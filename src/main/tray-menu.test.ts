import { describe, expect, it } from "vitest";

import { trayMenu } from "./tray-menu";
import type { TrayModel } from "./tray-menu";

const labels = (model: TrayModel): string[] =>
  trayMenu(model).map((item) =>
    item.kind === "separator" ? "---" : item.label
  );

const base: TrayModel = {
  countdownPending: false,
  draft: "none",
  isMac: true,
  shortcutRegistered: true,
};

describe(trayMenu, () => {
  it("offers the delayed capture, the shortcut, the library and quit", () => {
    expect(labels(base)).toStrictEqual([
      "New capture in 3 seconds",
      "Capture under pointer: ⌥⌘P",
      "---",
      "Recent captures…",
      "---",
      "Quit Inset Context Pin",
    ]);
  });

  it("explains a shortcut conflict with the Windows label", () => {
    expect(
      labels({ ...base, isMac: false, shortcutRegistered: false })[1]
    ).toBe("Ctrl+Alt+P is in use by another app");
  });

  it("restores a draft instead of starting a new capture", () => {
    const items = trayMenu({ ...base, draft: "saveFailed" });

    expect(items[0]).toStrictEqual({
      action: "showDraft",
      enabled: true,
      kind: "item",
      label: "Show unsaved draft (save failed)",
    });
    expect(items[1]).toMatchObject({
      action: "captureAfterDelay",
      enabled: false,
    });
  });

  it("disables the delayed capture while its countdown runs", () => {
    expect(trayMenu({ ...base, countdownPending: true })[0]).toStrictEqual({
      action: "captureAfterDelay",
      enabled: false,
      kind: "item",
      label: "Capturing in 3 seconds…",
    });
  });
});
