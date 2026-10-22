import { describe, expect, it } from "vitest";

import { drawPinMark, PIN_RGB } from "./pin-mark";

const GREY = 128;

const greyBitmap = (width: number, height: number) => ({
  data: new Uint8Array(width * height * 4).fill(GREY),
  height,
  width,
});

const bgraAt = (data: Uint8Array, width: number, x: number, y: number) => [
  ...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
];

describe(drawPinMark, () => {
  const bitmap = greyBitmap(100, 80);
  const pin = { x: 40, y: 30 };
  const marked = drawPinMark(bitmap, pin, 2);
  const [r, g, b] = PIN_RGB;

  it("puts the pin colour on the point and on the ring, in BGRA order", () => {
    expect(bgraAt(marked, 100, 40, 30)).toStrictEqual([b, g, r, GREY]);
    expect(bgraAt(marked, 100, 40 + 25, 30)).toStrictEqual([b, g, r, GREY]);
  });

  it("leaves the detail between the dot and the ring visible", () => {
    expect(bgraAt(marked, 100, 40 + 14, 30)).toStrictEqual([
      GREY,
      GREY,
      GREY,
      GREY,
    ]);
  });

  it("leaves pixels beyond the halo and the source bitmap untouched", () => {
    expect(bgraAt(marked, 100, 40 + 34, 30)).toStrictEqual([
      GREY,
      GREY,
      GREY,
      GREY,
    ]);
    expect(bitmap.data.every((value) => value === GREY)).toBeTruthy();
  });

  it("clips the mark at the image edge", () => {
    const corner = drawPinMark(greyBitmap(10, 10), { x: 0, y: 0 }, 2);

    expect(bgraAt(corner, 10, 0, 0)).toStrictEqual([b, g, r, GREY]);
  });
});
