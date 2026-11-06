import { describe, expect, it } from "vitest";

import { trackMenuOpen } from "./menu-open";

/** Listeners by event, which the test fires as Electron would. */
const events = () => {
  const listeners = new Map<string, (() => void)[]>();

  return {
    emit: (event: string): void => {
      for (const listener of listeners.get(event) ?? []) {
        listener();
      }
    },
    on: (event: string, listener: () => void): void => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
  };
};

/** A library window and its page, recording whether the app menu's keys are ignored. */
const library = () => {
  let focused = true;
  let destroyed = false;
  const ignored: boolean[] = [];

  const window = { ...events(), isFocused: () => focused };

  const contents = {
    ...events(),
    isDestroyed: () => destroyed,
    setIgnoreMenuShortcuts: (ignore: boolean) => {
      ignored.push(ignore);
    },
  };

  const menu = trackMenuOpen({ contents, window });

  return {
    blur: () => {
      focused = false;
      window.emit("blur");
    },
    contents,
    destroy: () => {
      destroyed = true;
      contents.emit("destroyed");
    },
    focus: () => {
      focused = true;
    },
    ignored,
    menu,
  };
};

describe(trackMenuOpen, () => {
  it("holds the app menu's keys while a menu is open in the focused page, and lets them go when it closes", () => {
    const { ignored, menu } = library();

    menu.set(true);

    expect([menu.holdsKeys(), ignored]).toStrictEqual([true, [true]]);

    menu.set(false);

    expect([menu.holdsKeys(), ignored]).toStrictEqual([false, [true, false]]);
  });

  it("clears on blur, so the flag never sticks, until the page reports the open menu again", () => {
    const { blur, focus, ignored, menu } = library();

    menu.set(true);
    blur();

    expect([menu.holdsKeys(), ignored]).toStrictEqual([false, [true, false]]);

    focus();
    menu.set(true);

    expect(menu.holdsKeys()).toBeTruthy();
  });

  it("clears when the page navigates or its renderer goes away", () => {
    const { contents, menu } = library();

    const after = (event: string): boolean => {
      menu.set(true);
      contents.emit(event);

      return menu.holdsKeys();
    };

    expect(
      ["did-navigate", "render-process-gone"].map((event) => after(event))
    ).toStrictEqual([false, false]);
  });

  it("doesn't touch a destroyed page", () => {
    const { destroy, ignored, menu } = library();

    menu.set(true);
    destroy();

    expect([menu.holdsKeys(), ignored]).toStrictEqual([false, [true]]);
  });
});
