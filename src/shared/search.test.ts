import { describe, expect, it } from "vitest";

import { DueDateSchema } from "./due";
import { entryPlainText, entryText } from "./entry-text";
import {
  dueSuggestions,
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
      pendingDue: null,
      terms: ["quote", "cap"],
    });
  });

  it("keeps a due: word being typed apart, without filtering by it", () => {
    expect(parseQuery("cap due:to")).toStrictEqual({
      due: null,
      pendingDue: "to",
      terms: ["cap"],
    });
    expect(isEmptyQuery(parseQuery("  "))).toBeTruthy();
    expect(isEmptyQuery(parseQuery("due:"))).toBeTruthy();
  });
});

describe(dueSuggestions, () => {
  it("offers the filters a due: word can still become", () => {
    expect(dueSuggestions(parseQuery("due:"))).toStrictEqual([
      "today",
      "overdue",
      "week",
      "any",
      "none",
    ]);
    expect(dueSuggestions(parseQuery("due:o"))).toStrictEqual(["overdue"]);
    expect(dueSuggestions(parseQuery("due:n"))).toStrictEqual(["none"]);
  });

  it("offers every filter rather than an error for a word that fits none", () => {
    expect(dueSuggestions(parseQuery("due:someday"))).toHaveLength(5);
  });

  it("offers nothing once a filter is complete or absent", () => {
    expect(dueSuggestions(parseQuery("due:today"))).toStrictEqual([]);
    expect(dueSuggestions(parseQuery("quote"))).toStrictEqual([]);
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

  it("never empties the list for a due: word still being typed", () => {
    expect(search("due:someday")).toBeTruthy();
    expect(search("furniture due:to")).toBeTruthy();
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

describe(entryPlainText, () => {
  it("is the title and the description, without the details", () => {
    expect(
      entryPlainText({
        description: " Delivery adds CHF 980. ",
        title: "Quote",
      })
    ).toBe("Quote\n\nDelivery adds CHF 980.");
    expect(entryPlainText({ description: "", title: "Quote" })).toBe("Quote");
  });
});
