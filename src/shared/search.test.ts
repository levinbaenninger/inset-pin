import { describe, expect, it } from "vitest";

import { DueDateSchema } from "./due";
import { entryText } from "./entry-text";
import {
  highlightParts,
  isEmptyQuery,
  matchesSearch,
  parseQuery,
  withDueFilter,
} from "./search";
import type { Searchable } from "./search";

const now = new Date(2026, 10, 5, 12);

const entry: Searchable = {
  description: "Rieder can only deliver from the 24th",
  due: DueDateSchema.parse("2026-11-05"),
  pins: [{ label: "Chair total" }, {}],
  sourceLabel: "Studio Display",
  steps: [{ text: "Ask for a second quote" }],
  title: "Quote breaks the furniture cap",
};

const search = (query: string, target: Searchable = entry) =>
  matchesSearch(target, parseQuery(query), now);

describe(parseQuery, () => {
  it("splits words and pulls out a due filter", () => {
    expect(parseQuery("  Quote  due:Today cap ")).toStrictEqual({
      due: "today",
      terms: ["quote", "cap"],
      unknownDue: null,
    });
  });

  it("remembers a due filter it does not know", () => {
    expect(parseQuery("due:someday").unknownDue).toBe("someday");
    expect(isEmptyQuery(parseQuery("  "))).toBeTruthy();
  });
});

describe(matchesSearch, () => {
  it("finds words in the title, description, steps, pin labels and source", () => {
    expect(search("furniture")).toBeTruthy();
    expect(search("rieder")).toBeTruthy();
    expect(search("second quote")).toBeTruthy();
    expect(search("chair")).toBeTruthy();
    expect(search("studio")).toBeTruthy();
  });

  it("needs every word", () => {
    expect(search("quote missing")).toBeFalsy();
  });

  it("applies due filters with or without words", () => {
    expect(search("due:today")).toBeTruthy();
    expect(search("due:overdue")).toBeFalsy();
    expect(search("due:week quote")).toBeTruthy();
    expect(search("due:none")).toBeFalsy();
    expect(search("due:none", { ...entry, due: null })).toBeTruthy();
  });

  it("matches nothing for an unknown due filter", () => {
    expect(search("due:someday")).toBeFalsy();
  });
});

describe(highlightParts, () => {
  it("marks every match, ignoring case, and merges neighbours", () => {
    expect(highlightParts("Quote the quote", ["quo", "te"])).toStrictEqual([
      { match: true, text: "Quote" },
      { match: false, text: " the " },
      { match: true, text: "quote" },
    ]);
  });

  it("returns the text whole without terms", () => {
    expect(highlightParts("abc", [])).toStrictEqual([
      { match: false, text: "abc" },
    ]);
  });
});

describe(withDueFilter, () => {
  it("replaces or removes the due token and keeps the words", () => {
    expect(withDueFilter("quote due:today", "week")).toBe("due:week quote");
    expect(withDueFilter("due:today quote", null)).toBe("quote");
  });
});

describe(entryText, () => {
  it("lists every part that has something, steps as a checklist", () => {
    expect(
      entryText({
        description: "Delivery adds CHF 980.",
        due: DueDateSchema.parse("2026-11-07"),
        pins: [{ label: "Chairs" }, {}, { label: "Delivery" }],
        steps: [
          { done: true, text: "Ask Rieder" },
          { done: false, text: "Second quote" },
          { done: false, text: "  " },
        ],
        title: "Quote breaks the cap",
      })
    ).toBe(
      "Quote breaks the cap\n\nDelivery adds CHF 980.\n\n- [x] Ask Rieder\n- [ ] Second quote\n\nDue: 2026-11-07\n\n1 · Chairs\n3 · Delivery"
    );
  });

  it("is only the title when nothing else is set", () => {
    expect(
      entryText({
        description: "",
        due: null,
        pins: [{}],
        steps: [],
        title: "A",
      })
    ).toBe("A");
  });
});
