import type { EditableFields } from "@shared/capture-record";
import { describe, expect, it } from "vitest";

import { reduceDraft, storedFields } from "./draft-lifecycle";
import type { Draft, DraftEvent } from "./draft-lifecycle";

const STORED: EditableFields = {
  description: "Check with finance",
  due: null,
  pins: [{ x: 10, y: 20 }],
  steps: [{ done: false, id: "s1", text: "Ask" }],
  title: "Total is off",
};

const titled = (title: string): EditableFields => ({ ...STORED, title });

const edit = (title: string): DraftEvent => ({
  kind: "edit",
  stored: STORED,
  values: titled(title),
});

const SEND: DraftEvent = { kind: "send" };

const RETRY: DraftEvent = { kind: "retry" };

const DISCARD: DraftEvent = { kind: "discard" };

const ok = (rev: number): DraftEvent => ({
  kind: "answered",
  result: { ok: true },
  rev,
});

const failed = (rev: number, message = "The disk is full."): DraftEvent => ({
  kind: "answered",
  result: { message, ok: false },
  rev,
});

const run = (...events: readonly DraftEvent[]): Draft | null => {
  let draft: Draft | null = null;

  for (const event of events) {
    draft = reduceDraft(draft, event);
  }

  return draft;
};

describe(reduceDraft, () => {
  it("starts a dirty draft on the first edit, from what is stored", () => {
    expect(run(edit("Total is wrong"))).toStrictEqual({
      confirmed: STORED,
      error: null,
      inFlight: null,
      kind: "dirty",
      rev: 1,
      undo: null,
      values: titled("Total is wrong"),
    });
  });

  it("starts no draft for a trailing space, which saving would trim away", () => {
    expect(run(edit("Total is off "))).toBeNull();
    expect(run(edit("Total is off!"))?.kind).toBe("dirty");
  });

  it("sends the latest rev and goes clean when its save succeeds", () => {
    const saving = run(edit("Total is"), edit("Total is wrong"), SEND);

    expect(saving).toStrictEqual({
      confirmed: STORED,
      error: null,
      inFlight: { payload: titled("Total is wrong"), rev: 2 },
      kind: "saving",
      rev: 2,
      undo: null,
      values: titled("Total is wrong"),
    });
    expect(reduceDraft(saving, ok(2))).toBeNull();
  });

  it("keeps a second edit made during an in-flight save, and saves it next", () => {
    const during = run(edit("First"), SEND, edit("Second"));

    expect(during).toStrictEqual({
      confirmed: STORED,
      error: null,
      inFlight: { payload: titled("First"), rev: 1 },
      kind: "dirty",
      rev: 2,
      undo: null,
      values: titled("Second"),
    });

    // Saves go one at a time: sending now waits for the first answer.
    expect(reduceDraft(during, SEND)).toBe(during);

    const afterFirst = reduceDraft(during, ok(1));

    expect(afterFirst).toStrictEqual({
      confirmed: titled("First"),
      error: null,
      inFlight: null,
      kind: "dirty",
      rev: 2,
      undo: null,
      values: titled("Second"),
    });
    expect(reduceDraft(afterFirst, SEND)).toMatchObject({
      inFlight: { payload: titled("Second"), rev: 2 },
      kind: "saving",
    });
    expect(
      run(edit("First"), SEND, edit("Second"), ok(1), SEND, ok(2))
    ).toBeNull();
  });

  it("doesn't go clean when the edit returns to what is stored while an older save can still land", () => {
    const back = run(edit("Changed"), SEND, edit("Total is off"), ok(1));

    expect(back).toMatchObject({ confirmed: titled("Changed"), kind: "dirty" });
    expect(reduceDraft(back, SEND)).toMatchObject({
      inFlight: { payload: STORED, rev: 2 },
      kind: "saving",
    });
  });

  it("lets a failed older save go when a newer edit is waiting, and keeps its error until a save succeeds", () => {
    const afterFailure = run(edit("First"), SEND, edit("Second"), failed(1));

    expect(afterFailure).toStrictEqual({
      confirmed: STORED,
      error: { during: "save", message: "The disk is full." },
      inFlight: null,
      kind: "dirty",
      rev: 2,
      undo: null,
      values: titled("Second"),
    });
    expect(reduceDraft(reduceDraft(afterFailure, SEND), ok(2))).toBeNull();
  });

  it("fails when the latest rev's save fails, and keeps the values", () => {
    expect(run(edit("Typed"), SEND, failed(1))).toStrictEqual({
      confirmed: STORED,
      error: { during: "save", message: "The disk is full." },
      kind: "failed",
      rev: 1,
      undo: null,
      values: titled("Typed"),
    });
  });

  it("sends a failed draft again only on Retry, types on from it, or discards it", () => {
    const fail = run(edit("Typed"), SEND, failed(1));

    expect(reduceDraft(fail, SEND)).toBe(fail);
    expect(reduceDraft(fail, RETRY)).toStrictEqual({
      confirmed: STORED,
      error: { during: "save", message: "The disk is full." },
      inFlight: { payload: titled("Typed"), rev: 1 },
      kind: "saving",
      rev: 1,
      undo: null,
      values: titled("Typed"),
    });
    expect(reduceDraft(fail, edit("Typed more"))).toStrictEqual({
      confirmed: STORED,
      error: { during: "save", message: "The disk is full." },
      inFlight: null,
      kind: "dirty",
      rev: 2,
      undo: null,
      values: titled("Typed more"),
    });
    expect(reduceDraft(fail, DISCARD)).toBeNull();
    expect(run(edit("Typed"), SEND, failed(1), RETRY, ok(1))).toBeNull();
  });

  it("ends the draft at once on Discard, whatever is on its way, and its save's answer can't bring it back", () => {
    expect([
      run(edit("Typed"), SEND, DISCARD),
      run(edit("Typed"), SEND, edit("More"), DISCARD),
      run(edit("Typed"), SEND, failed(1), RETRY, DISCARD),
      run(edit("Typed"), SEND, DISCARD, ok(1)),
      run(edit("Typed"), SEND, DISCARD, failed(1)),
    ]).toStrictEqual([null, null, null, null, null]);
  });

  it("goes clean without a save when the edits end where the disk is", () => {
    expect(run(edit("Typed"), edit("Total is off"), SEND)).toBeNull();
    expect(
      run(edit("Typed"), SEND, failed(1), edit("Total is off"), SEND)
    ).toBeNull();
  });

  it("never saves a blank title: the save keeps the title on disk", () => {
    const blank = run(
      {
        kind: "edit",
        stored: STORED,
        values: { ...STORED, description: "New words", title: "  " },
      },
      SEND
    );

    expect(blank).toMatchObject({
      inFlight: {
        payload: { ...STORED, description: "New words", title: "Total is off" },
      },
      kind: "saving",
    });
    expect(run(edit("  "), SEND)).toBeNull();
  });

  it("ignores an answer for a save that isn't on its way", () => {
    const saving = run(edit("Typed"), SEND);

    expect(reduceDraft(saving, ok(7))).toBe(saving);
    expect(reduceDraft(null, ok(1))).toBeNull();
  });
});

