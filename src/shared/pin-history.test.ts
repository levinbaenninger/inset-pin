import { describe, expect, it } from "vitest";

import {
  emptyHistory,
  endGesture,
  recordPins,
  redoPins,
  undoGesture,
  undoPins,
} from "./pin-history";

interface Pin {
  readonly x: number;
  readonly y: number;
}

const start: readonly Pin[] = [{ x: 10, y: 10 }];

/** Moves the pin in 20 steps of one drag, as pointer moves arrive. */
const drag = () => {
  let history = emptyHistory<Pin>();
  let pins = start;

  for (let step = 1; step <= 20; step += 1) {
    history = recordPins(history, pins, "drag:1");
    pins = [{ x: 10 + step, y: 10 }];
  }

  return { history, pins };
};

describe("pin history", () => {
  it("undoes a 20-step drag in one go", () => {
    const { history, pins } = drag();
    const undone = undoPins(history, pins);

    expect(pins).toStrictEqual([{ x: 30, y: 10 }]);
    expect(undone?.pins).toStrictEqual(start);
    expect(undone === null ? null : undoPins(undone.history, start)).toBeNull();
  });

  it("redoes what it undid, and a new change drops the redo", () => {
    const { history, pins } = drag();
    const undone = undoPins(history, pins);

    expect(
      undone === null ? null : redoPins(undone.history, start)?.pins
    ).toStrictEqual(pins);

    const changed =
      undone === null ? null : recordPins(undone.history, start, null);

    expect(changed === null ? null : redoPins(changed, start)).toBeNull();
  });

  it("takes a step for each change without a gesture", () => {
    let history = emptyHistory<Pin>();

    history = recordPins(history, [], null);
    history = recordPins(history, start, null);

    expect(history.undo).toStrictEqual([[], start]);
  });

  it("starts a new step for the same gesture once it ends", () => {
    let history = recordPins(emptyHistory<Pin>(), start, "nudge:0");

    history = recordPins(history, [{ x: 11, y: 10 }], "nudge:0");
    expect(history.undo).toHaveLength(1);

    history = recordPins(endGesture(history), [{ x: 12, y: 10 }], "nudge:0");
    expect(history.undo).toHaveLength(2);
  });

  it("takes back only the gesture still going on, as Esc does in a pin's label", () => {
    const { history, pins } = drag();
    const typed = recordPins(history, pins, "label:0");
    const labelled: readonly Pin[] = [{ x: 30, y: 10 }];

    expect(undoGesture(typed, labelled, "label:0")?.pins).toStrictEqual(pins);
    expect(undoGesture(typed, labelled, "label:1")).toBeNull();
    expect(undoGesture(endGesture(typed), labelled, "label:0")).toBeNull();
  });
});
