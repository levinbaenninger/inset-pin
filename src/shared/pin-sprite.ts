/**
 * The one pin renderer. A pin is a map-pin teardrop whose tip sits on the
 * point, with its number in the head. The panel, the library, the floating
 * window and every exported image draw it from this sprite, so they show the
 * same mark. Sizes are in display points (DIP); the sprite is drawn at a scale
 * of device pixels per DIP.
 */

/** sky 600, the same in both themes and in exported images (--color-pin in styles.css). */
export const PIN_RGB = [0, 132, 209] as const;

export const PIN_HEAD_RADIUS_DIP = 7.5;

/** From the tip up to the head's centre. */
export const PIN_HEAD_OFFSET_DIP = 13;
const OUTLINE_DIP = 1.25;
const HALO_DIP = 0.9;
const HALO_ALPHA = 0.3;
const DIGIT_HEIGHT_DIP = 7.6;
const TWO_DIGIT_HEIGHT_DIP = 6.6;
const DIGIT_ASPECT = 0.6;
const DIGIT_GAP = 0.18;

/** Half the stroke width, relative to the digit height. */
const STROKE = 0.088;

/** The pin's height from the top of its outline to its tip: about 22 points. */
export const PIN_HEIGHT_DIP =
  PIN_HEAD_OFFSET_DIP + PIN_HEAD_RADIUS_DIP + OUTLINE_DIP;

type Rgb = readonly [number, number, number];

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

type Segment = readonly [number, number, number, number];

const DEG = Math.PI / 180;

/** An elliptical arc as points, angles in degrees clockwise from +x (y points down). */
const arc = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number
): number[][] => {
  const steps = Math.max(4, Math.ceil(Math.abs(to - from) / 12));

  return Array.from({ length: steps + 1 }, (_, step) => {
    const angle = (from + ((to - from) * step) / steps) * DEG;

    return [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)];
  });
};

/** Monoline digits in a box 0.6 wide and 1 tall, as polylines. */
const GLYPHS: readonly (readonly number[][][])[] = [
  [arc(0.3, 0.5, 0.3, 0.5, 0, 360)],
  [
    [
      [0.1, 0.2],
      [0.36, 0],
      [0.36, 1],
    ],
  ],
  [[...arc(0.3, 0.28, 0.3, 0.28, 195, 395), [0, 1], [0.6, 1]]],
  [arc(0.3, 0.25, 0.27, 0.25, 200, 450), arc(0.3, 0.75, 0.3, 0.25, 270, 520)],
  [
    [
      [0.46, 1],
      [0.46, 0],
      [0, 0.68],
      [0.6, 0.68],
    ],
  ],
  [[[0.56, 0], [0.1, 0], [0.06, 0.46], ...arc(0.3, 0.68, 0.3, 0.32, 220, 520)]],
  [arc(0.3, 0.5, 0.3, 0.5, 300, 160), arc(0.3, 0.7, 0.3, 0.3, 0, 360)],
  [
    [
      [0, 0],
      [0.6, 0],
      [0.2, 1],
    ],
  ],
  [arc(0.3, 0.25, 0.26, 0.25, 0, 360), arc(0.3, 0.72, 0.3, 0.28, 0, 360)],
  [arc(0.3, 0.3, 0.3, 0.3, 0, 360), arc(0.3, 0.5, 0.3, 0.5, 340, 480)],
];

const segmentsOf = (polyline: readonly number[][]): Segment[] =>
  polyline.slice(1).map((point, index) => {
    const [x0 = 0, y0 = 0] = polyline[index] ?? [];
    const [x1 = 0, y1 = 0] = point;

    return [x0, y0, x1, y1] as const;
  });

/** The number's strokes in DIP, centred on the head's centre at the origin. */
interface NumberStrokes {
  readonly segments: readonly Segment[];
  readonly halfWidth: number;
}

const numberSegments = (value: number): NumberStrokes => {
  const digits = String(value).split("").map(Number);
  const height = digits.length > 1 ? TWO_DIGIT_HEIGHT_DIP : DIGIT_HEIGHT_DIP;
  const width = DIGIT_ASPECT * height;
  const gap = DIGIT_GAP * height;
  const total = digits.length * width + (digits.length - 1) * gap;
  const left = -total / 2;
  const top = -height / 2;

  const segments = digits.flatMap((digit, index) => {
    const glyph = GLYPHS[digit] ?? [];
    const x = left + index * (width + gap);

    return glyph
      .flatMap(segmentsOf)
      .map(
        ([x0, y0, x1, y1]) =>
          [
            x + x0 * height,
            top + y0 * height,
            x + x1 * height,
            top + y1 * height,
          ] as const
      );
  });

  return { halfWidth: STROKE * height, segments };
};

/** Distance from a point to a segment. */
const segmentDistance = (px: number, py: number, s: Segment): number => {
  const [x0, y0, x1, y1] = s;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = dx * dx + dy * dy;

  const t =
    length === 0
      ? 0
      : Math.min(Math.max(((px - x0) * dx + (py - y0) * dy) / length, 0), 1);

  return Math.hypot(px - x0 - t * dx, py - y0 - t * dy);
};

/**
 * Signed distance to the teardrop: the hull of the head's circle and the tip.
 * The head's centre is at the origin and the tip at (0, h).
 */
