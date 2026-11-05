import { CaptureIdSchema } from "@shared/capture-record";
import type { CaptureRecord } from "@shared/capture-record";
import { describe, expect, it } from "vitest";

import { exportFileName, toDetail, toSummary } from "./library-view";

const ID = CaptureIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c");

const record: CaptureRecord = {
  capturedAt: "2026-10-21T18:40:12.345Z",
  description: "Check with finance",
  due: null,
  id: ID,
  image: { file: "crop.png", heightPx: 600, pixelsPerDip: 2, widthPx: 960 },
  invokedVia: "trayDelayed",
  pins: [{ label: "Total", x: 240, y: 100 }],
  schemaVersion: 2,
  source: { kind: "display", label: null },
  status: { kind: "active" },
  steps: [],
  title: "This total ignores the discount row",
  updatedAt: "2026-10-21T18:40:31.002Z",
};

const image = {
  heightPx: 600,
  pixelsPerDip: 2,
  url: `inset://capture/${ID}`,
  widthPx: 960,
};

describe(toSummary, () => {
  it("passes the fields on and serves the image by id only", () => {
    expect(
      toSummary({ id: ID, kind: "ok", migratedFrom: null, record })
    ).toStrictEqual({
      capturedAt: "2026-10-21T18:40:12.345Z",
      description: "Check with finance",
      due: null,
      id: ID,
      image,
      invokedVia: "trayDelayed",
      kind: "ok",
      pins: [{ label: "Total", x: 240, y: 100 }],
      sourceLabel: null,
      status: { kind: "active" },
      steps: [],
      title: "This total ignores the discount row",
      updatedAt: "2026-10-21T18:40:31.002Z",
    });
  });

  it("marks foreign and unreadable entries read-only", () => {
    expect(
      toSummary({ id: ID, kind: "foreign", schemaVersion: 3 })
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

describe(exportFileName, () => {
  it("names the file after the title", () => {
    expect(exportFileName(record.title)).toBe(
      "This total ignores the discount row.png"
    );
  });

  it("replaces characters a file name can't hold and trims trailing dots", () => {
    expect(exportFileName('Is a/b: "ok"?\u0007...')).toBe("Is a-b- -ok--.png");
  });

  it("falls back when nothing usable is left", () => {
    expect(exportFileName("...")).toBe("Capture.png");
  });
});
