import { setTimeout as delay } from "node:timers/promises";

import { CaptureIdSchema } from "@shared/capture-record";
import type { EditableFields } from "@shared/capture-record";
import type { Leaving, SavedEdits } from "@shared/contracts";
import { describe, expect, it } from "vitest";

import { DraftStore } from "../renderer/library/drafts";
import { createLeaveHold } from "../renderer/library/leave-hold";
import { createLeaveGate } from "./leave-gate";
import type { Unconfirmed } from "./leave-gate";

const HELD: SavedEdits = { message: "Held to ask first.", ok: false };
const SAVED: SavedEdits = { fields: null, ok: true };

/** Lets the gate's awaits run. */
const tick = async (): Promise<void> => {
  await delay(0);
};

interface Setup {
  /** The page's answers, in order; null is no answer within the limit. */
  readonly answers: readonly (SavedEdits | null)[];
  /** The native dialog's answers, in order. */
  readonly choices?: readonly Unconfirmed[];
  /** Whether the disk wrote within the limit, in order of asking. */
  readonly written?: readonly boolean[];
  readonly unsaved?: number;
}

/** How long a page that held the close has to show its prompt, in these tests. */
const PROMPT_WITHIN_MS = 20;

const setup = ({ answers, choices = [], unsaved = 0, written = [] }: Setup) => {
  const calls: string[] = [];
  const pageAnswers = [...answers];
  const dialogAnswers = [...choices];
  const disk = [...written];

  const gate = createLeaveGate({
    ask: async (leaving: Leaving) => {
      calls.push(`ask:${leaving}`);

      return await Promise.resolve(pageAnswers.shift() ?? null);
    },
    confirm: async (leaving, count) => {
      calls.push(`confirm:${leaving}:${String(count)}`);

      return await Promise.resolve(dialogAnswers.shift() ?? "cancel");
    },
    promptWithinMs: PROMPT_WITHIN_MS,
    surface: () => {
      calls.push("surface");
    },
    unsaved: () => unsaved,
    written: async () => {
      const done = disk.shift() ?? true;

      calls.push(`written:${String(done)}`);

      return await Promise.resolve(done);
    },
  });

  const run = (name: string) => () => {
    calls.push(name);
  };

  return { calls, gate, run };
};

