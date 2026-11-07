import { describe, expect, it } from "vitest";

import { PINS_MAX } from "./capture-record";
import {
  addPin,
  applyPinKey,
  labelPin,
  movePin,
  nudgePin,
  pinAt,
  pinBounds,
  pinLabelLines,
  removePin,
  selectionAfterRemove,
} from "./pins";
import type { PinPoint } from "./pins";

const AREA = { height: 100, width: 200, x: 0, y: 0 };

const three: readonly PinPoint[] = [
  { label: "first", x: 10, y: 10 },
  { x: 50, y: 50 },
  { label: "third", x: 90, y: 20 },
];

describe(addPin, () => {
  it("appends the next pin, kept inside the area", () => {
    expect(addPin(three, { x: 500, y: -4 }, AREA)?.at(-1)).toStrictEqual({
      x: 199,
      y: 0,
    });
  });

  it("refuses a pin past the limit", () => {
    const full = Array.from({ length: PINS_MAX }, () => ({ x: 1, y: 1 }));

    expect(addPin(full, { x: 2, y: 2 }, AREA)).toBeNull();
  });
});

describe(removePin, () => {
  it("removes one pin and the later ones move up a number, labels with them", () => {
    expect(removePin(three, 0)).toStrictEqual([
      { x: 50, y: 50 },
      { label: "third", x: 90, y: 20 },
    ]);
    expect(pinLabelLines(removePin(three, 0))).toStrictEqual(["2 · third"]);
  });
});

describe(selectionAfterRemove, () => {
  it("selects the pin that took the number, else the one before, else none", () => {
    expect(selectionAfterRemove(3, 0)).toBe(0);
    expect(selectionAfterRemove(3, 2)).toBe(1);
    expect(selectionAfterRemove(1, 0)).toBeNull();
  });
});

describe(movePin, () => {
  it("moves one pin, keeps its label and clamps it to the area", () => {
    expect(movePin(three, 0, { x: -5, y: 300 }, AREA)[0]).toStrictEqual({
      label: "first",
      x: 0,
      y: 99,
    });
  });
});

describe(nudgePin, () => {
  it("nudges by the delta and stays inside", () => {
    expect(nudgePin(three, 1, { x: 10, y: -1 }, AREA)[1]).toStrictEqual({
      x: 60,
      y: 49,
    });
    expect(nudgePin(three, 2, { x: 500, y: 0 }, AREA)[2]?.x).toBe(199);
  });

  it("ignores an index without a pin", () => {
    expect(nudgePin(three, 7, { x: 1, y: 1 }, AREA)).toBe(three);
  });
});

describe(labelPin, () => {
  it("sets a label and drops a blank one", () => {
    expect(labelPin(three, 1, "Total")[1]).toStrictEqual({
      label: "Total",
      x: 50,
      y: 50,
    });
    expect(labelPin(three, 0, "  ")[0]).toStrictEqual({ x: 10, y: 10 });
  });
});

describe(pinBounds, () => {
  it("boxes every pin, and nothing without pins", () => {
    expect(pinBounds(three)).toStrictEqual({
      height: 41,
      width: 81,
      x: 10,
      y: 10,
    });
    expect(pinBounds([])).toBeNull();
  });
});

describe(pinAt, () => {
  it("finds the closest pin in reach, the later one on a tie", () => {
    expect(pinAt(three, { x: 12, y: 11 }, 6)).toBe(0);
    expect(pinAt(three, { x: 30, y: 30 }, 6)).toBeNull();
    expect(
      pinAt(
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
        { x: 1, y: 0 },
        6
      )
    ).toBe(1);
  });
});

describe(applyPinKey, () => {
  const edit = { pins: three, selected: 1 };
  const dropAt = { x: 5, y: 6 };

  const nudged = (far: boolean) =>
    applyPinKey(edit, { dx: 1, dy: -1, far, kind: "nudge" }, AREA, dropAt)
      .pins[1];

  it("nudges the selected pin one image pixel, or ten with Shift", () => {
    expect(nudged(false)).toStrictEqual({ x: 51, y: 49 });
    expect(nudged(true)).toStrictEqual({ x: 60, y: 40 });
  });

  it("removes the selected pin and selects the one that took its number", () => {
    expect(applyPinKey(edit, { kind: "remove" }, AREA, dropAt)).toStrictEqual({
      pins: [three[0], three[2]],
      selected: 1,
    });
  });

  it("drops a pin at the given point and selects it", () => {
    expect(applyPinKey(edit, { kind: "drop" }, AREA, dropAt)).toStrictEqual({
      pins: [...three, { x: 5, y: 6 }],
      selected: 3,
    });
  });

  it("leaves the pins alone without a selection", () => {
    const none = { pins: three, selected: null };

    expect(applyPinKey(none, { kind: "remove" }, AREA, dropAt)).toBe(none);
    expect(
      applyPinKey(
        none,
        { dx: 1, dy: 0, far: false, kind: "nudge" },
        AREA,
        dropAt
      )
    ).toBe(none);
  });

  it("selects and lets go", () => {
    expect(
      applyPinKey(edit, { index: 2, kind: "select" }, AREA, dropAt).selected
    ).toBe(2);
    expect(
      applyPinKey(edit, { kind: "deselect" }, AREA, dropAt).selected
    ).toBeNull();
  });
});
