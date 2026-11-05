export type Space = "screen" | "image" | "crop" | "preview";

declare const space: unique symbol;

/** The tag is optional so plain literals need no assertion, while mixing two spaces fails to typecheck. */
export interface Point<S extends Space> {
  readonly x: number;
  readonly y: number;
  readonly [space]?: S;
}

export interface Size<S extends Space> {
  readonly width: number;
  readonly height: number;
  readonly [space]?: S;
}

export type Rect<S extends Space> = Point<S> & Size<S>;

export const pt = <S extends Space>(x: number, y: number): Point<S> => ({
  x,
  y,
});

export const size = <S extends Space>(
  width: number,
  height: number
): Size<S> => ({
  height,
  width,
});

export const rect = <S extends Space>(
  x: number,
  y: number,
  width: number,
  height: number
): Rect<S> => ({ height, width, x, y });

export interface DisplaySnapshot {
  readonly id: number;
  readonly label: string | null;
  readonly bounds: Rect<"screen">;
  readonly workArea: Rect<"screen">;
  readonly scaleFactor: number;
}

/** Invariant: crop lies inside the image and every pin lies inside crop. */
export interface PinGeometry {
  readonly pins: readonly Point<"image">[];
  readonly crop: Rect<"image">;
}

// Design choices under test; see IMPLEMENTATION_REPORT.md.
export const DEFAULT_CROP_DIP = { height: 300, width: 480 } as const;
export const MIN_CROP_DIP = { height: 100, width: 160 } as const;

/** One widen step doubles the crop area. */
export const WIDEN_STEP = Math.SQRT2;
export const POPOVER_WIDTH_DIP = 380;
export const POPOVER_GAP_DIP = 16;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

/** Scales by image size over bounds, never bounds × scaleFactor, so negative origins and downscaled captures map correctly. */
export const screenToImage = (
  point: Point<"screen">,
  bounds: Rect<"screen">,
  image: Size<"image">
): Point<"image"> => {
  const x = Math.floor(((point.x - bounds.x) * image.width) / bounds.width);
  const y = Math.floor(((point.y - bounds.y) * image.height) / bounds.height);

  return pt(clamp(x, 0, image.width - 1), clamp(y, 0, image.height - 1));
};

/** Measured from the delivered image rather than taken from scaleFactor. */
export const pixelsPerDip = (
  bounds: Rect<"screen">,
  image: Size<"image">
): number => image.width / bounds.width;

const minCropSize = (image: Size<"image">, ppd: number): Size<"image"> =>
  size(
    Math.min(Math.round(MIN_CROP_DIP.width * ppd), image.width),
    Math.min(Math.round(MIN_CROP_DIP.height * ppd), image.height)
  );

/** Never shrinks: the crop must already fit inside the image. */
const shiftInside = (
  crop: Rect<"image">,
  image: Size<"image">
): Rect<"image"> =>
  rect(
    clamp(crop.x, 0, image.width - crop.width),
    clamp(crop.y, 0, image.height - crop.height),
    crop.width,
    crop.height
  );

/** The smallest box around the pins as edges, or null without pins. */
const pinEdges = (
  pins: readonly Point<"image">[]
): {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
} | null =>
  pins.length === 0
    ? null
    : {
        bottom: Math.max(...pins.map((pin) => pin.y)) + 1,
        left: Math.min(...pins.map((pin) => pin.x)),
        right: Math.max(...pins.map((pin) => pin.x)) + 1,
        top: Math.min(...pins.map((pin) => pin.y)),
      };

/** Moves the crop the least it takes to hold every pin; it must be large enough already. */
const containPins = (
  crop: Rect<"image">,
  pins: readonly Point<"image">[]
): Rect<"image"> => {
  const edges = pinEdges(pins);

  return edges === null
    ? crop
    : rect(
        clamp(crop.x, edges.right - crop.width, edges.left),
        clamp(crop.y, edges.bottom - crop.height, edges.top),
        crop.width,
        crop.height
      );
};

