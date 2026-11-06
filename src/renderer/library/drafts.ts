import type { CaptureId, EditableFields } from "@shared/capture-record";
import { LEAVE_SAVE_WAIT_MS, SAVE_TOO_SLOW } from "@shared/contracts";
import type {
  ActionResult,
  OwedDiscard,
  SavedEdits,
  SaveTag,
} from "@shared/contracts";

import { reduceDraft, snapshotOf, storedFields } from "./draft-lifecycle";
import type {
  Draft,
  DraftError,
  DraftEvent,
  InFlight,
} from "./draft-lifecycle";

export const SAVE_AFTER_MS = 600;

export interface FieldStore {
  readonly update: (input: {
    readonly id: CaptureId;
    readonly fields: EditableFields;
    readonly tag: SaveTag;
  }) => Promise<ActionResult>;
  /** Discard changes while this save is on its way: main drops it, or puts back what it replaced. */
  readonly discard: (input: {
    readonly id: CaptureId;
    readonly tag: SaveTag;
  }) => Promise<ActionResult>;
}

/** A rejected call, such as a closed IPC channel, reads as a failed save. */
const settle = async (
  call: () => Promise<ActionResult>
): Promise<ActionResult> => {
  try {
    return await call();
  } catch {
    return { message: "Inset couldn’t reach the app.", ok: false };
  }
};

/** A copy waiting for the save of its rev, or of a later one. */
interface Waiter {
  readonly rev: number;
  readonly resolve: (result: ActionResult) => void;
}

const SAVED: ActionResult = { ok: true };

/** A copy that waited for typing the user then discarded copies nothing. */
const DISCARDED: ActionResult = {
  message: "The changes were discarded.",
  ok: false,
};

/** Captures whose typing isn't on disk. */
export interface Unsaved {
  readonly count: number;
  /** The first error saving or discarding gave, in words; null while nothing has failed. */
  readonly error: string | null;
  /** Whether any of it is still being saved, rather than waiting for Retry. */
  readonly pending: boolean;
  /** Whether all of it is changes main couldn't discard, so leaving asks about discarding rather than saving. */
  readonly undiscarded: boolean;
}

/** How the wait before a close or a quit ended. */
export type Settled = "settled" | "overdue";

const TOO_SLOW: ActionResult = { message: SAVE_TOO_SLOW, ok: false };

/** The answer, or TOO_SLOW once `withinMs` is over. */
const withinLimit = async (
  answer: Promise<ActionResult>,
  withinMs: number
): Promise<ActionResult> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  // oxlint-disable-next-line promise/avoid-new -- a deadline: it resolves on a timer.
  const late = new Promise<ActionResult>((resolve) => {
    timer = setTimeout(() => {
      resolve(TOO_SLOW);
    }, withinMs);
  });

  const result = await Promise.race([answer, late]);

  clearTimeout(timer);

  return result;
};

const nothing = (): void => undefined;

/** A Discard main couldn't finish waits for the user: saving it then would keep what they discarded. */
const waitsForUser = (draft: Draft): boolean =>
  draft.kind === "failed" && draft.error.during === "discard";

/** A Discard on its way to main: its answer, the same once this store has taken it in, and the error the capture showed until then. */
interface Undoing {
  readonly answer: Promise<ActionResult>;
  readonly done: Promise<ActionResult>;
  readonly error: DraftError | null;
}

/**
 * Every capture's unsaved edits, kept above the pages, so a draft outlives
 * leaving its capture, closing the detail pane and coming back. Typing saves
 * a while after the last change; other changes and leaving save at once.
 * Saves of one capture reach main one at a time, in order.
 *
 * Each save carries its capture's epoch (SPEC round 8). Discard changes ends
 * the epoch: main drops the save on its way, or renames back what it
 * replaced, and its answer is ignored here, so a discarded save never
 * becomes what this library takes as saved.
 */
