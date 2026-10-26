import { CaptureIdSchema } from "@shared/capture-record";
import { describe, expect, it } from "vitest";

import { dockMenu, trayMenu, trayTooltip } from "./tray-menu";
import type { TrayModel } from "./tray-menu";

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
};

describe(trayMenu, () => {
  it("offers the delayed capture, the shortcut, the library and quit", () => {
    expect(labels(base)).toStrictEqual([
      "New capture in 3 seconds",
      "Capture under pointer: ⌥⌘P",
      "---",
      "Recent captures…",
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