describe(createLeaveGate, () => {
  it("goes on once the page has saved everything and the disk has written it", async () => {
    const { calls, gate, run } = setup({ answers: [SAVED] });

    await gate.leave("quit", run("quit"));

    expect(calls).toStrictEqual(["ask:quit", "written:true", "quit"]);
  });

  it("closes a window without waiting for the disk, which main keeps writing", async () => {
    const { calls, gate, run } = setup({ answers: [SAVED] });

    await gate.leave("close", run("close"));

    expect(calls).toStrictEqual(["ask:close", "close"]);
  });

  it("goes on without an answer only when the page had nothing unsaved", async () => {
    const { calls, gate, run } = setup({ answers: [null], unsaved: 0 });

    await gate.leave("quit", run("quit"));

    expect(calls).toStrictEqual(["ask:quit", "written:true", "quit"]);
  });

  it("never reads no answer as saved while the page has unsaved changes: it asks natively, and Cancel keeps the app open", async () => {
    const { calls, gate, run } = setup({
      answers: [null],
      choices: ["cancel"],
      unsaved: 2,
    });

    await gate.leave("quit", run("quit"));
    gate.resume();

    expect(calls).toStrictEqual(["ask:quit", "surface", "confirm:quit:2"]);
  });

  it("asks the page again on Wait, and goes on once it answers", async () => {
    const { calls, gate, run } = setup({
      answers: [null, SAVED],
      choices: ["wait"],
      unsaved: 1,
    });

    await gate.leave("close", run("close"));

    expect(calls).toStrictEqual([
      "ask:close",
      "surface",
      "confirm:close:1",
      "ask:close",
      "close",
    ]);
  });

  it("goes on once on Quit anyway, though the page resumes late too", async () => {
    const { calls, gate, run } = setup({
      answers: [null],
      choices: ["leave"],
      unsaved: 1,
    });

    await gate.leave("restart", run("restart"));
    gate.resume();
    await tick();

    expect(calls).toStrictEqual([
      "ask:restart",
      "surface",
      "confirm:restart:1",
      "written:true",
      "restart",
    ]);
  });

  it("holds while the page asks the user, without bringing it in front itself, and goes on once when the page resumes", async () => {
    const { calls, gate, run } = setup({ answers: [HELD] });

    await gate.leave("restart", run("restart"));

    expect(calls).toStrictEqual(["ask:restart"]);

    gate.resume();
    gate.resume();
    await tick();

    expect(calls).toStrictEqual(["ask:restart", "written:true", "restart"]);
  });

  it("asks natively when the disk doesn't write in time before a quit, and waits again on Wait", async () => {
    const { calls, gate, run } = setup({
      answers: [SAVED],
      choices: ["wait", "cancel"],
      written: [false, false],
    });

    await gate.leave("quit", run("quit"));

    expect(calls).toStrictEqual([
      "ask:quit",
      "written:false",
      "surface",
      "confirm:quit:null",
      "written:false",
      "surface",
      "confirm:quit:null",
    ]);
  });

  it("resumes the latest held kind, and nothing when nothing is held", async () => {
    const { calls, gate, run } = setup({ answers: [HELD, HELD] });

    gate.resume();
    await gate.leave("close", run("close"));
    await gate.leave("quit", run("quit"));
    gate.resume();
    await tick();

    expect(calls).toStrictEqual([
      "ask:close",
      "ask:quit",
      "written:true",
      "quit",
    ]);
  });

  it("asks natively when a page that held the close neither shows its prompt nor lets it go on in time", async () => {
    const { calls, gate, run } = setup({
      answers: [HELD, HELD],
      choices: ["wait", "cancel"],
      unsaved: 1,
    });

    await gate.leave("quit", run("quit"));
    await delay(PROMPT_WITHIN_MS + 10);

    expect(calls).toStrictEqual([
      "ask:quit",
      "surface",
      "confirm:quit:1",
      "ask:quit",
    ]);

    await delay(PROMPT_WITHIN_MS + 10);
    gate.resume();
    await tick();

    expect(calls.slice(4)).toStrictEqual(["surface", "confirm:quit:1"]);
  });

  it("leaves the answer to the page once its prompt is on screen", async () => {
    const { calls, gate, run } = setup({ answers: [HELD], unsaved: 1 });

    await gate.leave("close", run("close"));
    gate.shown();
    await delay(PROMPT_WITHIN_MS + 10);

    expect(calls).toStrictEqual(["ask:close", "surface"]);

    gate.resume();
    await tick();

    expect(calls).toStrictEqual(["ask:close", "surface", "close"]);
  });

  it("arms no deadline when the page says its prompt is on screen before it answers, as a prompt already showing does", async () => {
    const calls: string[] = [];
    let gate: ReturnType<typeof createLeaveGate> | null = null;

    gate = createLeaveGate({
      ask: async (leaving: Leaving) => {
        calls.push(`ask:${leaving}`);
        gate?.shown();

        return await Promise.resolve(HELD);
      },
      confirm: async (leaving, count) => {
        calls.push(`confirm:${leaving}:${String(count)}`);

        return await Promise.resolve("cancel");
      },
      promptWithinMs: PROMPT_WITHIN_MS,
      surface: () => {
        calls.push("surface");
      },
      unsaved: () => 1,
      written: async () => await Promise.resolve(true),
    });

    await gate.leave("quit", () => {
      calls.push("quit");
    });
    await delay(PROMPT_WITHIN_MS + 10);

    expect(calls).toStrictEqual(["ask:quit", "surface"]);

    gate.resume();
    gate.resume();
    await tick();

    expect(calls).toStrictEqual(["ask:quit", "surface", "quit"]);
  });

  it("drops a restart that a newer quit replaced while the restart waited for the disk", async () => {
    const calls: string[] = [];
    const answers = [SAVED, HELD];
    const disk = { wrote: (_done: boolean): void => undefined };

    const gate = createLeaveGate({
      ask: async (leaving: Leaving) => {
        calls.push(`ask:${leaving}`);

        return await Promise.resolve(answers.shift() ?? null);
      },
      confirm: async () => await Promise.resolve("cancel"),
      promptWithinMs: PROMPT_WITHIN_MS,
      surface: () => {
        calls.push("surface");
      },
      unsaved: () => 1,
      written: async () =>
        // oxlint-disable-next-line promise/avoid-new -- the test lets the disk finish later, through this callback.
        await new Promise<boolean>((resolve) => {
          disk.wrote = resolve;
        }),
    });

    const restart = gate.leave("restart", () => {
      calls.push("restart");
    });

    await tick();
    await gate.leave("quit", () => {
      calls.push("quit");
    });
    gate.shown();
    disk.wrote(true);
    await restart;
    await tick();

    expect(calls).toStrictEqual(["ask:restart", "ask:quit", "surface"]);
  });
});

describe("the gate and the library's hold together", () => {
  it("quits at once when the only change was typed back to what is saved", async () => {
    const id = CaptureIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c");

    const stored: EditableFields = {
      description: "",
      due: null,
      pins: [],
      steps: [],
      title: "Total is off",
    };

    const calls: string[] = [];

    const drafts = new DraftStore({
      update: async ({ fields }) => {
        calls.push(`save:${fields.title}`);

        return await Promise.resolve({ ok: true });
      },
    });

    // Typed, then typed back before the pause in typing saved it.
    drafts.edit(id, { ...stored, title: "Total is off by 40" }, stored);
    drafts.edit(id, stored, stored);

    const toMain = {
      resume: (): void => undefined,
      shown: (): void => undefined,
    };

    const hold = createLeaveHold({
      drafts,
      resume: () => {
        toMain.resume();
      },
      shown: () => {
        toMain.shown();
      },
    });

    const gate = createLeaveGate({
      // As the library page answers main's flush: at once, then on another channel.
      ask: async (leaving: Leaving) => {
        const answer = hold.ask(leaving);

        return await Promise.resolve(answer.ok ? SAVED : answer);
      },
      confirm: async () => await Promise.resolve("cancel"),
      promptWithinMs: PROMPT_WITHIN_MS,
      surface: () => {
        calls.push("surface");
      },
      unsaved: () => drafts.unsaved()?.count ?? 0,
      written: async () => await Promise.resolve(true),
    });

    toMain.resume = gate.resume;
    toMain.shown = gate.shown;

    await gate.leave("quit", () => {
      calls.push("quit");
    });

    expect(calls).toStrictEqual(["quit"]);
  });
});
