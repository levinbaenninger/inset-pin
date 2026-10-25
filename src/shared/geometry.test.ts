import { describe, expect, it } from "vitest";

import {
  clampPin,
  defaultCrop,
  fitView,
  imageToPreview,
  moveCrop,
  normalizeGeometry,
  pinInCrop,
  pixelsPerDip,
  placePopover,
  previewToImage,
  pt,
  rect,
  resizeCrop,
  scaleCrop,
  screenToImage,
  size,
} from "./geometry";
import type { Point } from "./geometry";

const retina = size<"image">(2880, 1800);

describe(screenToImage, () => {
  it("maps a 2x display by the actual image size", () => {
    expect(
      screenToImage(pt(720, 450), rect(0, 0, 1440, 900), retina)
    ).toStrictEqual({
      x: 1440,
      y: 900,
    });
  });

  it("handles a display with a negative origin", () => {
    expect(
      screenToImage(
        pt(-1000, 300),
        rect(-1920, 0, 1920, 1080),
        size(1920, 1080)
      )
    ).toStrictEqual({ x: 920, y: 300 });
  });

  it("handles mixed scale with a negative vertical origin", () => {
    expect(
      screenToImage(
        pt(3520, 140),
        rect(2560, -400, 1920, 1080),
        size(2400, 1350)
      )
    ).toStrictEqual({ x: 1200, y: 675 });
  });

  it("uses the delivered image size, not bounds × scaleFactor", () => {
    expect(
      screenToImage(pt(640, 400), rect(0, 0, 1280, 800), size(1280, 800))
    ).toStrictEqual({ x: 640, y: 400 });
  });

  it("clamps the right and bottom edge to the last pixel", () => {
    expect(
      screenToImage(pt(1440, 900), rect(0, 0, 1440, 900), retina)
    ).toStrictEqual({ x: 2879, y: 1799 });
  });

  it("floors fractional DIP points", () => {
    expect(
      screenToImage(pt(100.5, 50.25), rect(0, 0, 1440, 900), retina)
    ).toStrictEqual({ x: 201, y: 100 });
  });

  it("keeps spaces apart at the type level", () => {
    const screenPoint = pt<"screen">(1, 2);
    // @ts-expect-error a screen point is not an image point
    const imagePoint: Point<"image"> = screenPoint;

    expect(imagePoint).toStrictEqual({ x: 1, y: 2 });
  });
});

describe(pixelsPerDip, () => {
  it("is the measured width ratio", () => {
    expect(pixelsPerDip(rect(0, 0, 1920, 1080), size(2400, 1350))).toBe(1.25);
  });
});

describe(defaultCrop, () => {
  it("centres 480×300 DIP on the pin", () => {
    expect(defaultCrop(pt(1440, 900), retina, 2)).toStrictEqual({
      height: 600,
      width: 960,
      x: 960,
      y: 600,
    });
  });

  it("shifts into the image near the top-left and bottom-right edges", () => {
    expect(defaultCrop(pt(50, 40), retina, 2)).toStrictEqual({
      height: 600,
      width: 960,
      x: 0,
      y: 0,
    });
    expect(defaultCrop(pt(2870, 1790), retina, 2)).toStrictEqual({
      height: 600,
      width: 960,
      x: 1920,
      y: 1200,
    });
  });

  it("rounds the origin at a fractional scale", () => {
    expect(defaultCrop(pt(1200, 675), size(2400, 1350), 1.25)).toStrictEqual({
      height: 375,
      width: 600,
      x: 900,
      y: 488,
    });
  });

  it("shrinks only to an image smaller than the default", () => {
    expect(defaultCrop(pt(100, 100), size(400, 250), 1)).toStrictEqual({
      height: 250,
      width: 400,
      x: 0,
      y: 0,
    });
  });
});

