import type { PointVia } from "@shared/capture-record";
import type { ReadOnlyWhy } from "@shared/contracts";
import { shortcutLabel } from "@shared/shortcut";

import { isMac } from "@/shared/platform";

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export const formatCaptureTime = (iso: string): string =>
  dateTime.format(new Date(iso));

/** Factual only: the display's own name, or nothing. */
export const sourceText = (label: string | null): string =>
  label ?? "Screen capture";

export const viaText = (via: PointVia): string =>
  via === "shortcut"
    ? `Captured with ${shortcutLabel(isMac)}`
    : "Captured from the menu (3 s delay)";

export const readOnlyText = (why: ReadOnlyWhy): string =>
  why === "newerVersion"
    ? "Saved by a newer version of Inset. It is kept unchanged and can't be shown here."
    : "This capture's file can't be read. It is kept unchanged on disk.";
