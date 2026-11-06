import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { CaptureIdSchema, CaptureRecordSchema } from "@shared/capture-record";
import type { CaptureRecord, EditableFields } from "@shared/capture-record";
import type { ActionResult } from "@shared/contracts";
import { DueDateSchema } from "@shared/due";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DraftStore } from "../renderer/library/drafts";
import { nodeStoreFs, openCaptureStore } from "./store";
import type { CaptureStore, StoreResult } from "./store";

const ID = CaptureIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c");
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const BASE: EditableFields = {
  description: "Saved description",
  due: DueDateSchema.parse("2026-11-09"),
  pins: [{ label: "Saved label", x: 10, y: 20 }],
  steps: [{ done: false, id: "s1", text: "Saved step" }],
  title: "Saved title",
};

const DISCARDED: EditableFields = {
  description: "Discarded description",
  due: DueDateSchema.parse("2026-11-11"),
  pins: [{ label: "Discarded label", x: 50, y: 60 }],
  steps: [{ done: true, id: "s2", text: "Discarded step" }],
  title: "Discarded title",
};

const RECORD: CaptureRecord = {
  ...BASE,
  capturedAt: "2026-11-06T01:00:00.000Z",
  id: ID,
  image: { file: "crop.png", heightPx: 600, pixelsPerDip: 2, widthPx: 960 },
  invokedVia: "shortcut",
  schemaVersion: 2,
  source: { kind: "display", label: "Built-in Retina Display" },
  status: { kind: "active" },
  updatedAt: "2026-11-06T01:00:00.000Z",
};

const nothing = (): void => undefined;

/**
 * The real store on a real folder, with a disk the test can hold at one
 * step of a save and then fill, as a slow and then full disk would.
 */
interface Disk {
  /** Holds the next content write, or the next rename into capture.json. */
  hold: "write" | "rename" | null;
  full: boolean;
  /** Renames into capture.json.prev fail, as a backup a Windows lock holds would. */
  backupLocked: boolean;
  held: boolean;
  release: () => void;
  /** Content writes into the capture's folder, in order. */
  writes: string[];
}

const disk: Disk = {
  backupLocked: false,
  full: false,
  held: false,
  hold: null,
  release: nothing,
  writes: [],
};

let root = "";
let store: CaptureStore;

const holdHere = async (): Promise<void> => {
  disk.hold = null;
  disk.held = true;
  // oxlint-disable-next-line promise/avoid-new -- the test lets the held step go on later, through this callback.
  await new Promise<void>((resolve) => {
    disk.release = resolve;
  });
};

/** Holds every answer to a save main already wrote, until the test releases them. */
const holdAnswers = () => {
  let release = nothing;

  // oxlint-disable-next-line promise/avoid-new -- the test lets the held answers go on later, through this callback.
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    held,
    release: () => {
      release();
    },
  };
};

const toAction = <T>(result: StoreResult<T>): ActionResult =>
  result.ok ? { ok: true } : { message: result.message, ok: false };

/** The library's draft store, talking to the real store as main does over IPC. */
const openDrafts = (): DraftStore =>
  new DraftStore({
    discard: async ({ id, tag }) => toAction(await store.discard(id, tag)),
    update: async ({ fields, id, tag }) =>
      toAction(await store.update(id, fields, tag)),
  });

const onDisk = async (): Promise<CaptureRecord> =>
  CaptureRecordSchema.parse(
    JSON.parse(await readFile(path.join(root, ID, "capture.json"), "utf-8"))
  );

const fieldsOf = (record: CaptureRecord): EditableFields => ({
  description: record.description,
  due: record.due,
  pins: record.pins,
  steps: record.steps,
  title: record.title,
});

/** What the capture shows: the draft while there is one, else the last save this library confirmed, else what it loaded. */
const shown = (drafts: DraftStore): EditableFields =>
  drafts.get(ID)?.values ?? drafts.saved(ID) ?? BASE;

/** Every write the store queued, and every answer the draft store reacts to by queuing more. */
const settle = async (): Promise<void> => {
  for (let round = 0; round < 3; round += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each round's answers may queue the next write.
    await store.settled();
    // oxlint-disable-next-line no-await-in-loop -- as above.
    await delay(5);
  }
};

