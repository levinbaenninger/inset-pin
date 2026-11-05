/**
 * Every in-window key of the app, in one place: the handlers match presses
 * here, and the shortcut sheet, tooltips and menus show these labels. The page
 * handles each key itself, so the keys work the same on Windows, where the app
 * has no menu bar.
 */

export interface KeyPress {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

const plain = (press: KeyPress): boolean =>
  !press.metaKey && !press.ctrlKey && !press.altKey;

/** ⌘ on macOS, Ctrl elsewhere, and no Alt (AltGr arrives as Ctrl+Alt on Windows and types characters). */
const command = (press: KeyPress, isMac: boolean): boolean =>
  (isMac ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey) &&
  !press.altKey;

/** ⌥⌘ on macOS, Ctrl+Alt elsewhere. */
const commandAlt = (press: KeyPress, isMac: boolean): boolean =>
  (isMac ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey) &&
  press.altKey;

const letter = (press: KeyPress, wanted: string): boolean =>
  press.key.toLowerCase() === wanted;

/** Keys that work from anywhere, text fields included. */
export type FieldKeyAction =
  | "description"
  | "due"
  | "steps"
  | "shortcuts"
  | "find"
  | "float";

/**
 * ⌘D description, ⇧⌘D due, ⇧⌘S next steps, ⌘/ the shortcut sheet, ⌘F
 * search and ⌥⌘F Float on Top. ⌘/ allows Shift, since Swiss and German
 * layouts type / with Shift+7.
 */
export const fieldKeyAction = (
  press: KeyPress,
  isMac: boolean
): FieldKeyAction | null => {
  if (press.key === "/" && command(press, isMac)) {
    return "shortcuts";
  }

  if (letter(press, "f") && commandAlt(press, isMac) && !press.shiftKey) {
    return "float";
  }

  if (!command(press, isMac)) {
    return null;
  }

  if (letter(press, "d")) {
    return press.shiftKey ? "due" : "description";
  }

  if (letter(press, "s") && press.shiftKey) {
    return "steps";
  }

  if (letter(press, "f") && !press.shiftKey) {
    return "find";
  }

  return null;
};

/** What a key does to an image's pins. */
export type PinKeyAction =
  | { readonly kind: "toggleTool" }
  | { readonly kind: "drop" }
  | { readonly kind: "select"; readonly index: number }
  | { readonly kind: "remove" }
  | {
      readonly kind: "nudge";
      readonly dx: number;
      readonly dy: number;
      readonly far: boolean;
    }
  | { readonly kind: "deselect" };

const ARROWS: ReadonlyMap<string, readonly [number, number]> = new Map([
  ["ArrowDown", [0, 1]],
  ["ArrowLeft", [-1, 0]],
  ["ArrowRight", [1, 0]],
  ["ArrowUp", [0, -1]],
]);

const DIGIT = /^[1-9]$/u;

export interface PinKeyContext {
  readonly pinCount: number;
  readonly selected: number | null;
}

/**
 * P toggles pin mode, ⇧P drops a pin under the pointer or in the middle, 1–9
 * select a pin, and with one selected ⌫ removes it, the arrows nudge it (⇧
 * for ten points) and Escape lets it go. Only outside text fields: the caller
 * checks the focus.
 */
export const pinKeyAction = (
  press: KeyPress,
  context: PinKeyContext
): PinKeyAction | null => {
  if (!plain(press)) {
    return null;
  }

  if (letter(press, "p")) {
    return press.shiftKey ? { kind: "drop" } : { kind: "toggleTool" };
  }

  if (DIGIT.test(press.key) && !press.shiftKey) {
    const index = Number(press.key) - 1;

    return index < context.pinCount ? { index, kind: "select" } : null;
  }

  if (context.selected === null) {
    return null;
  }

  if (press.key === "Backspace" || press.key === "Delete") {
    return { kind: "remove" };
  }

  if (press.key === "Escape") {
    return { kind: "deselect" };
  }

  const arrow = ARROWS.get(press.key);

  return arrow === undefined
    ? null
    : { dx: arrow[0], dy: arrow[1], far: press.shiftKey, kind: "nudge" };
};

/** What a key does to the capture shown in the library, outside text fields, once pins had their turn. */
export type CaptureKeyAction =
  | "edit"
  | "delete"
  | "copyImage"
  | "done"
  | "next"
  | "previous";

export const captureKeyAction = (
  press: KeyPress,
  isMac: boolean
): CaptureKeyAction | null => {
  if (press.key === "Enter" && plain(press) && !press.shiftKey) {
    return "edit";
  }

  // ⌘⌫ is how Finder deletes; Backspace alone is enough, as in the shelf.
  if (
    (press.key === "Backspace" || press.key === "Delete") &&
    !press.shiftKey &&
    (plain(press) || command(press, isMac))
  ) {
    return "delete";
  }

  if (letter(press, "c") && command(press, isMac) && press.shiftKey) {
    return "copyImage";
  }

  // As the shelf checks an item off.
  if (press.key === " " && plain(press) && !press.shiftKey) {
    return "done";
  }

  if (plain(press) && !press.shiftKey) {
    if (press.key === "ArrowDown") {
      return "next";
    }

    if (press.key === "ArrowUp") {
      return "previous";
    }
  }

  return null;
};

/** Tighten and widen in the capture panel: ⌘= shows less, ⌘− shows more. */
export const zoomKeyAction = (
  press: KeyPress,
  isMac: boolean
): "tighten" | "widen" | null => {
  if (!command(press, isMac)) {
    return null;
  }

  if (press.key === "=" || press.key === "+") {
    return "tighten";
  }

  return press.key === "-" ? "widen" : null;
};

export interface ShortcutRow {
  readonly label: string;
  readonly keys: string;
}

export interface ShortcutGroup {
  readonly title: string;
  readonly rows: readonly ShortcutRow[];
}

export interface KeyLabels {
  readonly capture: string;
  readonly save: string;
  readonly description: string;
  readonly due: string;
  readonly steps: string;
  readonly shortcuts: string;
  readonly find: string;
  readonly float: string;
  readonly copyText: string;
  readonly copyImage: string;
  readonly delete: string;
  readonly edit: string;
  readonly done: string;
  readonly settings: string;
  readonly close: string;
  readonly sidebar: string;
  readonly tighten: string;
  readonly widen: string;
}

export const keyLabels = (isMac: boolean): KeyLabels =>
  isMac
    ? {
        capture: "⌥⌘P",
        close: "⌘W",
        copyImage: "⇧⌘C",
        copyText: "⌘C",
        delete: "⌫",
        description: "⌘D",
        done: "Space",
        due: "⇧⌘D",
        edit: "↩",
        find: "⌘F",
        float: "⌥⌘F",
        save: "⌘↩",
        settings: "⌘,",
        shortcuts: "⌘/",
        sidebar: "⌃⌘S",
        steps: "⇧⌘S",
        tighten: "⌘=",
        widen: "⌘−",
      }
    : {
        capture: "Ctrl+Alt+P",
        close: "Ctrl+W",
        copyImage: "Ctrl+Shift+C",
        copyText: "Ctrl+C",
        delete: "Delete",
        description: "Ctrl+D",
        done: "Space",
        due: "Ctrl+Shift+D",
        edit: "Enter",
        find: "Ctrl+F",
        float: "Ctrl+Alt+F",
        save: "Ctrl+Enter",
        settings: "Ctrl+,",
        shortcuts: "Ctrl+/",
        sidebar: "Ctrl+B",
        steps: "Ctrl+Shift+S",
        tighten: "Ctrl+=",
        widen: "Ctrl+−",
      };

const pinRows = (isMac: boolean): readonly ShortcutRow[] => [
  { keys: "P", label: "Pin mode on or off" },
  { keys: isMac ? "⇧P" : "Shift+P", label: "Drop a pin under the pointer" },
  { keys: "1 – 9", label: "Select pin 1 to 9" },
  { keys: isMac ? "← ↑ → ↓" : "Arrow keys", label: "Nudge the selected pin" },
  {
    keys: isMac ? "⇧ + arrows" : "Shift+arrows",
    label: "Nudge it 10 points",
  },
  { keys: isMac ? "⌫" : "Delete", label: "Remove the selected pin" },
  { keys: "Esc", label: "Deselect the pin" },
];

const fieldRows = (keys: KeyLabels): readonly ShortcutRow[] => [
  { keys: keys.description, label: "Description" },
  { keys: keys.steps, label: "Next steps" },
  { keys: keys.due, label: "Due date" },
];

/** The capture panel's keys. */
export const panelShortcuts = (isMac: boolean): readonly ShortcutGroup[] => {
  const keys = keyLabels(isMac);

  return [
    {
      rows: [
        { keys: keys.capture, label: "Capture under the pointer (anywhere)" },
        { keys: keys.save, label: "Save" },
        { keys: "Esc", label: "Set the draft aside" },
        { keys: keys.tighten, label: "Tighten the crop" },
        { keys: keys.widen, label: "Widen the crop" },
        { keys: keys.shortcuts, label: "Keyboard shortcuts" },
      ],
      title: "Capture",
    },
    { rows: fieldRows(keys), title: "Add a field" },
    { rows: pinRows(isMac), title: "Pins" },
  ];
};

/** The library's keys, and the panel's, so one sheet lists everything. */
export const libraryShortcuts = (isMac: boolean): readonly ShortcutGroup[] => {
  const keys = keyLabels(isMac);

  return [
    {
      rows: [
        { keys: keys.find, label: "Search" },
        { keys: "Esc", label: "Clear the search" },
        {
          keys: isMac ? "↑ ↓" : "Up / Down",
          label: "Previous or next capture",
        },
        { keys: keys.sidebar, label: "Show or hide the sidebar" },
        { keys: keys.settings, label: "Settings" },
        { keys: keys.shortcuts, label: "Keyboard shortcuts" },
        { keys: keys.close, label: "Close the window" },
        // The app menu's Show Library; Windows has no app menu, so it opens from the tray.
        ...(isMac ? [{ keys: "⌘L", label: "Show the library" }] : []),
      ],
      title: "Library",
    },
    {
      rows: [
        { keys: keys.edit, label: "Edit the title" },
        { keys: keys.copyText, label: "Copy as text" },
        { keys: keys.copyImage, label: "Copy image with pins" },
        { keys: keys.float, label: "Float on Top" },
        { keys: keys.done, label: "Mark as done, or not done" },
        { keys: keys.delete, label: "Delete…" },
      ],
      title: "Capture",
    },
    { rows: fieldRows(keys), title: "Add a field" },
    { rows: pinRows(isMac), title: "Pins" },
    ...panelShortcuts(isMac)
      .slice(0, 1)
      .map((group) => ({
        ...group,
        title: "Capture panel",
      })),
  ];
};
