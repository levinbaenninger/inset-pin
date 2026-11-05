import { isDueFilter, matchesDueFilter } from "./due";
import type { DueDate, DueFilter } from "./due";

const TERM_SEPARATOR = /\s+/u;
const DUE_TOKEN = /^due:(?<value>.*)$/iu;

export interface ParsedQuery {
  /** Lowercase words; each must appear somewhere in the capture. */
  readonly terms: readonly string[];
  readonly due: DueFilter | null;
  /** A `due:` token that names no filter, so the search can say which ones exist. */
  readonly unknownDue: string | null;
}

export const parseQuery = (query: string): ParsedQuery => {
  const terms: string[] = [];
  let due: DueFilter | null = null;
  let unknownDue: string | null = null;

  for (const word of query.split(TERM_SEPARATOR)) {
    const token = DUE_TOKEN.exec(word);

    if (token === null) {
      if (word !== "") {
        terms.push(word.toLocaleLowerCase());
      }
    } else {
      const value = (token.groups?.value ?? "").toLocaleLowerCase();

      if (isDueFilter(value)) {
        due = value;
      } else {
        unknownDue = value;
      }
    }
  }

  return { due, terms, unknownDue };
};

export const isEmptyQuery = (query: ParsedQuery): boolean =>
  query.terms.length === 0 && query.due === null && query.unknownDue === null;

/** What a capture offers the search. */
export interface Searchable {
  readonly title: string;
  readonly description: string;
  readonly steps: readonly { readonly text: string }[];
  readonly pins: readonly { readonly label?: string }[];
  readonly sourceLabel: string | null;
  readonly due: DueDate | null;
}

const haystackOf = (entry: Searchable): string =>
  [
    entry.title,
    entry.description,
    ...entry.steps.map((step) => step.text),
    ...entry.pins.map((pin) => pin.label ?? ""),
    entry.sourceLabel ?? "",
  ]
    .join("\n")
    .toLocaleLowerCase();

/** Every word must appear in the title, description, steps, pin labels or source, ignoring case. */
export const matchesSearch = (
  entry: Searchable,
  query: ParsedQuery,
  now: Date
): boolean => {
  if (query.unknownDue !== null) {
    return false;
  }

  if (query.due !== null && !matchesDueFilter(entry.due, query.due, now)) {
    return false;
  }

  if (query.terms.length === 0) {
    return true;
  }

  const haystack = haystackOf(entry);

  return query.terms.every((term) => haystack.includes(term));
};

export interface TextPart {
  readonly text: string;
  readonly match: boolean;
}

/** Splits text into the parts a search highlights and the parts it doesn't. */
export const highlightParts = (
  text: string,
  terms: readonly string[]
): readonly TextPart[] => {
  const wanted = terms.filter((term) => term !== "");

  if (wanted.length === 0 || text === "") {
    return [{ match: false, text }];
  }

  const lower = text.toLocaleLowerCase();

  // A case change that alters the length would shift every index.
  if (lower.length !== text.length) {
    return [{ match: false, text }];
  }

  const marked = Array.from({ length: text.length }, () => false);

  for (const term of wanted) {
    for (
      let index = lower.indexOf(term);
      index !== -1;
      index = lower.indexOf(term, index + term.length)
    ) {
      marked.fill(true, index, index + term.length);
    }
  }

  const parts: TextPart[] = [];

  // By UTF-16 unit, as indexOf counts; a surrogate pair is never split since terms match whole.
  for (const [index, char] of text.split("").entries()) {
    const match = marked[index] ?? false;
    const last = parts.at(-1);

    if (last?.match === match) {
      parts[parts.length - 1] = { match, text: last.text + char };
    } else {
      parts.push({ match, text: char });
    }
  }

  return parts;
};

/** The search's due filters, for the placeholder and the filter menu. */
export const DUE_FILTER_LABELS: readonly {
  readonly filter: DueFilter;
  readonly label: string;
}[] = [
  { filter: "overdue", label: "Overdue" },
  { filter: "today", label: "Due today" },
  { filter: "tomorrow", label: "Due tomorrow" },
  { filter: "week", label: "Due this week" },
  { filter: "any", label: "Has a due date" },
];

/** The query with its `due:` token replaced, or removed for null. */
export const withDueFilter = (
  query: string,
  filter: DueFilter | null
): string => {
  const words = query
    .split(TERM_SEPARATOR)
    .filter((word) => word !== "" && !DUE_TOKEN.test(word));

  return [...(filter === null ? [] : [`due:${filter}`]), ...words].join(" ");
};
