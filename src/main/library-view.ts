import { shortTitle } from "@shared/capture-record";
import type { CaptureRecord, StoredEntry } from "@shared/capture-record";
import type { CaptureSummary, SavedImage } from "@shared/contracts";
import { insetUrl } from "@shared/inset-url";

/** Characters a file name can't hold on macOS or Windows, besides control characters. */
const UNSAFE_FILE_CHARS = /[\\/:*?"<>|]/gu;
const FIRST_PRINTABLE = 0x20;

const withoutControlChars = (text: string): string =>
  Array.from(text, (char) =>
    (char.codePointAt(0) ?? 0) < FIRST_PRINTABLE ? "" : char
  ).join("");

const TRAILING_DOTS_AND_SPACES = /[.\s]+$/u;
const FILE_NAME_MAX = 60;

/** Names a dragged image after its title, so the dropped file says what it shows. */
export const exportFileName = (title: string): string => {
  const base = withoutControlChars(shortTitle(title))
    .replaceAll(UNSAFE_FILE_CHARS, "-")
    .slice(0, FILE_NAME_MAX)
    .replace(TRAILING_DOTS_AND_SPACES, "");

  return `${base === "" ? "Capture" : base}.png`;
};

const savedImage = (record: CaptureRecord): SavedImage => ({
  heightPx: record.image.heightPx,
  pixelsPerDip: record.image.pixelsPerDip,
  url: insetUrl.captureImage(record.id),
  widthPx: record.image.widthPx,
});

const readOnly = (
  entry: Exclude<StoredEntry, { kind: "ok" }>
): CaptureSummary => ({
  id: entry.id,
  kind: "readOnly",
  why: entry.kind === "foreign" ? "newerVersion" : "unreadable",
});

export const toSummary = (entry: StoredEntry): CaptureSummary => {
  if (entry.kind !== "ok") {
    return readOnly(entry);
  }

  const { record } = entry;

  return {
    capturedAt: record.capturedAt,
    description: record.description,
    due: record.due,
    id: record.id,
    image: savedImage(record),
    invokedVia: record.invokedVia,
    kind: "ok",
    pins: record.pins.map(({ label, x, y }) =>
      label === undefined ? { x, y } : { label, x, y }
    ),
    sourceLabel: record.source.label,
    status: record.status,
    steps: record.steps,
    title: record.title,
    updatedAt: record.updatedAt,
  };
};

export const toDetail = toSummary;
