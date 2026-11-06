import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { CaptureIdSchema, CaptureRecordSchema } from "@shared/capture-record";
import type { CaptureRecord, EditableFields } from "@shared/capture-record";
import type { ActionResult } from "@shared/contracts";
import { DueDateSchema } from "@shared/due";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DraftStore, SAVE_AFTER_MS } from "../renderer/library/drafts";
import { createLeaveHold } from "../renderer/library/leave-hold";
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
  /** Renaming capture.json.prev back into place fails, as a lock on it would. */
  restoreLocked: boolean;
  /** Renaming a temp file into capture.json fails, as a lock on capture.json would. */
  installLocked: boolean;
  /** Writing the discard marker fails, as a full disk would. */
  markerFull: boolean;
  held: boolean;
  release: () => void;
  /** Content writes into the capture's folder, in order. */
  writes: string[];
}

const disk: Disk = {
  backupLocked: false,
  installLocked: false,
  markerFull: false,
  restoreLocked: false,
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

/** The writes that carry content: the discard marker is empty. */
const contentOf = (writes: readonly string[]): string[] =>
  writes.filter((data) => data !== "");

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

/** A save main wrote but hasn't answered yet. */
const landed = async () => {
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

  return { answers, drafts };
};

/** A save main wrote but hasn't answered, and a Discard of it that can't rename capture.json.prev back. */
const stranded = async () => {
  const { answers, drafts } = await landed();

  disk.restoreLocked = true;
  drafts.discard(ID);
  await vi.waitFor(() => {
    expect(drafts.get(ID)).toBeDefined();
  });

  return { answers, drafts };
};

/** What a start after a quit or a crash right now finds. */
const restartedRecord = async (): Promise<CaptureRecord | null> => {
  const copy = await mkdtemp(path.join(tmpdir(), "inset-discard-restart-"));

  await cp(root, copy, { recursive: true });

  const started = await openCaptureStore(copy);
  const entry = started.get(ID);

  return entry?.kind === "ok" ? entry.record : null;
};

/** The title a start after a quit or a crash right now finds. */
const restarted = async (): Promise<string> => {
  const record = await restartedRecord();

  return record?.title ?? "gone";
};

describe("Discard changes never writes content to undo a save (SPEC round 8)", () => {
  beforeEach(async () => {
    disk.hold = null;
    disk.backupLocked = false;
    disk.installLocked = false;
    disk.markerFull = false;
    disk.restoreLocked = false;
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

          if (
            disk.installLocked &&
            from.endsWith(".tmp") &&
            path.basename(to) === "capture.json"
          ) {
            throw Object.assign(new Error("locked"), { code: "EPERM" });
          }

          if (disk.backupLocked && path.basename(to) === "capture.json.prev") {
            throw Object.assign(new Error("locked"), { code: "EPERM" });
          }

          if (
            disk.restoreLocked &&
            path.basename(from) === "capture.json.prev" &&
            path.basename(to) === "capture.json"
          ) {
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
          } else if (
            disk.full ||
            (disk.markerFull && target.endsWith("capture.json.discard"))
          ) {
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
        writesAfterDiscard: contentOf(disk.writes.slice(writesBefore)),
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
      writesAfterDiscard: contentOf(disk.writes.slice(writesBefore)),
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

  it("fails a Mark as done whose backup can't take it, so Discard still puts back every saved field", async () => {
    const { answers, drafts } = await landed();

    disk.backupLocked = true;

    const done = await store.setDone(ID, true);

    disk.backupLocked = false;
    drafts.discard(ID);
    await settle();
    answers.release();
    await settle();

    const after = await onDisk();

    expect({
      disk: [fieldsOf(after), after.status.kind],
      done,
      draft: drafts.get(ID),
      shown: shown(drafts),
    }).toStrictEqual({
      disk: [BASE, "active"],
      done: {
        error: "writeFailed",
        message: "Inset can’t write to its data folder.",
        ok: false,
      },
      draft: undefined,
      shown: BASE,
    });
  });

  it("leaves the backup as it was when a Mark as done can't replace capture.json, so Discard puts back the status too", async () => {
    const { answers, drafts } = await landed();

    disk.installLocked = true;

    const done = await store.setDone(ID, true);

    disk.installLocked = false;
    drafts.discard(ID);
    await settle();
    answers.release();
    await settle();

    const after = await onDisk();
    const reopened = await restartedRecord();

    expect({
      disk: [fieldsOf(after), after.status.kind],
      done: done.ok,
      restart: [reopened?.title, reopened?.status.kind],
      shown: shown(drafts),
    }).toStrictEqual({
      disk: [BASE, "active"],
      done: false,
      restart: [BASE.title, "active"],
      shown: BASE,
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
      { during: "save", message: "The disk is full." },
    ]);

    drafts.discard(ID);
    await settle();

    expect({
      disk: fieldsOf(await onDisk()).due,
      shown: shown(drafts).due,
    }).toStrictEqual({ disk: BASE.due, shown: BASE.due });
  });

  describe("when Discard can't put the saved version back", () => {
    it("stays a failed draft with Keep changes and Discard again, refuses copies, and the next start puts the saved version back", async () => {
      const { answers, drafts } = await stranded();

      answers.release();
      await settle();

      const written = await onDisk();

      expect({
        copy: await drafts.settle(ID),
        disk: written.title,
        draft: drafts.get(ID)?.kind,
        error: drafts.get(ID)?.error,
        restart: await restarted(),
        shown: shown(drafts).title,
        unsaved: drafts.unsaved(),
      }).toStrictEqual({
        copy: {
          during: "discard",
          message: "Inset can’t write to its data folder.",
          ok: false,
        },
        disk: DISCARDED.title,
        draft: "failed",
        error: {
          during: "discard",
          message: "Inset can’t write to its data folder.",
        },
        restart: BASE.title,
        shown: DISCARDED.title,
        unsaved: {
          count: 1,
          error: "Inset can’t write to its data folder.",
          pending: false,
          undiscarded: true,
        },
      });
    });

    it("puts back the version saved before it on Discard again, through more typing and a Keep changes caught on its way", async () => {
      const { answers, drafts } = await stranded();

      disk.restoreLocked = false;
      drafts.edit(ID, { ...DISCARDED, title: "Typed on" }, BASE, { now: true });
      void drafts.retry(ID);
      await vi.waitFor(async () => {
        const written = await onDisk();

        expect(written.title).toBe("Typed on");
      });
      drafts.discard(ID);
      answers.release();
      await settle();

      expect({
        disk: fieldsOf(await onDisk()),
        draft: drafts.get(ID),
        restart: await restarted(),
        shown: shown(drafts),
      }).toStrictEqual({
        disk: BASE,
        draft: undefined,
        restart: BASE.title,
        shown: BASE,
      });
    });

    it("keeps the discarded changes on Keep changes, and so does the next start", async () => {
      const { answers, drafts } = await stranded();

      answers.release();
      await settle();
      disk.restoreLocked = false;

      const retried = await drafts.retry(ID);

      await settle();

      expect({
        disk: fieldsOf(await onDisk()),
        draft: drafts.get(ID),
        restart: await restarted(),
        retried,
      }).toStrictEqual({
        disk: DISCARDED,
        draft: undefined,
        restart: DISCARDED.title,
        retried: { ok: true },
      });
    });

    it("leaves it to the user before a close or a quit: nothing is saved, and the prompt says why", async () => {
      const { answers, drafts } = await stranded();

      answers.release();
      await settle();

      const writes = disk.writes.length;
      const outcome = await drafts.settleAll(200);

      expect({
        outcome,
        unsaved: drafts.unsaved()?.error,
        writes: disk.writes.length - writes,
      }).toStrictEqual({
        outcome: "settled",
        unsaved: "Inset can’t write to its data folder.",
        writes: 0,
      });
    });

    it("stays failed through more typing: nothing is saved on its own, a close asks, copies are refused, and Discard again still puts the saved version back", async () => {
      const { answers, drafts } = await stranded();

      answers.release();
      await settle();

      const writes = disk.writes.length;
      const heard: string[] = [];

      const hold = createLeaveHold({
        drafts,
        resume: () => {
          heard.push("resume");
        },
        shown: () => {
          heard.push("shown");
        },
      });

      drafts.edit(ID, { ...DISCARDED, description: "Typed after" }, BASE);

      const asked = hold.ask("quit");

      await delay(SAVE_AFTER_MS + 100);
      await settle();

      const typedOn = {
        asked,
        copy: await drafts.settle(ID),
        draft: [drafts.get(ID)?.kind, drafts.get(ID)?.error?.during],
        heard: [...heard],
        prompt: hold.get(),
        restart: await restarted(),
        writes: contentOf(disk.writes.slice(writes)),
      };

      hold.cancel();
      disk.restoreLocked = false;
      drafts.discard(ID);
      await settle();

      expect({
        disk: fieldsOf(await onDisk()),
        draft: drafts.get(ID),
        typedOn,
      }).toStrictEqual({
        disk: BASE,
        draft: undefined,
        typedOn: {
          asked: {
            message: "The library holds this to save or ask first.",
            ok: false,
          },
          copy: {
            during: "discard",
            message: "Inset can’t write to its data folder.",
            ok: false,
          },
          draft: ["failed", "discard"],
          heard: ["shown"],
          prompt: {
            count: 1,
            leaving: "quit",
            message: "Inset can’t write to its data folder.",
            undiscarded: true,
          },
          restart: BASE.title,
          writes: [],
        },
      });
    });

    it("puts its marker down again on the next Discard after a full disk refused it, and holds a quit until Discard again in the prompt finishes", async () => {
      disk.markerFull = true;

      const { answers, drafts } = await stranded();

      disk.markerFull = false;
      answers.release();
      await settle();

      const heard: string[] = [];

      const hold = createLeaveHold({
        drafts,
        resume: () => {
          heard.push("resume");
        },
        shown: () => {
          heard.push("shown");
        },
      });

      hold.ask("quit");
      await vi.waitFor(() => {
        expect(hold.get()?.undiscarded).toBeTruthy();
      });
      hold.discard();
      await settle();

      const stillLocked = {
        draft: drafts.get(ID)?.error,
        heard: [...heard],
        prompt: hold.get()?.undiscarded,
        restart: await restarted(),
      };

      disk.restoreLocked = false;
      hold.discard();
      await settle();

      expect({
        disk: fieldsOf(await onDisk()),
        heard,
        restart: await restarted(),
        stillLocked,
        unsaved: drafts.unsaved(),
      }).toStrictEqual({
        disk: BASE,
        heard: ["shown", "resume"],
        restart: BASE.title,
        stillLocked: {
          draft: {
            during: "discard",
            message: "Inset can’t write to its data folder.",
          },
          heard: ["shown"],
          prompt: true,
          restart: BASE.title,
        },
        unsaved: null,
      });
    });
  });
});
