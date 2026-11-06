import type { CaptureId, EditableFields } from "@shared/capture-record";
import type { ActionResult, SavedEdits } from "@shared/contracts";
import { entryPlainText, entryText } from "@shared/entry-text";
import { clipboard, ClipboardItem } from "electron";

import type { PinnedImage, ShownPins } from "./capture-export";
import type { CaptureStore } from "./store";

/**
 * What a copy puts on the clipboard: Copy Text (the title and description),
 * Copy with Details, Copy Image (with its pins), or the image and the details
 * in one item, as Copy after saving does.
 */
export type CopyFormat = "text" | "details" | "image" | "imageAndDetails";

export type CopyGate = (
  id: CaptureId,
  format: CopyFormat
) => Promise<ActionResult>;

/** The clipboard as the gate writes to it; tests pass one that records. */
export interface ClipboardWriter {
  readonly writeText: (text: string) => Promise<void>;
  /** One item with the image and, when given, the text, so the receiving app pastes whichever it can. */
  readonly writeImage: (png: Buffer, text: string | null) => Promise<void>;
}

export const electronClipboard: ClipboardWriter = {
  writeImage: async (png, text) => {
    const image = new Blob([png], { type: "image/png" });

    await clipboard.write([
      new ClipboardItem(
        text === null
          ? { "image/png": image }
          : {
              "image/png": image,
              "text/plain": new Blob([text], { type: "text/plain" }),
            }
      ),
    ]);
  },
  writeText: async (text) => {
    await clipboard.writeText(text);
  },
};

export interface CopyGateOptions {
  readonly clipboard: ClipboardWriter;
  readonly store: Pick<CaptureStore, "get">;
  /**
   * Saves what the library has typed into this capture, waits for the disk,
   * and hands back the fields as they were when the copy started.
   */
  readonly saveEdits: (id: CaptureId) => Promise<SavedEdits>;
  /** The saved crop with these pins drawn on it. */
  readonly pinnedImage: (
    id: CaptureId,
    shown: ShownPins
  ) => Pick<PinnedImage, "png"> | null;
}

const OK: ActionResult = { ok: true };

const fail = (message: string): ActionResult => ({ message, ok: false });

const fieldsOf = (record: EditableFields): EditableFields => ({
  description: record.description,
  due: record.due,
  pins: record.pins,
  steps: record.steps,
  title: record.title,
});

/**
 * The one way anything reaches the clipboard (clipboard-writers.test.ts holds
 * every other file to that). It has the library save what is typed into the
 * capture and wait for the disk, then copies the snapshot the library took
 * when the copy started, never the capture as it is once the wait is over.
 * When that save fails it copies nothing and says why.
 */
export const createCopyGate =
  ({
    clipboard: board,
    pinnedImage,
    saveEdits,
    store,
  }: CopyGateOptions): CopyGate =>
  async (id, format) => {
    const saved = await saveEdits(id);

    if (!saved.ok) {
      return fail(
        `Couldn’t save your changes, so nothing was copied. ${saved.message}`
      );
    }

    const entry = store.get(id);

    if (entry?.kind !== "ok") {
      return fail("This capture can’t be copied.");
    }

    // Nothing typed: the stored capture is what the library shows.
    const copied = saved.fields ?? fieldsOf(entry.record);

    if (format === "text" || format === "details") {
      try {
        await board.writeText(
          format === "text" ? entryPlainText(copied) : entryText(copied)
        );

        return OK;
      } catch {
        return fail("The text could not be copied.");
      }
    }

    const pinned = pinnedImage(id, { pins: copied.pins, title: copied.title });

    if (pinned === null) {
      return fail("This capture has no readable image.");
    }

    try {
      await board.writeImage(
        pinned.png,
        format === "imageAndDetails" ? entryText(copied) : null
      );

      return OK;
    } catch {
      return fail("The image could not be copied.");
    }
  };