describe("a Discard main couldn't finish", () => {
  const TAG = { epoch: "page.1", seq: 4 };

  const undiscarded = (draft: Draft): DraftEvent => ({
    draft,
    kind: "undiscarded",
    message: "Inset can’t write to its data folder.",
    tag: TAG,
  });

  const discarded = run(edit("Discard me"), SEND);

  it("brings the discarded changes back as failed, with the save main still holds", () => {
    expect(
      discarded === null ? null : run(DISCARD, undiscarded(discarded))
    ).toStrictEqual({
      confirmed: STORED,
      error: {
        during: "discard",
        message: "Inset can’t write to its data folder.",
      },
      kind: "failed",
      rev: 1,
      undo: TAG,
      values: titled("Discard me"),
    });
  });

  it("brings typing done since the Discard back failed with it, toward what the Discard puts back", () => {
    const typed = run(edit("Typed after"), edit("Typed after, more"));

    expect(
      discarded === null || typed === null
        ? null
        : reduceDraft(typed, undiscarded(discarded))
    ).toStrictEqual({
      confirmed: STORED,
      error: {
        during: "discard",
        message: "Inset can’t write to its data folder.",
      },
      kind: "failed",
      rev: 2,
      undo: TAG,
      values: titled("Typed after, more"),
    });
  });

  it("stays failed through more typing until Keep changes, which sends even the saved fields so main keeps them", () => {
    const back =
      discarded === null ? null : run(DISCARD, undiscarded(discarded));

    const typedBack = reduceDraft(back, {
      kind: "edit",
      stored: STORED,
      values: STORED,
    });

    expect({
      autosave: reduceDraft(back, SEND),
      kept: reduceDraft(typedBack, RETRY),
      typedBack: reduceDraft(typedBack, SEND),
    }).toStrictEqual({
      autosave: back,
      typedBack: {
        confirmed: STORED,
        error: {
          during: "discard",
          message: "Inset can’t write to its data folder.",
        },
        kind: "failed",
        rev: 2,
        undo: TAG,
        values: STORED,
      },
      kept: {
        confirmed: STORED,
        error: {
          during: "discard",
          message: "Inset can’t write to its data folder.",
        },
        inFlight: { payload: STORED, rev: 2 },
        kind: "saving",
        rev: 2,
        undo: TAG,
        values: STORED,
      },
    });
  });

  it("is resolved once a save of it lands, and says a failed one was a save", () => {
    const back =
      discarded === null ? null : run(DISCARD, undiscarded(discarded));

    const kept = reduceDraft(reduceDraft(back, RETRY), failed(1));

    expect({
      failedRetry: kept === null ? null : [kept.error, kept.undo],
      landed: reduceDraft(reduceDraft(kept, RETRY), ok(1)),
    }).toStrictEqual({
      failedRetry: [{ during: "save", message: "The disk is full." }, TAG],
      landed: null,
    });
  });
});

describe(storedFields, () => {
  it("trims the title, steps and labels, drops blank ones, and keeps the description as typed", () => {
    expect(
      storedFields({
        description: " a\n ",
        due: null,
        pins: [
          { label: "  ", x: 1, y: 2 },
          { label: " Total ", x: 3, y: 4 },
        ],
        steps: [
          { done: false, id: "a", text: " x " },
          { done: false, id: "b", text: " " },
        ],
        title: " T ",
      })
    ).toStrictEqual({
      description: " a\n ",
      due: null,
      pins: [
        { x: 1, y: 2 },
        { label: "Total", x: 3, y: 4 },
      ],
      steps: [{ done: false, id: "a", text: "x" }],
      title: "T",
    });
  });
});
