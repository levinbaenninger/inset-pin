import { CaptureIdSchema } from "@shared/capture-record";
import type { CaptureSummary } from "@shared/contracts";
import { describe, expect, it } from "vitest";

import {
  groupByDay,
  matchesQuery,
  selectionAfterRemoval,
  stepSelection,
  visibleIds,
} from "./list-model";

const id = (n: number) =>
  CaptureIdSchema.parse(
    `3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b${String(n).padStart(2, "0")}`
  );

const saved = (
  n: number,
  capturedAt: Date,
  thought = "Total ignores the discount"
): CaptureSummary => ({
  capturedAt: capturedAt.toISOString(),
  id: id(n),
  image: {
    heightPx: 600,
    pixelsPerDip: 2,
    url: "inset://capture/x",
    widthPx: 960,
  },
  kind: "ok",
  pin: { x: 1, y: 1 },
  sourceLabel: "Built-in Retina Display",
  thought,
  title: thought,
});

const unreadable: CaptureSummary = {
  id: id(99),
  kind: "readOnly",
  why: "unreadable",
};

const NOW = new Date(2026, 9, 22, 9, 30);
const at = (day: number, hour: number) => new Date(2026, 9, day, hour);

describe(matchesQuery, () => {
  const capture = saved(1, NOW, "Total ignores the DISCOUNT\nfor Meier AG");

  it("matches every word in any order and case", () => {
    expect(matchesQuery(capture, "  meier discount ")).toBeTruthy();
    expect(matchesQuery(capture, "meier invoice")).toBeFalsy();
  });

  it("searches the source as well as the thought", () => {
    expect(matchesQuery(capture, "retina")).toBeTruthy();
  });

  it("shows everything, read-only entries included, for an empty query", () => {
    expect(matchesQuery(unreadable, " ")).toBeTruthy();
    expect(matchesQuery(unreadable, "total")).toBeFalsy();
  });
});

describe(groupByDay, () => {
  it("groups by local day in list order and labels today and yesterday", () => {
    const groups = groupByDay(
      [
        saved(1, at(22, 8)),
        saved(2, at(22, 0)),
        saved(3, at(21, 23)),
        saved(4, at(16, 12)),
        unreadable,
      ],
      NOW
    );

    expect(
      groups.map((group) =>
        group.kind === "day"
          ? [group.relative, group.day.getDate(), group.captures.length]
          : ["readOnly", group.captures.length]
      )
    ).toStrictEqual([
      ["today", 22, 2],
      ["yesterday", 21, 1],
      [null, 16, 1],
      ["readOnly", 1],
    ]);
  });

  it("returns no groups for no captures", () => {
    expect(groupByDay([], NOW)).toStrictEqual([]);
  });
});

describe(stepSelection, () => {
  const ids = [id(1), id(2), id(3)];

  it("moves by one and stops at the ends", () => {
    expect(stepSelection(ids, id(2), 1)).toBe(id(3));
    expect(stepSelection(ids, id(3), 1)).toBe(id(3));
    expect(stepSelection(ids, id(1), -1)).toBe(id(1));
  });

  it("starts at the first capture when nothing visible is selected", () => {
    expect(stepSelection(ids, null, 1)).toBe(id(1));
    expect(stepSelection(ids, id(9), -1)).toBe(id(1));
    expect(stepSelection([], null, 1)).toBeNull();
  });
});

describe(selectionAfterRemoval, () => {
  const ids = [id(1), id(2), id(3)];

  it("selects the next older capture, else the newer one", () => {
    expect(selectionAfterRemoval(ids, id(2))).toBe(id(3));
    expect(selectionAfterRemoval(ids, id(3))).toBe(id(2));
    expect(selectionAfterRemoval([id(1)], id(1))).toBeNull();
  });

  it("selects the first shown capture when the removed one was hidden", () => {
    expect(selectionAfterRemoval(ids, id(9))).toBe(id(1));
    expect(selectionAfterRemoval([], id(9))).toBeNull();
  });
});

describe(visibleIds, () => {
  it("keeps the list's order and only what the search shows", () => {
    const captures = [
      saved(1, at(22, 8), "Total ignores the discount"),
      saved(2, at(22, 7), "Button looks disabled"),
      saved(3, at(21, 9), "Discount applied twice"),
      unreadable,
    ];

    expect(visibleIds(captures, "discount")).toStrictEqual([id(1), id(3)]);
    expect(visibleIds(captures, "")).toStrictEqual([
      id(1),
      id(2),
      id(3),
      id(99),
    ]);
  });
});