describe(scaleCrop, () => {
  it("widens about the pin and keeps its relative position", () => {
    const pin = pt<"image">(1200, 700);
    const before = rect<"image">(960, 600, 960, 600);
    const after = scaleCrop(before, pin, 2, retina, 2);

    expect(after).toStrictEqual({ height: 1200, width: 1920, x: 720, y: 500 });
    expect(pinInCrop(pin, before)).toStrictEqual({ x: 240, y: 100 });
    expect(pinInCrop(pin, after)).toStrictEqual({ x: 480, y: 200 });
    expect(pinInCrop(pin, after).x / after.width).toBe(
      pinInCrop(pin, before).x / before.width
    );
    expect(pinInCrop(pin, after).y / after.height).toBe(
      pinInCrop(pin, before).y / before.height
    );
  });

  it("keeps a pin near an edge on the same image detail after widening", () => {
    const pin = pt<"image">(50, 40);
    const after = scaleCrop(rect(0, 0, 960, 600), pin, 2, retina, 2);

    expect(after).toStrictEqual({ height: 1200, width: 1920, x: 0, y: 0 });
    expect(pinInCrop(pin, after)).toStrictEqual({ x: 50, y: 40 });
  });

  it("stops at the whole image", () => {
    expect(
      scaleCrop(rect(720, 500, 1920, 1200), pt(1200, 700), 2, retina, 2)
    ).toStrictEqual({ height: 1800, width: 2880, x: 0, y: 0 });
  });

  it("stops tightening at 160×100 DIP", () => {
    expect(
      scaleCrop(rect(960, 600, 960, 600), pt(1200, 700), 0.25, retina, 2)
    ).toStrictEqual({ height: 200, width: 320, x: 1120, y: 667 });
  });
});

describe(clampPin, () => {
  it("clamps into the crop", () => {
    expect(clampPin(pt(5000, -3), rect(960, 600, 960, 600))).toStrictEqual({
      x: 1919,
      y: 600,
    });
  });
});

describe(normalizeGeometry, () => {
  it("repairs an out-of-image crop and pulls the pin inside, idempotently", () => {
    const once = normalizeGeometry(
      { crop: rect(2800, 0, 960, 600), pin: pt(0, 0) },
      retina,
      2
    );

    expect(once).toStrictEqual({
      crop: { height: 600, width: 960, x: 1920, y: 0 },
      pin: { x: 1920, y: 0 },
    });
    expect(normalizeGeometry(once, retina, 2)).toStrictEqual(once);
  });
});

describe(moveCrop, () => {
  const crop = rect<"image">(960, 600, 960, 600);
  const pin = pt<"image">(1200, 700);

  it("moves by the drag", () => {
    expect(moveCrop(crop, pt(100, -50), pin, retina)).toStrictEqual({
      height: 600,
      width: 960,
      x: 1060,
      y: 550,
    });
  });

  it("stops at the image edge, and at the pin first", () => {
    expect(moveCrop(crop, pt(0, 5000), pt(1200, 1500), retina)).toMatchObject({
      y: 1200,
    });
    expect(moveCrop(crop, pt(-5000, 5000), pin, retina)).toMatchObject({
      x: 241,
      y: 700,
    });
  });

  it("never leaves the pin outside", () => {
    const moved = moveCrop(crop, pt(900, 0), pin, retina);

    expect(moved.x).toBe(1200);
    expect(pin.x).toBeGreaterThanOrEqual(moved.x);
  });
});

