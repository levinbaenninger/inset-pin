import type { CaptureId } from "@shared/capture-record";
import type { CaptureSummary } from "@shared/contracts";

type Saved = Extract<CaptureSummary, { kind: "ok" }>;

type ReadOnly = Extract<CaptureSummary, { kind: "readOnly" }>;

const TERM_SEPARATOR = /\s+/u;
const DAY_MS = 86_400_000;

/** Every word of the query must appear in the thought or the source, ignoring case. */
export const matchesQuery = (
  capture: CaptureSummary,
  query: string
): boolean => {
  const terms = query.toLocaleLowerCase().split(TERM_SEPARATOR).filter(Boolean);

  if (terms.length === 0) {
    return true;
  }

  if (capture.kind !== "ok") {
    return false;
  }

  const text =
    `${capture.thought} ${capture.sourceLabel ?? ""}`.toLocaleLowerCase();

  return terms.every((term) => text.includes(term));
};

export type CaptureGroup =
  | {
      readonly kind: "day";
      /** Local midnight of the day. */
      readonly day: Date;
      readonly relative: "today" | "yesterday" | null;
      readonly captures: readonly Saved[];
    }
  | { readonly kind: "readOnly"; readonly captures: readonly ReadOnly[] };

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const relativeDay = (day: Date, today: Date): "today" | "yesterday" | null => {
  const days = Math.round((today.getTime() - day.getTime()) / DAY_MS);

  if (days === 0) {
    return "today";
  }

  return days === 1 ? "yesterday" : null;
};

/** Groups captures by local day in list order; read-only entries have no date and come last. */
export const groupByDay = (
  captures: readonly CaptureSummary[],
  now: Date
): readonly CaptureGroup[] => {
  const today = startOfDay(now);
  const days = new Map<number, Saved[]>();
  const readOnly: ReadOnly[] = [];

  for (const capture of captures) {
    if (capture.kind === "ok") {
      const day = startOfDay(new Date(capture.capturedAt)).getTime();
      const group = days.get(day) ?? [];

      group.push(capture);
      days.set(day, group);
    } else {
      readOnly.push(capture);
    }
  }

  const groups: CaptureGroup[] = [...days].map(([time, items]) => ({
    captures: items,
    day: new Date(time),
    kind: "day",
    relative: relativeDay(new Date(time), today),
  }));

  return readOnly.length === 0
    ? groups
    : [...groups, { captures: readOnly, kind: "readOnly" }];
};

/** The id offset steps away from current, staying at the ends; the first id when nothing is selected. */
export const stepSelection = (
  ids: readonly CaptureId[],
  current: CaptureId | null,
  offset: 1 | -1
): CaptureId | null => {
  const index = current === null ? -1 : ids.indexOf(current);

  if (index === -1) {
    return ids[0] ?? null;
  }

  return ids[Math.min(Math.max(index + offset, 0), ids.length - 1)] ?? null;
};

/** After a delete, select the next older capture, else the newer one. */
export const selectionAfterRemoval = (
  ids: readonly CaptureId[],
  removed: CaptureId
): CaptureId | null => {
  const index = ids.indexOf(removed);

  if (index === -1) {
    return null;
  }

  return ids[index + 1] ?? ids[index - 1] ?? null;
};
