import { deriveTitle } from "@shared/capture-record";
import type { CaptureRecordV1, StoredEntry } from "@shared/capture-record";
import type {
  CaptureDetail,
  CaptureSummary,
  SavedImage,
} from "@shared/contracts";
import { insetUrl } from "@shared/inset-url";

const savedImage = (record: CaptureRecordV1): SavedImage => ({
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
    id: record.id,
    image: savedImage(record),
    kind: "ok",
    pin: { x: record.pin.x, y: record.pin.y },
    sourceLabel: record.source.label,
    title: deriveTitle(record.thought),
  };
};

export const toDetail = (entry: StoredEntry): CaptureDetail => {
  if (entry.kind !== "ok") {
    return {
      id: entry.id,
      kind: "readOnly",
      why: entry.kind === "foreign" ? "newerVersion" : "unreadable",
    };
  }

  const { record } = entry;

  return {
    capturedAt: record.capturedAt,
    id: record.id,
    image: savedImage(record),
    invokedVia: record.invokedVia,
    kind: "ok",
    pin: { x: record.pin.x, y: record.pin.y },
    sourceLabel: record.source.label,
    thought: record.thought,
    title: deriveTitle(record.thought),
    updatedAt: record.updatedAt,
  };
};
