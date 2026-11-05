/**
 * Every date and time the app shows, written in the system's locale through
 * Intl. The app never names a locale: left undefined, Intl takes the system's.
 * Tests pass one to get fixed text. The rules match Window Links'
 * `src/shared/dates.ts`, so the three Inset apps read dates the same way.
 */

type Locale = string | undefined;

const DAY_MS = 86_400_000;

/** The days within which a weekday names the day without its date. */
const NEAR_DAYS = 6;

const RELATIVE: ReadonlyMap<number, string> = new Map([
  [-1, "Yesterday"],
  [0, "Today"],
  [1, "Tomorrow"],
]);

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** Whole calendar days from `now` to `date`: 0 today, 1 tomorrow, -1 yesterday. */
export const calendarDays = (date: Date, now: Date): number =>
  Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY_MS);

/** "Nov 5" or "5 Nov", with the weekday when asked, and the year only when it is not this year's. */
export const shortDate = (
  date: Date,
  now: Date,
  {
    locale,
    weekday = false,
  }: { readonly weekday?: boolean; readonly locale?: Locale } = {}
): string => {
  const parts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

  if (weekday) {
    parts.weekday = "short";
  }

  if (date.getFullYear() !== now.getFullYear()) {
    parts.year = "numeric";
  }

  return date.toLocaleDateString(locale, parts);
};

/** A chip's day: Today, Tomorrow or Yesterday, the weekday within the coming six days, else a short date. */
export const dayLabel = (date: Date, now: Date, locale?: Locale): string => {
  const days = calendarDays(date, now);
  const relative = RELATIVE.get(days);

  if (relative !== undefined) {
    return relative;
  }

  return days > 1 && days <= NEAR_DAYS
    ? date.toLocaleDateString(locale, { weekday: "long" })
    : shortDate(date, now, { locale });
};

/** A list heading: Today or Yesterday, else the weekday and short date. */
export const dayHeading = (date: Date, now: Date, locale?: Locale): string =>
  RELATIVE.get(calendarDays(date, now)) ??
  shortDate(date, now, { locale, weekday: true });

/** "2:05 PM" or "14:05", as the system writes the time. */
export const clockTime = (date: Date, locale?: Locale): string =>
  date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });

/** "Today, 10:42 AM" or "Mon, Nov 2, 10:42 AM": a moment, as a header names it. */
export const dayAndTime = (date: Date, now: Date, locale?: Locale): string =>
  `${dayHeading(date, now, locale)}, ${clockTime(date, locale)}`;

/** The whole date, for a tooltip or an accessible name: "Friday, November 7, 2026". */
export const longDate = (date: Date, locale?: Locale): string =>
  date.toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  });

/** "November 2026", over a month of the date picker. */
export const monthTitle = (date: Date, locale?: Locale): string =>
  date.toLocaleDateString(locale, { month: "long", year: "numeric" });

/** The weekdays' short names from Monday, as the date picker's columns run. */
export const weekdayNames = (locale?: Locale): readonly string[] =>
  Array.from({ length: 7 }, (_, index) =>
    // 2 January 2023 was a Monday.
    new Date(2023, 0, 2 + index).toLocaleDateString(locale, {
      weekday: "short",
    })
  );
