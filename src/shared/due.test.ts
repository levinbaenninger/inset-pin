import { describe, expect, it } from "vitest";

import {
  daysUntil,
  DUE_FILTERS,
  dueChipText,
  DueDateSchema,
  dueLabel,
  duePresets,
  dueSentence,
  dueState,
  fromDueDate,
  matchesDueFilter,
  toDueDate,
} from "./due";
import type { DueFilter } from "./due";

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

  const labels = (days: readonly string[]) =>
    days.map((due) => dueLabel(day(due), now, "en-US"));

  it("names near days, the weekday within six days, and dates further away", () => {
    expect(
      labels([
        "2026-11-05",
        "2026-11-06",
        "2026-11-04",
        "2026-11-11",
        "2026-11-12",
        "2026-11-02",
        "2027-01-08",
      ])
    ).toStrictEqual([
      "Today",
      "Tomorrow",
      "Yesterday",
      "Wednesday",
      "Nov 12",
      "Nov 2",
      "Jan 8, 2027",
    ]);
  });

  it("follows the locale it is given", () => {
    expect(dueLabel(day("2026-11-12"), now, "en-GB")).toBe("12 Nov");
    expect(dueLabel(day("2026-11-11"), now, "de-CH")).toBe("Mittwoch");
  });
});

describe(dueChipText, () => {
  const now = at(2026, 11, 5);

  it("says Overdue in words, not by colour alone", () => {
    expect(dueChipText(day("2026-11-03"), now, "en-US")).toBe(
      "Overdue · Nov 3"
    );
    expect(dueChipText(day("2026-11-04"), now, "en-US")).toBe(
      "Overdue · Yesterday"
    );
    expect(dueChipText(day("2026-11-05"), now, "en-US")).toBe("Today");
  });

  it("reads aloud with the state", () => {
    expect(dueSentence(day("2026-11-04"), now, "en-US")).toBe(
      "Overdue, was due yesterday"
    );
    expect(dueSentence(day("2026-11-05"), now, "en-US")).toBe("Due today");
    expect(dueSentence(day("2026-11-12"), now, "en-US")).toBe("Due Nov 12");
  });
});

describe(matchesDueFilter, () => {
  const now = at(2026, 11, 5);
  const past = day("2026-11-01");
  const today = day("2026-11-05");
  const sixDays = day("2026-11-11");
  const sevenDays = day("2026-11-12");
  const all = [past, today, sixDays, sevenDays, null] as const;

  const kept = (filter: DueFilter) =>
    all.map((due) => matchesDueFilter(due, filter, now));

  it("keeps the past, today, +6 and +7 days as each filter says", () => {
    expect({
      any: kept("any"),
      none: kept("none"),
      overdue: kept("overdue"),
      today: kept("today"),
      week: kept("week"),
    }).toStrictEqual({
      any: [true, true, true, true, false],
      none: [false, false, false, false, true],
      overdue: [true, false, false, false, false],
      today: [false, true, false, false, false],
      week: [true, true, true, false, false],
    });
  });

  it("offers the same five filters as the other Inset apps", () => {
    expect(DUE_FILTERS).toStrictEqual([
      "today",
      "overdue",
      "week",
      "any",
      "none",
    ]);
  });
});
