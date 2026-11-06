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

  it("keeps a failed draft with nothing watching it, refuses copies while it fails, and copies it once a retry works", async () => {
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

    const refused = drafts.settle(A);

    await answer(FULL);

    await expect(refused).resolves.toStrictEqual({
      message: "The disk is full.",
      ok: false,
    });

    const copied = drafts.settle(A);

    await answer();

    await expect(copied).resolves.toStrictEqual({
      fields: titled("Typed while full"),
      ok: true,
    });
    expect(sent.map(({ title }) => title)).toStrictEqual([
      "Typed while full",
      "Other",
      "Typed while full",
      "Typed while full",
    ]);
    expect(drafts.get(A)).toBeUndefined();
  });

  it("drops a draft only when the user discards it, and not while a retry is on its way", async () => {
    const { answer, drafts, sent } = heldDisk();

    drafts.edit(A, titled("Typed"), STORED, { now: true });
    await answer(FULL);

    // Retry, then Discard changes before the retry answers: the retry could still write the text.
    const retry = drafts.settle(A);

    drafts.discard(A);

    expect(drafts.get(A)?.kind).toBe("saving");

    await answer(FULL);

    await expect(retry).resolves.toStrictEqual({
      message: "The disk is full.",
      ok: false,
    });

    drafts.discard(A);

    expect([drafts.get(A), sent.length]).toStrictEqual([undefined, 2]);
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
    await settled;

    expect([
      drafts.unsaved(),
      drafts.get(B)?.kind,
      drafts.get(C)?.kind,
    ]).toStrictEqual([
      { count: 2, message: "The disk is full." },
      "failed",
      "saving",
    ]);
  });

  it("says saving took too long while only a slow save is left, and nothing once it lands", async () => {
    const { answer, drafts } = heldDisk();

    drafts.edit(A, titled("A typed"), STORED);

    const settled = drafts.settleAll(1000);

    await vi.advanceTimersByTimeAsync(1000);
    await settled;

    const slow = drafts.unsaved();

    await answer();

    expect([slow, drafts.unsaved()]).toStrictEqual([
      { count: 1, message: "Saving took too long." },
      null,
    ]);
  });

  it("forgets a deleted capture's draft, though its save is on its way and then fails", async () => {
    const { answer, drafts } = heldDisk();

    drafts.edit(A, titled("A typed"), STORED, { now: true });
    drafts.forget(A);
    await answer(FULL);

    expect([drafts.get(A), drafts.unsaved()]).toStrictEqual([undefined, null]);
  });
});
