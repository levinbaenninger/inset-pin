import { describe, expect, it } from "vitest";

import { createQuitGate } from "./quit-gate";

const setup = (draft: "none" | "open") => {
  const calls: string[] = [];
  let holding = draft === "open";

  const gate = createQuitGate({
    holdIfNeeded: () => (holding ? "hold" : "allow"),
    quit: () => {
      calls.push("quit");
    },
    releaseWindows: () => {
      calls.push("release");
    },
    restartToUpdate: () => {
      calls.push("restartToUpdate");
    },
  });

  const draftEnds = (): void => {
    holding = false;
  };

  return { calls, draftEnds, gate };
};

describe(createQuitGate, () => {
  it("restarts into the update right away without a draft", () => {
    const { calls, gate } = setup("none");

    gate.restartToUpdate();

    expect(calls).toStrictEqual(["release", "restartToUpdate"]);
  });

  it("restarts into the update once the draft lets the quit go on", () => {
    const { calls, draftEnds, gate } = setup("open");

    gate.restartToUpdate();

    expect(calls).toStrictEqual([]);

    draftEnds();
    gate.resume();

    expect(calls).toStrictEqual(["release", "restartToUpdate"]);
  });

  it("quits plainly when the latest held quit was a plain one", () => {
    const { calls, draftEnds, gate } = setup("open");

    gate.restartToUpdate();

    expect(gate.allowQuit()).toBeFalsy();

    draftEnds();
    gate.resume();

    expect(calls).toStrictEqual(["quit"]);
  });

  it("lets a quit through and releases the hidden windows without a draft", () => {
    const { calls, gate } = setup("none");

    expect(gate.allowQuit()).toBeTruthy();
    expect(calls).toStrictEqual(["release"]);
  });
});