describe("Discard changes never writes content to undo a save (SPEC round 8)", () => {
  beforeEach(async () => {
    disk.hold = null;
    disk.backupLocked = false;
    disk.full = false;
    disk.held = false;
    disk.release = nothing;
    disk.writes = [];
    root = await mkdtemp(path.join(tmpdir(), "inset-discard-"));
    store = await openCaptureStore(root, {
      fs: {
        ...nodeStoreFs,
        rename: async (from, to) => {
          if (disk.hold === "rename" && path.basename(to) === "capture.json") {
            await holdHere();
          }

          if (disk.backupLocked && path.basename(to) === "capture.json.prev") {
            throw Object.assign(new Error("locked"), { code: "EPERM" });
          }

          await nodeStoreFs.rename(from, to);
        },
        writeFileDurable: async (target, data) => {
          if (target.includes(ID)) {
            disk.writes.push(String(data));
          }

          if (disk.hold === "write") {
            await holdHere();
          } else if (disk.full) {
            throw Object.assign(new Error("full"), { code: "ENOSPC" });
          }

          await nodeStoreFs.writeFileDurable(target, data);
        },
      },
      retryDelaysMs: [],
    });
    await store.publish(RECORD, PNG);
    disk.writes = [];
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it.each(["write", "rename"] as const)(
    "puts back every saved field when the discarded save is held at its %s and the disk is full afterwards",
    async (step) => {
      const drafts = openDrafts();

      disk.hold = step;
      drafts.edit(ID, DISCARDED, BASE, { now: true });
      await vi.waitFor(() => {
        expect(disk.held).toBeTruthy();
      });

      const writesBefore = disk.writes.length;

      drafts.discard(ID);

      expect(shown(drafts)).toStrictEqual(BASE);

      disk.full = true;
      disk.release();
      await settle();

      expect({
        disk: fieldsOf(await onDisk()),
        draft: drafts.get(ID),
        saved: drafts.saved(ID) ?? BASE,
        shown: shown(drafts),
        writesAfterDiscard: disk.writes.slice(writesBefore),
      }).toStrictEqual({
        disk: BASE,
        draft: undefined,
        saved: BASE,
        shown: BASE,
        writesAfterDiscard: [],
      });

      // Discard again and a new edit both start from what is saved, never from the discarded save.
      drafts.discard(ID);
      expect(shown(drafts)).toStrictEqual(BASE);
    }
  );

  it("puts back what is saved when an edit typed behind the held save is discarded too", async () => {
    const drafts = openDrafts();

    disk.hold = "rename";
    drafts.edit(ID, DISCARDED, BASE, { now: true });
    await vi.waitFor(() => {
      expect(disk.held).toBeTruthy();
    });
    drafts.edit(ID, { ...DISCARDED, title: "Typed behind it" }, BASE);

    const writesBefore = disk.writes.length;

    drafts.discard(ID);
    disk.full = true;
    disk.release();
    await settle();

    expect({
      disk: fieldsOf(await onDisk()),
      shown: shown(drafts),
      writesAfterDiscard: disk.writes.slice(writesBefore),
    }).toStrictEqual({ disk: BASE, shown: BASE, writesAfterDiscard: [] });
  });

  it("shows and builds on what was saved before a discarded save, even once the capture reloaded with the discarded save", async () => {
    const answers = holdAnswers();

    const drafts = new DraftStore({
      discard: async ({ id, tag }) => toAction(await store.discard(id, tag)),
      update: async ({ fields, id, tag }) => {
        const result = toAction(await store.update(id, fields, tag));

        await answers.held;

        return result;
      },
    });

    drafts.edit(ID, DISCARDED, BASE, { now: true });
    await vi.waitFor(async () => {
      const written = await onDisk();

      expect(written.title).toBe(DISCARDED.title);
    });

    const stored = store.get(ID);
    const reloaded = stored?.kind === "ok" ? fieldsOf(stored.record) : BASE;

    drafts.discard(ID);
    await settle();

    const atOnce = drafts.get(ID)?.values ?? drafts.saved(ID) ?? reloaded;

    drafts.edit(ID, { ...atOnce, description: "A new description" }, reloaded, {
      now: true,
    });
    await settle();
    answers.release();
    await settle();

    expect({
      atOnce,
      disk: fieldsOf(await onDisk()),
      reloaded: reloaded.title,
    }).toStrictEqual({
      atOnce: BASE,
      disk: { ...BASE, description: "A new description" },
      reloaded: DISCARDED.title,
    });
  });

  it("says Discard couldn't undo the save, and keeps the capture done, when its backup couldn't take the Mark as done", async () => {
    const answers = holdAnswers();
    const said: string[] = [];

    const drafts = new DraftStore({
      discard: async ({ id, tag }) => toAction(await store.discard(id, tag)),
      update: async ({ fields, id, tag }) => {
        const result = toAction(await store.update(id, fields, tag));

        await answers.held;

        return result;
      },
    });

    drafts.onUndoFailed((message) => {
      said.push(message);
    });
    drafts.edit(ID, DISCARDED, BASE, { now: true });
    await vi.waitFor(async () => {
      const written = await onDisk();

      expect(written.title).toBe(DISCARDED.title);
    });
    disk.backupLocked = true;

    const done = await store.setDone(ID, true);

    drafts.discard(ID);
    await settle();
    answers.release();
    await settle();

    const after = await onDisk();

    expect({
      disk: [after.title, after.status.kind],
      done: done.ok,
      said,
      saved: drafts.saved(ID),
    }).toStrictEqual({
      disk: [DISCARDED.title, "done"],
      done: true,
      said: ["Inset can’t write to its data folder."],
      saved: undefined,
    });
  });

  it("keeps a save the library already confirmed when only the edit after it is discarded", async () => {
    const drafts = openDrafts();
    const confirmed = { ...BASE, title: "Confirmed title" };

    drafts.edit(ID, confirmed, BASE, { now: true });
    await expect(drafts.retry(ID)).resolves.toStrictEqual({ ok: true });

    drafts.edit(ID, { ...confirmed, title: "Not sent yet" }, BASE);
    drafts.discard(ID);
    await settle();

    expect({
      disk: fieldsOf(await onDisk()),
      shown: shown(drafts),
    }).toStrictEqual({ disk: confirmed, shown: confirmed });
  });

  it("keeps a failed Due change as a draft with its error, and Discard puts the saved Due back", async () => {
    const drafts = openDrafts();
    const due = DueDateSchema.parse("2026-12-24");

    disk.full = true;
    drafts.edit(ID, { ...BASE, due }, BASE, { now: true });
    await vi.waitFor(() => {
      expect(drafts.get(ID)?.kind).toBe("failed");
    });

    expect([drafts.get(ID)?.values.due, drafts.get(ID)?.error]).toStrictEqual([
      due,
      "The disk is full.",
    ]);

    drafts.discard(ID);
    await settle();

    expect({
      disk: fieldsOf(await onDisk()).due,
      shown: shown(drafts).due,
    }).toStrictEqual({ disk: BASE.due, shown: BASE.due });
  });
});
