import { describe, expect, it } from "vitest";

import { captureKeyAction } from "./capture-keys";
import type { KeyPress } from "./capture-keys";

const press = (key: string, held: Partial<KeyPress> = {}): KeyPress => ({
  altKey: false,
  ctrlKey: false,
  key,
  metaKey: false,
  shiftKey: false,
  ...held,
});

describe(captureKeyAction, () => {
  it("edits with Enter alone", () => {
    expect(captureKeyAction(press("Enter"), true)).toBe("edit");
    expect(
      captureKeyAction(press("Enter", { metaKey: true }), true)
    ).toBeNull();
    expect(
      captureKeyAction(press("Enter", { shiftKey: true }), false)
    ).toBeNull();
  });

  it("deletes with Backspace or Delete, alone or with the command key", () => {
    expect(captureKeyAction(press("Backspace"), true)).toBe("delete");
    expect(captureKeyAction(press("Delete"), false)).toBe("delete");
    expect(captureKeyAction(press("Backspace", { metaKey: true }), true)).toBe(
      "delete"
    );
    expect(
      captureKeyAction(press("Backspace", { ctrlKey: true }), true)
    ).toBeNull();
    expect(
      captureKeyAction(press("Backspace", { altKey: true }), true)
    ).toBeNull();
  });

  it("copies the image with Shift and the platform's command key", () => {
    expect(
      captureKeyAction(press("C", { metaKey: true, shiftKey: true }), true)
    ).toBe("copyImage");
    expect(
      captureKeyAction(press("c", { ctrlKey: true, shiftKey: true }), false)
    ).toBe("copyImage");
    expect(
      captureKeyAction(press("c", { ctrlKey: true, shiftKey: true }), true)
    ).toBeNull();
    expect(captureKeyAction(press("c", { metaKey: true }), true)).toBeNull();
  });

  it("leaves AltGr combinations alone", () => {
    expect(
      captureKeyAction(
        press("c", { altKey: true, ctrlKey: true, shiftKey: true }),
        false
      )
    ).toBeNull();
  });
});
