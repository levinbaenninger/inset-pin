import { describe, expect, it } from "vitest";

import {
  daysUntil,
  DueDateSchema,
  dueLabel,
  duePresets,
  dueState,
  fromDueDate,
  matchesDueFilter,
  toDueDate,
} from "./due";

const day = (text: string) => DueDateSchema.parse(text);

/** Local times, so the tests hold in every time zone. */
const at = (year: number, month: number, date: number, hour = 12) =>
  new Date(year, month - 1, date, hour);

const presetDates = (now: Date) =>
  Object.fromEntries(duePresets(now).map((preset) => [preset.id, preset.date]));

describe(toDueDate, () => {
  it("uses the local day, even just before midnight", () => {
    expect(toDueDate(at(2026, 11, 5, 23))).toBe("2026-11-05");
    expect(toDueDate(at(2026, 11, 5, 0))).toBe("2026-11-05");
  });

  it("round-trips through fromDueDate", () => {
    expect(toDueDate(fromDueDate(day("2026-02-28")))).toBe("2026-02-28");
  });
});

describe("reading a due date", () => {
  it("accepts calendar days only", () => {
    expect(DueDateSchema.safeParse("2028-02-29").success).toBeTruthy();
    expect(DueDateSchema.safeParse("2026-02-29").success).toBeFalsy();
    expect(DueDateSchema.safeParse("2026-13-01").success).toBeFalsy();
    expect(DueDateSchema.safeParse("2026-1-1").success).toBeFalsy();
    expect(DueDateSchema.safeParse("2026-11-05T00:00:00Z").success).toBeFalsy();
  });
});

describe(duePresets, () => {
  it("offers today, tomorrow, Saturday and next Monday on a Wednesday", () => {
    expect(presetDates(at(2026, 11, 4))).toStrictEqual({
      nextWeek: "2026-11-09",
      today: "2026-11-04",
      tomorrow: "2026-11-05",
      weekend: "2026-11-07",
    });
  });

  it("makes this weekend today on a Saturday and on a Sunday", () => {
    expect(presetDates(at(2026, 11, 7)).weekend).toBe("2026-11-07");
    expect(presetDates(at(2026, 11, 8)).weekend).toBe("2026-11-08");
  });

  it("makes next week the Monday after, never today", () => {
    expect(presetDates(at(2026, 11, 9)).nextWeek).toBe("2026-11-16");
    expect(presetDates(at(2026, 11, 8)).nextWeek).toBe("2026-11-09");
  });

  it("crosses a month and a year", () => {
    expect(presetDates(at(2026, 12, 31))).toMatchObject({
      nextWeek: "2027-01-04",
      tomorrow: "2027-01-01",
    });
  });
});

describe(dueState, () => {
  const now = at(2026, 11, 5);

  it("buckets by whole local days", () => {
    expect(dueState(day("2026-11-04"), now)).toBe("overdue");
    expect(dueState(day("2026-11-05"), now)).toBe("today");
    expect(dueState(day("2026-11-11"), now)).toBe("soon");
    expect(dueState(day("2026-11-12"), now)).toBe("later");
  });

  it("counts days across a daylight saving change", () => {
    expect(daysUntil(day("2026-11-02"), at(2026, 10, 24))).toBe(9);
    expect(daysUntil(day("2026-03-30"), at(2026, 3, 28))).toBe(2);
  });
});

describe(dueLabel, () => {
  const now = at(2026, 11, 5);

  it("names near days and dates further away", () => {
    expect(dueLabel(day("2026-11-05"), now)).toBe("Today");
    expect(dueLabel(day("2026-11-06"), now)).toBe("Tomorrow");
    expect(dueLabel(day("2026-11-04"), now)).toBe("Yesterday");
    expect(dueLabel(day("2026-11-13"), now)).toBe("Fri 13 Nov");
    expect(dueLabel(day("2027-01-08"), now)).toBe("8 Jan 2027");
  });
});

describe(matchesDueFilter, () => {
  const now = at(2026, 11, 5);

  it("filters by due day", () => {
    expect(matchesDueFilter(day("2026-11-05"), "today", now)).toBeTruthy();
    expect(matchesDueFilter(day("2026-11-06"), "today", now)).toBeFalsy();
    expect(matchesDueFilter(day("2026-11-06"), "tomorrow", now)).toBeTruthy();
    expect(matchesDueFilter(day("2026-11-01"), "overdue", now)).toBeTruthy();
    expect(matchesDueFilter(day("2026-11-05"), "overdue", now)).toBeFalsy();
  });

  it("counts overdue and the next seven days as this week", () => {
    expect(matchesDueFilter(day("2026-11-01"), "week", now)).toBeTruthy();
    expect(matchesDueFilter(day("2026-11-11"), "week", now)).toBeTruthy();
    expect(matchesDueFilter(day("2026-11-12"), "week", now)).toBeFalsy();
  });

  it("keeps entries without a due date only for due:none", () => {
    expect(matchesDueFilter(null, "week", now)).toBeFalsy();
    expect(matchesDueFilter(null, "any", now)).toBeFalsy();
    expect(matchesDueFilter(null, "none", now)).toBeTruthy();
    expect(matchesDueFilter(day("2026-11-05"), "none", now)).toBeFalsy();
  });
});
