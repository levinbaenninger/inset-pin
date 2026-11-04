import { CaptureIdSchema } from "@shared/capture-record";
import { describe, expect, it } from "vitest";

import { dockMenu, trayMenu, trayTooltip } from "./tray-menu";
import type { TrayModel } from "./tray-menu";
import { IDLE } from "./update-state";

const labels = (model: TrayModel, menu = trayMenu): string[] =>
  menu(model).map((item) => (item.kind === "separator" ? "---" : item.label));

const ID = "3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c";

const recent = (count: number): TrayModel["recent"] =>
  Array.from({ length: count }, (_, index) => ({
    id: CaptureIdSchema.parse(ID.replace(/.$/u, String(index))),
    title: `Thought ${index}`,
  }));

const base: TrayModel = {
  countdownPending: false,
  draft: "none",
  isMac: true,
  libraryOnTop: false,
  libraryOpen: false,
  recent: [],
  shortcutRegistered: true,
  update: IDLE,
  version: "0.1.57",
};

describe(trayMenu, () => {
  it("offers the delayed capture, the shortcut, the library and quit", () => {
    expect(labels(base)).toStrictEqual([
      "New capture in 3 seconds",
      "Capture under pointer: ⌥⌘P",
      "---",
      "Recent captures…",
      "---",
      "Version 0.1.57",
      "Check for updates",
      "---",
      "Settings…",
      "Quit Inset Context Pin",
    ]);
  });

  it("lists the five newest captures by name, shortened to one line", () => {
    const model = {
      ...base,
      recent: [
        {
          id: CaptureIdSchema.parse(ID),
          title: "A thought that runs on far longer than a menu item should",
        },
        ...recent(6),
      ],
    };

    expect(labels(model).slice(3, 9)).toStrictEqual([
      "A thought that runs on far longer than…",
      "Thought 0",
      "Thought 1",
      "Thought 2",
      "Thought 3",
      "Recent captures…",
    ]);
    expect(trayMenu(model)[3]).toMatchObject({ id: ID, kind: "capture" });
  });

  it("keeps an ampersand in a capture's name, after shortening it", () => {
    const model = {
      ...base,
      recent: [
        { id: CaptureIdSchema.parse(ID), title: "Q&A: totals & discounts" },
        {
          id: CaptureIdSchema.parse(ID.replace(/.$/u, "d")),
          title: "Terms & conditions differ between the quote & the invoice",
        },
      ],
    };

    expect(labels(model).slice(3, 5)).toStrictEqual([
      "Q&&A: totals && discounts",
      "Terms && conditions differ between the q…",
    ]);
  });

  it("explains a shortcut conflict with the Windows label", () => {
    expect(
      labels({ ...base, isMac: false, shortcutRegistered: false })[1]
    ).toBe("Ctrl+Alt+P is in use by another app");
  });

  it("keeps the library on top from the Windows menu, while it is open", () => {
    const windows = { ...base, isMac: false };

    expect(labels(windows)).toStrictEqual([
      "New capture in 3 seconds",
      "Capture under pointer: Ctrl+Alt+P",
      "---",
      "Recent captures…",
      "Keep library on top",
      "---",
      "Version 0.1.57",
      "Check for updates",
      "---",
      "Settings…",
      "Quit Inset Context Pin",
    ]);
    expect(trayMenu(windows)[4]).toStrictEqual({
      action: "toggleLibraryOnTop",
      checked: false,
      enabled: false,
      kind: "item",
      label: "Keep library on top",
    });
    expect(
      trayMenu({ ...windows, libraryOnTop: true, libraryOpen: true })[4]
    ).toMatchObject({ checked: true, enabled: true });
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
      label: "New capture: save or discard the draft first",
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

const updateItems = (update: TrayModel["update"]): string[] =>
  labels({ ...base, update }).slice(5, 7);

describe("the tray's update items", () => {
  it("follows a check from start to the download", () => {
    expect(updateItems({ kind: "checking" })).toStrictEqual([
      "Version 0.1.57",
      "Checking for updates…",
    ]);
    expect(updateItems({ kind: "available", version: "0.1.58" })).toStrictEqual(
      ["Version 0.1.57", "Downloading v0.1.58…"]
    );
    expect(
      updateItems({ kind: "downloading", percent: 42, version: "0.1.58" })
    ).toStrictEqual(["Version 0.1.57", "Downloading v0.1.58… 42%"]);
    expect(
      trayMenu({ ...base, update: { kind: "checking" } })[6]
    ).toMatchObject({ action: "checkForUpdates", enabled: false });
  });

  it("says when the app is up to date or the check failed, and checks again", () => {
    expect(updateItems({ kind: "upToDate" })).toStrictEqual([
      "Version 0.1.57 (up to date)",
      "Check for updates",
    ]);
    expect(
      trayMenu({
        ...base,
        update: { kind: "error", message: "offline" },
      }).slice(5, 7)
    ).toStrictEqual([
      {
        action: null,
        enabled: false,
        kind: "item",
        label: "Version 0.1.57 (update failed)",
      },
      {
        action: "checkForUpdates",
        enabled: true,
        kind: "item",
        label: "Check for updates",
      },
    ]);
  });

  it("offers the restart once the update has downloaded", () => {
    expect(
      trayMenu({ ...base, update: { kind: "ready", version: "0.1.58" } })[6]
    ).toStrictEqual({
      action: "installUpdate",
      enabled: true,
      kind: "item",
      label: "Restart to update to v0.1.58",
    });
  });
});

describe("a copy that can't update itself", () => {
  it("shows only its version", () => {
    expect(labels({ ...base, update: null }).slice(4, 8)).toStrictEqual([
      "---",
      "Version 0.1.57",
      "---",
      "Settings…",
    ]);
  });
});

describe(dockMenu, () => {
  it("offers the delayed capture and the recent captures", () => {
    expect(labels({ ...base, recent: recent(2) }, dockMenu)).toStrictEqual([
      "New capture in 3 seconds",
      "---",
      "Thought 0",
      "Thought 1",
    ]);
    expect(labels(base, dockMenu)).toStrictEqual(["New capture in 3 seconds"]);
  });
});

describe(trayTooltip, () => {
  it("names the shortcut for the platform", () => {
    expect(trayTooltip({ isMac: true })).toBe(
      "Inset Context Pin: point at a detail and press ⌥⌘P"
    );
    expect(trayTooltip({ isMac: false })).toBe(
      "Inset Context Pin: point at a detail and press Ctrl+Alt+P"
    );
  });
});
