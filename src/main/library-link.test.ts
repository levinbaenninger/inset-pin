import { setTimeout as delay } from "node:timers/promises";

import { CaptureIdSchema } from "@shared/capture-record";
import type { FlushRequest, Leaving, SavedEdits } from "@shared/contracts";
import { describe, expect, it } from "vitest";

import type { Unconfirmed } from "./leave-gate";
import { createLibraryLink } from "./library-link";

const ID = CaptureIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c");

const SAVED: SavedEdits = { fields: null, ok: true };
const HELD: SavedEdits = { message: "Held to ask first.", ok: false };

/** How long main waits for the page in these tests. */
const WAIT_MS = 60;

/** How the fake page answers main's requests. */
type PageMood = "answers" | "holds and asks" | "silent";

interface PageState {
  mood: PageMood;
  windowOpen: boolean;
}

/**
 * Main's link to a library page the test drives: the page answers, holds
 * and shows its prompt, or says nothing, and the native dialog answers
 * Cancel unless told otherwise.
 */
const setup = (
  choices: Unconfirmed[] = [],
  written: () => Promise<boolean> = async () => await Promise.resolve(true)
) => {
  const calls: string[] = [];

  const state: PageState = { mood: "answers", windowOpen: true };

  const link = createLibraryLink({
    confirm: async (leaving: Leaving, count: number | null) => {
      calls.push(`confirm:${leaving}:${String(count)}`);

      return await Promise.resolve(choices.shift() ?? "cancel");
    },
    promptWithinMs: WAIT_MS,
    send: (request: FlushRequest) => {
      calls.push(request.id === null ? `ask:${request.leaving}` : "ask:copy");

      queueMicrotask(() => {
        if (state.mood === "answers") {
          link.answered(request.token, SAVED);
        } else if (state.mood === "holds and asks") {
          link.answered(request.token, HELD);
          link.shown();
        }
      });
    },
    surface: () => {
      calls.push("surface");
    },
    waitMs: WAIT_MS,
    windowOpen: () => state.windowOpen,
    written,
  });

  const leave = (leaving: Leaving): void => {
    void link.leave(leaving, () => {
      calls.push(leaving);
    });
  };

  return { calls, leave, link, state };
};

/** Lets the link's awaits run. */
const settle = async (ms = 0): Promise<void> => {
  await delay(ms);
};

/** A disk the test holds in the final wait before a quit, then lets write. */
const slowDisk = () => {
  const disk = {
    entered: false,
    finish: (_written: boolean): void => undefined,
  };

  const written = async (): Promise<boolean> => {
    disk.entered = true;

    // oxlint-disable-next-line promise/avoid-new -- the test lets the disk finish later, through this callback.
    return await new Promise<boolean>((resolve) => {
      disk.finish = resolve;
    });
  };

  return { disk, written };
};

