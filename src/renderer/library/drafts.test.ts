import { CaptureIdSchema } from "@shared/capture-record";
import type { CaptureId, EditableFields } from "@shared/capture-record";
import type { ActionResult, SaveTag } from "@shared/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DraftStore, SAVE_AFTER_MS } from "./drafts";

const A = CaptureIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c");
const B = CaptureIdSchema.parse("7a1b2c3d-4e5f-4a7d-9b0c-5d8e6f7a1b2c");
const C = CaptureIdSchema.parse("9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d");

const STORED: EditableFields = {
  description: "Check with finance",
  due: null,
  pins: [{ x: 10, y: 20 }],
  steps: [],
  title: "Total is off",
};

const titled = (title: string): EditableFields => ({ ...STORED, title });

/** Main's update, held until the test answers it, as a slow or failing disk would. */
const heldDisk = () => {
  const sent: { id: CaptureId; title: string }[] = [];
  const pending: ((result: ActionResult) => void)[] = [];
  /** Each save's tag, by the title it carries. */
  const tags: { title: string; tag: SaveTag }[] = [];
  /** The saves Discard told main to drop, by the title they carry. */
  const undone: string[] = [];

  const update = async ({
    fields,
    id,
    tag,
  }: {
    readonly id: CaptureId;
    readonly fields: EditableFields;
    readonly tag: SaveTag;
  }): Promise<ActionResult> => {
    sent.push({ id, title: fields.title });
    tags.push({ tag, title: fields.title });

    // oxlint-disable-next-line promise/avoid-new -- the test answers the save later, through this callback.
    return await new Promise<ActionResult>((resolve) => {
      pending.push(resolve);
    });
  };

  /** Answers the oldest save on its way (saved, unless a failure is given), then lets the store react. */
  const answer = async (result?: ActionResult): Promise<void> => {
    pending.shift()?.(result ?? { ok: true });
    await vi.advanceTimersByTimeAsync(0);
  };

  const discard = async ({
    tag,
  }: {
    readonly id: CaptureId;
    readonly tag: SaveTag;
  }): Promise<ActionResult> => {
    undone.push(
      tags.find((one) => one.tag.seq === tag.seq && one.tag.epoch === tag.epoch)
        ?.title ?? "?"
    );

    return await Promise.resolve({ ok: true });
  };

  return {
    answer,
    drafts: new DraftStore({ discard, update }),
    sent,
    tags,
    undone,
  };
};

/** How main answers Discard changes, which a test changes as the disk heals. */
interface DiscardAnswer {
  discard: ActionResult | Promise<ActionResult>;
}

const FULL: ActionResult = { message: "The disk is full.", ok: false };

const unanswered = (_result: ActionResult): void => undefined;

const DISK_FULL = { during: "save", message: "The disk is full." };

/** A copy refused because a save of the capture failed. */
const REFUSED = { during: "save", message: "The disk is full.", ok: false };

