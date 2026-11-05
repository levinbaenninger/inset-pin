import { fitView, imageToPreview, size } from "../../src/shared/geometry.ts";
import type { Point, Rect, Size } from "../../src/shared/geometry.ts";

/** What main logs with `panelShown` under INSET_E2E_LOG (src/main/e2e-log.ts), in the captured frame's pixels. */
export interface PanelPreview {
  readonly crop: Rect<"image">;
  readonly frame: Size<"image">;
  readonly pointer: Point<"image">;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface ScreenBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where to click in the panel's preview so pin 1 lands on the pixel the
 * pointer was on, mapped as the preview maps it
 * (src/renderer/capture/pin-preview.tsx). `box` is the preview's frame on
 * screen, in points or physical pixels: the mapping scales with it.
 */
export const pinClickPoint = (
  preview: PanelPreview,
  box: ScreenBox
): ScreenPoint => {
  const view = fitView(
    preview.crop,
    preview.frame,
    size<"preview">(box.width, box.height)
  );

  const corner = imageToPreview(preview.pointer, view);

  // The middle of the pointer's pixel, so rounding to a whole screen point stays on it.
  return {
    x: Math.round(box.x + corner.x + view.scale / 2),
    y: Math.round(box.y + corner.y + view.scale / 2),
  };
};
