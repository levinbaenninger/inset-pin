/** The panel's pin colour (sky 600 in the preset), so a copied image shows the same mark. */
export const PIN_RGB = [0, 132, 209] as const;

type Rgb = readonly [number, number, number];

interface Layer {
  readonly rgb: Rgb;
  readonly alpha: number;
  /** Radii in DIP; an inner radius of 0 draws a disc. */
  readonly inner: number;
  readonly outer: number;
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

// A hollow ring keeps the detail under the pin readable; the halo keeps it visible on any content.
const LAYERS: readonly Layer[] = [
  { alpha: 0.3, inner: 10, outer: 15, rgb: BLACK },
  { alpha: 1, inner: 10.5, outer: 14.5, rgb: WHITE },
  { alpha: 1, inner: 11.5, outer: 13.5, rgb: PIN_RGB },
  { alpha: 0.3, inner: 0, outer: 3.5, rgb: BLACK },
  { alpha: 1, inner: 0, outer: 3, rgb: WHITE },
  { alpha: 1, inner: 0, outer: 2, rgb: PIN_RGB },
];

const REACH_DIP = 16;

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);

/** Antialiased coverage of a pixel at distance d by the band between inner and outer. */
const coverage = (distance: number, inner: number, outer: number): number =>
  clamp01(
    Math.min(inner === 0 ? 1 : distance - inner + 0.5, outer - distance + 0.5)
  );

export interface Bitmap {
  /** BGRA, 4 bytes per pixel, as nativeImage.toBitmap returns it on macOS and Windows. */
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** Returns a copy of the bitmap with the pin ring drawn at pin, sized in DIP. */
export const drawPinMark = (
  bitmap: Bitmap,
  pin: { readonly x: number; readonly y: number },
  pixelsPerDip: number
): Uint8Array => {
  const { height, width } = bitmap;
  const out = Uint8Array.from(bitmap.data);
  const reach = Math.ceil(REACH_DIP * pixelsPerDip);
  const cx = pin.x + 0.5;
  const cy = pin.y + 0.5;

  for (
    let y = Math.max(0, pin.y - reach);
    y <= Math.min(height - 1, pin.y + reach);
    y += 1
  ) {
    for (
      let x = Math.max(0, pin.x - reach);
      x <= Math.min(width - 1, pin.x + reach);
      x += 1
    ) {
      const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const offset = (y * width + x) * 4;

      for (const layer of LAYERS) {
        const alpha =
          layer.alpha *
          coverage(
            distance,
            layer.inner * pixelsPerDip,
            layer.outer * pixelsPerDip
          );

        if (alpha > 0) {
          const [r, g, b] = layer.rgb;

          out[offset] = Math.round(
            b * alpha + (out[offset] ?? 0) * (1 - alpha)
          );
          out[offset + 1] = Math.round(
            g * alpha + (out[offset + 1] ?? 0) * (1 - alpha)
          );
          out[offset + 2] = Math.round(
            r * alpha + (out[offset + 2] ?? 0) * (1 - alpha)
          );
        }
      }
    }
  }

  return out;
};
