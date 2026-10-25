import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, readSettings } from "./settings";

describe(readSettings, () => {
  it("keeps stored values and fills the rest with defaults", () => {
    expect(readSettings(JSON.stringify({ copyAfterSave: true }))).toStrictEqual(
      { ...DEFAULT_SETTINGS, copyAfterSave: true }
    );
  });

  it("falls back to the defaults for damaged settings", () => {
    expect(readSettings(JSON.stringify({ iconIn: "taskbar" }))).toStrictEqual(
      DEFAULT_SETTINGS
    );
    expect(readSettings("{ broken")).toStrictEqual(DEFAULT_SETTINGS);
    expect(readSettings(null)).toStrictEqual(DEFAULT_SETTINGS);
  });
});
