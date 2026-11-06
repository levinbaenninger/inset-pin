import type { CaptureId, EditableFields } from "@shared/capture-record";
import type { ActionResult, SavedEdits } from "@shared/contracts";

import { reduceDraft, snapshotOf } from "./draft-lifecycle";
import type { Draft, DraftEvent, InFlight } from "./draft-lifecycle";

export const SAVE_AFTER_MS = 600;

export interface FieldStore {
  readonly update: (input: {
    readonly id: CaptureId;
    readonly fields: EditableFields;
  }) => Promise<ActionResult>;
}

/** A rejected call, such as a closed IPC channel, reads as a failed save. */
const settle = async (
  call: () => Promise<ActionResult>
): Promise<ActionResult> => {
  try {
    return await call();
  } catch (error) {
    return { message: String(error), ok: false };
  }
};

/** A copy waiting for the save of its rev, or of a later one. */
interface Waiter {
  readonly rev: number;
  readonly resolve: (result: ActionResult) => void;
}

const SAVED: ActionResult = { ok: true };

/** For a save still on its way when the wait before a close is over. */
const TOO_LONG = "Saving took too long.";

/** Captures whose typing isn't on disk, and the first error saving it gave. */
export interface Unsaved {
  readonly count: number;
  readonly message: string;
}

/**
 * Every capture's unsaved edits, kept above the pages, so a draft outlives
 * leaving its capture, closing the detail pane and coming back. Typing saves
 * a while after the last change; other changes and leaving save at once.
 * Saves of one capture reach main one at a time, in order.
 */
export class DraftStore {
  readonly #store: FieldStore;
  readonly #drafts = new Map<CaptureId, Draft>();
  readonly #timers = new Map<CaptureId, ReturnType<typeof setTimeout>>();
  readonly #waiters = new Map<CaptureId, Waiter[]>();
  readonly #listeners = new Set<() => void>();

  constructor(store: FieldStore) {
    this.#store = store;
  }

  /** For useSyncExternalStore: the same object until this capture's draft changes. */
  readonly get = (id: CaptureId): Draft | undefined => this.#drafts.get(id);

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Typing: saved a while after the last change, or at once for a ticked step or a moved pin. */
  edit(
    id: CaptureId,
    values: EditableFields,
    stored: EditableFields,
    { now = false }: { readonly now?: boolean } = {}
  ): void {
    this.#apply(id, { kind: "edit", stored, values });
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

  /** Saves the latest edit now; for a failed draft this is Retry. */
  flush(id: CaptureId): void {
    this.#stopTimer(id);

    const before = this.#drafts.get(id);

    this.#apply(id, { kind: "send" });

    const after = this.#drafts.get(id);

    if (after?.kind === "saving" && before?.kind !== "saving") {
      void this.#write(id, after.inFlight);
    }
  }

  /** Discard changes: the capture shows what is on disk again. */
  discard(id: CaptureId): void {
    this.#stopTimer(id);
    this.#apply(id, { kind: "discard" });
  }

  /**
   * For a copy: takes what the capture shows now, saves it and waits for the
   * disk. The copy carries this snapshot, never the fields as they are once
   * the save is done, and nothing when that save fails. A failed draft is
   * tried again. Null fields: nothing is typed, so the stored copy is current.
   */
  async settle(id: CaptureId): Promise<SavedEdits> {
    const draft = this.#drafts.get(id);

    if (draft === undefined) {
      return { fields: null, ok: true };
    }

    const snapshot = snapshotOf(draft);
    const saved = this.#waitFor(id, snapshot.rev);

    this.flush(id);

    const result = await saved;

    return result.ok
      ? { fields: snapshot.payload, ok: true }
      : { message: result.message, ok: false };
  }

  /** Before the window closes or the app quits: saves every draft, and waits at most `withinMs` for the disk. */
  async settleAll(withinMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    // oxlint-disable-next-line promise/avoid-new -- a deadline: it resolves on a timer.
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, withinMs);
    });

    await Promise.race([
      Promise.all(
        [...this.#drafts.keys()].map(async (id) => await this.settle(id))
      ),
      deadline,
    ]);
    clearTimeout(timer);
  }

  /** What closing or quitting now would lose: how many captures, and why; null when everything is saved. */
  readonly unsaved = (): Unsaved | null => {
    const left = [...this.#drafts.values()];

    return left.length === 0
      ? null
      : {
          count: left.length,
          message:
            left.find((draft) => draft.error !== null)?.error ?? TOO_LONG,
        };
  };

  /** Retry for every capture that couldn't be saved. */
  retryAll(): void {
    for (const id of this.#drafts.keys()) {
      this.flush(id);
    }
  }

  /** Discard changes in every capture, except where a save is already on its way. */
  discardAll(): void {
    for (const id of this.#drafts.keys()) {
      this.discard(id);
    }
  }

  /** The capture was deleted, so there is nothing left to save its typing into. */
  forget(id: CaptureId): void {
    this.#stopTimer(id);
    this.#apply(id, { kind: "removed" });
  }

  async #write(id: CaptureId, inFlight: InFlight): Promise<void> {
    const result = await settle(
      async () => await this.#store.update({ fields: inFlight.payload, id })
    );

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
      // Gone without a save of its own: nothing was left to write, or the capture was deleted and main refuses its copy. A discard never drops a draft with a save on its way.
      this.#resolve(id, () => true, SAVED);
    } else {
      this.#drafts.set(id, after);
    }

    for (const listener of this.#listeners) {
      listener();
    }
  }
}
