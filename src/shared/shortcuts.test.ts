import { describe, expect, it } from "vitest";

import {
  captureKeyAction,
  fieldKeyAction,
  libraryShortcuts,
  pinKeyAction,
  zoomKeyAction,
} from "./shortcuts";
import type { KeyPress } from "./shortcuts";

const press = (key: string, held: Partial<KeyPress> = {}): KeyPress => ({
  altKey: false,
  ctrlKey: false,
  key,
  metaKey: false,
  shiftKey: false,
  ...held,
});

const mac = { metaKey: true };
const win = { ctrlKey: true };

describe(fieldKeyAction, () => {
  it("maps the field keys with ⌘ on macOS and Ctrl on Windows", () => {
    expect(fieldKeyAction(press("d", mac), true)).toBe("description");
    expect(fieldKeyAction(press("D", { ...mac, shiftKey: true }), true)).toBe(
      "due"
    );
    expect(fieldKeyAction(press("S", { ...win, shiftKey: true }), false)).toBe(
      "steps"
    );
    expect(fieldKeyAction(press("d", win), false)).toBe("description");
  });

  it("needs the platform's own modifier", () => {
    expect(fieldKeyAction(press("d", win), true)).toBeNull();
    expect(fieldKeyAction(press("d", mac), false)).toBeNull();
    expect(fieldKeyAction(press("s", mac), true)).toBeNull();
  });

  it("opens the sheet with ⌘/ or Ctrl+/, also with Shift for layouts that need it", () => {
    expect(fieldKeyAction(press("/", mac), true)).toBe("shortcuts");
    expect(fieldKeyAction(press("/", { ...win, shiftKey: true }), false)).toBe(
      "shortcuts"
    );
  });

  it("tells Find from Float on Top", () => {
    expect(fieldKeyAction(press("f", mac), true)).toBe("find");
    expect(fieldKeyAction(press("f", { ...mac, altKey: true }), true)).toBe(
      "float"
    );
    expect(fieldKeyAction(press("f", { ...win, altKey: true }), false)).toBe(
      "float"
    );
  });

  it("ignores AltGr characters, which Windows reports as Ctrl+Alt", () => {
    // AltGr+E types € on many layouts, AltGr+Q types @ on German ones.
    expect(
      fieldKeyAction(press("€", { ...win, altKey: true }), false)
    ).toBeNull();
    expect(
      fieldKeyAction(press("@", { ...win, altKey: true }), false)
    ).toBeNull();
    expect(
      fieldKeyAction(press("d", { ...win, altKey: true }), false)
    ).toBeNull();
  });
});

describe(pinKeyAction, () => {
  const none = { pinCount: 3, selected: null };
  const second = { pinCount: 3, selected: 1 };

  it("toggles pin mode with P and drops a pin with Shift+P", () => {
    expect(pinKeyAction(press("p"), none)).toStrictEqual({
      kind: "toggleTool",
    });
    expect(pinKeyAction(press("P", { shiftKey: true }), none)).toStrictEqual({
      kind: "drop",
    });
    expect(pinKeyAction(press("p", mac), none)).toBeNull();
  });

  it("selects pins 1 to 9 that exist", () => {
    expect(pinKeyAction(press("2"), none)).toStrictEqual({
      index: 1,
      kind: "select",
    });
    expect(pinKeyAction(press("4"), none)).toBeNull();
    expect(pinKeyAction(press("0"), none)).toBeNull();
  });

  it("ignores ⌫, the arrows and Escape without a selected pin", () => {
    expect(
      ["Backspace", "ArrowUp", "Escape"].map((key) =>
        pinKeyAction(press(key), none)
      )
    ).toStrictEqual([null, null, null]);
  });

  it("removes, nudges and lets go of the selected pin", () => {
    expect(pinKeyAction(press("Backspace"), second)).toStrictEqual({
      kind: "remove",
    });
    expect(pinKeyAction(press("Delete"), second)).toStrictEqual({
      kind: "remove",
    });
    expect(
      pinKeyAction(press("ArrowLeft", { shiftKey: true }), second)
    ).toStrictEqual({ dx: -1, dy: 0, far: true, kind: "nudge" });
    expect(pinKeyAction(press("Escape"), second)).toStrictEqual({
      kind: "deselect",
    });
  });
});

describe(captureKeyAction, () => {
  it("deletes with ⌫, ⌘⌫ or Delete", () => {
    expect([
      captureKeyAction(press("Backspace"), true),
      captureKeyAction(press("Backspace", mac), true),
      captureKeyAction(press("Delete"), false),
    ]).toStrictEqual(["delete", "delete", "delete"]);
  });

  it("edits, copies and checks off", () => {
    expect(captureKeyAction(press("Enter"), true)).toBe("edit");
    expect(captureKeyAction(press("C", { ...mac, shiftKey: true }), true)).toBe(
      "copyImage"
    );
    expect(captureKeyAction(press(" "), true)).toBe("done");
  });

  it("moves through the list with the arrows", () => {
    expect(captureKeyAction(press("ArrowDown"), true)).toBe("next");
    expect(captureKeyAction(press("ArrowUp"), false)).toBe("previous");
    expect(
      captureKeyAction(press("ArrowUp", { shiftKey: true }), true)
    ).toBeNull();
  });

  it("leaves other chords alone", () => {
    expect(captureKeyAction(press("Enter", mac), true)).toBeNull();
    expect(captureKeyAction(press("c", mac), true)).toBeNull();
  });
});

describe(zoomKeyAction, () => {
  it("tightens with ⌘= and widens with ⌘−", () => {
    expect(zoomKeyAction(press("=", mac), true)).toBe("tighten");
    expect(zoomKeyAction(press("+", { ...win, shiftKey: true }), false)).toBe(
      "tighten"
    );
    expect(zoomKeyAction(press("-", win), false)).toBe("widen");
    expect(zoomKeyAction(press("-"), false)).toBeNull();
  });
});

describe(libraryShortcuts, () => {
  it("lists every key for the platform, without duplicate rows in a group", () => {
    for (const isMac of [true, false]) {
      for (const group of libraryShortcuts(isMac)) {
        const labels = group.rows.map((row) => row.label);

        expect(new Set(labels).size).toBe(labels.length);
      }
    }

    const windows = libraryShortcuts(false)
      .flatMap((group) => group.rows)
      .map((row) => row.keys)
      .join(" ");

    expect(windows).not.toMatch(/[⌘⌥⇧⌃]/u);
  });
});
