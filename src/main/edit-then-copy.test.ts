import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { CaptureIdSchema, CaptureRecordSchema } from "@shared/capture-record";
import type { CaptureRecord, EditableFields } from "@shared/capture-record";
import { DueDateSchema } from "@shared/due";
import { entryText } from "@shared/entry-text";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InlineSaver } from "../renderer/library/inline-saver";
import { openCaptureStore } from "./store";
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

/** The library's saver, talking to the real store as main does over IPC. */
const openSaver = (): InlineSaver => {
  const saver = new InlineSaver(ID, {
    update: async ({ fields, id }) => {
      const result = await store.update(id, fields);

      return result.ok ? { ok: true } : { message: result.message, ok: false };
    },
  });

  saver.adopt(fieldsOf(stored()));

  return saver;
};

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
    const saver = openSaver();

    saver.edit({ ...fieldsOf(stored()), description: "NEW DESCRIPTION" });

    await expect(saver.settle()).resolves.toStrictEqual({ ok: true });
    expect(entryText(stored())).toContain("NEW DESCRIPTION");
  });

  it("copies a pin moved a moment ago", async () => {
    const saver = openSaver();

    saver.editNow({ ...fieldsOf(stored()), pins: [{ x: 300, y: 200 }] });
    await saver.settle();

    expect(stored().pins).toStrictEqual([{ x: 300, y: 200 }]);
  });
});

describe("a migrated v1 thought", () => {
  beforeEach(openStore);
  afterEach(removeStore);

  it("keeps every character when another field is edited and written as v2", async () => {
    const saver = openSaver();
    const due = DueDateSchema.parse("2026-11-07");

    saver.editNow({ ...fieldsOf(stored()), due });
    await saver.settle();

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