const teardropDistance = (px: number, py: number): number => {
  const radius = PIN_HEAD_RADIUS_DIP;
  const h = PIN_HEAD_OFFSET_DIP;
  const x = Math.abs(px);
  const b = radius / h;
  const a = Math.sqrt(1 - b * b);
  const k = -b * x + a * py;

  if (k < 0) {
    return Math.hypot(x, py) - radius;
  }

  if (k > a * h) {
    return Math.hypot(x, py - h);
  }

  return a * x + b * py - radius;
};

const coverage = (distance: number, pixelsPerDip: number): number =>
  Math.min(Math.max(0.5 - distance * pixelsPerDip, 0), 1);

export interface PinSprite {
  /** RGBA, straight alpha, 4 bytes per pixel. */
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  /** The sprite pixel whose centre is the tip. */
  readonly tipX: number;
  readonly tipY: number;
}

const over = (
  out: Uint8ClampedArray,
  offset: number,
  rgb: Rgb,
  alpha: number
): void => {
  if (alpha <= 0) {
    return;
  }

  const below = (out[offset + 3] ?? 0) / 255;
  const total = alpha + below * (1 - alpha);

  for (let channel = 0; channel < 3; channel += 1) {
    const top = rgb[channel] ?? 0;
    const under = out[offset + channel] ?? 0;

    out[offset + channel] = Math.round(
      (top * alpha + under * below * (1 - alpha)) / total
    );
  }

  out[offset + 3] = Math.round(total * 255);
};

const cache = new Map<string, PinSprite>();

/** The pin numbered `number`, drawn at `pixelsPerDip` device pixels per point. */
export const pinSprite = (number: number, pixelsPerDip: number): PinSprite => {
  const key = `${number}@${pixelsPerDip}`;
  const cached = cache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const reach = OUTLINE_DIP + HALO_DIP;
  const tipX = Math.ceil((PIN_HEAD_RADIUS_DIP + reach) * pixelsPerDip) + 1;
  const tipY = Math.ceil((PIN_HEIGHT_DIP + HALO_DIP) * pixelsPerDip) + 1;
  const width = tipX * 2 + 1;
  const height = tipY + Math.ceil(reach * 2 * pixelsPerDip) + 2;
  const data = new Uint8ClampedArray(width * height * 4);
  const { halfWidth, segments } = numberSegments(number);

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      // From the tip, in DIP, then from the head's centre.
      const x = (column - tipX) / pixelsPerDip;
      const y = (row - tipY) / pixelsPerDip + PIN_HEAD_OFFSET_DIP;
      const outline = teardropDistance(x, y);
      const offset = (row * width + column) * 4;

      over(
        data,
        offset,
        BLACK,
        HALO_ALPHA * coverage(outline - reach, pixelsPerDip)
      );
      over(data, offset, WHITE, coverage(outline - OUTLINE_DIP, pixelsPerDip));
      over(data, offset, PIN_RGB, coverage(outline, pixelsPerDip));

      if (outline < 0) {
        const stroke = Math.min(
          ...segments.map((segment) => segmentDistance(x, y, segment))
        );

        over(data, offset, WHITE, coverage(stroke - halfWidth, pixelsPerDip));
      }
    }
  }

  const sprite = { data, height, tipX, tipY, width };

  cache.set(key, sprite);

  return sprite;
};

export interface Bitmap {
  /** 4 bytes per pixel, in the order `order` names. */
  readonly data: Uint8Array | Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** Lays one sprite over the bitmap, tip on the pixel, clipped at its edges. */
const blendSprite = (
  out: Uint8Array,
  bitmap: Bitmap,
  sprite: PinSprite,
  tip: { readonly x: number; readonly y: number },
  channels: readonly [number, number, number]
): void => {
  const left = Math.round(tip.x) - sprite.tipX;
  const top = Math.round(tip.y) - sprite.tipY;
  const rows = Math.min(sprite.height, bitmap.height - top);
  const columns = Math.min(sprite.width, bitmap.width - left);

  for (let row = Math.max(0, -top); row < rows; row += 1) {
    for (let column = Math.max(0, -left); column < columns; column += 1) {
      const from = (row * sprite.width + column) * 4;
      const alpha = (sprite.data[from + 3] ?? 0) / 255;
      const to = ((top + row) * bitmap.width + left + column) * 4;

      for (const [channel, target] of channels.entries()) {
        const value = sprite.data[from + channel] ?? 0;

        out[to + target] = Math.round(
          value * alpha + (out[to + target] ?? 0) * (1 - alpha)
        );
      }
    }
  }
};

/**
 * A copy of the bitmap with every pin drawn on it, numbered in order, each
 * tip on its pixel. nativeImage.toBitmap is BGRA on macOS and Windows.
 */
export const drawPins = (
  bitmap: Bitmap,
  pins: readonly { readonly x: number; readonly y: number }[],
  pixelsPerDip: number,
  order: "bgra" | "rgba" = "bgra"
): Uint8Array => {
  const out = Uint8Array.from(bitmap.data);

  const channels =
    order === "bgra" ? ([2, 1, 0] as const) : ([0, 1, 2] as const);

  for (const [index, pin] of pins.entries()) {
    blendSprite(out, bitmap, pinSprite(index + 1, pixelsPerDip), pin, channels);
  }

  return out;
};
