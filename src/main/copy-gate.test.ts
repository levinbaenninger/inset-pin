import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { CaptureIdSchema } from "@shared/capture-record";
import type { CaptureRecord, EditableFields } from "@shared/capture-record";
import type { ActionResult } from "@shared/contracts";
import { DueDateSchema } from "@shared/due";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DraftStore } from "../renderer/library/drafts";
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

const fieldsOf = (record: CaptureRecord): EditableFields => ({
  description: record.description,
  due: record.due,
  pins: record.pins,
  steps: record.steps,
  title: record.title,
});

const nothing = (): void => undefined;

const REFUSED = {
  message:
    "Couldn’t save your changes, so nothing was copied. The disk is full.",
  ok: false,
  retry: true,
};

/** Lets every save and copy started so far run as far as it can. */
const settleDown = async (): Promise<void> => {
  await delay(50);
};

describe(createCopyGate, () => {
  let root = "";
  let store: CaptureStore;
  let drafts: DraftStore;
  let copy: CopyGate;
  /** While true the disk is full, so every save fails. */
  let full = false;
  /** Saves wait here while held, as on a slow disk, until the test lets them go. */
  let held: (() => void)[] | null = null;

  const hold = (): void => {
    held = [];
  };

  const release = (): void => {
    const waiting = held ?? [];

    held = null;

    for (const go of waiting) {
      go();
    }
  };

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
        throw Object.assign(new Error("ENOSPC: no space left on device"), {
          code: "ENOSPC",
        });
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

  /** Types into the capture's title, as the library does, without waiting for the save. */
  const typeTitle = (title: string): void => {
    const shown = drafts.get(ID)?.values ?? fieldsOf(stored());

    drafts.edit(ID, { ...shown, title }, fieldsOf(stored()));
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

    held = null;

    // The library's draft store, talking to the real store as main does over IPC.
    drafts = new DraftStore({
      discard: async ({ id, tag }): Promise<ActionResult> => {
        const result = await store.discard(id, tag);

        return result.ok
          ? { ok: true }
          : { message: result.message, ok: false };
      },
      update: async ({ fields, id, tag }): Promise<ActionResult> => {
        if (held !== null) {
          const waiting = held;

          // oxlint-disable-next-line promise/avoid-new -- release() lets the held save go through this callback.
          await new Promise<void>((resolve) => {
            waiting.push(resolve);
          });
        }

        const result = await store.update(id, fields, tag);

        return result.ok
          ? { ok: true }
          : { message: result.message, ok: false };
      },
    });

    copy = createCopyGate({
      clipboard: recording,
      pinnedImage: (id, { pins }) =>
        id === ID
          ? { png: Buffer.from(`PNG with pins at ${JSON.stringify(pins)}`) }
          : null,
      saveEdits: async (id) => await drafts.settle(id),
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
      { "image/png": 'PNG with pins at [{"label":"Total","x":240,"y":100}]' },
      {
        "image/png": 'PNG with pins at [{"label":"Total","x":240,"y":100}]',
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

    expect(results).toStrictEqual([REFUSED, REFUSED, REFUSED, REFUSED]);
    expect(pasted).toStrictEqual([]);
    expect(stored().title).toBe("Total ignores the discount");
  });

  it("refuses a failed draft at once once the disk recovers, without saving it again, and copies it after Retry", async () => {
    full = true;
    typeTitle("Typed while the disk is full");
    await copy(ID, "text");
    full = false;

    await expect(copy(ID, "text")).resolves.toStrictEqual(REFUSED);
    expect([stored().title, pasted]).toStrictEqual([
      "Total ignores the discount",
      [],
    ]);

    await expect(drafts.retry(ID)).resolves.toStrictEqual({ ok: true });
    await expect(copy(ID, "text")).resolves.toStrictEqual({ ok: true });
    expect(pasted).toStrictEqual([
      { "text/plain": "Typed while the disk is full\n\nRow 12 drops it" },
    ]);
  });

  it("with nothing typed, copies every field as stored when the copy started, though the record changes during the wait", async () => {
    let answer = nothing;

    const waiting = createCopyGate({
      clipboard: recording,
      pinnedImage: () => null,
      saveEdits: async () => {
        // oxlint-disable-next-line promise/avoid-new -- the test answers for the page later.
        await new Promise<void>((resolve) => {
          answer = resolve;
        });

        return { fields: null, ok: true };
      },
      store,
    });

    const copying = waiting(ID, "details");

    await store.update(ID, {
      ...fieldsOf(stored()),
      due: DueDateSchema.parse("2026-11-09"),
      title: "Renamed during the wait",
    });
    answer();

    await expect(copying).resolves.toStrictEqual({ ok: true });
    expect(pasted).toStrictEqual([
      {
        "text/plain":
          "Total ignores the discount\n\nRow 12 drops it\n\n1 · Total",
      },
    ]);
  });

  it("copies the Due in the snapshot taken when the copy started, though a later Due reaches the disk", async () => {
    hold();
    drafts.edit(
      ID,
      { ...fieldsOf(stored()), due: DueDateSchema.parse("2026-11-07") },
      fieldsOf(stored())
    );

    const copying = copy(ID, "details");

    drafts.edit(
      ID,
      { ...fieldsOf(stored()), due: DueDateSchema.parse("2026-11-20") },
      fieldsOf(stored())
    );
    drafts.flush(ID);
    release();

    await expect(copying).resolves.toStrictEqual({ ok: true });
    await settleDown();
    release();
    await settleDown();

    expect(pasted).toStrictEqual([
      {
        "text/plain":
          "Total ignores the discount\n\nRow 12 drops it\n\nDue: 2026-11-07\n\n1 · Total",
      },
    ]);
    expect(stored().due).toBe("2026-11-20");
  });

  it("copies the snapshot taken when the copy started, though a second edit reaches the disk during the wait", async () => {
    hold();
    typeTitle("First");

    const copying = copy(ID, "details");

    typeTitle("First, then more");
    drafts.flush(ID);
    release();

    await expect(copying).resolves.toStrictEqual({ ok: true });
    await settleDown();

    expect(pasted).toStrictEqual([
      { "text/plain": "First\n\nRow 12 drops it\n\n1 · Total" },
    ]);
    expect(stored().title).toBe("First, then more");
  });

  it("refuses a copy started while the capture's save was on its way, once that save fails, and keeps the typing", async () => {
    hold();
    typeTitle("Typed, then the capture was left");
    // Leaving the capture sends its save at once; the page that showed it is gone.
    drafts.flush(ID);

    const copying = copy(ID, "text");

    full = true;
    release();

    await expect(copying).resolves.toStrictEqual(REFUSED);
    expect(pasted).toStrictEqual([]);
    expect(drafts.get(ID)).toMatchObject({
      kind: "failed",
      values: { title: "Typed, then the capture was left" },
    });
  });

  it("refuses a capture that no longer exists without touching the clipboard", async () => {
    await store.remove(ID);

    await expect(copy(ID, "image")).resolves.toStrictEqual({
      message: "This capture can’t be copied.",
      ok: false,
      retry: false,
    });
    expect(pasted).toStrictEqual([]);
  });
});
