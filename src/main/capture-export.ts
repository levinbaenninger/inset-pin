import type { CaptureId } from "@shared/capture-record";
import type { ActionResult } from "@shared/contracts";
import { clipboard, ClipboardItem, nativeImage } from "electron";

import { exportFileName } from "./library-view";
import { drawPinMark } from "./pin-mark";
import type { CaptureStore } from "./store";

export interface PinnedImage {
  readonly image: Electron.NativeImage;
  readonly png: Buffer;
  readonly fileName: string;
}

export interface CaptureExport {
  /** The saved crop with the pin drawn on it, so the receiving app sees what mattered. */
  readonly pinnedImage: (id: CaptureId) => PinnedImage | null;
  readonly copyImage: (id: CaptureId) => Promise<ActionResult>;
  readonly copyNote: (id: CaptureId) => Promise<ActionResult>;
  /** The image and the thought in one clipboard item; an app takes whichever it can paste. */
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
    const { pin, image } = entry.record;

    const marked = nativeImage.createFromBitmap(
      Buffer.from(
        drawPinMark(
          { data: saved.toBitmap(), height, width },
          pin,
          image.pixelsPerDip
        )
      ),
      { height, width }
    );

    return {
      fileName: exportFileName(entry.record.thought),
      image: marked,
      png: marked.toPNG(),
    };
  };

  const write = async (
    id: CaptureId,
    withThought: boolean
  ): Promise<ActionResult> => {
    const pinned = pinnedImage(id);
    const entry = store.get(id);

    if (pinned === null || entry?.kind !== "ok") {
      return fail("This capture has no readable image.");
    }

    try {
      const png = new Blob([pinned.png], { type: "image/png" });

      await clipboard.write([
        new ClipboardItem(
          withThought
            ? {
                "image/png": png,
                "text/plain": new Blob([entry.record.thought], {
                  type: "text/plain",
                }),
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
    copyNote: async (id) => {
      const entry = store.get(id);

      if (entry?.kind !== "ok") {
        return fail("This capture can't be copied.");
      }

      await clipboard.writeText(entry.record.thought);

      return OK;
    },
    pinnedImage,
  };
};
