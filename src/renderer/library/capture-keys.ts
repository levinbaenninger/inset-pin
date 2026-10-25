/** What a key does to the capture on the right. Copy note comes from the copy command, so the Edit menu works too. */
export type CaptureKeyAction = "edit" | "delete" | "copyImage" | "pin";

export interface KeyPress {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

const plain = (press: KeyPress): boolean =>
  !press.metaKey && !press.ctrlKey && !press.shiftKey && !press.altKey;

/** ⌘ on macOS, Ctrl elsewhere, and nothing else held. */
const command = (press: KeyPress, isMac: boolean): boolean =>
  (isMac ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey) &&
  !press.altKey;

export const captureKeyAction = (
  press: KeyPress,
  isMac: boolean
): CaptureKeyAction | null => {
  if (press.key === "Enter" && plain(press)) {
    return "edit";
  }

  // ⌘⌫ is how Finder deletes; Backspace alone is enough, as in the shelf.
  if (
    (press.key === "Backspace" || press.key === "Delete") &&
    (plain(press) || (command(press, isMac) && !press.shiftKey))
  ) {
    return "delete";
  }

  if (
    press.key.toLowerCase() === "c" &&
    command(press, isMac) &&
    press.shiftKey
  ) {
    return "copyImage";
  }

  if (
    press.key.toLowerCase() === "p" &&
    command(press, isMac) &&
    !press.shiftKey
  ) {
    return "pin";
  }

  return null;
};

export interface CaptureKeyLabels {
  readonly copyNote: string;
  readonly copyImage: string;
  readonly edit: string;
  readonly pin: string;
  readonly delete: string;
}

export const captureKeyLabels = (isMac: boolean): CaptureKeyLabels =>
  isMac
    ? { copyImage: "⇧⌘C", copyNote: "⌘C", delete: "⌫", edit: "↩", pin: "⌘P" }
    : {
        copyImage: "Ctrl+Shift+C",
        copyNote: "Ctrl+C",
        delete: "Delete",
        edit: "Enter",
        pin: "Ctrl+P",
      };