describe(DraftStore, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves a while after the last edit, once, with the latest text", async () => {
    const { answer, drafts, sent } = heldDisk();

    drafts.edit(A, titled("Total is"), STORED);
    drafts.edit(A, titled("Total is wrong"), STORED);
    await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS);

    expect(sent).toStrictEqual([{ id: A, title: "Total is wrong" }]);
    expect(drafts.get(A)?.kind).toBe("saving");

    await answer();

    expect(drafts.get(A)).toBeUndefined();
  });

  it("copies the snapshot taken when the copy started, though a second edit is typed during the wait", async () => {
    const { answer, drafts, sent } = heldDisk();

    drafts.edit(A, titled("First"), STORED);

    const copy = drafts.settle(A);

    drafts.edit(A, titled("First and second"), STORED);
    await answer();

    await expect(copy).resolves.toStrictEqual({
      fields: titled("First"),
      ok: true,
    });

    await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS);
    await answer();

    expect(sent.map(({ title }) => title)).toStrictEqual([
      "First",
      "First and second",
    ]);
    expect(drafts.get(A)).toBeUndefined();
  });

  it("refuses a copy whose own rev fails to save, though a later edit then saves", async () => {
    const { answer, drafts } = heldDisk();

    drafts.edit(A, titled("First"), STORED);

    const copy = drafts.settle(A);

    drafts.edit(A, titled("Second"), STORED);
    await answer(FULL);

    await expect(copy).resolves.toStrictEqual({
      message: "The disk is full.",
      ok: false,
    });
    expect(drafts.get(A)?.error).toStrictEqual(DISK_FULL);
  });

  it("keeps a failed draft with nothing watching it, refuses its copy at once without saving it again, and copies it once Retry works", async () => {
    const { answer, drafts, sent } = heldDisk();

    drafts.edit(A, titled("Typed while full"), STORED, { now: true });
    await answer(FULL);
    // Another capture is opened and edited; A's page is long gone.
    drafts.edit(B, titled("Other"), STORED, { now: true });
    await answer();

    expect(drafts.get(A)).toMatchObject({
      error: DISK_FULL,
      kind: "failed",
      values: titled("Typed while full"),
    });

    // The disk has recovered, but nothing sends A's typing again until Retry.
    await expect(drafts.settle(A)).resolves.toStrictEqual(REFUSED);
    drafts.flush(A);

    const sentBeforeRetry = sent.map(({ title }) => title);
    const retried = drafts.retry(A);

    await answer();

    await expect(retried).resolves.toStrictEqual({ ok: true });
    await expect(drafts.settle(A)).resolves.toStrictEqual({
      fields: null,
      ok: true,
    });
    expect([sentBeforeRetry, sent.length, drafts.get(A)]).toStrictEqual([
      ["Typed while full", "Other"],
      3,
      undefined,
    ]);
  });

  it("refuses a copy at once while the capture still says it couldn't be saved, though more was typed since", async () => {
    const { answer, drafts, sent } = heldDisk();

    drafts.edit(A, titled("Typed while full"), STORED, { now: true });
    await answer(FULL);
    drafts.edit(A, titled("Typed while full, and more"), STORED);

    await expect(drafts.settle(A)).resolves.toStrictEqual(REFUSED);
    expect([sent.length, drafts.get(A)?.kind]).toStrictEqual([1, "dirty"]);
  });

  it("answers a Retry that doesn't land within its limit as not finished in time", async () => {
    const { answer, drafts } = heldDisk();

    drafts.edit(A, titled("Typed"), STORED, { now: true });
    await answer(FULL);

    const retried = drafts.retry(A, 3000);

    await vi.advanceTimersByTimeAsync(3000);

    await expect(retried).resolves.toStrictEqual({
      message: "Saving didn’t finish in time.",
      ok: false,
    });
  });

  it("discards at once while a retry is on its way: shows what is saved, tells main to drop the retry, writes nothing to undo it, and the retry answers that it was discarded", async () => {
    const { answer, drafts, sent, undone } = heldDisk();

    drafts.edit(A, titled("Typed"), STORED, { now: true });
    await answer(FULL);

    const retry = drafts.retry(A);
    const copy = drafts.settle(A);

    drafts.discard(A);

    await expect(Promise.all([retry, copy])).resolves.toStrictEqual([
      { message: "The changes were discarded.", ok: false },
      // The error still showed while the retry was on its way, so the copy was refused at once.
      REFUSED,
    ]);

    // Main says the retry landed: main put back what it replaced, and the library never takes it as saved.
    await answer();

    expect({
      discards: drafts.discards(A),
      end: drafts.get(A),
      saved: drafts.saved(A),
      sent: sent.map(({ title }) => title),
      undone,
    }).toStrictEqual({
      discards: 1,
      end: undefined,
      // What was saved before the discarded save stays the baseline.
      saved: STORED,
      sent: ["Typed", "Typed"],
      undone: ["Typed"],
    });
  });

  it("never takes a discarded save as saved, so a new edit starts from what was saved before it, under a new epoch, once main has answered the Discard", async () => {
    const { answer, drafts, sent, tags } = heldDisk();

    drafts.edit(A, titled("Discard me"), STORED, { now: true });
    drafts.discard(A);
    drafts.edit(A, titled("Kept"), STORED, { now: true });

    const beforeAnswer = sent.map(({ title }) => title);

    await vi.advanceTimersByTimeAsync(0);

    // The new edit waits only for main's answer to the Discard, not for the discarded save's.
    expect([beforeAnswer, sent.map(({ title }) => title)]).toStrictEqual([
      ["Discard me"],
      ["Discard me", "Kept"],
    ]);

    await answer();

    const afterDiscarded = drafts.get(A);

    await answer();

    expect({
      afterDiscarded: afterDiscarded?.confirmed,
      end: drafts.get(A),
      epochs: tags[0]?.tag.epoch === tags[1]?.tag.epoch,
      saved: drafts.saved(A)?.title,
    }).toStrictEqual({
      afterDiscarded: STORED,
      end: undefined,
      epochs: false,
      saved: "Kept",
    });
  });

  describe("when main can't put back what was saved", () => {
    const LOCKED: ActionResult = {
      message: "Inset can’t write to its data folder.",
      ok: false,
    };

    /** Main saves at once; its Discard answers as `disk.discard` says, and records the save each one names. */
    const lockedDisk = () => {
      const disk: DiscardAnswer = { discard: LOCKED };
      const named: SaveTag[] = [];
      const sent: string[] = [];
      let seq = 0;

      const drafts = new DraftStore({
        discard: async ({ tag }) => {
          named.push(tag);

          return await Promise.resolve(disk.discard);
        },
        update: async ({ fields, tag }) => {
          sent.push(fields.title);
          ({ seq } = tag);

          return await Promise.resolve({ ok: true });
        },
      });

      /** A save main wrote and is slow to answer: Discard then names it. */
      const landedThenDiscarded = async (title: string): Promise<number> => {
        drafts.edit(A, titled(title), STORED);
        drafts.flush(A);
        drafts.discard(A);
        await vi.advanceTimersByTimeAsync(0);

        return seq;
      };

      return { disk, drafts, landedThenDiscarded, named, sent };
    };

    it("brings the discarded changes back as failed, with Keep changes and Discard again, and refuses copies until one of them works", async () => {
      const { drafts, landedThenDiscarded } = lockedDisk();
      const seq = await landedThenDiscarded("Discard me");
      const draft = drafts.get(A);

      expect({
        copy: await drafts.settle(A),
        discards: drafts.discards(A),
        draft: draft === undefined ? null : { ...draft, undo: draft.undo?.seq },
        saved: drafts.saved(A),
        unsaved: drafts.unsaved(),
      }).toStrictEqual({
        copy: {
          during: "discard",
          message: "Inset can’t write to its data folder.",
          ok: false,
        },
        discards: 2,
        draft: {
          confirmed: STORED,
          error: {
            during: "discard",
            message: "Inset can’t write to its data folder.",
          },
          kind: "failed",
          rev: 1,
          undo: seq,
          values: titled("Discard me"),
        },
        saved: STORED,
        unsaved: {
          count: 1,
          error: "Inset can’t write to its data folder.",
          pending: false,
          undiscarded: true,
        },
      });
    });

    it("asks main again for the same save on the next Discard, even after more typing, and then shows what was saved", async () => {
      const { disk, drafts, landedThenDiscarded, named } = lockedDisk();
      const seq = await landedThenDiscarded("Discard me");

      drafts.edit(A, titled("Discard me, typed on"), STORED);
      disk.discard = { ok: true };
      drafts.discard(A);
      await vi.advanceTimersByTimeAsync(0);

      expect({
        draft: drafts.get(A),
        named: named.map((tag) => tag.seq),
        shown: drafts.get(A)?.values ?? drafts.saved(A),
      }).toStrictEqual({
        draft: undefined,
        named: [seq, seq],
        shown: STORED,
      });
    });

    it("never keeps it on its own, through a close, a quit or more typing: only Keep changes saves it, even when it holds the saved fields", async () => {
      const { drafts, landedThenDiscarded, sent } = lockedDisk();

      await landedThenDiscarded("Discard me");
      drafts.saveAll();
      drafts.edit(A, STORED, STORED);
      drafts.flush(A);
      await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS);

      const typed = { draft: drafts.get(A)?.kind, sent: [...sent] };

      void drafts.retry(A);
      await vi.advanceTimersByTimeAsync(0);

      expect({
        draft: drafts.get(A),
        sent,
        typed,
      }).toStrictEqual({
        draft: undefined,
        sent: ["Discard me", STORED.title],
        typed: { draft: "failed", sent: ["Discard me"] },
      });
    });

    it("counts Discard again from a close or a quit as unsaved until main answers, and a copy meanwhile copies what is saved", async () => {
      const { disk, drafts, landedThenDiscarded } = lockedDisk();
      let answer = unanswered;

      await landedThenDiscarded("Discard me");
      // oxlint-disable-next-line promise/avoid-new -- the test answers the Discard later, through this callback.
      disk.discard = new Promise<ActionResult>((resolve) => {
        answer = resolve;
      });
      drafts.discardAll();

      const copying = drafts.settle(A);

      await vi.advanceTimersByTimeAsync(0);

      const waiting = drafts.unsaved();

      answer({ ok: true });
      await vi.advanceTimersByTimeAsync(0);

      expect({
        copy: await copying,
        unsaved: drafts.unsaved(),
        waiting,
      }).toStrictEqual({
        copy: { fields: STORED, ok: true },
        unsaved: null,
        waiting: {
          count: 1,
          error: "Inset can’t write to its data folder.",
          pending: true,
          undiscarded: true,
        },
      });
    });

    it("sends none of the typing done while main answers the Discard, brings it back failed with the Discard, and names the same save on Discard again", async () => {
      const { disk, drafts, named, sent } = lockedDisk();
      let answer = unanswered;

      // oxlint-disable-next-line promise/avoid-new -- the test answers the Discard later, through this callback.
      disk.discard = new Promise<ActionResult>((resolve) => {
        answer = resolve;
      });
      drafts.edit(A, titled("Discard me"), STORED);
      drafts.flush(A);
      drafts.discard(A);
      drafts.edit(A, titled("Typed after"), STORED, { now: true });

      const quitting = drafts.settleAll(SAVE_AFTER_MS);

      await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS);

      const waiting = {
        quit: await quitting,
        sent: [...sent],
        unsaved: drafts.unsaved(),
      };

      answer(LOCKED);
      await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS);

      const draft = drafts.get(A);

      const typed = {
        copy: await drafts.settle(A),
        draft: draft === undefined ? null : [draft.kind, draft.error],
        sent: [...sent],
        values: draft?.values.title,
      };

      disk.discard = { ok: true };
      drafts.discard(A);
      await vi.advanceTimersByTimeAsync(0);

      expect({
        named: new Set(named.map((tag) => tag.seq)).size,
        shown: drafts.get(A)?.values ?? drafts.saved(A),
        typed,
        waiting,
      }).toStrictEqual({
        named: 1,
        shown: STORED,
        typed: {
          copy: { during: "discard", message: LOCKED.message, ok: false },
          draft: ["failed", { during: "discard", message: LOCKED.message }],
          sent: ["Discard me"],
          values: "Typed after",
        },
        waiting: {
          quit: "overdue",
          sent: ["Discard me"],
          unsaved: {
            count: 1,
            error: null,
            pending: true,
            undiscarded: false,
          },
        },
      });
    });

    it("waits for main's answer before a copy, at most the save limit, and copies what is saved once it is back", async () => {
      const { disk, drafts } = lockedDisk();
      let answer = unanswered;

      // oxlint-disable-next-line promise/avoid-new -- the test answers the Discard later, through this callback.
      disk.discard = new Promise<ActionResult>((resolve) => {
        answer = resolve;
      });
      drafts.edit(A, titled("Discard me"), STORED);
      drafts.flush(A);
      drafts.discard(A);

      const late = drafts.settle(A);

      await vi.advanceTimersByTimeAsync(3000);

      const copying = drafts.settle(A);

      answer({ ok: true });
      await vi.advanceTimersByTimeAsync(0);

      expect({
        copied: await copying,
        late: await late,
      }).toStrictEqual({
        copied: { fields: STORED, ok: true },
        late: { message: "Saving didn’t finish in time.", ok: false },
      });
    });

    it("opens a Discard main still owes as failed, refuses its copies, keeps it through typing, and Keep changes sends even the saved fields so main keeps them", async () => {
      const { drafts, sent } = lockedDisk();
      const tag = { epoch: "closed-page.1", seq: 7 };

      drafts.owe([
        {
          confirmed: STORED,
          id: A,
          message: LOCKED.message,
          tag,
          values: titled("Discarded"),
        },
      ]);
      // A capture the page already holds changes for keeps them.
      drafts.owe([
        {
          confirmed: STORED,
          id: A,
          message: "Other",
          tag,
          values: titled("Other"),
        },
      ]);

      const opened = {
        copy: await drafts.settle(A),
        draft: drafts.get(A),
        saved: drafts.saved(A),
        unsaved: drafts.unsaved(),
      };

      drafts.edit(A, STORED, titled("Discarded"));
      await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS);

      const typed = { draft: drafts.get(A)?.kind, sent: [...sent] };
      const keeping = drafts.retry(A);

      await vi.advanceTimersByTimeAsync(0);

      expect({
        draft: drafts.get(A),
        kept: await keeping,
        opened,
        sent,
        typed,
      }).toStrictEqual({
        draft: undefined,
        kept: { ok: true },
        opened: {
          copy: { during: "discard", message: LOCKED.message, ok: false },
          draft: {
            confirmed: STORED,
            error: { during: "discard", message: LOCKED.message },
            kind: "failed",
            rev: 1,
            undo: tag,
            values: titled("Discarded"),
          },
          saved: STORED,
          unsaved: {
            count: 1,
            error: LOCKED.message,
            pending: false,
            undiscarded: true,
          },
        },
        sent: [STORED.title],
        typed: { draft: "failed", sent: [] },
      });
    });

    it("lets a close or a quit go on after Discard and quit: main finishes the Discard at the next start", async () => {
      const { drafts } = lockedDisk();

      drafts.edit(A, titled("Discard me"), STORED);
      drafts.flush(A);
      drafts.discardAll();
      await vi.advanceTimersByTimeAsync(0);

      expect([drafts.get(A), drafts.unsaved()]).toStrictEqual([
        undefined,
        null,
      ]);
    });
  });

  it("names only a save on its way, never one main already confirmed", async () => {
    const { answer, drafts, undone } = heldDisk();

    drafts.edit(A, titled("Confirmed"), STORED, { now: true });
    await answer();
    drafts.edit(A, titled("Not sent yet"), STORED);
    drafts.discard(A);

    expect([undone, drafts.saved(A)?.title, drafts.get(A)]).toStrictEqual([
      [],
      "Confirmed",
      undefined,
    ]);
  });

  it("sends nothing when only a trailing space was typed, and copies the stored capture", async () => {
    const { drafts, sent } = heldDisk();

    drafts.edit(A, titled("Total is off "), STORED);
    await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS);

    await expect(drafts.settle(A)).resolves.toStrictEqual({
      fields: null,
      ok: true,
    });

    drafts.edit(A, titled("Total is off!"), STORED, { now: true });

    expect(sent).toStrictEqual([{ id: A, title: "Total is off!" }]);
  });

  it("saves every draft before a close, waits at most the given time, and counts what is left with the first error", async () => {
    const { answer, drafts } = heldDisk();

    drafts.edit(A, titled("A typed"), STORED);
    drafts.edit(B, titled("B typed"), STORED);
    drafts.edit(C, titled("C typed"), STORED);

    const settled = drafts.settleAll(1000);

    await answer();
    await answer(FULL);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(settled).resolves.toBe("overdue");
    expect([
      drafts.unsaved(),
      drafts.get(B)?.kind,
      drafts.get(C)?.kind,
    ]).toStrictEqual([
      {
        count: 2,
        error: "The disk is full.",
        pending: true,
        undiscarded: false,
      },
      "failed",
      "saving",
    ]);
  });

  it("ends the wait before a close as soon as only failed drafts are left, after sending a failed one again", async () => {
    const { answer, drafts, sent } = heldDisk();

    drafts.edit(A, titled("A typed"), STORED, { now: true });
    await answer(FULL);

    const settled = drafts.settleAll(3000);

    await answer(FULL);

    await expect(settled).resolves.toBe("settled");
    expect([drafts.unsaved(), sent.length]).toStrictEqual([
      {
        count: 1,
        error: "The disk is full.",
        pending: false,
        undiscarded: false,
      },
      2,
    ]);
  });

  it("counts a slow save as unsaved with no error, and nothing once it lands", async () => {
    const { answer, drafts } = heldDisk();

    drafts.edit(A, titled("A typed"), STORED);

    const settled = drafts.settleAll(1000);

    await vi.advanceTimersByTimeAsync(1000);
    await settled;

    const slow = drafts.unsaved();

    await answer();

    expect([slow, drafts.unsaved()]).toStrictEqual([
      { count: 1, error: null, pending: true, undiscarded: false },
      null,
    ]);
  });

  it("discards back to the last save that landed, though the page still passes what it loaded before that save", async () => {
    const { answer, drafts, sent, undone } = heldDisk();

    drafts.edit(A, titled("Saved first"), STORED, { now: true });
    await answer();
    // The page's reload after that save hasn't answered, so it still passes STORED.
    drafts.edit(A, titled("Discard me"), STORED, { now: true });
    await answer(FULL);

    void drafts.retry(A);
    drafts.discard(A);

    await answer();

    expect({
      after: drafts.saved(A)?.title,
      draft: drafts.get(A),
      sent: sent.map(({ title }) => title),
      undone,
    }).toStrictEqual({
      after: "Saved first",
      draft: undefined,
      sent: ["Saved first", "Discard me", "Discard me"],
      undone: ["Discard me"],
    });
  });

  it("starts a new edit from the last save that landed, so Discard with nothing on its way shows that save", async () => {
    const { answer, drafts } = heldDisk();

    drafts.edit(A, titled("Saved first"), STORED, { now: true });
    await answer();
    drafts.edit(A, titled("Discard me"), STORED, { now: true });
    await answer(FULL);
    drafts.discard(A);

    expect([drafts.get(A), drafts.saved(A)?.title]).toStrictEqual([
      undefined,
      "Saved first",
    ]);
  });

  it("says a Retry didn't finish once its 3 s are over, and lets it land later", async () => {
    const { answer, drafts } = heldDisk();

    drafts.edit(A, titled("A typed"), STORED, { now: true });
    await answer(FULL);

    let result: ActionResult | null = null;

    void drafts.retry(A).then((answered) => {
      result = answered;

      return answered;
    });
    await vi.advanceTimersByTimeAsync(2999);

    const before = { error: drafts.get(A)?.error, result };

    await vi.advanceTimersByTimeAsync(1);

    const after = { error: drafts.get(A)?.error, result };

    await answer();

    expect({ after, before, landed: drafts.get(A) }).toStrictEqual({
      after: {
        error: { during: "save", message: "Saving didn’t finish in time." },
        result: { message: "Saving didn’t finish in time.", ok: false },
      },
      before: { error: DISK_FULL, result: null },
      landed: undefined,
    });
  });

  it("forgets a deleted capture's draft, though its save is on its way and then fails", async () => {
    const { answer, drafts } = heldDisk();

    drafts.edit(A, titled("A typed"), STORED, { now: true });
    drafts.forget(A);
    await answer(FULL);

    expect([drafts.get(A), drafts.unsaved()]).toStrictEqual([undefined, null]);
  });
});
