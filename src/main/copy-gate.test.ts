import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { CaptureIdSchema } from "@shared/capture-record";
import type { CaptureRecord, EditableFields } from "@shared/capture-record";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InlineSaver } from "../renderer/library/inline-saver";
import { createCopyGate } from "./copy-gate";
import type { ClipboardWriter, CopyGate } from "./copy-gate";
import { nodeStoreFs, openCaptureStore } from "./store";
import type { CaptureStore, StoreFs } from "./store";

const ID = CaptureIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c");

const RECORD = {
  capturedAt: "2026-10-21T18:40:12.345Z",
  description: "Row 12 drops it",
  due: null,
  id: ID,
  image: { file: "crop.png", heightPx: 600, pixelsPerDip: 2, widthPx: 960 },
  invokedVia: "shortcut",
  pins: [{ label: "Total", x: 240, y: 100 }],
  schemaVersion: 2,
  source: { kind: "display", label: "Built-in Retina Display" },
  status: { kind: "active" },
  steps: [],
  title: "Total ignores the discount",
  updatedAt: "2026-10-21T18:40:31.002Z",
};

const PNG = Buffer.from("PNG with pin 1");

const fieldsOf = (record: CaptureRecord): EditableFields => ({
  description: record.description,
  due: record.due,
  pins: record.pins,
  steps: record.steps,
  title: record.title,
});

describe(createCopyGate, () => {
  let root = "";
  let store: CaptureStore;
  let saver: InlineSaver;
  let copy: CopyGate;
  /** While true the disk is full, so every save fails. */
  let full = false;
  /** What reached the clipboard, as the receiving app would read it. */
  let pasted: Record<string, string>[] = [];

  const recording: ClipboardWriter = {
    writeImage: async (png, text) => {
      pasted.push(
        text === null
          ? { "image/png": png.toString() }
          : { "image/png": png.toString(), "text/plain": text }
      );
      await Promise.resolve();
    },
    writeText: async (text) => {
      pasted.push({ "text/plain": text });
      await Promise.resolve();
    },
  };

  const fullDisk: StoreFs = {
    ...nodeStoreFs,
    writeFileDurable: async (target, data) => {
      if (full) {
        throw new Error("ENOSPC: no space left on device");
      }

      await nodeStoreFs.writeFileDurable(target, data);
    },
  };

  const stored = (): CaptureRecord => {
    const entry = store.get(ID);

    if (entry?.kind !== "ok") {
      throw new Error("the capture is not readable");
    }

    return entry.record;
  };

  /** Types into the open capture's title, as the library does, without waiting for the save. */
  const typeTitle = (title: string): void => {
    saver.edit({ ...fieldsOf(stored()), title });
  };

  beforeEach(async () => {
    full = false;
    pasted = [];
    root = await mkdtemp(path.join(tmpdir(), "inset-copy-gate-"));
    await mkdir(path.join(root, ID));
    await writeFile(
      path.join(root, ID, "capture.json"),
      JSON.stringify(RECORD)
    );
    store = await openCaptureStore(root, { fs: fullDisk });

    // The library's saver, talking to the real store as main does over IPC.
    saver = new InlineSaver(ID, {
      update: async ({ fields, id }) => {
        const result = await store.update(id, fields);

        return result.ok
          ? { ok: true }
          : { message: result.message, ok: false };
      },
    });
    saver.adopt(fieldsOf(stored()));

    copy = createCopyGate({
      clipboard: recording,
      pinnedImage: (id) => (id === ID ? { png: PNG } : null),
      saveEdits: async () => await saver.settle(),
      store,
    });
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("copies what was just typed in every format, once it is on disk", async () => {
    typeTitle("Total skips the discount");

    const results = [
      await copy(ID, "text"),
      await copy(ID, "details"),
      await copy(ID, "image"),
      await copy(ID, "imageAndDetails"),
    ];

    expect(results).toStrictEqual([
      { ok: true },
      { ok: true },
      { ok: true },
      { ok: true },
    ]);
    expect(stored().title).toBe("Total skips the discount");
    expect(pasted).toStrictEqual([
      { "text/plain": "Total skips the discount\n\nRow 12 drops it" },
      {
        "text/plain":
          "Total skips the discount\n\nRow 12 drops it\n\n1 · Total",
      },
      { "image/png": "PNG with pin 1" },
      {
        "image/png": "PNG with pin 1",
        "text/plain":
          "Total skips the discount\n\nRow 12 drops it\n\n1 · Total",
      },
    ]);
  });

  it("copies nothing in any format when the save fails, and says why", async () => {
    full = true;
    typeTitle("Typed while the disk is full");

    const results = [
      await copy(ID, "text"),
      await copy(ID, "details"),
      await copy(ID, "image"),
      await copy(ID, "imageAndDetails"),
    ];

    const refused = {
      message:
        "Couldn’t save your changes, so nothing was copied. ENOSPC: no space left on device",
      ok: false,
    };

    expect(results).toStrictEqual([refused, refused, refused, refused]);
    expect(pasted).toStrictEqual([]);
    expect(stored().title).toBe("Total ignores the discount");
  });

  it("copies the typing once saving works again", async () => {
    full = true;
    typeTitle("Typed while the disk is full");
    await copy(ID, "text");
    full = false;

    await expect(copy(ID, "text")).resolves.toStrictEqual({ ok: true });
    expect(pasted).toStrictEqual([
      { "text/plain": "Typed while the disk is full\n\nRow 12 drops it" },
    ]);
  });

  it("refuses a capture that no longer exists without touching the clipboard", async () => {
    await store.remove(ID);

    await expect(copy(ID, "image")).resolves.toStrictEqual({
      message: "This capture can’t be copied.",
      ok: false,
    });
    expect(pasted).toStrictEqual([]);
  });
});
