import { CaptureIdSchema } from "@shared/capture-record";
import type { CaptureId, EditableFields } from "@shared/capture-record";
import type { ActionResult } from "@shared/contracts";
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

  const update = async ({
    fields,
    id,
  }: {
    readonly id: CaptureId;
    readonly fields: EditableFields;
  }): Promise<ActionResult> => {
    sent.push({ id, title: fields.title });

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

  return { answer, drafts: new DraftStore({ update }), sent };
};

const FULL: ActionResult = { message: "The disk is full.", ok: false };

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
    expect(drafts.get(A)?.error).toBe("The disk is full.");
  });

  it("keeps a failed draft with nothing watching it, refuses its copy at once without saving it again, and copies it once Retry works", async () => {
    const { answer, drafts, sent } = heldDisk();

    drafts.edit(A, titled("Typed while full"), STORED, { now: true });
    await answer(FULL);
    // Another capture is opened and edited; A's page is long gone.
    drafts.edit(B, titled("Other"), STORED, { now: true });
    await answer();

    expect(drafts.get(A)).toMatchObject({
      error: "The disk is full.",
      kind: "failed",
      values: titled("Typed while full"),
    });

    // The disk has recovered, but nothing sends A's typing again until Retry.
    await expect(drafts.settle(A)).resolves.toStrictEqual({
      message: "The disk is full.",
      ok: false,
    });
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

    await expect(drafts.settle(A)).resolves.toStrictEqual({
      message: "The disk is full.",
      ok: false,
    });
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

  it("discards at once while a retry is on its way: shows what is saved, writes it after the retry, and the retry answers that it was discarded", async () => {
    const { answer, drafts, sent } = heldDisk();

    drafts.edit(A, titled("Typed"), STORED, { now: true });
    await answer(FULL);

    const retry = drafts.retry(A);
    const copy = drafts.settle(A);

    drafts.discard(A);

    const shown = drafts.get(A)?.values.title;

    await expect(Promise.all([retry, copy])).resolves.toStrictEqual([
      { message: "The changes were discarded.", ok: false },
      // The error still showed while the retry was on its way, so the copy was refused at once.
      { message: "The disk is full.", ok: false },
    ]);

    // The retry lands after all; the saved values written after it win.
    await answer();

    const afterRetry = drafts.get(A)?.values.title;

    await answer();

    expect({
      afterRetry,
      discards: drafts.discards(A),
      end: drafts.get(A),
      sent: sent.map(({ title }) => title),
      shown,
    }).toStrictEqual({
      afterRetry: "Total is off",
      discards: 1,
      end: undefined,
      sent: ["Typed", "Typed", "Total is off"],
      shown: "Total is off",
    });
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
      { count: 2, error: "The disk is full.", pending: true },
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
      { count: 1, error: "The disk is full.", pending: false },
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
      { count: 1, error: null, pending: true },
      null,
    ]);
  });

  it("discards back to the last save that landed, though the page still passes what it loaded before that save", async () => {
    const { answer, drafts, sent } = heldDisk();

    drafts.edit(A, titled("Saved first"), STORED, { now: true });
    await answer();
    // The page's reload after that save hasn't answered, so it still passes STORED.
    drafts.edit(A, titled("Discard me"), STORED, { now: true });
    await answer(FULL);

    void drafts.retry(A);
    drafts.discard(A);

    const shown = drafts.get(A)?.values.title;

    await answer();
    await answer();

    expect({
      after: drafts.saved(A)?.title,
      draft: drafts.get(A),
      sent: sent.map(({ title }) => title),
      shown,
    }).toStrictEqual({
      after: "Saved first",
      draft: undefined,
      sent: ["Saved first", "Discard me", "Discard me", "Saved first"],
      shown: "Saved first",
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
        error: "Saving didn’t finish in time.",
        result: { message: "Saving didn’t finish in time.", ok: false },
      },
      before: { error: "The disk is full.", result: null },
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
