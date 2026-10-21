import { rect } from "@shared/geometry";
import type { DisplaySnapshot, Rect, Size } from "@shared/geometry";

interface RectLike {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The fields of an Electron Display the app reads. */
export interface DisplayLike {
  readonly id: number;
  readonly label: string;
  readonly bounds: RectLike;
  readonly workArea: RectLike;
  readonly scaleFactor: number;
}

const toScreenRect = (value: RectLike): Rect<"screen"> =>
  rect(value.x, value.y, value.width, value.height);

export const snapshotDisplay = (display: DisplayLike): DisplaySnapshot => ({
  bounds: toScreenRect(display.bounds),
  id: display.id,
  label: display.label === "" ? null : display.label,
  scaleFactor: display.scaleFactor,
  workArea: toScreenRect(display.workArea),
});

/**
 * getSources scales every screen to fit this size, so asking for the target
 * display's own pixel size yields full resolution for it. The real size is
 * read from the image afterwards.
 */
export const thumbnailSizeFor = (display: DisplaySnapshot): Size<"image"> => ({
  height: Math.round(display.bounds.height * display.scaleFactor),
  width: Math.round(display.bounds.width * display.scaleFactor),
});

/**
 * Index of the source showing the display: one exact display_id match, or
 * the only source when there is only one display (some systems report an
 * empty id). Never "the first source" of several.
 */
export const matchSource = (
  sources: readonly { readonly display_id: string }[],
  displayId: number,
  displayCount: number
): number | null => {
  const wanted = String(displayId);

  const matches = sources.flatMap((source, index) =>
    source.display_id === wanted ? [index] : []
  );

  if (matches.length === 1) {
    return matches[0] ?? null;
  }

  return matches.length === 0 && displayCount === 1 && sources.length === 1
    ? 0
    : null;
};