describe(resizeCrop, () => {
  const crop = rect<"image">(960, 600, 960, 600);
  const pin = pt<"image">(1200, 700);

  it("moves only the dragged edges", () => {
    expect(
      resizeCrop(crop, "se", pt(2400, 1500), pin, retina, 2)
    ).toStrictEqual({ height: 900, width: 1440, x: 960, y: 600 });
    expect(resizeCrop(crop, "w", pt(100, 0), pin, retina, 2)).toStrictEqual({
      height: 600,
      width: 1820,
      x: 100,
      y: 600,
    });
  });

  it("stops at the image", () => {
    expect(
      resizeCrop(crop, "nw", pt(-300, -300), pin, retina, 2)
    ).toStrictEqual({ height: 1200, width: 1920, x: 0, y: 0 });
  });

  it("stops at the pin and at the smallest crop", () => {
    expect(resizeCrop(crop, "w", pt(1900, 0), pin, retina, 2).x).toBe(1200);
    expect(resizeCrop(crop, "e", pt(0, 0), pin, retina, 2)).toMatchObject({
      width: 320,
      x: 960,
    });
    expect(resizeCrop(crop, "n", pt(0, 9999), pin, retina, 2)).toMatchObject({
      height: 500,
      y: 700,
    });
  });
});

describe("preview mapping", () => {
  const crop = rect<"image">(960, 600, 960, 600);
  const box = size<"preview">(356, 220);
  const view = fitView(crop, retina, box);

  it("centres the crop with context around it", () => {
    expect(view.scale).toBeCloseTo((220 * 0.78) / 600);
    expect(imageToPreview(pt(1440, 900), view)).toStrictEqual({
      x: 178,
      y: 110,
    });
  });

  it("maps preview to image and back", () => {
    expect(
      previewToImage(imageToPreview(pt(1200, 700), view), view)
    ).toStrictEqual({ x: 1200, y: 700 });
  });

  it("keeps the view on the image near an edge", () => {
    expect(fitView(rect(0, 0, 960, 600), retina, box).origin).toStrictEqual({
      x: 0,
      y: 0,
    });
  });

  it("shows the whole image when the crop is the whole image", () => {
    const whole = fitView(rect(0, 0, 2880, 1800), retina, box);

    expect(whole.scale).toBeCloseTo(220 / 1800);
    expect(imageToPreview(pt(1440, 900), whole)).toStrictEqual({
      x: 178,
      y: 110,
    });
  });
});

describe(placePopover, () => {
  const panel = size<"screen">(380, 300);
  const workArea = rect<"screen">(0, 25, 1440, 875);

  it("opens right of the anchor, a third above it", () => {
    expect(placePopover(pt(200, 400), panel, workArea)).toStrictEqual({
      height: 300,
      width: 380,
      x: 216,
      y: 300,
    });
  });

  it("flips left near the right edge", () => {
    expect(placePopover(pt(1300, 400), panel, workArea)).toStrictEqual({
      height: 300,
      width: 380,
      x: 904,
      y: 300,
    });
  });

  it("clamps to the bottom of the work area", () => {
    expect(placePopover(pt(700, 860), panel, workArea)).toStrictEqual({
      height: 300,
      width: 380,
      x: 716,
      y: 600,
    });
  });

  it("works on a display left of the primary", () => {
    expect(
      placePopover(pt(-100, 500), panel, rect(-1920, 0, 1920, 1040))
    ).toStrictEqual({ height: 300, width: 380, x: -496, y: 400 });
  });

  it("clamps when neither side fits", () => {
    expect(
      placePopover(pt(300, 400), panel, rect(0, 0, 600, 800))
    ).toStrictEqual({
      height: 300,
      width: 380,
      x: 220,
      y: 300,
    });
  });

  it("stays inside the work area for an anchor left of it", () => {
    expect(
      placePopover(pt(-1000, 400), panel, rect(0, 0, 1440, 900))
    ).toStrictEqual({ height: 300, width: 380, x: 0, y: 300 });
  });

  it("stays inside the work area for an anchor right of it", () => {
    expect(
      placePopover(pt(3000, 400), panel, rect(0, 0, 1440, 900))
    ).toStrictEqual({ height: 300, width: 380, x: 1060, y: 300 });
  });

  it("cuts a panel taller than the work area to it", () => {
    expect(placePopover(pt(200, 400), size(380, 1000), workArea)).toStrictEqual(
      {
        height: 875,
        width: 380,
        x: 216,
        y: 25,
      }
    );
  });
});
