import { describe, expect, it } from "vitest";

import { pinSize, fitToCrop } from "./pin-size";

describe(pinSize, () => {
  it("keeps a small crop at its size on screen", () => {
    expect(
      pinSize({ heightPx: 400, pixelsPerDip: 2, widthPx: 600 })
    ).toStrictEqual({ height: 200, width: 300 });
  });

  it("scales a large crop down to fit, keeping its shape", () => {
    expect(
      pinSize({ heightPx: 600, pixelsPerDip: 1, widthPx: 960 })
    ).toStrictEqual({ height: 263, width: 420 });
  });

  it("never opens narrower than the smallest pin, even for a tall crop", () => {
    expect(
      pinSize({ heightPx: 200, pixelsPerDip: 2, widthPx: 160 })
    ).toStrictEqual({ height: 150, width: 120 });
    expect(
      pinSize({ heightPx: 1600, pixelsPerDip: 2, widthPx: 400 })
    ).toStrictEqual({ height: 480, width: 120 });
  });
});

describe(fitToCrop, () => {
  const opened = { height: 100, width: 160 };

  it("follows the width when it changed more", () => {
    expect(
      fitToCrop(opened, opened, { height: 140, width: 260 })
    ).toStrictEqual({ height: 163, width: 260 });
  });

  it("follows the height when only the height changed", () => {
    expect(
      fitToCrop(
        opened,
        { height: 163, width: 260 },
        { height: 200, width: 260 }
      )
    ).toStrictEqual({ height: 200, width: 320 });
  });

  it("keeps a tall crop's shape when it is made wider", () => {
    expect(
      fitToCrop(
        { height: 359, width: 120 },
        { height: 359, width: 120 },
        { height: 359, width: 200 }
      )
    ).toStrictEqual({ height: 598, width: 200 });
  });

  it("stops at the smallest pin", () => {
    expect(fitToCrop(opened, opened, { height: 100, width: 90 })).toStrictEqual(
      { height: 75, width: 120 }
    );
  });

  it("leaves a pin that already has the crop's shape as it is", () => {
    expect(fitToCrop(opened, opened, opened)).toStrictEqual(opened);
  });
});
