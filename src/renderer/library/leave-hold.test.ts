import { CaptureIdSchema } from "@shared/capture-record";
import type { EditableFields } from "@shared/capture-record";
import type { ActionResult } from "@shared/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DraftStore } from "./drafts";
import { createLeaveHold } from "./leave-hold";

const A = CaptureIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c");
const B = CaptureIdSchema.parse("7a1b2c3d-4e5f-4a7d-9b0c-5d8e6f7a1b2c");

const STORED: EditableFields = {
  description: "",
  due: null,
  pins: [],
  steps: [],
  title: "Total is off",
};

const titled = (title: string): EditableFields => ({ ...STORED, title });

const FULL: ActionResult = { message: "The disk is full.", ok: false };

const HELD = {
  message: "The library holds this to save or ask first.",
  ok: false,
};

const TOO_SLOW = "Saving didn’t finish in time.";

/** The library's drafts on a disk the test answers, and the hold main asks before a close or a quit. */
const setup = () => {
  const pending: ((result: ActionResult) => void)[] = [];
  /** What reached main, in order: each save's title, each resume and each time the prompt showed. */
  const log: string[] = [];

  const drafts = new DraftStore({
    update: async ({ fields }) => {
      log.push(`save:${fields.title}`);

      // oxlint-disable-next-line promise/avoid-new -- the test answers the save later, through this callback.
      return await new Promise<ActionResult>((resolve) => {
        pending.push(resolve);
      });
    },
  });

  const hold = createLeaveHold({
    drafts,
    resume: () => {
      log.push("resume");
    },
    shown: () => {
      log.push("shown");
    },
  });

  /** Answers the oldest save on its way, then lets the store react. */
  const answer = async (result?: ActionResult): Promise<void> => {
    pending.shift()?.(result ?? { ok: true });
    await vi.advanceTimersByTimeAsync(0);
  };

  /** A's save has failed and nothing is on its way. */
  const failA = async (): Promise<void> => {
    drafts.edit(A, titled("Typed while full"), STORED, { now: true });
    await answer(FULL);
  };

  /** Main asks before a quit while A can't be saved; the retry the wait makes fails too. */
  const heldQuit = async (): Promise<void> => {
    await failA();
    hold.ask("quit");
    await answer(FULL);
  };

  /** What main heard since the last look. */
  const take = (): string[] => log.splice(0);

  return { answer, drafts, failA, heldQuit, hold, take };
};

