import { describe, expect, it } from "vitest";

import {
  canSaveThought,
  deriveTitle,
  parseStoredEntry,
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
};

describe(deriveTitle, () => {
  it("uses the first non-blank line, trimmed", () => {
    expect(deriveTitle("  \n  Fix the padding here  \nmore")).toBe(
      "Fix the padding here"
    );
  });

  it("collapses inner whitespace", () => {
    expect(deriveTitle("a\t  b")).toBe("a b");
  });

  it("truncates to 80 characters including the ellipsis", () => {
    expect(deriveTitle("x".repeat(100))).toBe(`${"x".repeat(79)}…`);
  });

  it("falls back for a blank thought", () => {
    expect(deriveTitle(" \n ")).toBe("Untitled capture");
  });
});

describe(canSaveThought, () => {
  it("requires a non-blank thought", () => {
    expect(canSaveThought("  \n ")).toBeFalsy();
    expect(canSaveThought(" ok ")).toBeTruthy();
  });
});

describe(parseStoredEntry, () => {
  it("reports a newer schema version as foreign", () => {
    expect(parseStoredEntry(ID, '{"schemaVersion":2}')).toStrictEqual({
      id: ID,
      kind: "foreign",
      schemaVersion: 2,
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

  it("reports a pin outside the crop as unreadable", () => {
    const outside = { ...v1, pin: { x: 960, y: 0 } };

    expect(parseStoredEntry(ID, JSON.stringify(outside))).toMatchObject({
      kind: "unreadable",
    });
  });

  it("parses v1 and keeps unknown keys", () => {
    const entry = parseStoredEntry(ID, JSON.stringify({ ...v1, future: 1 }));

    expect(entry).toStrictEqual({
      id: ID,
      kind: "ok",
      record: { ...v1, future: 1 },
    });
  });
});
