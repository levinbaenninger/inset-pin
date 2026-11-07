import { describe, expect, it } from "vitest";

import {
  drawPins,
  PIN_HEAD_OFFSET_DIP,
  PIN_HEIGHT_DIP,
  PIN_RGB,
  pinSprite,
} from "./pin-sprite";

const GREY = 128;

const greyBitmap = (width: number, height: number) => ({
  data: new Uint8Array(width * height * 4).fill(GREY),
  height,
  width,
});

const at = (data: Uint8Array, width: number, x: number, y: number) => [
  ...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
];

const [r, g, b] = PIN_RGB;

describe(pinSprite, () => {
  it("is about 22 points tall, within the spec's 18 to 22", () => {
    expect(PIN_HEIGHT_DIP).toBeGreaterThanOrEqual(18);
    expect(PIN_HEIGHT_DIP).toBeLessThanOrEqual(22);
  });

  it("puts the tip on the tip pixel and fills just above it with the pin colour", () => {
    const sprite = pinSprite(1, 2);
    const above = (sprite.tipY - 3) * sprite.width + sprite.tipX;

    expect([...sprite.data.subarray(above * 4, above * 4 + 3)]).toStrictEqual([
      r,
      g,
      b,
    ]);
  });

  it("is clear outside the mark", () => {
    const sprite = pinSprite(1, 2);

    expect(sprite.data[3]).toBe(0);
    expect(sprite.data.at(-1)).toBe(0);
  });

  it("draws the number in white in the head", () => {
    const sprite = pinSprite(1, 3);
    // The 1's stem runs through the head's centre column, just right of it.
    const headY = Math.round(sprite.tipY - PIN_HEAD_OFFSET_DIP * 3);

    const row = Array.from({ length: sprite.width }, (_, x) => x).map(
      (x) => sprite.data[(headY * sprite.width + x) * 4]
    );

    expect(row.some((red) => red === 255)).toBeTruthy();
  });

  it("caches each number and scale", () => {
    expect(pinSprite(4, 2)).toBe(pinSprite(4, 2));
    expect(pinSprite(4, 2)).not.toBe(pinSprite(5, 2));
  });
});

describe(drawPins, () => {
  const bitmap = greyBitmap(120, 120);

  const pins = [
    { x: 30, y: 60 },
    { x: 90, y: 100 },
  ];

  const marked = drawPins(bitmap, pins, 2);

  it("draws every pin in BGRA with its tip on the point", () => {
    expect(at(marked, 120, 30, 57)).toStrictEqual([b, g, r, GREY]);
    expect(at(marked, 120, 90, 97)).toStrictEqual([b, g, r, GREY]);
  });

  it("draws in RGBA when asked", () => {
    const rgba = drawPins(bitmap, pins, 2, "rgba");

    expect(at(rgba, 120, 30, 57)).toStrictEqual([r, g, b, GREY]);
  });

  it("leaves pixels away from the pins and the source untouched", () => {
    expect(at(marked, 120, 5, 5)).toStrictEqual([GREY, GREY, GREY, GREY]);
    expect(bitmap.data.every((value) => value === GREY)).toBeTruthy();
  });

  it("outlines the pin so it shows on any background", () => {
    // Left of the head, just outside the fill, the outline is lighter than the grey.
    const headY = Math.round(60 - PIN_HEAD_OFFSET_DIP * 2);

    const row = Array.from({ length: 40 }, (_, x) => x).map((x) =>
      at(marked, 120, x + 10, headY)
    );

    expect(row.some(([blue]) => (blue ?? 0) > 200)).toBeTruthy();
  });

  it("clips a pin at the image edge", () => {
    const corner = drawPins(greyBitmap(10, 10), [{ x: 5, y: 2 }], 2);

    expect(corner).toHaveLength(400);
    expect(at(corner, 10, 5, 0)).toStrictEqual([b, g, r, GREY]);
  });
});
