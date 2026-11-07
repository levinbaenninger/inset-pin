import { describe, expect, it } from "vitest";

import {
  canSaveTitle,
  CaptureRecordSchema,
  CaptureRecordV1Schema,
  migrateV1,
  parseStoredEntry,
  SavedTitleSchema,
  SCHEMA_VERSION,
  shortTitle,
  splitThought,
  TITLE_MAX,
} from "./capture-record";
import type { SplitThought } from "./capture-record";

const ID = "3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c";
const OTHER_ID = "11111111-2222-4333-8444-555555555555";

const v1 = {
  capturedAt: "2026-10-21T18:40:12.345Z",
  id: ID,
  image: { file: "crop.png", heightPx: 600, pixelsPerDip: 2, widthPx: 960 },
  invokedVia: "shortcut",
  pin: { x: 240, y: 100 },
  schemaVersion: 1,
  source: { kind: "display", label: "Built-in Retina Display" },
  thought: "This total ignores the discount row\nCheck with finance",
  updatedAt: "2026-10-21T18:40:31.002Z",
} as const;

const v2 = {
  capturedAt: "2026-10-21T18:40:12.345Z",
  description: "Check with finance",
  due: "2026-11-07",
  id: ID,
  image: { file: "crop.png", heightPx: 600, pixelsPerDip: 2, widthPx: 960 },
  invokedVia: "shortcut",
  pins: [
    { x: 240, y: 100 },
    { label: "Discount", x: 500, y: 320 },
  ],
  schemaVersion: 2,
  source: { kind: "display", label: "Built-in Retina Display" },
  status: { kind: "active" },
  steps: [{ done: false, id: "s1", text: "Ask finance" }],
  title: "This total ignores the discount row",
  updatedAt: "2026-10-21T18:40:31.002Z",
};

describe(shortTitle, () => {
  it("uses the first non-blank line, trimmed", () => {
    expect(shortTitle("  \n  Fix the padding here  \nmore")).toBe(
      "Fix the padding here"
    );
  });

  it("collapses inner whitespace", () => {
    expect(shortTitle("a\t  b")).toBe("a b");
  });

  it("truncates to 80 characters including the ellipsis", () => {
    expect(shortTitle("x".repeat(100))).toBe(`${"x".repeat(79)}…`);
  });

  it("falls back for a blank title", () => {
    expect(shortTitle(" \n ")).toBe("Untitled capture");
  });
});

describe(canSaveTitle, () => {
  it("requires a non-blank title", () => {
    expect(canSaveTitle("  \n ")).toBeFalsy();
    expect(canSaveTitle(" ok ")).toBeTruthy();
  });
});

/** Every thought made of these parts, two to four of them long, so edges and mixtures all come up. */
const PARTS = ["A", " ", "\n", "\r\n", "\t", "y".repeat(TITLE_MAX + 1)];

const thoughts = (length: number): readonly string[] =>
  length === 0
    ? [""]
    : thoughts(length - 1).flatMap((head) => PARTS.map((part) => head + part));

const nonBlank = [2, 3, 4]
  .flatMap(thoughts)
  .filter((thought) => thought.trim() !== "");

/** What a reader of the migrated capture has: the title alone, or the description. */
const thoughtShown = ({ description, title }: SplitThought): string =>
  description === "" ? title : description;

describe(splitThought, () => {
  it("makes a clean one-line thought the title", () => {
    expect(splitThought("Just this")).toStrictEqual({
      description: "",
      title: "Just this",
    });
  });

  it("keeps any other thought whole as the description, under its first line", () => {
    expect(splitThought("Title\n\nParagraph")).toStrictEqual({
      description: "Title\n\nParagraph",
      title: "Title",
    });
    expect(splitThought("  indented\r\n\tdetail \n")).toStrictEqual({
      description: "  indented\r\n\tdetail \n",
      title: "indented",
    });
  });

  it("shortens a first line too long for a title, and keeps it in the description", () => {
    const long = "y".repeat(TITLE_MAX + 20);
    const split = splitThought(long);

    expect(split.title).toBe(`${"y".repeat(TITLE_MAX - 1)}…`);
    expect(split.description).toBe(long);
  });

  it("loses nothing for any mix of words, spaces, tabs, line breaks and long lines", () => {
    const lost = nonBlank.filter(
      (thought) => thoughtShown(splitThought(thought)) !== thought
    );

    expect(nonBlank.length).toBeGreaterThan(1000);
    expect(lost).toStrictEqual([]);
  });

  it("always gives a title that can be saved", () => {
    const unsavable = nonBlank.filter(
      (thought) =>
        !SavedTitleSchema.safeParse(splitThought(thought).title).success
    );

    expect(unsavable).toStrictEqual([]);
  });
});

