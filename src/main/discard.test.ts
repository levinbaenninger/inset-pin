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
import { openLibrary } from "../renderer/library/opening";
import { createCopyGate } from "./copy-gate";
import type { ClipboardWriter } from "./copy-gate";
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
  /** Holds the next content write, the next rename into capture.json, or the next removal of the discard marker. */
  hold: "write" | "rename" | "unmark" | null;
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

/** A save that failed, then the banner's Retry, which main wrote but hasn't answered. */
const retriedAndLanded = async () => {
  const answers = holdAnswers();

  const drafts = new DraftStore({
    discard: async ({ id, tag }) => toAction(await store.discard(id, tag)),
    update: async ({ fields, id, tag }) => {
      const result = toAction(await store.update(id, fields, tag));

      if (result.ok) {
        await answers.held;
      }

      return result;
    },
  });

  disk.full = true;
  drafts.edit(ID, DISCARDED, BASE, { now: true });
  await vi.waitFor(() => {
    expect(drafts.get(ID)?.kind).toBe("failed");
  });
  disk.full = false;
  void drafts.retry(ID);
  await vi.waitFor(async () => {
    const written = await onDisk();

    expect(written.title).toBe(DISCARDED.title);
  });

  return { answers, drafts };
};

/** Whether the wait ends within a moment. */
const within = async (wait: Promise<void>): Promise<boolean> =>
  await Promise.race([
    (async () => {
      await wait;

      return true;
    })(),
    (async () => {
      await delay(200);

      return false;
    })(),
  ]);

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

/** Discard and close lets the window go while main can't put the saved version back. */
const closedWhileOwed = async (): Promise<void> => {
  const { answers, drafts } = await landed();
  const heard: string[] = [];

  const hold = createLeaveHold({
    drafts,
    resume: () => {
      heard.push("resume");
    },
    shown: nothing,
  });

  disk.restoreLocked = true;
  hold.ask("close");
  hold.discard();
  answers.release();
  await settle();

  expect(heard).toStrictEqual(["resume"]);
};

/** A library opened after that hears the Discard is owed, as its page does. */
const reopenedWhileOwed = async (): Promise<DraftStore> => {
  await closedWhileOwed();

  const fresh = openDrafts();

  fresh.owe(store.owed());

  return fresh;
};

/** Discard and close lets the window go while main's rename of the saved version back is held on the disk. */
const closedWhileRestoring = async () => {
  const { answers, drafts } = await landed();
  const heard: string[] = [];

  const hold = createLeaveHold({
    drafts,
    resume: () => {
      heard.push("resume");
    },
    shown: nothing,
  });

  disk.hold = "rename";
  hold.ask("close");
  hold.discard();
  await vi.waitFor(() => {
    expect(disk.held).toBeTruthy();
  });

  expect(heard).toStrictEqual(["resume"]);

  return answers;
};

