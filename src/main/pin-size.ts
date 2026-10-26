/** A pinned capture opens at its own size, within these bounds (DIP). */
const MAX_WIDTH = 420;
const MAX_HEIGHT = 320;
export const MIN_WIDTH = 120;

export interface PinSize {
  readonly width: number;
  readonly height: number;
}

/** The crop at its size on screen, scaled down to fit the bounds and never below the smallest width. */
export const pinSize = (image: {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly pixelsPerDip: number;
}): PinSize => {
  const width = image.widthPx / image.pixelsPerDip;
  const height = image.heightPx / image.pixelsPerDip;
  const fit = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
  const grow = Math.max(1, MIN_WIDTH / (width * fit));
  const scale = fit * grow;

  return {
    height: Math.round(height * scale),
    width: Math.round(width * scale),
  };
};

/**
 * The size nearest a resized pin that shows its crop undistorted: the side
 * the user changed more, for its length, leads, and the width stays at least
 * the smallest pin's.
 */
export const fitToCrop = (
  opened: PinSize,
  before: PinSize,
  after: PinSize
): PinSize => {
  const ratio = opened.width / opened.height;

  const widthLeads =
    Math.abs(after.width - before.width) / before.width >=
    Math.abs(after.height - before.height) / before.height;

  const width = Math.max(
    MIN_WIDTH,
    widthLeads ? after.width : after.height * ratio
  );

  return { height: Math.round(width / ratio), width: Math.round(width) };
};
