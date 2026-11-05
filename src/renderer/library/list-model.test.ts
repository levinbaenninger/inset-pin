import { CaptureIdSchema } from "@shared/capture-record";
import type { CaptureId } from "@shared/capture-record";
import type { CaptureSummary, SavedCapture } from "@shared/contracts";
import { DueDateSchema } from "@shared/due";
import { parseQuery } from "@shared/search";
import { describe, expect, it } from "vitest";

import {
  groupByDay,
  isShown,
  listOf,
  listOrder,
  matchSnippet,
  selectionAfterRemoval,
  stepProgress,
  stepSelection,
} from "./list-model";

const id = (n: number): CaptureId =>
  CaptureIdSchema.parse(
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
  );

const saved = (
  n: number,
  capturedAt: string,
  change: Partial<SavedCapture> = {}
): SavedCapture => ({
  capturedAt,
  description: "",
  due: null,
  id: id(n),
  image: { heightPx: 10, pixelsPerDip: 1, url: "", widthPx: 10 },
  invokedVia: "shortcut",
  kind: "ok",
  pins: [],
  sourceLabel: null,
  status: { kind: "active" },
  steps: [],
  title: `Capture ${n}`,
  updatedAt: capturedAt,
  ...change,
});

const readOnly: CaptureSummary = {
  id: id(99),
  kind: "readOnly",
  why: "unreadable",
};

/** Local times, so the tests hold in every time zone. */
const local = (day: number, hour: number) =>
  new Date(2026, 10, day, hour).toISOString();

const now = new Date(2026, 10, 5, 12);

describe(listOf, () => {
  it("puts done captures in Done and everything else in the active list", () => {
    expect(
      listOf(
        saved(1, local(5, 9), { status: { at: local(5, 10), kind: "done" } })
      )
    ).toBe("done");
    expect(listOf(saved(2, local(5, 9)))).toBe("active");
    expect(listOf(readOnly)).toBe("active");
  });
});

describe(isShown, () => {
  const quote = saved(1, local(5, 9), {
    description: "Delivery comes late",
    due: DueDateSchema.parse("2026-11-05"),
    title: "Quote",
  });

  it("filters by list, words and due date", () => {
    expect(isShown(quote, "active", parseQuery(""), false, now)).toBeTruthy();
    expect(isShown(quote, "done", parseQuery(""), false, now)).toBeFalsy();
    expect(
      isShown(quote, "active", parseQuery("delivery"), true, now)
    ).toBeTruthy();
    expect(
      isShown(quote, "active", parseQuery("due:overdue"), true, now)
    ).toBeFalsy();
    expect(
      isShown(quote, "active", parseQuery("due:today"), true, now)
    ).toBeTruthy();
  });

  it("hides read-only entries while searching", () => {
    expect(
      isShown(readOnly, "active", parseQuery(""), false, now)
    ).toBeTruthy();
    expect(isShown(readOnly, "active", parseQuery("x"), true, now)).toBeFalsy();
  });
});

describe(groupByDay, () => {
  it("groups by local day, names today and yesterday, and puts read-only last", () => {
    const groups = groupByDay(
      [
        saved(1, local(5, 10)),
        saved(2, local(5, 8)),
        saved(3, local(4, 20)),
        saved(4, local(1, 9)),
        readOnly,
      ],
      now
    );

    expect(
      groups.map((group) =>
        group.kind === "day"
          ? [group.relative, group.captures.length]
          : ["readOnly", group.captures.length]
      )
    ).toStrictEqual([
      ["today", 2],
      ["yesterday", 1],
      [null, 1],
      ["readOnly", 1],
    ]);
  });

  it("groups done captures by when they were done", () => {
    const [group] = groupByDay(
      [saved(1, local(1, 9), { status: { at: local(5, 9), kind: "done" } })],
      now
    );

    expect(group?.kind === "day" && group.relative).toBe("today");
  });
});

describe(listOrder, () => {
  it("orders newest first and read-only last", () => {
    expect(
      listOrder([readOnly, saved(1, local(4, 9)), saved(2, local(5, 9))]).map(
        (capture) => capture.id
      )
    ).toStrictEqual([id(2), id(1), id(99)]);
  });
});

describe(stepSelection, () => {
  const ids = [id(1), id(2), id(3)];

  it("steps and stays at the ends", () => {
    expect(stepSelection(ids, id(1), 1)).toBe(id(2));
    expect(stepSelection(ids, id(3), 1)).toBe(id(3));
    expect(stepSelection(ids, id(1), -1)).toBe(id(1));
    expect(stepSelection(ids, null, 1)).toBe(id(1));
  });
});

describe(selectionAfterRemoval, () => {
  const ids = [id(1), id(2), id(3)];

  it("selects the next older capture, else the newer one", () => {
    expect(selectionAfterRemoval(ids, id(2))).toBe(id(3));
    expect(selectionAfterRemoval(ids, id(3))).toBe(id(2));
    expect(selectionAfterRemoval([id(1)], id(1))).toBeNull();
    expect(selectionAfterRemoval(ids, id(7))).toBe(id(1));
  });
});

describe(stepProgress, () => {
  it("counts checked steps", () => {
    expect(
      stepProgress([{ done: true }, { done: false }, { done: true }])
    ).toStrictEqual({ done: 2, total: 3 });
    expect(stepProgress([])).toBeNull();
  });
});

describe(matchSnippet, () => {
  const capture = saved(1, local(5, 9), {
    description: "First line\nChairs are over budget",
    pins: [
      { x: 1, y: 1 },
      { label: "Delivery fee", x: 2, y: 2 },
    ],
    steps: [{ done: false, id: "s", text: "Ask Rieder" }],
    title: "Quote",
  });

  it("shows the line that matched when the title did not", () => {
    expect(matchSnippet(capture, ["chairs"])).toBe("Chairs are over budget");
    expect(matchSnippet(capture, ["rieder"])).toBe("Ask Rieder");
    expect(matchSnippet(capture, ["delivery"])).toBe("2 · Delivery fee");
  });

  it("starts the excerpt near a match far into a long line", () => {
    const long = saved(2, local(5, 9), {
      description:
        "The first part of this line runs on for a while before the word delivery appears",
      title: "Quote",
    });

    expect(matchSnippet(long, ["delivery"])).toBe(
      "…before the word delivery appears"
    );
  });

  it("shows nothing when the title holds every word, or without a search", () => {
    expect(matchSnippet(capture, ["quote"])).toBeNull();
    expect(matchSnippet(capture, [])).toBeNull();
  });
});