/** A clipboard that records what is put on it. */
const recording = (pasted: string[]): ClipboardWriter => ({
  writeImage: async () => {
    pasted.push("image");
    await Promise.resolve();
  },
  writeText: async (text) => {
    pasted.push(text);
    await Promise.resolve();
  },
});

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
        rm: async (target) => {
          if (
            disk.hold === "unmark" &&
            path.basename(target) === "capture.json.discard"
          ) {
            await holdHere();
          }

          await nodeStoreFs.rm(target);
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

  it("retries the failed draft after installing an edit and rolling back both fail", async () => {
    const drafts = openDrafts();

    disk.installLocked = true;
    disk.restoreLocked = true;
    drafts.edit(ID, DISCARDED, BASE, { now: true });
    await vi.waitFor(() => {
      expect(drafts.get(ID)?.kind).toBe("failed");
    });
    expect(shown(drafts)).toStrictEqual(DISCARDED);
    await expect(onDisk()).rejects.toMatchObject({ code: "ENOENT" });

    disk.installLocked = false;
    disk.restoreLocked = false;

    await expect(drafts.retry(ID)).resolves.toStrictEqual({ ok: true });
    expect({
      disk: fieldsOf(await onDisk()),
      draft: drafts.get(ID),
      owed: store.owed(),
      shown: shown(drafts),
    }).toStrictEqual({
      disk: DISCARDED,
      draft: undefined,
      owed: [],
      shown: DISCARDED,
    });
  });

  it("discards owed recovery after installing an edit and rolling back both fail", async () => {
    disk.installLocked = true;
    disk.restoreLocked = true;
    await expect(
      store.update(ID, DISCARDED, { epoch: "page.1", seq: 1 })
    ).resolves.toMatchObject({ ok: false });

    const fresh = openDrafts();

    fresh.owe(store.owed());
    expect(fresh.get(ID)?.error?.during).toBe("discard");

    const writes = disk.writes.length;

    disk.installLocked = false;
    disk.restoreLocked = false;
    fresh.discard(ID);
    await settle();

    expect({
      disk: fieldsOf(await onDisk()),
      draft: fresh.get(ID),
      owed: store.owed(),
      shown: shown(fresh),
      writes: contentOf(disk.writes.slice(writes)),
    }).toStrictEqual({
      disk: BASE,
      draft: undefined,
      owed: [],
      shown: BASE,
      writes: [],
    });
  });

  it("copies what the capture showed as each copy started while a Discard is on its way, never typing done during the wait", async () => {
    const { answers, drafts } = await landed();
    const pasted: string[] = [];

    const copy = createCopyGate({
      clipboard: recording(pasted),
      pinnedImage: () => ({ png: Buffer.from(PNG) }),
      saveEdits: async (id) => await drafts.settle(id),
      store,
    });

    disk.hold = "rename";
    drafts.discard(ID);
    await vi.waitFor(() => {
      expect(disk.held).toBeTruthy();
    });

    const first = copy(ID, "text");

    drafts.edit(ID, { ...BASE, title: "Typed after the first copy" }, BASE, {
      now: true,
    });

    const second = copy(ID, "text");

    drafts.edit(ID, { ...BASE, title: "Typed after the second copy" }, BASE, {
      now: true,
    });
    disk.release();
    answers.release();
    await settle();

    const written = await onDisk();

    expect({
      copied: [await first, await second],
      disk: written.title,
      pasted,
    }).toStrictEqual({
      copied: [{ ok: true }, { ok: true }],
      disk: "Typed after the second copy",
      pasted: [
        "Saved title\n\nSaved description",
        "Typed after the first copy\n\nSaved description",
      ],
    });
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
            asks: "keep",
          },
          restart: BASE.title,
          writes: [],
        },
      });
    });

    it("holds a close during a first Discard main hasn't answered, and asks once it fails, so the discarded changes never read as saved", async () => {
      const drafts = openDrafts();
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

      disk.full = true;
      drafts.edit(ID, DISCARDED, BASE, { now: true });
      await vi.waitFor(() => {
        expect(drafts.get(ID)?.kind).toBe("failed");
      });
      disk.full = false;
      disk.hold = "rename";
      void drafts.retry(ID);
      await vi.waitFor(() => {
        expect(disk.held).toBeTruthy();
      });
      disk.restoreLocked = true;
      drafts.discard(ID);

      const asked = hold.ask("close");
      const atClose = { heard: [...heard], unsaved: drafts.unsaved()?.count };

      disk.release();
      await settle();
      await vi.waitFor(() => {
        expect(heard).toStrictEqual(["shown"]);
      });

      const draft = drafts.get(ID);

      expect({
        asked,
        atClose,
        copy: await drafts.settle(ID),
        draft: draft === undefined ? null : [draft.kind, draft.error],
        prompt: hold.get(),
        restart: await restarted(),
        shown: shown(drafts).title,
      }).toStrictEqual({
        asked: {
          message: "The library holds this to save or ask first.",
          ok: false,
        },
        atClose: { heard: [], unsaved: 1 },
        copy: {
          during: "discard",
          message: "Inset can’t write to its data folder.",
          ok: false,
        },
        draft: [
          "failed",
          {
            during: "discard",
            message: "Inset can’t write to its data folder.",
          },
        ],
        prompt: {
          count: 1,
          leaving: "close",
          message: "Inset can’t write to its data folder.",
          asks: "keep",
        },
        restart: BASE.title,
        shown: DISCARDED.title,
      });
    });

    it("sends none of the typing done while a first Discard is on its way: a quit waits, a copy waits and is refused, and the typing comes back failed with the Discard", async () => {
      const { answers, drafts } = await landed();
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

      disk.hold = "rename";
      disk.restoreLocked = true;
      drafts.discard(ID);
      await vi.waitFor(() => {
        expect(disk.held).toBeTruthy();
      });

      const writes = disk.writes.length;
      const pending = { asked: hold.ask("quit"), unsaved: drafts.unsaved() };
      const copying = drafts.settle(ID);
      const typed = { ...BASE, title: "Typed while it was discarded" };

      drafts.edit(ID, typed, BASE, { now: true });
      answers.release();
      disk.release();
      await settle();
      await vi.waitFor(() => {
        expect(heard).toStrictEqual(["shown"]);
      });

      const draft = drafts.get(ID);
      const written = await onDisk();

      expect({
        copy: await copying,
        disk: written.title,
        draft:
          draft === undefined
            ? null
            : {
                confirmed: draft.confirmed,
                error: draft.error,
                kind: draft.kind,
                values: draft.values,
              },
        pending,
        prompt: hold.get()?.asks,
        restart: await restarted(),
        writes: contentOf(disk.writes.slice(writes)),
      }).toStrictEqual({
        copy: {
          during: "discard",
          message: "Inset can’t write to its data folder.",
          ok: false,
        },
        disk: DISCARDED.title,
        draft: {
          confirmed: BASE,
          error: {
            during: "discard",
            message: "Inset can’t write to its data folder.",
          },
          kind: "failed",
          values: typed,
        },
        pending: {
          asked: {
            message: "The library holds this to save or ask first.",
            ok: false,
          },
          unsaved: {
            count: 1,
            error: null,
            pending: true,
            undiscarded: true,
          },
        },
        prompt: "keep",
        restart: BASE.title,
        writes: [],
      });
    });

    describe("and the library opens again while main still owes it", () => {
      it("opens failed, refuses copies, saves nothing through more typing, and Discard again puts the saved version back", async () => {
        const drafts = await reopenedWhileOwed();
        const draft = drafts.get(ID);

        const opened = {
          copy: await drafts.settle(ID),
          draft:
            draft === undefined
              ? null
              : {
                  confirmed: draft.confirmed,
                  error: draft.error,
                  kind: draft.kind,
                  values: draft.values,
                },
          unsaved: drafts.unsaved(),
        };

        const writes = disk.writes.length;

        drafts.edit(
          ID,
          { ...DISCARDED, description: "Typed after reopening" },
          DISCARDED
        );
        await delay(SAVE_AFTER_MS + 100);
        await settle();

        const typed = {
          draft: drafts.get(ID)?.error?.during,
          writes: contentOf(disk.writes.slice(writes)),
        };

        disk.restoreLocked = false;
        drafts.discard(ID);
        await settle();

        expect({
          disk: fieldsOf(await onDisk()),
          draft: drafts.get(ID),
          opened,
          owed: store.owed(),
          restart: await restarted(),
          shown: shown(drafts),
          typed,
        }).toStrictEqual({
          disk: BASE,
          draft: undefined,
          opened: {
            copy: {
              during: "discard",
              message: "Inset can’t write to its data folder.",
              ok: false,
            },
            draft: {
              confirmed: BASE,
              error: {
                during: "discard",
                message: "Inset can’t write to its data folder.",
              },
              kind: "failed",
              values: DISCARDED,
            },
            unsaved: {
              count: 1,
              error: "Inset can’t write to its data folder.",
              pending: false,
              undiscarded: true,
            },
          },
          owed: [],
          restart: BASE.title,
          shown: BASE,
          typed: { draft: "discard", writes: [] },
        });
      });

      it("stays closed and reports nothing while its lookup of what main owes fails, then opens it failed, so an unrelated edit can't clear the Discard", async () => {
        await closedWhileOwed();
        vi.spyOn(console, "error").mockImplementation(nothing);

        const drafts = openDrafts();
        const counts: number[] = [];
        const seen: string[] = [];
        let asked = 0;

        const opening = openLibrary({
          drafts,
          owed: async () => {
            asked += 1;

            if (asked === 1) {
              throw new Error("The IPC channel closed.");
            }

            return await Promise.resolve(store.owed());
          },
          report: (count) => {
            counts.push(count);
          },
        });

        /** What main had heard, and what the capture held, as the page went unread. */
        const unread: unknown[] = [];

        opening.subscribe(() => {
          seen.push(opening.get());

          if (opening.get() === "unread") {
            unread.push({ counts: [...counts], shown: drafts.get(ID) });
          }
        });
        await opening.opened;

        const writes = disk.writes.length;

        drafts.edit(
          ID,
          { ...DISCARDED, description: "Unrelated edit after reopening" },
          DISCARDED,
          { now: true }
        );
        await delay(SAVE_AFTER_MS + 100);
        await settle();
        vi.restoreAllMocks();

        expect({
          counts,
          marker: await readFile(
            path.join(root, ID, "capture.json.discard"),
            "utf-8"
          ).then(
            () => true,
            () => false
          ),
          owed: store.owed().map((one) => one.message),
          restart: await restarted(),
          seen,
          unread,
          writes: contentOf(disk.writes.slice(writes)),
        }).toStrictEqual({
          counts: [1],
          marker: true,
          owed: ["Inset can’t write to its data folder."],
          restart: BASE.title,
          seen: ["unread", "open"],
          unread: [{ counts: [], shown: undefined }],
          writes: [],
        });
      }, 10_000);

      it("refuses a copy made with no library page open, as Float on Top makes, until the library settles it", async () => {
        await closedWhileOwed();

        const pasted: string[] = [];

        const copy = createCopyGate({
          clipboard: {
            writeImage: async () => {
              pasted.push("image");
              await Promise.resolve();
            },
            writeText: async (text) => {
              pasted.push(text);
              await Promise.resolve();
            },
          },
          pinnedImage: () => ({ png: Buffer.from(PNG) }),
          // As main's link answers while no library page is open and none reported unsaved changes.
          saveEdits: async () =>
            await Promise.resolve({ fields: null, ok: true }),
          store,
        });

        const refusal = {
          message:
            "Couldn’t discard your changes, so nothing was copied. Inset can’t write to its data folder.",
          ok: false,
          retry: false,
        };

        const refused = [await copy(ID, "text"), await copy(ID, "image")];

        expect({ pasted: [...pasted], refused }).toStrictEqual({
          pasted: [],
          refused: [refusal, refusal],
        });

        const drafts = openDrafts();

        drafts.owe(store.owed());
        disk.restoreLocked = false;
        drafts.discard(ID);
        await settle();

        expect({
          copied: await copy(ID, "details"),
          pasted: pasted.map((text) => text.split("\n")[0]),
        }).toStrictEqual({ copied: { ok: true }, pasted: [BASE.title] });
      });

      it("holds a first Discard main is still putting back once the page's wait for it runs out, and shows it failed when main can't", async () => {
        const answers = await closedWhileRestoring();
        const fresh = openDrafts();

        // What main's owedDiscards answers once its wait for the held rename runs out.
        fresh.owe(store.owed());

        const opened = {
          draft: fresh.get(ID),
          shown: shown(fresh),
          unsaved: fresh.unsaved(),
        };

        disk.restoreLocked = true;
        disk.release();
        answers.release();
        await settle();

        const draft = fresh.get(ID);

        const failed =
          draft === undefined
            ? null
            : {
                confirmed: draft.confirmed,
                error: draft.error,
                kind: draft.kind,
                values: draft.values,
              };

        const writes = disk.writes.length;

        fresh.edit(
          ID,
          { ...DISCARDED, description: "Typed after reopening" },
          DISCARDED
        );
        await delay(SAVE_AFTER_MS + 100);
        await settle();

        expect({
          failed,
          opened,
          owed: store.owed().map(({ id, message }) => ({ id, message })),
          restart: await restarted(),
          writes: contentOf(disk.writes.slice(writes)),
        }).toStrictEqual({
          failed: {
            confirmed: BASE,
            error: {
              during: "discard",
              message: "Inset can’t write to its data folder.",
            },
            kind: "failed",
            values: DISCARDED,
          },
          opened: {
            draft: undefined,
            shown: BASE,
            unsaved: {
              count: 1,
              error: null,
              pending: true,
              undiscarded: true,
            },
          },
          owed: [{ id: ID, message: "Inset can’t write to its data folder." }],
          restart: BASE.title,
          writes: [],
        });
      });

      it("refuses a Float on Top copy with no library page open while main is still putting the saved version back", async () => {
        const answers = await closedWhileRestoring();
        const pasted: string[] = [];

        const copy = createCopyGate({
          clipboard: recording(pasted),
          pinnedImage: () => ({ png: Buffer.from(PNG) }),
          // As main's link answers while no library page is open and none reported unsaved changes.
          saveEdits: async () =>
            await Promise.resolve({ fields: null, ok: true }),
          store,
        });

        const refusal = {
          message:
            "Couldn’t discard your changes, so nothing was copied. Inset is still putting the earlier version back.",
          ok: false,
          retry: false,
        };

        const refused = [await copy(ID, "text"), await copy(ID, "image")];
        const whileOwed = [...pasted];

        disk.release();
        answers.release();
        await settle();

        expect({
          copied: await copy(ID, "text"),
          pasted,
          refused,
          whileOwed,
        }).toStrictEqual({
          copied: { ok: true },
          pasted: ["Saved title\n\nSaved description"],
          refused: [refusal, refusal],
          whileOwed: [],
        });
      });

      it("keeps the discarded changes on Keep changes, and so does the next start", async () => {
        const drafts = await reopenedWhileOwed();
        const kept = await drafts.retry(ID);

        await settle();

        expect({
          disk: fieldsOf(await onDisk()),
          draft: drafts.get(ID),
          kept,
          owed: store.owed(),
          restart: await restarted(),
        }).toStrictEqual({
          disk: DISCARDED,
          draft: undefined,
          kept: { ok: true },
          owed: [],
          restart: DISCARDED.title,
        });
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
        expect(hold.get()?.asks).toBe("keep");
      });
      hold.discard();
      await settle();

      const stillLocked = {
        draft: drafts.get(ID)?.error,
        heard: [...heard],
        prompt: hold.get()?.asks,
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
          prompt: "keep",
          restart: BASE.title,
        },
        unsaved: null,
      });
    });
  });

  describe("when main doesn't answer a Discard within the limit (SPEC round 10)", () => {
    it("offers Wait and Close anyway for a first Discard whose restore is held, leaves on Close anyway, and the next start puts the saved version back", async () => {
      const { answers, drafts } = await retriedAndLanded();
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

      disk.hold = "rename";
      drafts.discard(ID);
      await vi.waitFor(() => {
        expect(disk.held).toBeTruthy();
      });

      const asked = hold.ask("close");

      await vi.waitFor(
        () => {
          expect(heard).toStrictEqual(["shown"]);
        },
        { timeout: 4000 }
      );

      const prompt = hold.get();

      hold.discard();

      const left = {
        heard: [...heard],
        owed: store.owed().map(({ id, message }) => ({ id, message })),
        restart: await restarted(),
      };

      disk.release();
      answers.release();
      await settle();

      expect({
        asked,
        later: { disk: fieldsOf(await onDisk()), owed: store.owed() },
        left,
        prompt,
      }).toStrictEqual({
        asked: {
          message: "The library holds this to save or ask first.",
          ok: false,
        },
        later: { disk: BASE, owed: [] },
        left: {
          heard: ["shown", "resume"],
          owed: [{ id: ID, message: null }],
          restart: BASE.title,
        },
        prompt: {
          asks: "wait",
          count: 1,
          leaving: "close",
          message:
            "Inset is still putting the earlier version back. Close anyway lets it finish on its own.",
        },
      });
    }, 10_000);

    it("lets a quit go on once the Discard's marker is down, while its restore is still held, but not while the marker is being written", async () => {
      const { answers, drafts } = await landed();

      disk.hold = "write";
      drafts.discard(ID);
      await vi.waitFor(() => {
        expect(disk.held).toBeTruthy();
      });

      const markerHeld = await within(store.durable());

      disk.held = false;
      disk.hold = "rename";
      disk.release();
      await vi.waitFor(() => {
        expect(disk.held).toBeTruthy();
      });

      const restoreHeld = {
        durable: await within(store.durable()),
        restart: await restarted(),
        settled: await within(store.settled()),
      };

      disk.release();
      answers.release();
      await settle();

      expect({
        later: await within(store.durable()),
        markerHeld,
        restoreHeld,
      }).toStrictEqual({
        later: true,
        markerHeld: false,
        restoreHeld: { durable: true, restart: BASE.title, settled: false },
      });
    });

    it("lets a quit go on when a reopened library asks again for a Discard whose marker is down and whose restore is held", async () => {
      const { answers, drafts } = await landed();
      const askedAgain: string[] = [];

      disk.hold = "rename";
      drafts.discard(ID);
      await vi.waitFor(() => {
        expect(disk.held).toBeTruthy();
      });

      const reopened = new DraftStore({
        discard: async ({ id, tag }) => {
          askedAgain.push(id);

          return toAction(await store.discard(id, tag));
        },
        update: async ({ fields, id, tag }) =>
          toAction(await store.update(id, fields, tag)),
      });

      reopened.owe(store.owed());
      await vi.waitFor(() => {
        expect(askedAgain).toStrictEqual([ID]);
      });

      const restoreHeld = {
        durable: await within(store.durable()),
        restart: await restarted(),
        settled: await within(store.settled()),
      };

      disk.release();
      answers.release();
      await settle();

      expect({
        later: { disk: fieldsOf(await onDisk()), owed: store.owed() },
        restoreHeld,
      }).toStrictEqual({
        later: { disk: BASE, owed: [] },
        restoreHeld: { durable: true, restart: BASE.title, settled: false },
      });
    });

    it("lets a quit go on once a Discard's marker is down while the save it discards is held going into capture.json, but not before the Discard", async () => {
      const tag = { epoch: "page.1", seq: 1 };

      disk.hold = "rename";

      const saving = store.update(ID, DISCARDED, tag);

      await vi.waitFor(() => {
        expect(disk.held).toBeTruthy();
      });

      const beforeDiscard = await within(store.durable());
      const discarding = store.discard(ID, tag);

      await vi.waitFor(async () => {
        await expect(
          readFile(path.join(root, ID, "capture.json.discard"), "utf-8")
        ).resolves.toBe("");
      });

      const installHeld = {
        durable: await within(store.durable()),
        restart: await restarted(),
        settled: await within(store.settled()),
      };

      disk.release();

      const discarded = await discarding;
      const saved = await saving;
      const answered = { discard: discarded.ok, save: saved.ok };

      await settle();

      expect({
        answered,
        beforeDiscard,
        installHeld,
        later: { disk: fieldsOf(await onDisk()), owed: store.owed() },
      }).toStrictEqual({
        answered: { discard: true, save: false },
        beforeDiscard: false,
        installHeld: { durable: true, restart: BASE.title, settled: false },
        later: { disk: BASE, owed: [] },
      });
    });

    it("puts the marker down again for a Discard that arrives while Keep changes is removing it, so a quit during the restore leaves a start that puts the saved version back", async () => {
      const { answers, drafts } = await retriedAndLanded();

      disk.restoreLocked = true;
      drafts.discard(ID);
      await vi.waitFor(() => {
        expect(drafts.get(ID)?.error?.during).toBe("discard");
      });
      answers.release();
      await settle();
      disk.restoreLocked = false;

      drafts.edit(ID, { ...DISCARDED, title: "Typed during keep" }, BASE, {
        now: true,
      });
      disk.hold = "unmark";

      const keeping = drafts.retry(ID);

      await vi.waitFor(() => {
        expect(disk.held).toBeTruthy();
      });

      const releaseUnmark = disk.release;

      drafts.discard(ID);
      await delay(20);
      disk.held = false;
      disk.hold = "rename";
      releaseUnmark();
      await vi.waitFor(() => {
        expect(disk.held).toBeTruthy();
      });

      const restoreHeld = {
        durable: await within(store.durable()),
        marker: await readFile(
          path.join(root, ID, "capture.json.discard"),
          "utf-8"
        ).then(
          () => true,
          () => false
        ),
        owed: store.owed().length,
        restart: await restarted(),
        shown: shown(drafts).title,
      };

      disk.release();
      await keeping;
      await settle();

      expect({
        later: { disk: fieldsOf(await onDisk()), owed: store.owed() },
        restoreHeld,
      }).toStrictEqual({
        later: { disk: BASE, owed: [] },
        restoreHeld: {
          durable: true,
          marker: true,
          owed: 1,
          restart: BASE.title,
          shown: BASE.title,
        },
      });
    });

    it("refuses a library copy main stopped waiting for while the Discard is on its way, saying the Discard isn't finished", async () => {
      const { answers, drafts } = await landed();
      const pasted: string[] = [];

      disk.hold = "rename";
      drafts.discard(ID);
      await vi.waitFor(() => {
        expect(disk.held).toBeTruthy();
      });

      const copy = createCopyGate({
        clipboard: recording(pasted),
        pinnedImage: () => ({ png: Buffer.from(PNG) }),
        // As main's link answers when the library page doesn't within the limit.
        saveEdits: async () =>
          await Promise.resolve({
            message: "Saving didn’t finish in time.",
            ok: false,
          }),
        store,
      });

      const refused = await copy(ID, "text");

      disk.release();
      answers.release();
      await settle();

      expect({ pasted, refused }).toStrictEqual({
        pasted: [],
        refused: {
          message:
            "Couldn’t discard your changes, so nothing was copied. Inset is still putting the earlier version back.",
          ok: false,
          retry: false,
        },
      });
    });
  });
});