describe(migrateV1, () => {
  it("moves the pin into pins and keeps the whole thought", () => {
    const migrated = migrateV1(CaptureRecordV1Schema.parse(v1));

    expect(migrated).toStrictEqual({
      capturedAt: v1.capturedAt,
      description: "This total ignores the discount row\nCheck with finance",
      due: null,
      id: ID,
      image: v1.image,
      invokedVia: "shortcut",
      pins: [{ x: 240, y: 100 }],
      schemaVersion: SCHEMA_VERSION,
      source: v1.source,
      status: { kind: "active" },
      steps: [],
      title: "This total ignores the discount row",
      updatedAt: v1.updatedAt,
    });
    expect(CaptureRecordSchema.safeParse(migrated).success).toBeTruthy();
  });
});

describe(parseStoredEntry, () => {
  it("reports a newer schema version as foreign", () => {
    expect(parseStoredEntry(ID, '{"schemaVersion":3}')).toStrictEqual({
      id: ID,
      kind: "foreign",
      schemaVersion: 3,
    });
  });

  it("ignores a directory that is not a capture id", () => {
    expect(parseStoredEntry("notes", "{}")).toBeNull();
  });

  it("reports broken JSON as unreadable", () => {
    expect(parseStoredEntry(ID, "{")).toMatchObject({
      id: ID,
      kind: "unreadable",
    });
  });

  it("reports a record whose id does not match its directory as unreadable", () => {
    expect(parseStoredEntry(OTHER_ID, JSON.stringify(v1))).toStrictEqual({
      id: OTHER_ID,
      kind: "unreadable",
      reason: "id does not match its directory",
    });
  });

  it("reports a v1 pin outside the crop as unreadable", () => {
    const outside = { ...v1, pin: { x: 960, y: 0 } };

    expect(parseStoredEntry(ID, JSON.stringify(outside))).toMatchObject({
      kind: "unreadable",
    });
  });

  it("reports a v2 pin outside the crop as unreadable", () => {
    const outside = { ...v2, pins: [{ x: 10, y: 600 }] };

    expect(parseStoredEntry(ID, JSON.stringify(outside))).toMatchObject({
      kind: "unreadable",
    });
  });

  it("reads v1 as a migrated v2 record and keeps unknown keys", () => {
    const entry = parseStoredEntry(ID, JSON.stringify({ ...v1, future: 1 }));

    expect(entry).toMatchObject({
      kind: "ok",
      migratedFrom: 1,
      record: {
        description: v1.thought,
        future: 1,
        pins: [{ x: 240, y: 100 }],
        schemaVersion: 2,
        title: "This total ignores the discount row",
      },
    });
    expect(entry?.kind === "ok" && "thought" in entry.record).toBeFalsy();
  });

  it("reads v2 unchanged and keeps unknown keys", () => {
    const entry = parseStoredEntry(ID, JSON.stringify({ ...v2, future: 1 }));

    expect(entry).toStrictEqual({
      id: ID,
      kind: "ok",
      migratedFrom: null,
      record: { ...v2, future: 1 },
    });
  });

  it("round-trips a v2 record through JSON unchanged", () => {
    const entry = parseStoredEntry(ID, JSON.stringify(v2));
    const record = entry?.kind === "ok" ? entry.record : null;

    expect(parseStoredEntry(ID, JSON.stringify(record))).toStrictEqual(entry);
  });

  it("reads a migrated v1 record back unchanged after it is written as v2", () => {
    const thought = "  Total ignores the discount\r\n\n\tsee row 12\n";
    const first = parseStoredEntry(ID, JSON.stringify({ ...v1, thought }));
    const record = first?.kind === "ok" ? first.record : null;
    const again = parseStoredEntry(ID, JSON.stringify(record));

    expect(again).toMatchObject({
      kind: "ok",
      migratedFrom: null,
      record: { description: thought, title: "Total ignores the discount" },
    });
  });

  it("rejects a due date that is no calendar day", () => {
    expect(
      parseStoredEntry(ID, JSON.stringify({ ...v2, due: "2026-02-30" }))
    ).toMatchObject({ kind: "unreadable" });
  });
});
