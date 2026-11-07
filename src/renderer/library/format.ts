import type { PointVia } from "@shared/capture-record";
import type { ReadOnlyWhy } from "@shared/contracts";
import { clockTime, dayAndTime, dayHeading } from "@shared/dates";
import { shortcutLabel } from "@shared/shortcut";

import { isMac } from "@/shared/platform";

/** "Today, 10:42 AM" over a capture, in the system's locale, as the list and the chips read dates. */
export const formatCaptureTime = (iso: string, now: Date): string =>
  dayAndTime(new Date(iso), now);

export const timeOfDay = (iso: string): string => clockTime(new Date(iso));

/** A day group's heading: Today, Yesterday, else the weekday and short date. */
export const dayLabel = (day: Date, now: Date): string => dayHeading(day, now);

export const sourceText = (label: string | null): string =>
  label ?? "Screen capture";

export const viaText = (via: PointVia): string =>
  via === "shortcut"
    ? `Captured with ${shortcutLabel(isMac)}`
    : "Captured from the menu (3 s delay)";

export const readOnlyText = (why: ReadOnlyWhy): string =>
  why === "newerVersion"
    ? "Saved by a newer version of Inset. It stays on disk unchanged."
    : "Its file can't be read. It stays on disk unchanged.";
