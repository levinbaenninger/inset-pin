import { describe, expect, it } from "vitest";

import { canCheck, IDLE, nextUpdateState } from "./update-state";
import type { UpdateEvent, UpdateState } from "./update-state";

const run = (
  events: readonly UpdateEvent[],
  from: UpdateState = IDLE
): UpdateState => {
  let state = from;

  for (const event of events) {
    state = nextUpdateState(state, event);
  }

  return state;
};

describe(nextUpdateState, () => {
  it("checks, downloads and then waits for the restart", () => {
    expect(
      run([
        { type: "checkStarted" },
        { type: "found", version: "0.1.58" },
        { percent: 41.7, type: "progress" },
      ])
    ).toStrictEqual({ kind: "downloading", percent: 41, version: "0.1.58" });
    expect(
      run([
        { type: "checkStarted" },
        { type: "found", version: "0.1.58" },
        { type: "downloaded", version: "0.1.58" },
      ])
    ).toStrictEqual({ kind: "ready", version: "0.1.58" });
  });

  it("reports an app that is up to date", () => {
    expect(run([{ type: "checkStarted" }, { type: "notFound" }])).toStrictEqual(
      { kind: "upToDate" }
    );
  });

  it("keeps a downloaded update when a later event fails", () => {
    const ready: UpdateState = { kind: "ready", version: "0.1.58" };

    expect(
      run(
        [
          { type: "checkStarted" },
          { message: "offline", type: "failed" },
          { type: "notFound" },
        ],
        ready
      )
    ).toBe(ready);
  });

  it("shows a failure and lets the next check start", () => {
    const failed = run([
      { type: "checkStarted" },
      { message: "404 latest-mac.yml", type: "failed" },
    ]);

    expect(failed).toStrictEqual({
      kind: "error",
      message: "404 latest-mac.yml",
    });
    expect(run([{ type: "checkStarted" }], failed)).toStrictEqual({
      kind: "checking",
    });
  });

  it("does not restart a running download", () => {
    const downloading: UpdateState = {
      kind: "downloading",
      percent: 10,
      version: "0.1.58",
    };

    expect(run([{ type: "checkStarted" }], downloading)).toBe(downloading);
  });

  it("ignores progress that belongs to no download", () => {
    expect(run([{ percent: 50, type: "progress" }])).toBe(IDLE);
  });
});

describe(canCheck, () => {
  it("allows a check only when nothing runs or waits", () => {
    const states: UpdateState[] = [
      IDLE,
      { kind: "checking" },
      { kind: "available", version: "1.0.0" },
      { kind: "downloading", percent: 0, version: "1.0.0" },
      { kind: "ready", version: "1.0.0" },
      { kind: "upToDate" },
      { kind: "error", message: "x" },
    ];

    expect(states.map(canCheck)).toStrictEqual([
      true,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
  });
});
