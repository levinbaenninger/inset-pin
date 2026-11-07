import type { CaptureId } from "@shared/capture-record";
import type { CaptureSummary, SavedCapture } from "@shared/contracts";
import { matchesSearch } from "@shared/search";
import type { ParsedQuery } from "@shared/search";

type ReadOnly = Extract<CaptureSummary, { kind: "readOnly" }>;

const DAY_MS = 86_400_000;

/** How far into a line a match may sit before the excerpt starts nearer it. */
const SNIPPET_LEAD = 24;

/** The sidebar's two lists: captures still to act on, and done ones. */
export type ListKind = "active" | "done";

/** Which list a capture belongs to. A read-only capture stays with the active ones. */
export const listOf = (capture: CaptureSummary): ListKind =>
  capture.kind === "ok" && capture.status.kind === "done" ? "done" : "active";

/** A capture the list shows: in the list, and matching the search. Read-only ones show only without a search. */
export const isShown = (
  capture: CaptureSummary,
  list: ListKind,
  query: ParsedQuery,
  searching: boolean,
  now: Date
): boolean => {
  if (listOf(capture) !== list) {
    return false;
  }

  if (capture.kind !== "ok") {
    return !searching;
  }

  return matchesSearch(capture, query, now);
};

/** When a capture is listed: when it was done, else when it was captured. */
export const listedAt = (capture: SavedCapture): string =>
  capture.status.kind === "done" ? capture.status.at : capture.capturedAt;

export type CaptureGroup =
  | {
      readonly kind: "day";
      /** Local midnight of the day. */
      readonly day: Date;
      readonly relative: "today" | "yesterday" | null;
      readonly captures: readonly SavedCapture[];
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

/**
 * Groups captures by local day in list order: active ones by when they were
 * captured, done ones by when they were done. Read-only entries have no date
 * and come last.
 */
export const groupByDay = (
  captures: readonly CaptureSummary[],
  now: Date
): readonly CaptureGroup[] => {
  const today = startOfDay(now);
  const days = new Map<number, SavedCapture[]>();
  const readOnly: ReadOnly[] = [];

  for (const capture of captures) {
    if (capture.kind === "ok") {
      const day = startOfDay(new Date(listedAt(capture))).getTime();
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

/** Newest first; done ones by when they were done. Read-only entries last. */
export const listOrder = (
  captures: readonly CaptureSummary[]
): readonly CaptureSummary[] =>
  captures.toSorted((a, b) => {
    if (a.kind !== "ok" || b.kind !== "ok") {
      return Number(a.kind !== "ok") - Number(b.kind !== "ok");
    }

    return listedAt(b).localeCompare(listedAt(a));
  });

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

/**
 * After a delete, select the next older capture the list shows, else the newer
 * one. A capture the search hides gives way to the first one it shows.
 */
export const selectionAfterRemoval = (
  ids: readonly CaptureId[],
  removed: CaptureId
): CaptureId | null => {
  const index = ids.indexOf(removed);

  if (index === -1) {
    return ids[0] ?? null;
  }

  return ids[index + 1] ?? ids[index - 1] ?? null;
};

/** Steps checked off, as "2/5", or null without steps. */
export const stepProgress = (
  steps: readonly { readonly done: boolean }[]
): { readonly done: number; readonly total: number } | null =>
  steps.length === 0
    ? null
    : { done: steps.filter((step) => step.done).length, total: steps.length };

/**
 * Where a search found a capture other than its title: the first line of the
 * description, a step or a pin label holding a term, so the row can show why
 * it matched.
 */
export const matchSnippet = (
  capture: SavedCapture,
  terms: readonly string[]
): string | null => {
  if (terms.length === 0) {
    return null;
  }

  const title = capture.title.toLocaleLowerCase();

  if (terms.every((term) => title.includes(term))) {
    return null;
  }

  const lines = [
    ...capture.description.split("\n"),
    ...capture.steps.map((step) => step.text),
    ...capture.pins.flatMap((pin, index) =>
      pin.label === undefined ? [] : [`${index + 1} · ${pin.label}`]
    ),
  ];

  const missing = terms.filter((term) => !title.includes(term));

  for (const line of lines) {
    const lower = line.toLocaleLowerCase();

    const at = Math.min(
      ...missing.flatMap((term) => {
        const index = lower.indexOf(term);

        return index === -1 ? [] : [index];
      })
    );

    if (Number.isFinite(at)) {
      // A match far into a long line starts the excerpt shortly before it, so it stays in view.
      return at > SNIPPET_LEAD
        ? `…${line.slice(line.lastIndexOf(" ", at - SNIPPET_LEAD / 2) + 1)}`
        : line;
    }
  }

  return null;
};
