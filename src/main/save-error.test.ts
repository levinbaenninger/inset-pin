import { describe, expect, it } from "vitest";

import { saveErrorText } from "./save-error";

const nodeError = (code: string): Error =>
  Object.assign(
    new Error(`${code}: something low-level, write 'capture.json'`),
    {
      code,
    }
  );

describe(saveErrorText, () => {
  it("says what a full, locked or read-only disk means", () => {
    expect(
      ["ENOSPC", "EACCES", "EPERM", "EROFS"].map((code) =>
        saveErrorText(nodeError(code))
      )
    ).toStrictEqual([
      "The disk is full.",
      "Inset can’t write to its data folder.",
      "Inset can’t write to its data folder.",
      "The disk is read-only.",
    ]);
  });

  it("names any other code, and says only that it failed when there is none", () => {
    expect(saveErrorText(nodeError("EIO"))).toBe("Couldn’t save (EIO).");
    expect(saveErrorText(nodeError("EBUSY"), "delete")).toBe(
      "Couldn’t delete (EBUSY)."
    );
    expect(saveErrorText(new Error("boom"))).toBe("Couldn’t save.");
    expect(saveErrorText("not an error")).toBe("Couldn’t save.");
  });
});
