import type { Leaving, SavedEdits } from "@shared/contracts";
import { describe, expect, it } from "vitest";

import { createLeaveGate } from "./leave-gate";

const FULL: SavedEdits = { message: "The disk is full.", ok: false };
const SAVED: SavedEdits = { fields: null, ok: true };

const setup = (answer: SavedEdits | null) => {
  const calls: string[] = [];

  const gate = createLeaveGate({
    ask: async (leaving: Leaving) => {
      calls.push(`ask:${leaving}`);

      return await Promise.resolve(answer);
    },
    surface: () => {
      calls.push("surface");
    },
  });

  const run = (name: string) => () => {
    calls.push(name);
  };

  return { calls, gate, run };
};

describe(createLeaveGate, () => {
  it("goes on once the page has saved everything", async () => {
    const { calls, gate, run } = setup(SAVED);

    await gate.leave("close", run("close"));

    expect(calls).toStrictEqual(["ask:close", "close"]);
  });

  it("goes on when the page doesn't answer, since it can't ask the user", async () => {
    const { calls, gate, run } = setup(null);

    await gate.leave("quit", run("quit"));

    expect(calls).toStrictEqual(["ask:quit", "quit"]);
  });

  it("holds while the page couldn't save, brings it in front, and goes on once, when the page resumes", async () => {
    const { calls, gate, run } = setup(FULL);

    await gate.leave("restart", run("restart"));

    expect(calls).toStrictEqual(["ask:restart", "surface"]);

    gate.resume();
    gate.resume();

    expect(calls).toStrictEqual(["ask:restart", "surface", "restart"]);
  });

  it("resumes the latest held kind, and nothing when nothing is held", async () => {
    const { calls, gate, run } = setup(FULL);

    gate.resume();
    await gate.leave("close", run("close"));
    await gate.leave("quit", run("quit"));
    gate.resume();

    expect(calls).toStrictEqual([
      "ask:close",
      "surface",
      "ask:quit",
      "surface",
      "quit",
    ]);
  });
});
