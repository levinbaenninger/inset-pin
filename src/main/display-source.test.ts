import { describe, expect, it } from "vitest";

import {
  matchSource,
  snapshotDisplay,
  thumbnailSizeFor,
} from "./display-source";

const ids = (...values: string[]) =>
  values.map((value) => ({ display_id: value }));

describe(matchSource, () => {
  it("picks the exact display id", () => {
    expect(matchSource(ids("1", "2"), 2, 2)).toBe(1);
  });

  it("accepts a lone source with an empty id on a lone display", () => {
    expect(matchSource(ids(""), 5, 1)).toBe(0);
  });

  it("refuses to guess between several unlabelled sources", () => {
    expect(matchSource(ids("", ""), 1, 2)).toBeNull();
  });

  it("refuses a lone source that names another display", () => {
    expect(matchSource(ids("1"), 2, 2)).toBeNull();
  });

  it("refuses an ambiguous match", () => {
    expect(matchSource(ids("2", "2"), 2, 2)).toBeNull();
  });
});

describe(thumbnailSizeFor, () => {
  it("requests the display's own pixel size", () => {
    const display = snapshotDisplay({
      bounds: { height: 1169, width: 1800, x: 3440, y: 728 },
      id: 1,
      label: "",
      scaleFactor: 2,
      workArea: { height: 1130, width: 1800, x: 3440, y: 767 },
    });

    expect(display.label).toBeNull();
    expect(thumbnailSizeFor(display)).toStrictEqual({
      height: 2338,
      width: 3600,
    });
  });
});