export const clampPin = (
  point: Point<"image">,
  crop: Rect<"image">
): Point<"image"> =>
  pt(
    clamp(Math.round(point.x), crop.x, crop.x + crop.width - 1),
    clamp(Math.round(point.y), crop.y, crop.y + crop.height - 1)
  );

/** Centred on the point under the pointer; a new capture has no pins. */
export const defaultCrop = (
  center: Point<"image">,
  image: Size<"image">,
  ppd: number
): Rect<"image"> => {
  const width = Math.min(Math.round(DEFAULT_CROP_DIP.width * ppd), image.width);

  const height = Math.min(
    Math.round(DEFAULT_CROP_DIP.height * ppd),
    image.height
  );

  return shiftInside(
    rect(
      Math.round(center.x - width / 2),
      Math.round(center.y - height / 2),
      width,
      height
    ),
    image
  );
};

/**
 * Scales about the pins' middle, or the crop's without pins, which keeps its
 * relative place in the preview. The crop never gets smaller than the pins
 * need, and keeps every pin inside.
 */
export const scaleCrop = (
  crop: Rect<"image">,
  pins: readonly Point<"image">[],
  factor: number,
  image: Size<"image">,
  ppd: number
): Rect<"image"> => {
  const min = minCropSize(image, ppd);
  const edges = pinEdges(pins);
  const needW = edges === null ? 0 : edges.right - edges.left;
  const needH = edges === null ? 0 : edges.bottom - edges.top;

  const width = clamp(
    Math.round(crop.width * factor),
    Math.max(min.width, needW),
    image.width
  );

  const height = clamp(
    Math.round(crop.height * factor),
    Math.max(min.height, needH),
    image.height
  );

  const anchor =
    edges === null
      ? pt<"image">(crop.x + crop.width / 2, crop.y + crop.height / 2)
      : pt<"image">(
          (edges.left + edges.right - 1) / 2,
          (edges.top + edges.bottom - 1) / 2
        );

  const fractionX = (anchor.x - crop.x) / crop.width;
  const fractionY = (anchor.y - crop.y) / crop.height;

  const scaled = shiftInside(
    rect(
      Math.round(anchor.x - fractionX * width),
      Math.round(anchor.y - fractionY * height),
      width,
      height
    ),
    image
  );

  return containPins(scaled, pins);
};

/** Repairs untrusted geometry against the frame. Idempotent. */
export const normalizeGeometry = (
  geometry: PinGeometry,
  image: Size<"image">,
  ppd: number
): PinGeometry => {
  const min = minCropSize(image, ppd);

  const crop = shiftInside(
    rect(
      Math.round(geometry.crop.x),
      Math.round(geometry.crop.y),
      clamp(Math.round(geometry.crop.width), min.width, image.width),
      clamp(Math.round(geometry.crop.height), min.height, image.height)
    ),
    image
  );

  return { crop, pins: geometry.pins.map((pin) => clampPin(pin, crop)) };
};

export const isWidest = (crop: Size<"image">, image: Size<"image">): boolean =>
  crop.width >= image.width && crop.height >= image.height;

export const isTightest = (
  crop: Size<"image">,
  image: Size<"image">,
  ppd: number
): boolean => {
  const min = minCropSize(image, ppd);

  return crop.width <= min.width && crop.height <= min.height;
};

export const pinInCrop = (
  pin: Point<"image">,
  crop: Rect<"image">
): Point<"crop"> => pt(pin.x - crop.x, pin.y - crop.y);

/** Moves the crop over the image; it stays inside the image and around every pin. */
export const moveCrop = (
  crop: Rect<"image">,
  delta: Point<"image">,
  pins: readonly Point<"image">[],
  image: Size<"image">
): Rect<"image"> =>
  containPins(
    shiftInside(
      rect(
        Math.round(crop.x + delta.x),
        Math.round(crop.y + delta.y),
        crop.width,
        crop.height
      ),
      image
    ),
    pins
  );

/** A corner or an edge of the crop, by compass direction. */
export type CropHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * Moves the handle's edges to the point. An edge stops at the image, at the
 * pins and at the smallest crop, so the crop keeps every pin and its minimum size.
 */
