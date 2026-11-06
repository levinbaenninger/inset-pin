import type { CaptureId, EditableFields } from "@shared/capture-record";
import { SAVE_TOO_SLOW } from "@shared/contracts";
import type { CopyResult, SavedEdits } from "@shared/contracts";
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
) => Promise<CopyResult>;

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
  readonly store: Pick<CaptureStore, "get" | "owed">;
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

const OK: CopyResult = { ok: true };

const fail = (message: string): CopyResult => ({
  message,
  ok: false,
  retry: false,
});

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
 * when the copy started, never the capture as it is once the wait is over:
 * with nothing typed, that snapshot is the record as stored when the copy
 * started. When that save fails it copies nothing, says why and offers Retry.
 */
export const createCopyGate =
  ({
    clipboard: board,
    pinnedImage,
    saveEdits,
    store,
  }: CopyGateOptions): CopyGate =>
  async (id, format) => {
    const entry = store.get(id);

    if (entry?.kind !== "ok") {
      return fail("This capture can’t be copied.");
    }

    const stored = fieldsOf(entry.record);
    const saved = await saveEdits(id);

    if (!saved.ok) {
      const message =
        saved.during === "discard"
          ? `Couldn’t discard your changes, so nothing was copied. ${saved.message}`
          : `Couldn’t save your changes, so nothing was copied. ${saved.message}`;

      return {
        message,
        ok: false,
        retry: true,
      };
    }

    // No library page was open to refuse it, so the stored record may still hold what the user discarded; only main's answer or the library can settle it.
    const owed = store.owed().find((one) => one.id === id);

    if (owed !== undefined) {
      return fail(
        `Couldn’t discard your changes, so nothing was copied. ${owed.message ?? SAVE_TOO_SLOW}`
      );
    }

    // Nothing typed: the record as stored when the copy started is what the library showed.
    const copied = saved.fields ?? stored;

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
