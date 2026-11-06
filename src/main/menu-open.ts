/** Called with a listener whenever the page or window goes through this event. */
type On<Event extends string> = (event: Event, listener: () => void) => void;

/** The page and window a menu opens in, as Electron's WebContents and BrowserWindow have them. */
export interface MenuOpenTarget {
  readonly window: {
    readonly on: On<"blur">;
    readonly isFocused: () => boolean;
  };
  readonly contents: {
    readonly on: On<"did-navigate"> &
      On<"render-process-gone"> &
      On<"destroyed">;
    readonly isDestroyed: () => boolean;
    readonly setIgnoreMenuShortcuts: (ignore: boolean) => void;
  };
}

export interface MenuOpen {
  /** The page reports that a menu of its own opened or closed. */
  readonly set: (open: boolean) => void;
  /** Whether a menu is open in the focused page, whose keys are then the menu's. */
  readonly holdsKeys: () => boolean;
}

/**
 * Whether a menu is open in one page (SPEC round 6). While it is, the app
 * menu's own keys stand aside, so a key shown in the page's menu never acts
 * on the page underneath. A blur, a navigation, a crash or a closed page
 * clears it, so it can never stay stuck; the page reports again when the
 * window comes back with the menu still open.
 */
export const trackMenuOpen = ({
  contents,
  window,
}: MenuOpenTarget): MenuOpen => {
  let open = false;

  const set = (next: boolean): void => {
    if (next === open) {
      return;
    }

    open = next;

    if (!contents.isDestroyed()) {
      contents.setIgnoreMenuShortcuts(next);
    }
  };

  const clear = (): void => {
    set(false);
  };

  window.on("blur", clear);
  contents.on("did-navigate", clear);
  contents.on("render-process-gone", clear);
  contents.on("destroyed", clear);

  return { holdsKeys: () => open && window.isFocused(), set };
};
