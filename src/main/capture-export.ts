import type { CaptureId, SavedPin } from "@shared/capture-record";
import { drawPins } from "@shared/pin-sprite";
import { nativeImage } from "electron";

import { exportFileName } from "./library-view";
import type { CaptureStore } from "./store";

export interface PinnedImage {
  readonly image: Electron.NativeImage;
  readonly png: Buffer;
  readonly fileName: string;
}

/** The pins and title the page shows, when they may be newer than the saved ones. */
export interface ShownPins {
  readonly pins: readonly SavedPin[];
  readonly title: string;
}

/**
 * The saved crop with every pin drawn on it, so the receiving app sees what
 * mattered. A drag passes the pins on screen, since it can't wait for a save.
 */
export type PinnedImageOf = (
  id: CaptureId,
  shown?: ShownPins
) => PinnedImage | null;

export const createPinnedImage = (store: CaptureStore): PinnedImageOf => {
  const pinnedImage = (
    id: CaptureId,
    shown?: ShownPins
  ): PinnedImage | null => {
    const entry = store.get(id);
    const file = store.imageFile(id);

    if (entry?.kind !== "ok" || file === null) {
      return null;
    }

    const saved = nativeImage.createFromPath(file);

    if (saved.isEmpty()) {
      return null;
    }

    const { height, width } = saved.getSize();
    const { image } = entry.record;
    const inside = shown?.pins.every((pin) => pin.x < width && pin.y < height);

    const { pins, title } =
      shown !== undefined && inside === true ? shown : entry.record;

    // The same sprite the screen shows (src/shared/pin-sprite.ts), in the bitmap's BGRA order.
    const marked = nativeImage.createFromBitmap(
      Buffer.from(
        drawPins(
          { data: saved.toBitmap(), height, width },
          pins,
          image.pixelsPerDip,
          "bgra"
        )
      ),
      { height, width }
    );

    return {
      fileName: exportFileName(title),
      image: marked,
      png: marked.toPNG(),
    };
  };

  return pinnedImage;
};