describe("main's link to the library page (SPEC round 8)", () => {
  it("asks natively at once, never quits, when the page crashes while main waits for its answer, and asks once though the answer then times out", async () => {
    const { calls, leave, link, state } = setup();

    link.reported(1);
    state.mood = "silent";
    leave("quit");
    await settle();
    link.gone();
    await settle(WAIT_MS * 2);

    expect(calls).toStrictEqual(["ask:quit", "surface", "confirm:quit:1"]);
  });

  it("asks natively, never quits, when the page crashes while its own unsaved-changes prompt is on screen", async () => {
    const { calls, leave, link, state } = setup();

    link.reported(1);
    state.mood = "holds and asks";
    leave("quit");
    await settle(WAIT_MS * 2);
    link.gone();
    await settle();

    expect(calls).toStrictEqual([
      "ask:quit",
      "surface",
      "surface",
      "confirm:quit:1",
    ]);
  });

  it("keeps the unsaved count across a navigation, so a page that hasn't reported yet is never read as saved", async () => {
    const { calls, leave, link } = setup();

    link.reported(2);
    link.gone();
    leave("close");
    await settle(WAIT_MS * 2);

    expect(calls).toStrictEqual(["surface", "confirm:close:2"]);
  });

  it("waits for a freshly loaded page to report, then asks it, and quits when it holds nothing", async () => {
    const { calls, leave, link } = setup();

    link.reported(1);
    link.gone();
    leave("quit");
    await settle(WAIT_MS / 3);
    link.reported(0);
    await settle();

    expect(calls).toStrictEqual(["ask:quit", "quit"]);
  });

  it("asks the page again on Wait, giving a crashed page time to come back", async () => {
    const { calls, leave, link, state } = setup(["wait"]);

    link.reported(1);
    state.mood = "silent";
    leave("quit");
    await settle();
    link.gone();
    await settle();
    state.mood = "answers";
    link.reported(0);
    await settle();

    expect(calls).toStrictEqual([
      "ask:quit",
      "surface",
      "confirm:quit:1",
      "ask:quit",
      "quit",
    ]);
  });

  it("refuses a copy a crashed page can't confirm, and copies the stored capture when it held nothing", async () => {
    const { link } = setup();

    link.reported(1);
    link.gone();

    const unconfirmed = await link.ask({ id: ID, retry: false });

    link.reported(0);
    link.gone();

    await expect(link.ask({ id: ID, retry: false })).resolves.toStrictEqual(
      SAVED
    );
    expect(unconfirmed).toBeNull();
  });

  it.each(["quit", "restart"] as const)(
    "asks natively, never leaves, on %s when typing is reported and the page then crashes while the disk writes",
    async (leaving) => {
      const { disk, written } = slowDisk();
      const { calls, leave, link } = setup([], written);

      link.reported(0);
      leave(leaving);
      await settle();
      expect(disk.entered).toBeTruthy();

      link.reported(1);
      link.gone();
      disk.finish(true);
      await settle();

      expect(calls).toStrictEqual([
        `ask:${leaving}`,
        "surface",
        `confirm:${leaving}:1`,
      ]);
    }
  );

  it("asks the page again when typing is reported while the disk writes, and quits once it answers", async () => {
    const { disk, written } = slowDisk();
    const { calls, leave, link } = setup([], written);

    link.reported(0);
    leave("quit");
    await settle();
    link.reported(1);
    disk.finish(true);
    await settle();

    const afterTyping = [...calls];

    link.reported(0);
    disk.finish(true);
    await settle();

    expect({ afterTyping, end: calls }).toStrictEqual({
      afterTyping: ["ask:quit", "ask:quit"],
      end: ["ask:quit", "ask:quit", "quit"],
    });
  });

  it("asks natively about typing reported while the slow disk wrote, rather than offering to quit over a slow disk", async () => {
    const { disk, written } = slowDisk();
    const { calls, leave, link } = setup([], written);

    link.reported(0);
    leave("quit");
    await settle();
    link.reported(1);
    link.gone();
    disk.finish(false);
    await settle();

    expect(calls).toStrictEqual(["ask:quit", "surface", "confirm:quit:1"]);
  });

  it("quits once, asking once, after Quit anyway, though the count it accepted is still on record when the disk finishes", async () => {
    const { disk, written } = slowDisk();
    const { calls, leave, link, state } = setup(["leave"], written);

    link.reported(1);
    state.mood = "silent";
    leave("quit");
    await settle();
    link.gone();
    await settle();
    disk.finish(true);
    await settle();

    expect(calls).toStrictEqual([
      "ask:quit",
      "surface",
      "confirm:quit:1",
      "quit",
    ]);
  });

  it("forgets the count once the user chose Quit anyway, so the window's own close after it neither asks again nor waits", async () => {
    const { calls, leave, link, state } = setup(["leave"]);

    link.reported(1);
    state.mood = "silent";
    leave("quit");
    await settle();
    link.gone();
    await settle();
    leave("close");
    await settle();

    expect(calls).toStrictEqual([
      "ask:quit",
      "surface",
      "confirm:quit:1",
      "quit",
      "close",
    ]);
  });
});
