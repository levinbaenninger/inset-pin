import { useEffect } from "react";
import type { KeyboardEvent } from "react";

let openMenus = 0;

let report: (open: boolean) => void = () => {
  // A page that doesn't tell main about its menus.
};

/**
 * Tells main whenever the page's first menu opens and its last one closes,
 * so main's own keys stand aside meanwhile (src/main/menu-open.ts). Main
 * forgets on a blur, so the page says so again when the window comes back.
 */
export const reportMenusTo = (send: (open: boolean) => void): void => {
  report = send;
  window.addEventListener("focus", () => {
    if (openMenus > 0) {
      send(true);
    }
  });
};

/** Rendered inside a menu's content, which exists only while the menu is open. */
export const MenuOpenReport = (): null => {
  useEffect(() => {
    openMenus += 1;

    if (openMenus === 1) {
      report(true);
    }

    return () => {
      openMenus -= 1;

      if (openMenus === 0) {
        report(false);
      }
    };
  }, []);

  return null;
};

/**
 * A key an open menu shows picks that item, as a click would, whatever is
 * highlighted: the menu closes and the item runs for the menu's owner. Set as
 * the menu's `onKeyDownCapture`, so the menu never sees the key first.
 */
export const pickShownItem =
  (resolve: (event: KeyboardEvent<HTMLElement>) => string | null) =>
  (event: KeyboardEvent<HTMLElement>): void => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    const action = resolve(event);

    const item =
      action === null
        ? null
        : event.currentTarget.querySelector<HTMLElement>(
            `[data-key-action="${action}"]`
          );

    if (item !== null) {
      event.preventDefault();

      if (!event.repeat) {
        item.click();
      }
    }
  };

/**
 * While a menu is open its keys stay in it, as in a native menu: a key it
 * picked an item with, and every other ⌘ or Ctrl chord, never reach the page
 * underneath. The arrows, Space, Return, Escape and typing go on to the menu.
 */
export const keepKeysInMenu = (event: KeyboardEvent<HTMLElement>): void => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey) {
    event.preventDefault();
    event.stopPropagation();
  }
};
