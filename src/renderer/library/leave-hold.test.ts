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

/** The library's drafts on a disk the test answers, and the hold main asks before a close or a quit. */
const setup = () => {
  const pending: ((result: ActionResult) => void)[] = [];
  let resumed = 0;

  const drafts = new DraftStore({
    update: async () =>
      // oxlint-disable-next-line promise/avoid-new -- the test answers the save later, through this callback.
      await new Promise<ActionResult>((resolve) => {
        pending.push(resolve);
      }),
  });

  const hold = createLeaveHold(drafts, () => {
    resumed += 1;
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
  const heldQuit = async (): Promise<ActionResult> => {
    await failA();

    const asked = hold.ask("quit");

    await answer(FULL);

    return await asked;
  };

  return {
    answer,
    drafts,
    failA,
    heldQuit,
    hold,
    resumed: () => resumed,
  };
};

describe(createLeaveHold, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets a close go on as soon as every save lands, without waiting out the second", async () => {
    const { answer, drafts, hold, resumed } = setup();

    drafts.edit(A, titled("A typed"), STORED);
    drafts.edit(B, titled("B typed"), STORED);

    const asked = hold.ask("close");

    await answer();
    await answer();

    await expect(asked).resolves.toStrictEqual({ ok: true });
    expect([hold.get(), resumed()]).toStrictEqual([null, 0]);
  });

  it("holds a quit while a save fails, and says how many changes and why", async () => {
    const { answer, drafts, failA, hold } = setup();

    await failA();
    drafts.edit(B, titled("B typed"), STORED);

    const asked = hold.ask("quit");

    await answer(FULL);
    await answer();

    await expect(asked).resolves.toStrictEqual({
      message: "The disk is full.",
      ok: false,
    });
    expect(hold.get()).toStrictEqual({
      count: 1,
      leaving: "quit",
      message: "The disk is full.",
    });
  });

  it("holds a close while a save is still on its way after the second, and lets it go on by itself once it lands", async () => {
    const { answer, drafts, hold, resumed } = setup();

    drafts.edit(A, titled("A typed"), STORED);

    const asked = hold.ask("restart");

    await vi.advanceTimersByTimeAsync(1000);

    await expect(asked).resolves.toStrictEqual({
      message: "Saving took too long.",
      ok: false,
    });

    const held = hold.get();

    await answer();

    expect([held, hold.get(), resumed()]).toStrictEqual([
      { count: 1, leaving: "restart", message: "Saving took too long." },
      null,
      1,
    ]);
  });

  it("keeps asking after a Retry that fails, and goes on after one that works", async () => {
    const { answer, heldQuit, hold, resumed } = setup();

    await heldQuit();
    hold.retry();
    await answer(FULL);

    const stillHeld = [hold.get(), resumed()];

    hold.retry();
    await answer();

    expect([stillHeld, [hold.get(), resumed()]]).toStrictEqual([
      [{ count: 1, leaving: "quit", message: "The disk is full." }, 0],
      [null, 1],
    ]);
  });

  it("drops every change on Discard and goes on once", async () => {
    const { drafts, heldQuit, hold, resumed } = setup();

    await heldQuit();
    hold.discard();

    expect([drafts.get(A), hold.get(), resumed()]).toStrictEqual([
      undefined,
      null,
      1,
    ]);
  });

  it("keeps the changes and the window on Cancel, and a later save doesn't go on", async () => {
    const { answer, drafts, heldQuit, hold, resumed } = setup();

    await heldQuit();
    hold.cancel();

    const kept = drafts.get(A)?.kind;

    drafts.flush(A);
    await answer();

    expect([kept, hold.get(), resumed()]).toStrictEqual(["failed", null, 0]);
  });

  it("doesn't hold a close for a deleted capture's typing", async () => {
    const { answer, drafts, failA, hold } = setup();

    await failA();
    drafts.forget(A);

    const asked = hold.ask("close");

    await answer(FULL);

    await expect(asked).resolves.toStrictEqual({ ok: true });
  });
});
