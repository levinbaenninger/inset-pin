import { z } from "zod";

import { dayLabel, longDate } from "./dates.ts";

const ISO_DATE = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;
const DAY_MS = 86_400_000;
const SATURDAY = 6;
const SUNDAY = 0;
const MONDAY = 1;
const WEEK_DAYS = 7;

/** A calendar day as `YYYY-MM-DD`, with no time and no time zone. */
export type DueDate = string & z.$brand<"DueDate">;

const isRealDay = (text: string): boolean => {
  const match = ISO_DATE.exec(text);

  if (match === null) {
    return false;
  }

  const year = Number(match.groups?.year);
  const month = Number(match.groups?.month);
  const day = Number(match.groups?.day);

  const date = new Date(year, month - 1, day);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
};

export const DueDateSchema = z
  .string()
  .regex(ISO_DATE)
  .refine(isRealDay, "not a calendar day")
  .brand<"DueDate">();

const pad = (value: number): string => String(value).padStart(2, "0");

/** The local calendar day of a moment. Never via toISOString, which is UTC. */
export const toDueDate = (date: Date): DueDate =>
  DueDateSchema.parse(
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  );

/** Local midnight of the day. */
export const fromDueDate = (due: DueDate): Date => {
  const [year = 1970, month = 1, day = 1] = due.split("-").map(Number);

  return new Date(year, month - 1, day);
};

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addDays = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/** Whole days from today to the due day; negative when it has passed. */
export const daysUntil = (due: DueDate, now: Date): number =>
  Math.round((fromDueDate(due).getTime() - startOfDay(now).getTime()) / DAY_MS);

export type DuePresetId = "today" | "tomorrow" | "weekend" | "nextWeek";

export interface DuePreset {
  readonly id: DuePresetId;
  readonly label: string;
  readonly date: DueDate;
}

/** Saturday, or today on a weekend. */
const thisWeekend = (today: Date): Date => {
  const weekday = today.getDay();

  if (weekday === SATURDAY || weekday === SUNDAY) {
    return today;
  }

  return addDays(today, SATURDAY - weekday);
};

/** The next Monday, always after today. */
const nextMonday = (today: Date): Date => {
  const ahead = (MONDAY - today.getDay() + WEEK_DAYS) % WEEK_DAYS;

  return addDays(today, ahead === 0 ? WEEK_DAYS : ahead);
};

type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** What Intl.Locale tells of a week; older engines name it a property, newer a method. */
interface WeekInfoLocale {
  readonly getWeekInfo?: () => { readonly firstDay: number };
  readonly weekInfo?: { readonly firstDay: number };
}

/**
 * The day a locale's weeks start on, as Date#getDay counts (Sunday is 0), so
 * the Due calendar's columns match the system: Monday in most of Europe,
 * Sunday in the US. Monday when the engine can't say. As in the Shelf.
 */
export const weekStartDay = (locale?: string): Weekday => {
  const info: Intl.Locale & WeekInfoLocale = new Intl.Locale(
    locale ?? new Intl.DateTimeFormat().resolvedOptions().locale
  );

  const first = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay ?? 1;

  return WEEKDAYS[first % WEEK_DAYS] ?? MONDAY;
};

/** The quick picks, worked out from the given moment. */
export const duePresets = (now: Date): readonly DuePreset[] => {
  const today = startOfDay(now);

  return [
    { date: toDueDate(today), id: "today", label: "Today" },
    { date: toDueDate(addDays(today, 1)), id: "tomorrow", label: "Tomorrow" },
    {
      date: toDueDate(thisWeekend(today)),
      id: "weekend",
      label: "This weekend",
    },
    { date: toDueDate(nextMonday(today)), id: "nextWeek", label: "Next week" },
  ];
};

export type DueState = "overdue" | "today" | "soon" | "later";

/** How a due chip looks: overdue in the destructive colour, today in the accent. */
export const dueState = (due: DueDate, now: Date): DueState => {
  const days = daysUntil(due, now);

  if (days < 0) {
    return "overdue";
  }

  if (days === 0) {
    return "today";
  }

  return days < WEEK_DAYS ? "soon" : "later";
};

/** "Today", "Tomorrow", "Yesterday", the weekday within six days ("Wed"), else a short date. */
export const dueLabel = (
  due: DueDate,
  now: Date,
  locale?: string,
  weekday: "short" | "long" = "short"
): string => dayLabel(fromDueDate(due), now, locale, weekday);

/** What the chip reads: an overdue day says so in words, not by colour alone. */
export const dueChipText = (due: DueDate, now: Date, locale?: string): string =>
  dueState(due, now) === "overdue"
    ? `Overdue · ${dueLabel(due, now, locale)}`
    : dueLabel(due, now, locale);

/** What the chip says aloud and in its tooltip, weekday in full: "Due today", "Overdue, was due yesterday", "Due Friday". */
export const dueSentence = (
  due: DueDate,
  now: Date,
  locale?: string
): string => {
  const label = dueLabel(due, now, locale, "long");
  const days = daysUntil(due, now);
  const spoken = Math.abs(days) <= 1 ? label.toLocaleLowerCase() : label;

  return days < 0 ? `Overdue, was due ${spoken}` : `Due ${spoken}`;
};

/** The whole day, for a tooltip: "Friday, November 13, 2026". */
export const dueLongLabel = (due: DueDate, locale?: string): string =>
  longDate(fromDueDate(due), locale);

/** What a due filter in the search keeps. */
export type DueFilter = "today" | "overdue" | "week" | "any" | "none";

/** The same five filters, in the same order, as the Shelf and Window Links. */
export const DUE_FILTERS: readonly DueFilter[] = [
  "today",
  "overdue",
  "week",
  "any",
  "none",
];

export const isDueFilter = (value: string): value is DueFilter =>
  DUE_FILTERS.some((filter) => filter === value);

/** `due:week` keeps what is overdue, due today or in the next six days, since what is overdue is due this week too. */
export const matchesDueFilter = (
  due: DueDate | null,
  filter: DueFilter,
  now: Date
): boolean => {
  if (filter === "none") {
    return due === null;
  }

  if (due === null) {
    return false;
  }

  const days = daysUntil(due, now);

  switch (filter) {
    case "today": {
      return days === 0;
    }

    case "overdue": {
      return days < 0;
    }

    case "week": {
      return days < WEEK_DAYS;
    }

    case "any": {
      return true;
    }

    default: {
      return true;
    }
  }
};