export class DraftStore {
  readonly #store: FieldStore;
  readonly #drafts = new Map<CaptureId, Draft>();
  readonly #timers = new Map<CaptureId, ReturnType<typeof setTimeout>>();
  readonly #waiters = new Map<CaptureId, Waiter[]>();
  readonly #discards = new Map<CaptureId, number>();
  /** The saved baseline: what the last save main confirmed in the current epoch wrote, or what a discarded draft last knew was saved. Saves land in order, so this is what the disk holds. */
  readonly #saved = new Map<CaptureId, EditableFields>();
  readonly #listeners = new Set<() => void>();
  /** Tells this page's epochs from a page loaded before it, whose epochs main may have ended. */
  readonly #page = crypto.randomUUID();
  #epochCount = 0;
  #seq = 0;
  /** Per capture, the run of edits its saves belong to; Discard changes starts a new one. */
  readonly #epochs = new Map<CaptureId, string>();
  /** Per capture, the save on its way. */
  readonly #sending = new Map<CaptureId, SaveTag>();
  /** Per capture, a Discard on its way: the changes count as unsaved, and nothing is saved, until main has put back what is saved. */
  readonly #undoing = new Map<CaptureId, Undoing>();

  constructor(store: FieldStore) {
    this.#store = store;
  }

  /** For useSyncExternalStore: the same object until this capture's draft changes. */
  readonly get = (id: CaptureId): Draft | undefined => this.#drafts.get(id);

  /**
   * What the disk holds since this library last saved or discarded changes
   * to the capture, in stored form; undefined before either. The capture a
   * page loaded can be older until its reload answers, or newer while it
   * shows a save that was then discarded.
   */
  readonly saved = (id: CaptureId): EditableFields | undefined =>
    this.#saved.get(id);

  /** How many times this capture's changes were discarded, so its page knows to show what is saved again. */
  readonly discards = (id: CaptureId): number => this.#discards.get(id) ?? 0;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  };

