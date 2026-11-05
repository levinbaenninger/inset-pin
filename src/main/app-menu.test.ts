import type { LibraryCommand } from "@shared/contracts";
import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";

import { appMenuTemplate } from "./app-menu";
import type { AppMenuActions, AppMenuState } from "./app-menu";
import { IDLE } from "./update-state";

const actions = (): AppMenuActions => ({
  captureAfterDelay: vi.fn<() => void>(),
  checkForUpdates: vi.fn<() => void>(),
  installUpdate: vi.fn<() => void>(),
  libraryCommand: vi.fn<(command: LibraryCommand) => void>(),
  openHelp: vi.fn<() => void>(),
  openLibrary: vi.fn<() => void>(),
  openSettings: vi.fn<() => void>(),
  setFloatOnTop: vi.fn<(on: boolean) => void>(),
  showShortcuts: vi.fn<() => void>(),
});

const state: AppMenuState = {
  canCapture: true,
  floatOnTop: false,
  libraryFocused: true,
  libraryOpen: true,
  shownDone: false,
  update: IDLE,
};

const submenu = (
  template: readonly MenuItemConstructorOptions[],
  label: string
): MenuItemConstructorOptions[] => {
  const menu = template.find(
    (item) => item.label === label || item.role === label
  )?.submenu;

  return Array.isArray(menu) ? menu : [];
};

const item = (
  items: readonly MenuItemConstructorOptions[],
  label: string
): MenuItemConstructorOptions | undefined =>
  items.find((entry) => entry.label === label);

describe(appMenuTemplate, () => {
  it("has the menus of a Mac app", () => {
    expect(
      appMenuTemplate(state, actions()).map((menu) => menu.label ?? menu.role)
    ).toStrictEqual([
      "Inset Context Pin",
      "File",
      "Edit",
      "Capture",
      "View",
      "windowMenu",
      "help",
    ]);
  });

  it("shows the library's keys without taking them from the page", () => {
    const capture = submenu(appMenuTemplate(state, actions()), "Capture");
    const keyed = capture.filter((entry) => entry.accelerator !== undefined);

    expect(keyed.map((entry) => entry.label)).toStrictEqual([
      "Copy Text",
      "Copy with Details",
      "Copy Image",
      "Edit Title",
      "Add Description",
      "Add Next Steps",
      "Due…",
      "Pin Tool",
      "Float on Top",
      "Mark as Done",
      "Delete…",
    ]);
    expect(keyed.map((entry) => entry.accelerator)).toContain(
      "Alt+CommandOrControl+F"
    );
    expect(
      keyed.every((entry) => entry.registerAccelerator === false)
    ).toBeTruthy();
  });

  it("sends a capture command to the library", () => {
    const run = actions();

    const float = item(
      submenu(appMenuTemplate(state, run), "Capture"),
      "Float on Top"
    );

    // @ts-expect-error the click handler ignores its arguments
    float?.click?.();

    expect(run.libraryCommand).toHaveBeenCalledWith("float");
  });

  it("calls the pin marker a pin and floating Float on Top, never Pin", () => {
    const labels = appMenuTemplate(state, actions()).flatMap((menu) =>
      Array.isArray(menu.submenu)
        ? menu.submenu.map((entry) => entry.label ?? "")
        : []
    );

    expect(labels).not.toContain("Pin to Screen");
    expect(labels).toContain("Pin Tool");
  });

  it("names Mark as Done after the shown capture's state", () => {
    expect(
      item(
        submenu(
          appMenuTemplate({ ...state, shownDone: true }, actions()),
          "Capture"
        ),
        "Mark as Not Done"
      )
    ).toBeDefined();
  });

  it("offers the shortcut sheet in Help with ⌘/", () => {
    const run = actions();

    const sheet = item(
      submenu(appMenuTemplate(state, run), "help"),
      "Keyboard Shortcuts"
    );

    // @ts-expect-error the click handler ignores its arguments
    sheet?.click?.();

    expect(sheet?.accelerator).toBe("CommandOrControl+/");
    expect(run.showShortcuts).toHaveBeenCalledOnce();
  });

  it("disables what has nowhere to go", () => {
    const template = appMenuTemplate(
      {
        canCapture: false,
        floatOnTop: false,
        libraryFocused: false,
        libraryOpen: false,
        shownDone: null,
        update: IDLE,
      },
      actions()
    );

    expect(item(submenu(template, "Capture"), "Delete…")?.enabled).toBeFalsy();
    expect(
      item(submenu(template, "File"), "New Capture in 3 Seconds")?.enabled
    ).toBeFalsy();
    expect(
      item(submenu(template, "View"), "Keep Library on Top")?.enabled
    ).toBeFalsy();
  });

  it("acts on a capture only while the library has the keyboard", () => {
    const template = appMenuTemplate(
      { ...state, libraryFocused: false },
      actions()
    );

    expect(
      submenu(template, "Capture").every((entry) => entry.enabled !== true)
    ).toBeTruthy();
    expect(
      item(submenu(template, "View"), "Keep Library on Top")?.enabled
    ).toBeTruthy();
  });

  it("has no page zoom, which would also zoom the capture panel", () => {
    const roles = appMenuTemplate(state, actions()).flatMap((menu) =>
      Array.isArray(menu.submenu) ? menu.submenu.map((entry) => entry.role) : []
    );

    expect(roles).not.toContain("zoomIn");
    expect(roles).not.toContain("resetZoom");
  });

  it("checks for updates, then offers the restart once one has downloaded", () => {
    const run = actions();

    const app = (update: AppMenuState["update"]) =>
      submenu(
        appMenuTemplate({ ...state, update }, run),
        "Inset Context Pin"
      )[1];

    expect(app(IDLE)).toMatchObject({
      enabled: true,
      label: "Check for Updates…",
    });
    expect(app({ kind: "checking" })).toMatchObject({ enabled: false });

    const restart = app({ kind: "ready", version: "0.1.58" });

    // @ts-expect-error the click handler ignores its arguments
    restart?.click?.();

    expect(restart?.label).toBe("Restart to Update to v0.1.58");
    expect(run.installUpdate).toHaveBeenCalledOnce();
  });

  it("has no update item where the app can't update itself", () => {
    const labels = submenu(
      appMenuTemplate({ ...state, update: null }, actions()),
      "Inset Context Pin"
    ).map((entry) => entry.label ?? entry.role ?? entry.type);

    expect(labels.slice(0, 2)).toStrictEqual(["about", "separator"]);
  });
});
