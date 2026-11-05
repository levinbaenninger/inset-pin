import type { LibraryCommand } from "@shared/contracts";
import type { MenuItemConstructorOptions } from "electron";

import { canCheck } from "./update-state";
import type { UpdateState } from "./update-state";

export const HELP_URL = "https://github.com/levinbaenninger/inset-pin#readme";

export interface AppMenuState {
  /** The library is open, so it can float. */
  readonly libraryOpen: boolean;
  /** The library has the keyboard, so its capture commands go to the capture the user is looking at. */
  readonly libraryFocused: boolean;
  readonly floatOnTop: boolean;
  /** The shown capture is in the Done list; null when none is shown. */
  readonly shownDone: boolean | null;
  /** No new capture while a draft waits to be saved or discarded. */
  readonly canCapture: boolean;
  /** Null where the app can't update itself. */
  readonly update: UpdateState | null;
}

export interface AppMenuActions {
  readonly captureAfterDelay: () => void;
  readonly openLibrary: () => void;
  readonly openSettings: () => void;
  readonly libraryCommand: (command: LibraryCommand) => void;
  readonly setFloatOnTop: (on: boolean) => void;
  readonly openHelp: () => void;
  readonly showShortcuts: () => void;
  readonly checkForUpdates: () => void;
  readonly installUpdate: () => void;
}

const SEPARATOR: MenuItemConstructorOptions = { type: "separator" };

const updateItems = (
  update: UpdateState | null,
  actions: AppMenuActions
): MenuItemConstructorOptions[] => {
  if (update === null) {
    return [];
  }

  return [
    update.kind === "ready"
      ? {
          click: actions.installUpdate,
          label: `Restart to Update to v${update.version}`,
        }
      : {
          click: actions.checkForUpdates,
          enabled: canCheck(update),
          label: "Check for Updates…",
        },
  ];
};

/**
 * The shown capture's commands with their keys, so the keys can be found.
 * The library page handles the keys itself, so they work the same on Windows,
 * where there is no menu bar; the menu only shows them.
 */
const captureSubmenu = (
  state: AppMenuState,
  actions: AppMenuActions
): MenuItemConstructorOptions[] => {
  const shown = state.libraryFocused && state.shownDone !== null;

  const entry = (
    command: LibraryCommand,
    label: string,
    accelerator: string
  ): MenuItemConstructorOptions => ({
    accelerator,
    click: () => {
      actions.libraryCommand(command);
    },
    enabled: shown,
    label,
    registerAccelerator: false,
  });

  return [
    entry("copyText", "Copy as Text", "CommandOrControl+C"),
    entry("copyImage", "Copy Image", "Shift+CommandOrControl+C"),
    SEPARATOR,
    entry("edit", "Edit Title", "Enter"),
    entry("description", "Add Description", "CommandOrControl+D"),
    entry("steps", "Add Next Steps", "Shift+CommandOrControl+S"),
    entry("due", "Set Due Date…", "Shift+CommandOrControl+D"),
    entry("pinTool", "Pin Tool", "P"),
    SEPARATOR,
    entry("float", "Float on Top", "Alt+CommandOrControl+F"),
    entry(
      "done",
      state.shownDone === true ? "Mark as Not Done" : "Mark as Done",
      "Space"
    ),
    SEPARATOR,
    entry("delete", "Delete…", "Backspace"),
  ];
};

const libraryItem = (
  state: AppMenuState,
  actions: AppMenuActions,
  command: LibraryCommand,
  label: string,
  accelerator?: string
): MenuItemConstructorOptions => ({
  accelerator,
  click: () => {
    actions.libraryCommand(command);
  },
  enabled: state.libraryFocused,
  label,
  registerAccelerator: false,
});

/** The menu bar of a regular Mac app; elsewhere the app has no menu bar. */
export const appMenuTemplate = (
  state: AppMenuState,
  actions: AppMenuActions
): MenuItemConstructorOptions[] => [
  {
    label: "Inset Context Pin",
    submenu: [
      { role: "about" },
      ...updateItems(state.update, actions),
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
      // The library turns Copy into Copy as Text when no text is selected.
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
      SEPARATOR,
      libraryItem(state, actions, "find", "Find", "CommandOrControl+F"),
    ],
  },
  { label: "Capture", submenu: captureSubmenu(state, actions) },
  // No page zoom: every window shares the app's origin, so it would also zoom the fixed-width capture panel.
  {
    label: "View",
    submenu: [
      libraryItem(
        state,
        actions,
        "toggleSidebar",
        "Toggle Sidebar",
        "Control+Command+S"
      ),
      libraryItem(state, actions, "showDone", "Show Done List"),
      SEPARATOR,
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
    submenu: [
      {
        accelerator: "CommandOrControl+/",
        click: actions.showShortcuts,
        label: "Keyboard Shortcuts",
        // The page takes ⌘/ itself; the menu opens the library first.
        registerAccelerator: false,
      },
      SEPARATOR,
      { click: actions.openHelp, label: "Inset Context Pin Help" },
    ],
  },
];
