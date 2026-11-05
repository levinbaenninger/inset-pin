import type { CaptureId } from "@shared/capture-record";
import type { ActionResult } from "@shared/contracts";
import { entryText } from "@shared/entry-text";
import { drawPins } from "@shared/pin-sprite";
import { clipboard, ClipboardItem, nativeImage } from "electron";

import { exportFileName } from "./library-view";
import type { CaptureStore } from "./store";

export interface PinnedImage {
  readonly image: Electron.NativeImage;
  readonly png: Buffer;
  readonly fileName: string;
}

export interface CaptureExport {
  /** The saved crop with every pin drawn on it, so the receiving app sees what mattered. */
  readonly pinnedImage: (id: CaptureId) => PinnedImage | null;
  readonly copyImage: (id: CaptureId) => Promise<ActionResult>;
  /** The title, description, steps, due date and pin labels as plain text. */
  readonly copyText: (id: CaptureId) => Promise<ActionResult>;
  /** The image and the text in one clipboard item; an app takes whichever it can paste. */
  readonly copyBoth: (id: CaptureId) => Promise<ActionResult>;
}

const OK: ActionResult = { ok: true };

const fail = (message: string): ActionResult => ({ message, ok: false });

export const createCaptureExport = (store: CaptureStore): CaptureExport => {
  const pinnedImage = (id: CaptureId): PinnedImage | null => {
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
    const { image, pins, title } = entry.record;

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

  const textOf = (id: CaptureId): string | null => {
    const entry = store.get(id);

    return entry?.kind === "ok" ? entryText(entry.record) : null;
  };

  const write = async (
    id: CaptureId,
    withText: boolean
  ): Promise<ActionResult> => {
    const pinned = pinnedImage(id);
    const text = textOf(id);

    if (pinned === null || text === null) {
      return fail("This capture has no readable image.");
    }

    try {
      const png = new Blob([pinned.png], { type: "image/png" });

      await clipboard.write([
        new ClipboardItem(
          withText
            ? {
                "image/png": png,
                "text/plain": new Blob([text], { type: "text/plain" }),
              }
            : { "image/png": png }
        ),
      ]);

      return OK;
    } catch {
      return fail("The image could not be copied.");
    }
  };

  return {
    copyBoth: async (id) => await write(id, true),
    copyImage: async (id) => await write(id, false),
    copyText: async (id) => {
      const text = textOf(id);

      if (text === null) {
        return fail("This capture can't be copied.");
      }

      await clipboard.writeText(text);

      return OK;
    },
    pinnedImage,
  };
};
