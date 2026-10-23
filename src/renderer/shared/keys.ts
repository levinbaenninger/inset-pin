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
