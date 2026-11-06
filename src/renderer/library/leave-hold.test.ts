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

const nothing = (): void => undefined;

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
    discard: async ({ tag }) => {
      log.push(`discard:${String(tag.seq)}`);

      return await Promise.resolve({ ok: true });
    },
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

const LOCKED: ActionResult = {
  message: "Inset can’t write to its data folder.",
  ok: false,
};

/** A save main wrote and never answers, then a Discard of it that main answers only when the test says. */
const discarding = () => {
  const log: string[] = [];
  const discards: ((result: ActionResult) => void)[] = [];

  const drafts = new DraftStore({
    discard: async ({ tag }) => {
      log.push(`discard:${String(tag.seq)}`);

      // oxlint-disable-next-line promise/avoid-new -- the test answers the Discard later, through this callback.
      return await new Promise<ActionResult>((resolve) => {
        discards.push(resolve);
      });
    },
    update: async ({ fields }) => {
      log.push(`save:${fields.title}`);

      // oxlint-disable-next-line promise/avoid-new -- the save landed, and its answer never comes.
      return await new Promise<ActionResult>(nothing);
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

  drafts.edit(A, titled("Discard me"), STORED, { now: true });
  drafts.discard(A);
  log.splice(0);

  /** Main answers the oldest Discard on its way, then the store reacts. */
  const answer = async (result: ActionResult): Promise<void> => {
    discards.shift()?.(result);
    await vi.advanceTimersByTimeAsync(0);
  };

  return { answer, drafts, hold, take: () => log.splice(0) };
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
      {
        count: 1,
        leaving: "quit",
        message: "The disk is full.",
        asks: "retry",
      },
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
      { count: 1, leaving: "restart", message: TOO_SLOW, asks: "retry" },
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
        {
          count: 1,
          leaving: "quit",
          message: "The disk is full.",
          asks: "retry",
        },
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

  it("discards at once while a save is on its way, tells main to drop that save, writes nothing to undo it, and the late save revives nothing", async () => {
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

    expect({
      afterLateSave: drafts.get(A)?.values.title ?? null,
      atDiscard,
      end: [drafts.get(A), drafts.saved(A), hold.get(), take()],
    }).toStrictEqual({
      afterLateSave: null,
      atDiscard: {
        // Main hears the discard before the resume, so its wait for the disk already skips the dropped save.
        log: ["save:Typed, then discarded", "shown", "discard:1", "resume"],
        prompt: null,
        shown: undefined,
      },
      // What was saved before the discarded save stays the baseline.
      end: [undefined, STORED, null, []],
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

  it("asks about a Discard main couldn't finish rather than saving it on its own, and Keep changes in the prompt keeps it", async () => {
    const log: string[] = [];

    const drafts = new DraftStore({
      discard: async ({ tag }) => {
        log.push(`discard:${String(tag.seq)}`);

        return await Promise.resolve({
          message: "Inset can’t write to its data folder.",
          ok: false,
        });
      },
      update: async ({ fields }) => {
        log.push(`save:${fields.title}`);

        return await Promise.resolve({ ok: true });
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

    drafts.edit(A, titled("Discard me"), STORED);
    drafts.flush(A);
    drafts.discard(A);
    await vi.advanceTimersByTimeAsync(0);
    log.splice(0);

    const answer = hold.ask("quit");

    await vi.advanceTimersByTimeAsync(3000);

    const asked = { answer, heard: log.splice(0), prompt: hold.get() };

    hold.retry();
    await vi.advanceTimersByTimeAsync(0);

    expect({ asked, kept: log.splice(0) }).toStrictEqual({
      asked: {
        answer: HELD,
        heard: ["shown"],
        prompt: {
          count: 1,
          leaving: "quit",
          message: "Inset can’t write to its data folder.",
          asks: "keep",
        },
      },
      kept: ["save:Discard me", "resume"],
    });
  });

  it("holds the close on Discard again until main answers, asks again when it fails, and goes on once it works", async () => {
    const log: string[] = [];
    const answers: ActionResult[] = [];

    const drafts = new DraftStore({
      discard: async ({ tag }) => {
        log.push(`discard:${String(tag.seq)}`);

        return await Promise.resolve(answers.shift() ?? LOCKED);
      },
      update: async ({ fields }) => {
        log.push(`save:${fields.title}`);

        return await Promise.resolve({ ok: true });
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

    drafts.edit(A, titled("Discard me"), STORED);
    drafts.flush(A);
    drafts.discard(A);
    await vi.advanceTimersByTimeAsync(0);
    hold.ask("close");
    await vi.advanceTimersByTimeAsync(0);
    log.splice(0);

    hold.discard();

    const sent = { heard: [...log], prompt: hold.get()?.asks };

    await vi.advanceTimersByTimeAsync(0);

    const failedAgain = { heard: log.splice(0), prompt: hold.get() };

    answers.push({ ok: true });
    hold.discard();
    await vi.advanceTimersByTimeAsync(0);

    expect({ failedAgain, sent, worked: log }).toStrictEqual({
      failedAgain: {
        heard: ["discard:1"],
        prompt: {
          count: 1,
          leaving: "close",
          message: "Inset can’t write to its data folder.",
          asks: "keep",
        },
      },
      sent: { heard: ["discard:1"], prompt: "keep" },
      worked: ["discard:1", "resume"],
    });
  });

  describe("while main hasn't answered a Discard (SPEC round 10)", () => {
    it("offers Wait and Close anyway once the limit runs out, and Close anyway goes on at once", async () => {
      const { hold, take } = discarding();
      const asked = hold.ask("close");

      await vi.advanceTimersByTimeAsync(2999);

      const before = hold.get();

      await vi.advanceTimersByTimeAsync(1);

      const stalled = { heard: take(), prompt: hold.get() };

      hold.discard();

      expect({
        after: { heard: take(), prompt: hold.get() },
        asked,
        before,
        stalled,
      }).toStrictEqual({
        after: { heard: ["resume"], prompt: null },
        asked: HELD,
        before: null,
        stalled: {
          heard: ["shown"],
          prompt: {
            asks: "wait",
            count: 1,
            leaving: "close",
            message:
              "Inset is still putting the earlier version back. Close anyway lets it finish on its own.",
          },
        },
      });
    });

    it("keeps waiting on Wait and says so, asks again once the limit runs out, and goes on once main has put the saved version back", async () => {
      const { answer, hold, take } = discarding();

      hold.ask("quit");
      await vi.advanceTimersByTimeAsync(3000);
      hold.retry();

      const waiting = hold.get()?.message;

      await vi.advanceTimersByTimeAsync(3000);

      const again = hold.get();

      hold.retry();
      await answer({ ok: true });

      expect({
        again,
        heard: take(),
        prompt: hold.get(),
        waiting,
      }).toStrictEqual({
        again: {
          asks: "wait",
          count: 1,
          leaving: "quit",
          message:
            "Inset is still putting the earlier version back. Quit anyway finishes it the next time Inset starts.",
        },
        heard: ["shown", "resume"],
        prompt: null,
        waiting:
          "Waiting for Inset to put the earlier version back… Quit anyway finishes it the next time Inset starts.",
      });
    });

    it("asks to keep the changes or discard them again once main answers that it couldn't put the saved version back", async () => {
      const { answer, hold } = discarding();

      hold.ask("close");
      await vi.advanceTimersByTimeAsync(3000);
      hold.retry();
      await answer(LOCKED);

      expect(hold.get()).toStrictEqual({
        asks: "keep",
        count: 1,
        leaving: "close",
        message: "Inset can’t write to its data folder.",
      });
    });

    it("says what was typed since the Discard won't be kept, and sends none of it", async () => {
      const { drafts, hold, take } = discarding();

      drafts.edit(A, titled("Typed since"), STORED, { now: true });
      hold.ask("restart");
      await vi.advanceTimersByTimeAsync(3000);

      expect({ heard: take(), prompt: hold.get() }).toStrictEqual({
        heard: ["shown"],
        prompt: {
          asks: "wait",
          count: 1,
          leaving: "restart",
          message:
            "Inset is still putting the earlier version back. Quit anyway finishes it the next time Inset starts. What you typed since won’t be kept.",
        },
      });
    });

    it("keeps the prompt as it is while main answers Discard again, then offers Wait and Quit anyway once the limit runs out", async () => {
      const { answer, hold, take } = discarding();

      await answer(LOCKED);
      hold.ask("quit");
      await vi.advanceTimersByTimeAsync(0);

      const asked = hold.get();

      hold.discard();
      await vi.advanceTimersByTimeAsync(2999);

      const meanwhile = hold.get();

      await vi.advanceTimersByTimeAsync(1);

      const stalled = { heard: take(), prompt: hold.get() };

      hold.discard();

      expect({
        asked,
        left: take(),
        meanwhile: meanwhile === asked,
        stalled,
      }).toStrictEqual({
        asked: {
          asks: "keep",
          count: 1,
          leaving: "quit",
          message: "Inset can’t write to its data folder.",
        },
        left: ["resume"],
        meanwhile: true,
        stalled: {
          heard: ["shown", "discard:1"],
          prompt: {
            asks: "wait",
            count: 1,
            leaving: "quit",
            message:
              "Inset is still putting the earlier version back. Quit anyway finishes it the next time Inset starts.",
          },
        },
      });
    });
  });
});
