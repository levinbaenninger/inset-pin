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

/** Invariant: crop lies inside the image and pin lies inside crop. */
export interface PinGeometry {
  readonly pin: Point<"image">;
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

const containPin = (crop: Rect<"image">, pin: Point<"image">): Rect<"image"> =>
  rect(
    clamp(crop.x, pin.x - crop.width + 1, pin.x),
    clamp(crop.y, pin.y - crop.height + 1, pin.y),
    crop.width,
    crop.height
  );

export const clampPin = (
  point: Point<"image">,
  crop: Rect<"image">
): Point<"image"> =>
  pt(
    clamp(Math.round(point.x), crop.x, crop.x + crop.width - 1),
    clamp(Math.round(point.y), crop.y, crop.y + crop.height - 1)
  );

export const defaultCrop = (
  pin: Point<"image">,
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
      Math.round(pin.x - width / 2),
      Math.round(pin.y - height / 2),
      width,
      height
    ),
    image
  );
};

/** The pin never moves and keeps its relative position in the preview. */
export const scaleCrop = (
  crop: Rect<"image">,
  pin: Point<"image">,
  factor: number,
  image: Size<"image">,
  ppd: number
): Rect<"image"> => {
  const min = minCropSize(image, ppd);
  const width = clamp(Math.round(crop.width * factor), min.width, image.width);

  const height = clamp(
    Math.round(crop.height * factor),
    min.height,
    image.height
  );

  const fractionX = (pin.x - crop.x) / crop.width;
  const fractionY = (pin.y - crop.y) / crop.height;

  const scaled = shiftInside(
    rect(
      Math.round(pin.x - fractionX * width),
      Math.round(pin.y - fractionY * height),
      width,
      height
    ),
    image
  );

  return containPin(scaled, pin);
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

  return { crop, pin: clampPin(geometry.pin, crop) };
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

/** Moves the crop over the image; it stays inside the image and around the pin. */
export const moveCrop = (
  crop: Rect<"image">,
  delta: Point<"image">,
  pin: Point<"image">,
  image: Size<"image">
): Rect<"image"> =>
  containPin(
    shiftInside(
      rect(
        Math.round(crop.x + delta.x),
        Math.round(crop.y + delta.y),
        crop.width,
        crop.height
      ),
      image
    ),
    pin
  );

/** A corner or an edge of the crop, by compass direction. */
export type CropHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * Moves the handle's edges to the point. An edge stops at the image, at the
 * pin and at the smallest crop, so the crop keeps the pin and its minimum size.
 */
export const resizeCrop = (
  crop: Rect<"image">,
  handle: CropHandle,
  point: Point<"image">,
  pin: Point<"image">,
  image: Size<"image">,
  ppd: number
): Rect<"image"> => {
  const min = minCropSize(image, ppd);
  let left = crop.x;
  let top = crop.y;
  let right = crop.x + crop.width;
  let bottom = crop.y + crop.height;

  if (handle.includes("w")) {
    left = clamp(Math.round(point.x), 0, Math.min(pin.x, right - min.width));
  }

  if (handle.includes("e")) {
    right = clamp(
      Math.round(point.x),
      Math.max(pin.x + 1, left + min.width),
      image.width
    );
  }

  if (handle.includes("n")) {
    top = clamp(Math.round(point.y), 0, Math.min(pin.y, bottom - min.height));
  }

  if (handle.includes("s")) {
    bottom = clamp(
      Math.round(point.y),
      Math.max(pin.y + 1, top + min.height),
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
