import type { LibraryCommand } from "@shared/contracts";
import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";

import { appMenuTemplate } from "./app-menu";
import type { AppMenuActions, AppMenuState } from "./app-menu";

const actions = (): AppMenuActions => ({
  captureAfterDelay: vi.fn<() => void>(),
  libraryCommand: vi.fn<(command: LibraryCommand) => void>(),
  openHelp: vi.fn<() => void>(),
  openLibrary: vi.fn<() => void>(),
  openSettings: vi.fn<() => void>(),
  setFloatOnTop: vi.fn<(on: boolean) => void>(),
});

const state: AppMenuState = {
  canCapture: true,
  floatOnTop: false,
  libraryOpen: true,
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
      "Copy Note",
      "Copy Image",
      "Edit Thought",
      "Pin to Screen",
      "Delete",
    ]);
    expect(
      keyed.every((entry) => entry.registerAccelerator === false)
    ).toBeTruthy();
  });

  it("sends a capture command to the library", () => {
    const run = actions();

    const pin = item(
      submenu(appMenuTemplate(state, run), "Capture"),
      "Pin to Screen"
    );

    // @ts-expect-error the click handler ignores its arguments
    pin?.click?.();

    expect(run.libraryCommand).toHaveBeenCalledWith("pin");
  });

  it("disables what has nowhere to go", () => {
    const template = appMenuTemplate(
      { canCapture: false, floatOnTop: false, libraryOpen: false },
      actions()
    );

    expect(item(submenu(template, "Capture"), "Delete")?.enabled).toBeFalsy();
    expect(
      item(submenu(template, "File"), "New Capture in 3 Seconds")?.enabled
    ).toBeFalsy();
    expect(
      item(submenu(template, "windowMenu"), "Keep Library on Top")?.enabled
    ).toBeFalsy();
  });
});
