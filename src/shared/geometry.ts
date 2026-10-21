export type Space = "screen" | "image" | "crop" | "preview";

declare const space: unique symbol;

/**
 * Coordinates tagged with the space they live in. The tag is optional so plain
 * literals build a value without an assertion, while mixing two spaces fails
 * to typecheck.
 */
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

/** Plain data copied from an Electron Display at sampling time. */
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

/**
 * Global DIP to full-image pixels. Scales by the actual image size over the
 * display bounds (never bounds × scaleFactor), so negative origins and
 * downscaled captures map correctly.
 */
export const screenToImage = (
  point: Point<"screen">,
  bounds: Rect<"screen">,
  image: Size<"image">
): Point<"image"> => {
  const x = Math.floor(((point.x - bounds.x) * image.width) / bounds.width);
  const y = Math.floor(((point.y - bounds.y) * image.height) / bounds.height);

  return pt(clamp(x, 0, image.width - 1), clamp(y, 0, image.height - 1));
};

/** Measured image pixels per DIP; feeds the DIP-denominated crop constants. */
export const pixelsPerDip = (
  bounds: Rect<"screen">,
  image: Size<"image">
): number => image.width / bounds.width;

const minCropSize = (image: Size<"image">, ppd: number): Size<"image"> =>
  size(
    Math.min(Math.round(MIN_CROP_DIP.width * ppd), image.width),
    Math.min(Math.round(MIN_CROP_DIP.height * ppd), image.height)
  );

/** Shifts (never shrinks) a crop of a valid size so it lies inside the image. */
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

/** Shifts a crop the least amount needed to contain the pin. */
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

/** DEFAULT_CROP_DIP centred on the pin, shifted into the image; shrunk only when the image is smaller. */
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

/**
 * Scales the crop about the pin so the pin keeps its relative preview
 * position, bounded by the minimum crop and the image. The pin never moves.
 */
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

/** Contain-fit of the crop into the preview box: the renderer's only mapping primitive. */
export interface PreviewFit {
  readonly scale: number;
  readonly box: Size<"preview">;
}

export const fitPreview = (
  crop: Size<"image">,
  maxBox: Size<"preview">
): PreviewFit => {
  const scale = Math.min(
    maxBox.width / crop.width,
    maxBox.height / crop.height
  );

  return { box: size(crop.width * scale, crop.height * scale), scale };
};

export const previewToImage = (
  point: Point<"preview">,
  crop: Rect<"image">,
  fit: PreviewFit
): Point<"image"> =>
  pt(
    Math.floor(crop.x + point.x / fit.scale),
    Math.floor(crop.y + point.y / fit.scale)
  );

export const imageToPreview = (
  point: Point<"image">,
  crop: Rect<"image">,
  fit: PreviewFit
): Point<"preview"> =>
  pt((point.x - crop.x) * fit.scale, (point.y - crop.y) * fit.scale);

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

/**
 * Beside the anchor (right, else left, else clamped), a third above it, inside
 * the work area. A panel taller than the work area is cut to it and scrolls.
 */
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
