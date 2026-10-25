import type { LibraryCommand } from "@shared/contracts";
import type { MenuItemConstructorOptions } from "electron";

export const HELP_URL = "https://github.com/levinbaenninger/inset-pin#readme";

export interface AppMenuState {
  /** The library is open, so it can float. */
  readonly libraryOpen: boolean;
  /** The library has the keyboard, so its capture commands go to the capture the user is looking at. */
  readonly libraryFocused: boolean;
  readonly floatOnTop: boolean;
  /** No new capture while a draft waits to be saved or discarded. */
  readonly canCapture: boolean;
}

export interface AppMenuActions {
  readonly captureAfterDelay: () => void;
  readonly openLibrary: () => void;
  readonly openSettings: () => void;
  readonly libraryCommand: (command: LibraryCommand) => void;
  readonly setFloatOnTop: (on: boolean) => void;
  readonly openHelp: () => void;
}

const SEPARATOR: MenuItemConstructorOptions = { type: "separator" };

/**
 * The shown capture's commands with their keys, so the keys can be found.
 * The library page handles the keys itself, where they also type into
 * fields, so the menu only shows them.
 */
const captureSubmenu = (
  state: AppMenuState,
  actions: AppMenuActions
): MenuItemConstructorOptions[] => {
  const entry = (
    command: LibraryCommand,
    label: string,
    accelerator: string
  ): MenuItemConstructorOptions => ({
    accelerator,
    click: () => {
      actions.libraryCommand(command);
    },
    enabled: state.libraryFocused,
    label,
    registerAccelerator: false,
  });

  return [
    entry("copyNote", "Copy Note", "CommandOrControl+C"),
    entry("copyImage", "Copy Image", "Shift+CommandOrControl+C"),
    SEPARATOR,
    entry("edit", "Edit Thought", "Enter"),
    entry("pin", "Pin to Screen", "CommandOrControl+P"),
    SEPARATOR,
    entry("delete", "Delete", "Backspace"),
  ];
};

/** The menu bar of a regular Mac app; elsewhere the app has no menu bar. */
export const appMenuTemplate = (
  state: AppMenuState,
  actions: AppMenuActions
): MenuItemConstructorOptions[] => [
  {
    label: "Inset Context Pin",
    submenu: [
      { role: "about" },
      SEPARATOR,
      {
        accelerator: "CommandOrControl+,",
        click: actions.openSettings,
        label: "Settings…",
      },
      SEPARATOR,
      { role: "services" },
      SEPARATOR,
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      SEPARATOR,
      { role: "quit" },
    ],
  },
  {
    label: "File",
    submenu: [
      {
        click: actions.captureAfterDelay,
        enabled: state.canCapture,
        label: "New Capture in 3 Seconds",
      },
      {
        accelerator: "CommandOrControl+L",
        click: actions.openLibrary,
        label: "Show Library",
      },
      SEPARATOR,
      { role: "close" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      SEPARATOR,
      { role: "cut" },
      // The library turns Copy into Copy Note when no text is selected.
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
      SEPARATOR,
      {
        accelerator: "CommandOrControl+F",
        click: () => {
          actions.libraryCommand("find");
        },
        enabled: state.libraryFocused,
        label: "Find",
        registerAccelerator: false,
      },
    ],
  },
  { label: "Capture", submenu: captureSubmenu(state, actions) },
  // No page zoom: every window shares the app's origin, so it would also zoom the fixed-width capture panel.
  {
    label: "View",
    submenu: [
      {
        checked: state.floatOnTop,
        click: (item) => {
          actions.setFloatOnTop(item.checked);
        },
        enabled: state.libraryOpen,
        label: "Keep Library on Top",
        type: "checkbox",
      },
      SEPARATOR,
      { role: "togglefullscreen" },
    ],
  },
  {
    role: "windowMenu",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      SEPARATOR,
      { role: "front" },
    ],
  },
  {
    role: "help",
    submenu: [{ click: actions.openHelp, label: "Inset Context Pin Help" }],
  },
];
