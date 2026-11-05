/**
 * Every in-window key of the app, in one place: the handlers match presses
 * here, and the shortcut sheet, tooltips and menus show these labels. The page
 * handles each key itself, so the keys work the same on Windows, where the app
 * has no menu bar.
 */

export interface KeyPress {
  readonly key: string;
  /** The physical key, which macOS keeps when ⌥ turns F into ƒ. */
  readonly code?: string;
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

/**
 * A ⌥ chord's letter. macOS types another character with ⌥ held (⌥F is ƒ),
 * so there the physical key counts too. Elsewhere only the letter does, since
 * AltGr arrives as Ctrl+Alt and types characters of its own.
 */
const altLetter = (press: KeyPress, wanted: string, isMac: boolean): boolean =>
  letter(press, wanted) ||
  (isMac && press.code === `Key${wanted.toUpperCase()}`);

/** Keys that work from anywhere, text fields included. */
export type FieldKeyAction =
  | "description"
  | "due"
  | "steps"
  | "shortcuts"
  | "find"
  | "float"
  | "copyDetails";

/**
 * ⌘D description, ⇧⌘D due, ⇧⌘S next steps, ⌘/ the shortcut sheet, ⌘F
 * search, ⌥⌘F Float on Top and ⌥⌘C Copy with Details. ⌘/ allows Shift,
 * since Swiss and German layouts type / with Shift+7.
 */
export const fieldKeyAction = (
  press: KeyPress,
  isMac: boolean
): FieldKeyAction | null => {
  if (press.key === "/" && command(press, isMac)) {
    return "shortcuts";
  }

  if (commandAlt(press, isMac) && !press.shiftKey) {
    if (altLetter(press, "f", isMac)) {
      return "float";
    }

    if (altLetter(press, "c", isMac)) {
      return "copyDetails";
    }
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
  | "previous"
  | "undo"
  | "redo";

/** ⌘Z and ⇧⌘Z on macOS; Ctrl+Z, and Ctrl+Y or Ctrl+Shift+Z, elsewhere. */
const historyKey = (
  press: KeyPress,
  isMac: boolean
): "undo" | "redo" | null => {
  if (!command(press, isMac)) {
    return null;
  }

  if (letter(press, "z")) {
    return press.shiftKey ? "redo" : "undo";
  }

  return !isMac && letter(press, "y") && !press.shiftKey ? "redo" : null;
};

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

  const history = historyKey(press, isMac);

  if (history !== null) {
    return history;
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

/** What a key does to the capture of the sidebar row in focus, which need not be the one shown. ⌘C arrives as the copy event instead. */
export type RowKeyAction =
  | "copyDetails"
  | "copyImage"
  | "float"
  | "delete"
  | "done";

/** The keys a capture's right-click menu lists, so each acts on the row it was opened on. */
export const rowKeyAction = (
  press: KeyPress,
  isMac: boolean
): RowKeyAction | null => {
  const field = fieldKeyAction(press, isMac);

  if (field === "copyDetails" || field === "float") {
    return field;
  }

  const action = captureKeyAction(press, isMac);

  return action === "copyImage" || action === "delete" || action === "done"
    ? action
    : null;
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
  readonly copyDetails: string;
  readonly copyImage: string;
  readonly undo: string;
  readonly redo: string;
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
        copyDetails: "⌥⌘C",
        copyImage: "⇧⌘C",
        copyText: "⌘C",
        delete: "⌫",
        description: "⌘D",
        done: "Space",
        due: "⇧⌘D",
        edit: "↩",
        find: "⌘F",
        float: "⌥⌘F",
        redo: "⇧⌘Z",
        save: "⌘↩",
        settings: "⌘,",
        shortcuts: "⌘/",
        sidebar: "⌃⌘S",
        steps: "⇧⌘S",
        tighten: "⌘=",
        undo: "⌘Z",
        widen: "⌘−",
      }
    : {
        capture: "Ctrl+Alt+P",
        close: "Ctrl+W",
        copyDetails: "Ctrl+Alt+C",
        copyImage: "Ctrl+Shift+C",
        copyText: "Ctrl+C",
        delete: "Delete",
        description: "Ctrl+D",
        done: "Space",
        due: "Ctrl+Shift+D",
        edit: "Enter",
        find: "Ctrl+F",
        float: "Ctrl+Alt+F",
        redo: "Ctrl+Y",
        save: "Ctrl+Enter",
        settings: "Ctrl+,",
        shortcuts: "Ctrl+/",
        sidebar: "Ctrl+B",
        steps: "Ctrl+Shift+S",
        tighten: "Ctrl+=",
        undo: "Ctrl+Z",
        widen: "Ctrl+−",
      };

const pinRows = (isMac: boolean): readonly ShortcutRow[] => [
  { keys: "P", label: "Pin mode on or off" },
  { keys: isMac ? "⇧P" : "Shift+P", label: "Drop a pin under the pointer" },
  { keys: "1 – 9", label: "Select pin 1 to 9" },
  { keys: isMac ? "← ↑ → ↓" : "Arrow keys", label: "Nudge it 1 pixel" },
  {
    keys: isMac ? "⇧ + arrows" : "Shift+arrows",
    label: "Nudge it 10 pixels",
  },
  { keys: isMac ? "⌫" : "Delete", label: "Remove the selected pin" },
  { keys: "Esc", label: "Deselect the pin" },
];

const fieldRows = (keys: KeyLabels, isMac: boolean): readonly ShortcutRow[] => [
  { keys: keys.description, label: "Description" },
  { keys: keys.steps, label: "Next steps" },
  { keys: keys.due, label: "Due" },
  { keys: isMac ? "↩" : "Enter", label: "In a step: add the next step" },
  {
    keys: isMac ? "⌫" : "Backspace",
    label: "In an empty step: remove it",
  },
  { keys: isMac ? "↑ ↓" : "Up / Down", label: "Move between steps" },
];

const captureRows = (keys: KeyLabels): readonly ShortcutRow[] => [
  { keys: keys.capture, label: "Capture under the pointer (anywhere)" },
  { keys: keys.save, label: "Save the capture" },
  { keys: "Esc", label: "Set the draft aside" },
  { keys: keys.tighten, label: "Tighten the crop" },
  { keys: keys.widen, label: "Widen the crop" },
];

/**
 * The capture panel's keys, in the sections every Inset app lists in this
 * order: Capture, Navigate, Edit, Fields, Pins, Window.
 */
export const panelShortcuts = (isMac: boolean): readonly ShortcutGroup[] => {
  const keys = keyLabels(isMac);

  return [
    { rows: captureRows(keys), title: "Capture" },
    {
      rows: [{ keys: keys.shortcuts, label: "Keyboard Shortcuts" }],
      title: "Navigate",
    },
    { rows: fieldRows(keys, isMac), title: "Fields" },
    { rows: pinRows(isMac), title: "Pins" },
  ];
};

/** The library's keys and the panel's, so one sheet lists everything, in the shared section order. */
export const libraryShortcuts = (isMac: boolean): readonly ShortcutGroup[] => {
  const keys = keyLabels(isMac);

  return [
    { rows: captureRows(keys), title: "Capture" },
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
        { keys: keys.shortcuts, label: "Keyboard Shortcuts" },
        // The app menu's Show Library; Windows has no app menu, so it opens from the tray.
        ...(isMac ? [{ keys: "⌘L", label: "Show the library" }] : []),
      ],
      title: "Navigate",
    },
    {
      rows: [
        { keys: keys.edit, label: "Edit the title" },
        { keys: keys.copyText, label: "Copy Text" },
        { keys: keys.copyDetails, label: "Copy with Details" },
        { keys: keys.copyImage, label: "Copy Image (with pins)" },
        { keys: keys.done, label: "Mark a focused row done, or not done" },
        { keys: keys.delete, label: "Delete…" },
        { keys: keys.undo, label: "Undo a pin edit" },
        { keys: keys.redo, label: "Redo a pin edit" },
      ],
      title: "Edit",
    },
    { rows: fieldRows(keys, isMac), title: "Fields" },
    { rows: pinRows(isMac), title: "Pins" },
    {
      rows: [
        { keys: keys.float, label: "Float on Top" },
        { keys: "Esc", label: "Close a floating capture" },
        { keys: keys.close, label: "Close the window" },
      ],
      title: "Window",
    },
  ];
};
