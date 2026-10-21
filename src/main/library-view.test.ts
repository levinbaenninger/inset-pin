import { CaptureIdSchema } from "@shared/capture-record";
import type { CaptureRecordV1 } from "@shared/capture-record";
import { describe, expect, it } from "vitest";

import { toDetail, toSummary } from "./library-view";

const ID = CaptureIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c");

const record: CaptureRecordV1 = {
  capturedAt: "2026-10-21T18:40:12.345Z",
  id: ID,
  image: { file: "crop.png", heightPx: 600, pixelsPerDip: 2, widthPx: 960 },
  invokedVia: "trayDelayed",
  pin: { x: 240, y: 100 },
  schemaVersion: 1,
  source: { kind: "display", label: null },
  thought: "  \nThis total ignores the discount row\nCheck with finance",
  updatedAt: "2026-10-21T18:40:31.002Z",
};

const image = {
  heightPx: 600,
  pixelsPerDip: 2,
  url: `inset://capture/${ID}`,
  widthPx: 960,
};

describe(toSummary, () => {
  it("derives the title and serves the image by id only", () => {
    expect(toSummary({ id: ID, kind: "ok", record })).toStrictEqual({
      capturedAt: "2026-10-21T18:40:12.345Z",
      id: ID,
      image,
      kind: "ok",
      pin: { x: 240, y: 100 },
      sourceLabel: null,
      title: "This total ignores the discount row",
    });
  });

  it("marks foreign and unreadable entries read-only", () => {
    expect(
      toSummary({ id: ID, kind: "foreign", schemaVersion: 2 })
    ).toStrictEqual({
      id: ID,
      kind: "readOnly",
      why: "newerVersion",
    });
    expect(
      toDetail({ id: ID, kind: "unreadable", reason: "bad json" })
    ).toStrictEqual({
      id: ID,
      kind: "readOnly",
      why: "unreadable",
    });
  });
});

describe(toDetail, () => {
  it("keeps the full thought and how it was captured", () => {
    expect(toDetail({ id: ID, kind: "ok", record })).toMatchObject({
      invokedVia: "trayDelayed",
      kind: "ok",
      thought: record.thought,
      updatedAt: "2026-10-21T18:40:31.002Z",
    });
  });
});
