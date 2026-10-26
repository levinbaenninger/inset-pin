import { useEffect } from "react";

import { isMac } from "./platform";

export interface LocalKeys {
  readonly onSave?: () => void;
  readonly onEscape?: () => void;
}

const isSaveChord = (event: KeyboardEvent): boolean =>
  event.key === "Enter" &&
  (isMac ? event.metaKey : event.ctrlKey) &&
  !event.altKey;

/** Skips IME composition and events a component, such as a Radix layer, already handled. */
export const useLocalKeys = (keys: LocalKeys): void => {
  const { onEscape, onSave } = keys;

  useEffect(() => {
    const handle = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      if (event.key === "Escape" && onEscape !== undefined) {
        event.preventDefault();
        onEscape();
      } else if (isSaveChord(event) && onSave !== undefined) {
        event.preventDefault();
        onSave();
      }
    };

    window.addEventListener("keydown", handle);

    return () => {
      window.removeEventListener("keydown", handle);
    };
  }, [onEscape, onSave]);
};

/** Ctrl with this key and nothing else; AltGr arrives as Ctrl+Alt and types characters. */
const isCtrlKey = (event: KeyboardEvent, key: string): boolean =>
  event.key.toLowerCase() === key &&
  event.ctrlKey &&
  !event.metaKey &&
  !event.altKey &&
  !event.shiftKey;

const closeWindow = (): void => {
  window.close();
};

/**
 * Windows has no app menu, so a page takes the keys macOS finds there:
 * Ctrl+W closes the window, and the page's own keys such as Ctrl+, for
 * Settings. On macOS the menu has them.
 */
export const handleMenuKeys = (
  keys: Readonly<Record<string, () => void>>
): void => {
  if (isMac) {
    return;
  }

  const all = { w: closeWindow, ...keys };

  window.addEventListener("keydown", (event) => {
    const run = Object.entries(all).find(([key]) => isCtrlKey(event, key))?.[1];

    if (run !== undefined) {
      event.preventDefault();
      run();
    }
  });
};
