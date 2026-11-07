import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { CaptureIdSchema, CaptureRecordSchema } from "@shared/capture-record";
import type { CaptureRecord, EditableFields } from "@shared/capture-record";
import { DueDateSchema } from "@shared/due";
import { entryText } from "@shared/entry-text";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DraftStore } from "../renderer/library/drafts";
import { nodeStoreFs, openCaptureStore } from "./store";
import type { CaptureStore } from "./store";

const ID = CaptureIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c");

/** A v1 thought with the spaces, tabs and line breaks a person may have typed. */
const THOUGHT = "  Total ignores the discount\r\n\n\tsee row 12\n";

const v1Json = JSON.stringify({
  capturedAt: "2026-10-21T18:40:12.345Z",
  id: ID,
  image: { file: "crop.png", heightPx: 600, pixelsPerDip: 2, widthPx: 960 },
  invokedVia: "shortcut",
  pin: { x: 240, y: 100 },
  schemaVersion: 1,
  source: { kind: "display", label: "Built-in Retina Display" },
  thought: THOUGHT,
  updatedAt: "2026-10-21T18:40:31.002Z",
});

let root = "";
let store: CaptureStore;

const nothing = (): void => undefined;

const stored = (): CaptureRecord => {
  const entry = store.get(ID);

  if (entry?.kind !== "ok") {
    throw new Error("the capture is not readable");
  }

  return entry.record;
};

const fieldsOf = (record: CaptureRecord): EditableFields => ({
  description: record.description,
  due: record.due,
  pins: record.pins,
  steps: record.steps,
  title: record.title,
});

/** The library's draft store, talking to the real store as main does over IPC. */
const openDrafts = (): DraftStore =>
  new DraftStore({
    discard: async ({ id, tag }) => {
      const result = await store.discard(id, tag);

      return result.ok ? { ok: true } : { message: result.message, ok: false };
    },
    update: async ({ fields, id, tag }) => {
      const result = await store.update(id, fields, tag);

      return result.ok ? { ok: true } : { message: result.message, ok: false };
    },
  });

const openStore = async (): Promise<void> => {
  root = await mkdtemp(path.join(tmpdir(), "inset-edit-copy-"));
  await mkdir(path.join(root, ID));
  await writeFile(path.join(root, ID, "capture.json"), v1Json);
  store = await openCaptureStore(root);
};

const removeStore = async (): Promise<void> => {
  await rm(root, { force: true, recursive: true });
};

describe("copying right after an edit", () => {
  beforeEach(openStore);
  afterEach(removeStore);

  it("copies what was just typed, not what was stored before", async () => {
    const drafts = openDrafts();

    drafts.edit(
      ID,
      { ...fieldsOf(stored()), description: "NEW DESCRIPTION" },
      fieldsOf(stored())
    );

    await expect(drafts.settle(ID)).resolves.toMatchObject({ ok: true });
    expect(entryText(stored())).toBe(
      "Total ignores the discount\n\nNEW DESCRIPTION"
    );
  });

  it("copies a pin moved a moment ago", async () => {
    const drafts = openDrafts();

    drafts.edit(
      ID,
      { ...fieldsOf(stored()), pins: [{ x: 300, y: 200 }] },
      fieldsOf(stored()),
      { now: true }
    );
    await drafts.settle(ID);

    expect(stored().pins).toStrictEqual([{ x: 300, y: 200 }]);
  });
});

describe("Discard changes on the real store", () => {
  afterEach(removeStore);

  it("puts back the edit saved before the discarded one, though the page still passes the copy it loaded first", async () => {
    root = await mkdtemp(path.join(tmpdir(), "inset-edit-copy-"));
    await mkdir(path.join(root, ID));
    await writeFile(path.join(root, ID, "capture.json"), v1Json);

    const disk = {
      full: false,
      holdNext: false,
      release: nothing,
      waiting: false,
    };

    store = await openCaptureStore(root, {
      fs: {
        ...nodeStoreFs,
        writeFileDurable: async (target, data) => {
          if (disk.holdNext) {
            disk.holdNext = false;
            disk.waiting = true;
            // oxlint-disable-next-line promise/avoid-new -- the test lets the held write go on later, through this callback.
            await new Promise<void>((resolve) => {
              disk.release = resolve;
            });
          }

          if (disk.full) {
            throw Object.assign(new Error("full"), { code: "ENOSPC" });
          }

          await nodeStoreFs.writeFileDurable(target, data);
        },
      },
      retryDelaysMs: [],
    });

    const loaded = fieldsOf(stored());
    const drafts = openDrafts();
    const saved = { ...loaded, description: "Saved first", title: "Saved" };

    drafts.edit(ID, saved, loaded, { now: true });
    await expect(drafts.retry(ID)).resolves.toStrictEqual({ ok: true });

    disk.full = true;
    drafts.edit(ID, { ...saved, title: "Discard me" }, loaded, { now: true });
    await vi.waitFor(() => {
      expect(drafts.get(ID)?.kind).toBe("failed");
    });

    disk.full = false;
    disk.holdNext = true;

    const retried = drafts.retry(ID);

    await vi.waitFor(() => {
      expect(disk.waiting).toBeTruthy();
    });
    drafts.discard(ID);
    disk.release();
    await retried;
    await vi.waitFor(() => {
      expect(drafts.get(ID)).toBeUndefined();
    });
    await store.settled();

    const written = CaptureRecordSchema.parse(
      JSON.parse(await readFile(path.join(root, ID, "capture.json"), "utf-8"))
    );

    expect([written.title, written.description]).toStrictEqual([
      "Saved",
      "Saved first",
    ]);
  });
});

describe("a migrated v1 thought", () => {
  beforeEach(openStore);
  afterEach(removeStore);

  it("keeps every character when another field is edited and written as v2", async () => {
    const drafts = openDrafts();
    const due = DueDateSchema.parse("2026-11-07");

    drafts.edit(ID, { ...fieldsOf(stored()), due }, fieldsOf(stored()), {
      now: true,
    });
    await drafts.settle(ID);

    const written = CaptureRecordSchema.parse(
      JSON.parse(await readFile(path.join(root, ID, "capture.json"), "utf-8"))
    );

    expect(written).toMatchObject({
      description: THOUGHT,
      due: "2026-11-07",
      schemaVersion: 2,
      title: "Total ignores the discount",
    });
    expect("thought" in written).toBeFalsy();
  });
});