export const resizeCrop = (
  crop: Rect<"image">,
  handle: CropHandle,
  point: Point<"image">,
  pins: readonly Point<"image">[],
  image: Size<"image">,
  ppd: number
): Rect<"image"> => {
  const min = minCropSize(image, ppd);
  const edges = pinEdges(pins);
  const keepLeft = edges?.left ?? Number.POSITIVE_INFINITY;
  const keepTop = edges?.top ?? Number.POSITIVE_INFINITY;
  const keepRight = edges?.right ?? 0;
  const keepBottom = edges?.bottom ?? 0;
  let left = crop.x;
  let top = crop.y;
  let right = crop.x + crop.width;
  let bottom = crop.y + crop.height;

  if (handle.includes("w")) {
    left = clamp(Math.round(point.x), 0, Math.min(keepLeft, right - min.width));
  }

  if (handle.includes("e")) {
    right = clamp(
      Math.round(point.x),
      Math.max(keepRight, left + min.width),
      image.width
    );
  }

  if (handle.includes("n")) {
    top = clamp(Math.round(point.y), 0, Math.min(keepTop, bottom - min.height));
  }

  if (handle.includes("s")) {
    bottom = clamp(
      Math.round(point.y),
      Math.max(keepBottom, top + min.height),
      image.height
    );
  }

  return rect(left, top, right - left, bottom - top);
};

/** How much of the preview the crop fills, so the context around it shows and its edges can be dragged outwards. */
export const CROP_FILL = 0.78;

/** What the preview shows: preview = (image − origin) × scale. */
export interface PreviewView {
  readonly origin: Point<"image">;
  readonly scale: number;
}

const viewOrigin = (center: number, span: number, total: number): number =>
  span >= total
    ? (total - span) / 2
    : clamp(center - span / 2, 0, total - span);

/**
 * Centres the crop in the box at CROP_FILL of its size, never showing more
 * than the image needs; near an edge the view stays on the image.
 */
export const fitView = (
  crop: Rect<"image">,
  image: Size<"image">,
  box: Size<"preview">
): PreviewView => {
  const scale = Math.max(
    Math.min(
      (box.width * CROP_FILL) / crop.width,
      (box.height * CROP_FILL) / crop.height
    ),
    Math.min(box.width / image.width, box.height / image.height)
  );

  return {
    origin: pt(
      viewOrigin(crop.x + crop.width / 2, box.width / scale, image.width),
      viewOrigin(crop.y + crop.height / 2, box.height / scale, image.height)
    ),
    scale,
  };
};

export const previewToImage = (
  point: Point<"preview">,
  view: PreviewView
): Point<"image"> =>
  pt(
    Math.floor(view.origin.x + point.x / view.scale),
    Math.floor(view.origin.y + point.y / view.scale)
  );

export const imageToPreview = (
  point: Point<"image">,
  view: PreviewView
): Point<"preview"> =>
  pt(
    (point.x - view.origin.x) * view.scale,
    (point.y - view.origin.y) * view.scale
  );

const horizontalPlacement = (
  anchorX: number,
  width: number,
  workArea: Rect<"screen">
): number => {
  const right = anchorX + POPOVER_GAP_DIP;
  const left = anchorX - POPOVER_GAP_DIP - width;
  const workRight = workArea.x + workArea.width;

  const fits = (x: number): boolean =>
    x >= workArea.x && x + width <= workRight;

  if (fits(right)) {
    return right;
  }

  if (fits(left)) {
    return left;
  }

  return clamp(right, workArea.x, workRight - width);
};

/** A panel taller than the work area is cut to it and scrolls. */
export const placePopover = (
  anchor: Point<"screen">,
  wanted: Size<"screen">,
  workArea: Rect<"screen">
): Rect<"screen"> => {
  const width = Math.min(Math.round(wanted.width), workArea.width);
  const height = Math.min(Math.round(wanted.height), workArea.height);
  const x = horizontalPlacement(Math.round(anchor.x), width, workArea);

  const y = clamp(
    Math.round(anchor.y - height / 3),
    workArea.y,
    workArea.y + workArea.height - height
  );

  return rect(x, y, width, height);
};
