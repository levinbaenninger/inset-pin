import { describe, expect, it } from "vitest";

import {
  canSaveTitle,
  CaptureRecordSchema,
  CaptureRecordV1Schema,
  joinThought,
  migrateV1,
  parseStoredEntry,
  SCHEMA_VERSION,
  shortTitle,
  splitThought,
  TITLE_MAX,
} from "./capture-record";

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

describe(splitThought, () => {
  it("takes the first line as the title and the rest as the description", () => {
    expect(
      splitThought("Total is off\nCheck the discount\n\nAnd tax")
    ).toStrictEqual({
      description: "Check the discount\n\nAnd tax",
      title: "Total is off",
    });
  });

  it("skips leading blank lines and trims the title", () => {
    expect(splitThought("\n\n   Total is off  \n\nCheck\n\n")).toStrictEqual({
      description: "Check",
      title: "Total is off",
    });
  });

  it("gives a one-line thought an empty description", () => {
    expect(splitThought("Just this")).toStrictEqual({
      description: "",
      title: "Just this",
    });
  });

  it("keeps a first line too long for a title whole in the description", () => {
    const long = "y".repeat(TITLE_MAX + 20);
    const split = splitThought(`${long}\nmore`);

    expect(split.title).toHaveLength(TITLE_MAX);
    expect(split.title.endsWith("…")).toBeTruthy();
    expect(split.description).toBe(`${long}\nmore`);
  });

  it("joins back to the thought it came from, without surrounding blank lines", () => {
    const thought = "Total is off\n  indented detail\n\n- a list";
    const { description, title } = splitThought(thought);

    expect(joinThought(title, description)).toBe(thought);
  });

  it("is stable: splitting a joined split changes nothing", () => {
    const once = splitThought("\nA\n\nB\nC\n");
    const twice = splitThought(joinThought(once.title, once.description));

    expect(twice).toStrictEqual(once);
  });
});

describe(migrateV1, () => {
  it("moves the pin into pins and the thought into title and description", () => {
    const migrated = migrateV1(CaptureRecordV1Schema.parse(v1));

    expect(migrated).toStrictEqual({
      capturedAt: v1.capturedAt,
      description: "Check with finance",
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
        description: "Check with finance",
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

  it("rejects a due date that is no calendar day", () => {
    expect(
      parseStoredEntry(ID, JSON.stringify({ ...v2, due: "2026-02-30" }))
    ).toMatchObject({ kind: "unreadable" });
  });
});
