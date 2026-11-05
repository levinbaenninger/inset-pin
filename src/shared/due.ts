import { z } from "zod";

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

const weekdayShort = new Intl.DateTimeFormat("en", { weekday: "short" });

const dayMonth = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

const dayMonthYear = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "Today", "Tomorrow", "Yesterday", "Fri 7 Nov", or with the year when it is another year. */
export const dueLabel = (due: DueDate, now: Date): string => {
  const days = daysUntil(due, now);

  if (days === 0) {
    return "Today";
  }

  if (days === 1) {
    return "Tomorrow";
  }

  if (days === -1) {
    return "Yesterday";
  }

  const date = fromDueDate(due);

  if (date.getFullYear() !== now.getFullYear()) {
    return dayMonthYear.format(date);
  }

  return `${weekdayShort.format(date)} ${dayMonth.format(date)}`;
};

/** What a due filter in the search keeps. */
export type DueFilter =
  | "today"
  | "overdue"
  | "week"
  | "tomorrow"
  | "any"
  | "none";

export const DUE_FILTERS: readonly DueFilter[] = [
  "today",
  "tomorrow",
  "week",
  "overdue",
  "any",
  "none",
];

export const isDueFilter = (value: string): value is DueFilter =>
  DUE_FILTERS.some((filter) => filter === value);

/** `due:week` keeps what is due in the next seven days, and what is overdue, since that is due too. */
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

    case "tomorrow": {
      return days === 1;
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
