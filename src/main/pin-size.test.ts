import { describe, expect, it } from "vitest";

import { pinSize } from "./pin-size";

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