describe(createLeaveHold, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets a close go on at once when nothing is unsaved", () => {
    const { hold, take } = setup();

    expect([hold.ask("close"), hold.get(), take()]).toStrictEqual([
      { ok: true },
      null,
      [],
    ]);
  });

  it("lets a quit go on at once, holding nothing, when the only change was typed back to what is saved", () => {
    const { drafts, hold, take } = setup();

    drafts.edit(A, titled("Total is off by 40"), STORED);
    drafts.edit(A, STORED, STORED);

    expect([hold.ask("quit"), hold.get(), take()]).toStrictEqual([
      { ok: true },
      null,
      [],
    ]);
  });

  it("answers main at once, and lets the close go on as soon as every save lands, without showing anything", async () => {
    const { answer, drafts, hold, take } = setup();

    drafts.edit(A, titled("A typed"), STORED);
    drafts.edit(B, titled("B typed"), STORED);

    expect(hold.ask("close")).toStrictEqual(HELD);

    await answer();
    await answer();

    expect([hold.get(), take()]).toStrictEqual([
      null,
      ["save:A typed", "save:B typed", "resume"],
    ]);
  });

  it("holds a quit while a save fails, retries a failed one once, and says how many changes and why", async () => {
    const { answer, drafts, failA, hold, take } = setup();

    await failA();
    drafts.edit(B, titled("B typed"), STORED);
    take();
    hold.ask("quit");
    await answer(FULL);
    await answer();

    expect([hold.get(), take()]).toStrictEqual([
      { count: 1, leaving: "quit", message: "The disk is full." },
      ["save:Typed while full", "save:B typed", "shown"],
    ]);
  });

  it("asks once the wait runs out, saying saving didn't finish in time, and goes on by itself once the save lands", async () => {
    const { answer, drafts, hold, take } = setup();

    drafts.edit(A, titled("A typed"), STORED);
    hold.ask("restart");
    await vi.advanceTimersByTimeAsync(2999);

    const before = hold.get();

    await vi.advanceTimersByTimeAsync(1);

    const held = hold.get();

    await answer();

    expect([before, held, hold.get(), take()]).toStrictEqual([
      null,
      { count: 1, leaving: "restart", message: TOO_SLOW },
      null,
      ["save:A typed", "shown", "resume"],
    ]);
  });

  it("keeps asking after a Retry that fails, and goes on after one that works", async () => {
    const { answer, heldQuit, hold, take } = setup();

    await heldQuit();
    hold.retry();
    await answer(FULL);

    const stillHeld = [hold.get(), take()];

    hold.retry();
    await answer();

    expect([stillHeld, [hold.get(), take()]]).toStrictEqual([
      [
        { count: 1, leaving: "quit", message: "The disk is full." },
        [
          "save:Typed while full",
          "save:Typed while full",
          "shown",
          "save:Typed while full",
        ],
      ],
      [null, ["save:Typed while full", "resume"]],
    ]);
  });

  it("says saving didn't finish in time once a Retry has been on its way for the limit", async () => {
    const { answer, heldQuit, hold } = setup();

    await heldQuit();
    hold.retry();
    await vi.advanceTimersByTimeAsync(2999);

    const before = hold.get()?.message;

    await vi.advanceTimersByTimeAsync(1);

    const after = hold.get()?.message;

    await answer(FULL);

    expect([before, after, hold.get()?.message]).toStrictEqual([
      "The disk is full.",
      TOO_SLOW,
      "The disk is full.",
    ]);
  });

  it("discards at once while a save is on its way, writes the saved values after it before going on, and the late save revives nothing", async () => {
    const { answer, drafts, hold, take } = setup();

    drafts.edit(A, titled("Typed, then discarded"), STORED);
    hold.ask("quit");
    await vi.advanceTimersByTimeAsync(3000);
    hold.discard();

    const atDiscard = {
      log: take(),
      prompt: hold.get(),
      shown: drafts.get(A)?.values.title,
    };

    await answer();

    const afterLateSave = drafts.get(A)?.values.title;

    await answer();

    expect({
      afterLateSave,
      atDiscard,
      end: [drafts.get(A), hold.get(), take()],
    }).toStrictEqual({
      afterLateSave: "Total is off",
      atDiscard: {
        log: [
          "save:Typed, then discarded",
          "shown",
          "save:Total is off",
          "resume",
        ],
        prompt: null,
        shown: "Total is off",
      },
      end: [undefined, null, []],
    });
  });

  it("drops a failed change on Discard and goes on once", async () => {
    const { drafts, heldQuit, hold, take } = setup();

    await heldQuit();
    take();
    hold.discard();

    expect([drafts.get(A), hold.get(), take()]).toStrictEqual([
      undefined,
      null,
      ["resume"],
    ]);
  });

  it("cancels at once while a save is on its way, keeps the change, and the save landing later doesn't go on", async () => {
    const { answer, drafts, hold, take } = setup();

    drafts.edit(A, titled("Typed"), STORED);
    hold.ask("close");
    await vi.advanceTimersByTimeAsync(3000);
    hold.cancel();

    const kept = drafts.get(A)?.values.title;

    await answer(FULL);

    expect([kept, drafts.get(A)?.kind, hold.get(), take()]).toStrictEqual([
      "Typed",
      "failed",
      null,
      ["save:Typed", "shown"],
    ]);
  });

  it("doesn't hold a close for a deleted capture's typing", async () => {
    const { drafts, failA, hold } = setup();

    await failA();
    drafts.forget(A);

    expect(hold.ask("close")).toStrictEqual({ ok: true });
  });
});
