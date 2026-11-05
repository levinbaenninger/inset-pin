import { describe, expect, it } from "vitest";

import {
  fitView,
  previewToImage,
  pt,
  rect,
  size,
} from "../../src/shared/geometry.ts";
import { pinClickPoint } from "./pin-click.ts";

/** A 2× capture of a 1512×982 display, with the crop clamped at the left edge, as near a screen edge. */
const preview = {
  crop: rect<"image">(0, 900, 960, 600),
  frame: size<"image">(3024, 1964),
  pointer: pt<"image">(120, 1200),
};

/** What the panel does with a click at a screen point inside the preview. */
const pinPlacedBy = (
  click: { readonly x: number; readonly y: number },
  box: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }
) =>
  previewToImage(
    pt(click.x - box.x, click.y - box.y),
    fitView(preview.crop, preview.frame, size(box.width, box.height))
  );

describe(pinClickPoint, () => {
  it("clicks where the panel places pin 1 on the pointer's pixel, within a pixel", () => {
    const box = { height: 220, width: 356, x: 812, y: 341 };
    const placed = pinPlacedBy(pinClickPoint(preview, box), box);

    expect(Math.abs(placed.x - 120)).toBeLessThanOrEqual(2);
    expect(Math.abs(placed.y - 1200)).toBeLessThanOrEqual(2);
  });

  it("works in physical pixels too, as Windows UI Automation reports them", () => {
    const box = { height: 330, width: 534, x: 1218, y: 512 };
    const placed = pinPlacedBy(pinClickPoint(preview, box), box);

    expect(Math.abs(placed.x - 120)).toBeLessThanOrEqual(2);
    expect(Math.abs(placed.y - 1200)).toBeLessThanOrEqual(2);
  });
});