  /**
   * Typing: saved a while after the last change, or at once for a ticked
   * step or a moved pin. A new draft starts from the last save that landed
   * when there is one, rather than `stored`, which may predate it.
   */
  edit(
    id: CaptureId,
    values: EditableFields,
    stored: EditableFields,
    { now = false }: { readonly now?: boolean } = {}
  ): void {
    this.#apply(id, {
      kind: "edit",
      stored: this.#saved.get(id) ?? stored,
      values,
    });
    this.#stopTimer(id);

    if (now) {
      this.flush(id);
    } else if (this.#drafts.has(id)) {
      this.#timers.set(
        id,
        setTimeout(() => {
          this.#timers.delete(id);
          this.flush(id);
        }, SAVE_AFTER_MS)
      );
    }
  }

  /** Saves the latest edit now. A draft whose save failed stays as it is: only Retry sends it again. */
  flush(id: CaptureId): void {
    this.#send(id, "send");
  }

  /** Retry: saves the capture's changes again, and answers how that went within `withinMs`. */
  async retry(
    id: CaptureId,
    withinMs = LEAVE_SAVE_WAIT_MS
  ): Promise<ActionResult> {
    const draft = this.#drafts.get(id);

    if (draft === undefined) {
      return SAVED;
    }

    const saved = this.#waitFor(id, draft.rev);

    this.#send(id, "retry");

    const result = await withinLimit(saved, withinMs);

    if (result === TOO_SLOW) {
      this.#apply(id, { kind: "overdue" });
    }

    return result;
  }

  /**
   * Discard changes: the capture shows what is saved again, at once. A save
   * already on its way belongs to the epoch this ends: main drops it, or
   * renames back the file it replaced. Nothing is written to undo it. When
   * main can't put back what is saved, the changes come back failed, with
   * Keep changes and Discard again, unless the window is closing or the app
   * quitting: main's marker then finishes the Discard at the next start.
   *
   * A Discard that names a save counts as unsaved until main answers, and
   * nothing of the capture is saved meanwhile, so a close waits for it and
   * typing never replaces what main puts back. Its changes come back, with
   * the typing since, whenever it fails. Only a first Discard sent as the
   * window closes or the app quits lets go at once (SPEC round 7).
   */
  discard(id: CaptureId, { leaving = false } = {}): void {
    const draft = this.#drafts.get(id);

    if (draft === undefined) {
      return;
    }

    const held = this.#sending.get(id) ?? draft.undo;

    // What main puts back is what the draft last knew was saved; a reload may already show the discarded save.
    this.#saved.set(id, draft.confirmed);
    this.#stopTimer(id);
    this.#discards.set(id, this.discards(id) + 1);
    this.#resolve(id, () => true, DISCARDED);
    this.#sending.delete(id);
    this.#epochs.delete(id);

    if (held === null) {
      this.#apply(id, { kind: "discard" });

      return;
    }

    // Main's marker finishes it at the next start, and a library opened before then hears it is owed.
    this.#sendDiscard(id, held, draft, leaving && draft.undo === null);
    this.#apply(id, { kind: "discard" });
  }

  /**
   * As the page loads: each Discard main still owes, from a page closed
   * before this one. One main couldn't finish shows failed with Keep changes
   * and Discard again. One main hasn't answered yet is asked again, and
   * waited for as the page that sent it would have.
   */
  owe(owed: readonly OwedDiscard[]): void {
    for (const { confirmed, id, message, tag, values } of owed) {
      if (!this.#drafts.has(id) && !this.#undoing.has(id)) {
        const saved = storedFields(confirmed);

        this.#saved.set(id, saved);

        if (message === null) {
          this.#sendDiscard(
            id,
            tag,
            {
              confirmed: saved,
              error: null,
              inFlight: null,
              kind: "dirty",
              rev: 1,
              undo: tag,
              values,
            },
            false
          );
          this.#changed();
        } else {
          this.#apply(id, {
            draft: {
              confirmed: saved,
              error: { during: "discard", message },
              kind: "failed",
              rev: 1,
              undo: tag,
              values,
            },
            kind: "undiscarded",
            message,
            tag,
          });
        }
      }
    }
  }

  /**
   * For a copy: takes what the capture shows now, saves it and waits for the
   * disk. The copy carries this snapshot, never the fields as they are once
   * the save is done, and nothing when that save fails. While the capture
   * says its changes couldn't be saved, even with typing since, the copy is
   * refused at once and nothing is saved again; Retry does that. Null fields:
   * nothing is typed, so the stored copy is current.
   */
  async settle(id: CaptureId): Promise<SavedEdits> {
    const undoing = this.#undoing.get(id);

    if (undoing !== undefined) {
      return await this.#settleUndoing(id, undoing);
    }

    const draft = this.#drafts.get(id);

    if (draft === undefined) {
      return { fields: null, ok: true };
    }

    if (draft.error !== null) {
      return {
        during: draft.error.during,
        message: draft.error.message,
        ok: false,
      };
    }

    const snapshot = snapshotOf(draft);
    const saved = this.#waitFor(id, snapshot.rev);

    this.flush(id);

    const result = await saved;

    return result.ok
      ? { fields: snapshot.payload, ok: true }
      : { message: result.message, ok: false };
  }

  /**
   * Before the window closes or the app quits: saves every draft, a failed
   * one too, and waits at most `withinMs` until no save is on its way.
   */
  async settleAll(withinMs: number): Promise<Settled> {
    this.saveAll();

    if (this.#quiet()) {
      return "settled";
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop = nothing;

    // oxlint-disable-next-line promise/avoid-new -- resolved by a timer or by the store's listener.
    const outcome = await new Promise<Settled>((resolve) => {
      timer = setTimeout(() => {
        resolve("overdue");
      }, withinMs);
      stop = this.subscribe(() => {
        if (this.#quiet()) {
          resolve("settled");
        }
      });
    });

    clearTimeout(timer);
    stop();

    return outcome;
  }

  /** What closing or quitting now would lose: how many captures, and why; null when everything is saved. */
  readonly unsaved = (): Unsaved | null => {
    const left = [...this.#drafts.values()];
    const captures = new Set([...this.#drafts.keys(), ...this.#undoing.keys()]);
    const count = captures.size;

    const error = [...left, ...this.#undoing.values()].find(
      (draft) => draft.error !== null
    )?.error;

    return count === 0
      ? null
      : {
          count,
          error: error?.message ?? null,
          pending: !this.#quiet(),
          undiscarded: left.every(waitsForUser),
        };
  };

  /** Retry for every capture that holds changes: the user asked, so a Discard main couldn't finish is kept too (Keep changes). */
  retryAll(): void {
    for (const id of this.#drafts.keys()) {
      this.#send(id, "retry");
    }
  }

  /** Before a close or a quit: saves every capture's changes, a failed save's too, but leaves a Discard main couldn't finish to the prompt. */
  saveAll(): void {
    for (const [id, draft] of this.#drafts) {
      if (!waitsForUser(draft)) {
        this.#send(id, "retry");
      }
    }
  }

  /** Discard changes in every capture, as the window closes or the app quits. */
  discardAll(): void {
    for (const id of this.#drafts.keys()) {
      this.discard(id, { leaving: true });
    }
  }

  /** The capture was deleted, so there is nothing left to save its typing into. */
  forget(id: CaptureId): void {
    this.#stopTimer(id);
    this.#saved.delete(id);
    this.#sending.delete(id);
    this.#epochs.delete(id);
    this.#apply(id, { kind: "removed" });
  }

  #epoch(id: CaptureId): string {
    const known = this.#epochs.get(id);

    if (known !== undefined) {
      return known;
    }

    this.#epochCount += 1;

    const epoch = `${this.#page}.${String(this.#epochCount)}`;

    this.#epochs.set(id, epoch);

    return epoch;
  }

  /** What is left once nothing is on its way: only failed drafts, which wait for the user. */
  #quiet(): boolean {
    return (
      this.#undoing.size === 0 &&
      [...this.#drafts.values()].every((draft) => draft.kind === "failed")
    );
  }

  /**
   * A copy of a capture whose Discard is on its way takes what the capture
   * shows as it starts, then waits for main, at most the save limit. It
   * copies that once main has put back what is saved and any typing it
   * carries is saved, and is refused once the changes are back, or when main
   * doesn't answer in time.
   */
  async #settleUndoing(id: CaptureId, undoing: Undoing): Promise<SavedEdits> {
    const draft = this.#drafts.get(id);
    const snapshot = draft === undefined ? null : snapshotOf(draft);
    const fields = snapshot?.payload ?? this.#saved.get(id) ?? null;

    const saved =
      snapshot === null
        ? Promise.resolve(SAVED)
        : this.#waitFor(id, snapshot.rev);

    const discarded = await withinLimit(undoing.done, LEAVE_SAVE_WAIT_MS);

    if (discarded === TOO_SLOW) {
      return { message: SAVE_TOO_SLOW, ok: false };
    }

    if (!discarded.ok) {
      return { during: "discard", message: discarded.message, ok: false };
    }

    const result = await saved;

    return result.ok
      ? { fields, ok: true }
      : { message: result.message, ok: false };
  }

  /** Asks main to put back what was saved before `discarded`; counted as unsaved until main answers, unless it lets go at once. */
  #sendDiscard(
    id: CaptureId,
    tag: SaveTag,
    discarded: Draft,
    letsGo: boolean
  ): void {
    const answer = settle(async () => await this.#store.discard({ id, tag }));
    const done = this.#undo(id, tag, discarded, answer, letsGo);

    // Counted before the draft goes, so the capture never reads as saved meanwhile.
    if (!letsGo) {
      this.#undoing.set(id, { answer, done, error: discarded.error });
    }
  }

  async #undo(
    id: CaptureId,
    tag: SaveTag,
    discarded: Draft,
    answer: Promise<ActionResult>,
    letsGo: boolean
  ): Promise<ActionResult> {
    const result = await answer;
    const counted = this.#undoing.get(id)?.answer === answer;

    if (counted) {
      this.#undoing.delete(id);
    }

    if (result.ok || letsGo) {
      // Typing done meanwhile waited for this answer.
      if (counted) {
        this.flush(id);
        this.#changed();
      }

      return result;
    }

    // The discarded save stays on disk: its changes show again, failed, until Keep changes keeps them or Discard again gets them back.
    if (!this.#drafts.has(id)) {
      this.#discards.set(id, this.discards(id) + 1);
    }

    this.#apply(id, {
      draft: discarded,
      kind: "undiscarded",
      message: result.message,
      tag,
    });
    this.#resolve(id, () => true, result);

    return result;
  }

  #send(id: CaptureId, kind: "send" | "retry"): void {
    this.#stopTimer(id);

    // A save now would replace what main is putting back, and keep what the user discarded.
    if (this.#undoing.has(id)) {
      return;
    }

    const before = this.#drafts.get(id);

    this.#apply(id, { kind });

    const after = this.#drafts.get(id);

    if (after?.kind === "saving" && before?.kind !== "saving") {
      void this.#write(id, after.inFlight);
    }
  }

  async #write(id: CaptureId, inFlight: InFlight): Promise<void> {
    this.#seq += 1;

    const tag: SaveTag = { epoch: this.#epoch(id), seq: this.#seq };

    this.#sending.set(id, tag);

    const result = await settle(
      async () =>
        await this.#store.update({ fields: inFlight.payload, id, tag })
    );

    // Discarded, or deleted, while on its way: the answer belongs to no draft, and a discarded save never becomes what is saved.
    if (this.#sending.get(id) !== tag) {
      return;
    }

    this.#sending.delete(id);

    if (result.ok) {
      this.#saved.set(id, inFlight.payload);
    }

    this.#apply(id, { kind: "answered", result, rev: inFlight.rev });
    this.#resolve(id, (waiter) => waiter.rev <= inFlight.rev, result);

    // The edit typed meanwhile goes next, unless its pause is still running and no copy waits for it.
    const next = this.#drafts.get(id);

    if (
      next?.kind === "dirty" &&
      (!this.#timers.has(id) || this.#waiters.has(id))
    ) {
      this.flush(id);
    }
  }

  async #waitFor(id: CaptureId, rev: number): Promise<ActionResult> {
    // oxlint-disable-next-line promise/avoid-new -- the answer arrives through #write, so this waits on its callback.
    return await new Promise<ActionResult>((resolve) => {
      this.#waiters.set(id, [
        ...(this.#waiters.get(id) ?? []),
        { resolve, rev },
      ]);
    });
  }

  #resolve(
    id: CaptureId,
    covered: (waiter: Waiter) => boolean,
    result: ActionResult
  ): void {
    const waiting = this.#waiters.get(id) ?? [];
    const rest = waiting.filter((waiter) => !covered(waiter));

    if (rest.length === 0) {
      this.#waiters.delete(id);
    } else {
      this.#waiters.set(id, rest);
    }

    for (const waiter of waiting) {
      if (covered(waiter)) {
        waiter.resolve(result);
      }
    }
  }

  #stopTimer(id: CaptureId): void {
    clearTimeout(this.#timers.get(id));
    this.#timers.delete(id);
  }

  #apply(id: CaptureId, event: DraftEvent): void {
    const before = this.#drafts.get(id) ?? null;
    const after = reduceDraft(before, event);

    if (after === before) {
      return;
    }

    if (after === null) {
      this.#drafts.delete(id);
      // Gone without a failed save: nothing was left to write, the capture was deleted and main refuses its copy, or a discard already answered its copies.
      this.#resolve(id, () => true, SAVED);
    } else {
      this.#drafts.set(id, after);
    }

    this.#changed();
  }

  #changed(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
