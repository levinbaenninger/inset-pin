import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  CaptureIdSchema,
  CaptureRecordSchema,
  parseStoredEntry,
} from "@shared/capture-record";
import type {
  CaptureId,
  CaptureRecord,
  EditableFields,
  StoredEntry,
} from "@shared/capture-record";
import type { SaveTag } from "@shared/contracts";
import { z } from "zod";

import { saveErrorText } from "./save-error";

/** Every filesystem call the store makes; tests wrap it to inject faults. */
export interface StoreFs {
  readonly mkdir: (target: string) => Promise<void>;
  readonly readdir: (target: string) => Promise<string[]>;
  readonly readFile: (target: string) => Promise<Uint8Array>;
  /** Exclusive create, then fsync. */
  readonly writeFileDurable: (
    target: string,
    data: Uint8Array | string
  ) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
  /** Recursive and forced. */
  readonly rm: (target: string) => Promise<void>;
  /** Flushes a directory's entries, so a rename into it survives a crash. */
  readonly syncDirectory: (target: string) => Promise<void>;
}

export const nodeStoreFs: StoreFs = {
  mkdir: async (target) => {
    await mkdir(target, { recursive: true });
  },
  readFile: async (target) => await readFile(target),
  readdir: async (target) => await readdir(target),
  rename: async (from, to) => {
    await rename(from, to);
  },
  rm: async (target) => {
    await rm(target, { force: true, recursive: true });
  },
  syncDirectory: async (target) => {
    // Node cannot open a directory for fsync on Windows.
    if (process.platform === "win32") {
      return;
    }

    const handle = await open(target, "r");

    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  writeFileDurable: async (target, data) => {
    const handle = await open(target, "wx");

    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
};

/** INSET_FAIL_NEXT_WRITE hook for verifying the failed-save UI. */
export const failNextWrite = (fs: StoreFs): StoreFs => {
  let armed = true;

  return {
    ...fs,
    writeFileDurable: async (target, data) => {
      if (armed) {
        armed = false;
        throw new Error("Simulated write failure (INSET_FAIL_NEXT_WRITE)");
      }

      await fs.writeFileDurable(target, data);
    },
  };
};

export type StoreError =
  | "notFound"
  | "readOnly"
  | "invalid"
  | "writeFailed"
  | "discarded";

export type StoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: StoreError;
      readonly message: string;
    };

export interface CaptureStore {
  readonly list: () => readonly StoredEntry[];
  readonly get: (id: CaptureId) => StoredEntry | undefined;
  /** Main-process only (protocol, clipboard, drag). */
  readonly imageFile: (id: CaptureId) => string | null;
  readonly publish: (
    record: CaptureRecord,
    png: Uint8Array
  ) => Promise<StoreResult<CaptureRecord>>;
  /**
   * A library save. It rewrites the record as the current version, so a v1
   * file becomes v2 on its first edit, and carries its tag, so Discard
   * changes can drop it or put back what it replaced.
   */
  readonly update: (
    id: CaptureId,
    fields: EditableFields,
    tag: SaveTag
  ) => Promise<StoreResult<CaptureRecord>>;
  /**
   * Discard changes (SPEC round 8). The tagged save's epoch ends at once, so
   * it never replaces capture.json: it is dropped before it moves the file
   * aside, puts it back if it moved it, and is undone by renaming
   * capture.json.prev back if it replaced it. A marker goes down first, so a
   * start after a crash finishes that. Only the marker is written.
   *
   * A Discard that couldn't put the saved version back stays owed, marker
   * and all: the capture's next Discard puts the marker down again if it
   * isn't, and tries again; a save keeps what it writes instead, once it
   * lands and the marker is gone.
   */
  readonly discard: (id: CaptureId, tag: SaveTag) => Promise<StoreResult<null>>;
  /**
   * The capture panel gave up a new capture whose save may still be on its
   * way. A tombstone goes down first, so a start after a crash never lists it.
   */
  readonly withdraw: (id: CaptureId) => Promise<StoreResult<null>>;
  readonly setDone: (
    id: CaptureId,
    done: boolean
  ) => Promise<StoreResult<CaptureRecord>>;
  readonly remove: (id: CaptureId) => Promise<StoreResult<null>>;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Resolves once no queued write can still change what is on disk,
   * including writes queued meanwhile. A discarded or withdrawn save that
   * will be dropped doesn't count; a marker or tombstone on its way does.
   */
  readonly settled: () => Promise<void>;
}

export interface StoreOptions {
  readonly fs?: StoreFs;
  readonly now?: () => Date;
  readonly nonce?: () => string;
  /** Windows antivirus and drag sources hold handles that make renames fail briefly. */
  readonly retryDelaysMs?: readonly number[];
}

const STAGING = ".staging";
const TRASH = ".trash";
const RECORD_FILE = "capture.json";

/** What capture.json held before the last library save, moved aside by that save. */
const PREVIOUS_FILE = "capture.json.prev";

/** Down while a Discard puts capture.json.prev back; a start after a crash finishes that. */
const MARKER_FILE = "capture.json.discard";

/** `<id>.withdrawn` beside a capture's folder: the panel gave it up, so a start removes both. */
const TOMBSTONE = ".withdrawn";
const IMAGE_FILE = "crop.png";
const RETRYABLE_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const ErrorCodeSchema = z.object({ code: z.string() });

const codeOf = (cause: unknown): string | undefined =>
  ErrorCodeSchema.safeParse(cause).data?.code;

const isRetryable = (cause: unknown): boolean =>
  RETRYABLE_CODES.has(codeOf(cause) ?? "");

const isMissing = (cause: unknown): boolean => codeOf(cause) === "ENOENT";

const failure = <T>(error: StoreError, message: string): StoreResult<T> => ({
  error,
  message,
  ok: false,
});

const success = <T>(value: T): StoreResult<T> => ({ ok: true, value });

const contentOf = (record: CaptureRecord): string =>
  JSON.stringify([
    record.title,
    record.description,
    record.steps,
    record.due,
    record.pins,
    record.image.widthPx,
    record.image.heightPx,
  ]);

/** A retry of the same draft: the times may differ, the content may not. */
const sameCapture = (a: CaptureRecord, b: CaptureRecord): boolean =>
  contentOf(a) === contentOf(b);

const newestFirst = (a: StoredEntry, b: StoredEntry): number => {
  const timeA = a.kind === "ok" ? a.record.capturedAt : "";
  const timeB = b.kind === "ok" ? b.record.capturedAt : "";

  return timeB.localeCompare(timeA) || a.id.localeCompare(b.id);
};

const decoder = new TextDecoder();

const after = async <T>(
  previous: Promise<void>,
  task: () => Promise<T>
): Promise<T> => {
  await previous;

  return await task();
};

const quietly = async <T>(run: Promise<T>): Promise<void> => {
  try {
    await run;
  } catch {
    // The caller of `run` sees the rejection; the queue only needs to continue.
  }
};

const sameSave = (a: SaveTag, b: SaveTag): boolean =>
  a.epoch === b.epoch && a.seq === b.seq;

type OkEntry = StoredEntry & { readonly kind: "ok" };

/**
 * The library save that last replaced an entry's capture.json, and the entry
 * capture.json.prev holds, which Discard changes puts back. Marked once a
 * Discard asked for that and it isn't done yet; its marker may be on disk.
 */
interface Undo {
  readonly tag: SaveTag;
  readonly previous: OkEntry;
  readonly marked: boolean;
}

/** A write in or beside the queue, and whether it can still change what is on disk. */
interface Pending {
  readonly harmless: () => boolean;
}

/** Where a save is: it can be dropped until it starts moving files into place. */
interface Progress {
  moving: boolean;
}

const DISCARDED_TEXT = "The changes were discarded.";
const WITHDRAWN_TEXT = "The capture was discarded.";

const json = (record: CaptureRecord): string => JSON.stringify(record, null, 2);

/**
 * Publishing renames a fully written staging directory, so a listed entry is
 * always complete. The cache changes only after the filesystem commit, and
 * the single-instance lock makes it authoritative.
 *
 * Every library save moves capture.json aside as capture.json.prev before it
 * renames the new file into place, so Discard changes can undo it with a
 * rename instead of writing the old content again. Whenever the discard
 * marker is on disk, capture.json.prev is exactly what Discard puts back:
 * a status change carries into it first, and a save takes the marker away
 * before it moves capture.json aside.
 */
export const openCaptureStore = async (
  root: string,
  options: StoreOptions = {}
): Promise<CaptureStore> => {
  const fs = options.fs ?? nodeStoreFs;
  const now = options.now ?? (() => new Date());
  const nonce = options.nonce ?? (() => randomBytes(6).toString("hex"));
  const retryDelaysMs = options.retryDelaysMs ?? [50, 150, 400];
  const cache = new Map<CaptureId, StoredEntry>();
  const listeners = new Set<() => void>();
  const undo = new Map<CaptureId, Undo>();
  /** Per capture, the epochs Discard changes ended. */
  const ended = new Map<CaptureId, Set<string>>();
  /** Per capture whose discard marker may be on disk: its write, true once it is down. */
  const markers = new Map<CaptureId, Promise<boolean>>();
  /** New captures the panel gave up. */
  const withdrawn = new Set<CaptureId>();
  /** Entries a start couldn't finish a Discard for: read-only until the next start tries again. */
  const stuck = new Set<string>();
  const pending = new Set<Pending>();
  const waking = new Set<() => void>();
  let tail: Promise<void> = Promise.resolve();

  const wake = (): void => {
    for (const resolve of waking) {
      resolve();
    }

    waking.clear();
  };

  /** The tail never rejects, so one failed task never blocks the next. */
  const enqueue = async <T>(
    task: () => Promise<T>,
    harmless: () => boolean = () => false
  ): Promise<T> => {
    const entry: Pending = { harmless };
    const run = after(tail, task);

    pending.add(entry);
    tail = quietly(run);

    try {
      return await run;
    } finally {
      pending.delete(entry);
      wake();
    }
  };

  /** A write that can't wait for the queue: settled() waits for it all the same. */
  const beside = async <T>(run: Promise<T>): Promise<T> => {
    const entry: Pending = { harmless: () => false };

    pending.add(entry);

    try {
      return await run;
    } finally {
      pending.delete(entry);
      wake();
    }
  };

  const isEnded = (id: CaptureId, tag: SaveTag): boolean =>
    ended.get(id)?.has(tag.epoch) ?? false;

  /** Whether a Discard naming this save still has a file to put back. */
  const owes = (id: CaptureId, tag: SaveTag): boolean => {
    const slot = undo.get(id);

    return slot !== undefined && (slot.marked || sameSave(slot.tag, tag));
  };

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const renameWithRetry = async (
    from: string,
    to: string,
    attempt = 0
  ): Promise<void> => {
    try {
      await fs.rename(from, to);
    } catch (error) {
      const wait = retryDelaysMs[attempt];

      if (wait === undefined || !isRetryable(error)) {
        throw error;
      }

      await delay(wait);
      await renameWithRetry(from, to, attempt + 1);
    }
  };

  const removeQuietly = async (target: string): Promise<void> => {
    try {
      await fs.rm(target);
    } catch {
      // Leftovers in .staging or .trash are wiped at the next open.
    }
  };

  const syncQuietly = async (dir: string): Promise<void> => {
    try {
      await fs.syncDirectory(dir);
    } catch {
      // Best effort: only the entry's survival of a power loss is at stake.
    }
  };

  /** An empty file, down for good; false when the disk refused it, and the work goes on without it. */
  const touch = async (target: string): Promise<boolean> => {
    try {
      await fs.writeFileDurable(target, "");
    } catch (error) {
      if (codeOf(error) !== "EEXIST") {
        return false;
      }
    }

    await syncQuietly(path.dirname(target));

    return true;
  };

  const fileOf = (id: string, name: string): string =>
    path.join(root, id, name);

  /** Puts the discard marker down now, ahead of the queue, unless an earlier write put it down already. */
  const mark = async (id: CaptureId): Promise<boolean> => {
    const known = markers.get(id);

    const writing = beside(
      (async () =>
        (known !== undefined && (await known)) ||
        (await touch(fileOf(id, MARKER_FILE))))()
    );

    markers.set(id, writing);

    return await writing;
  };

  /** Takes the marker away, so it can't undo a save that comes after; throws when it can't. */
  const unmark = async (id: CaptureId): Promise<void> => {
    const marking = markers.get(id);

    if (marking === undefined) {
      return;
    }

    await marking;
    await fs.rm(fileOf(id, MARKER_FILE));
    await syncQuietly(path.join(root, id));

    if (markers.get(id) === marking) {
      markers.delete(id);
    }
  };

  const readEntry = async (name: string): Promise<StoredEntry | null> => {
    const id = CaptureIdSchema.safeParse(name);

    if (!id.success) {
      return null;
    }

    const read = async (): Promise<StoredEntry | null> =>
      parseStoredEntry(
        name,
        decoder.decode(await fs.readFile(fileOf(name, RECORD_FILE)))
      );

    const unreadable: StoredEntry = {
      id: id.data,
      kind: "unreadable",
      reason: `${RECORD_FILE} could not be read`,
    };

    if (stuck.has(name)) {
      return unreadable;
    }

    try {
      return await read();
    } catch (error) {
      if (!isMissing(error)) {
        return unreadable;
      }
    }

    // Quit between moving capture.json aside and renaming the new one in: the version moved aside is the last one saved.
    try {
      await fs.rename(fileOf(name, PREVIOUS_FILE), fileOf(name, RECORD_FILE));

      return await read();
    } catch {
      return unreadable;
    }
  };

  const clearDirectory = async (dir: string): Promise<void> => {
    const children = await fs.readdir(dir);

    await Promise.all(
      children.map(async (child) => {
        await removeQuietly(path.join(dir, child));
      })
    );
  };

  /** A Discard a quit or a crash cut short: capture.json.prev goes back, then the marker. */
  const finishDiscard = async (name: string): Promise<void> => {
    try {
      await fs.rename(fileOf(name, PREVIOUS_FILE), fileOf(name, RECORD_FILE));
    } catch (error) {
      // Missing: it went back before the crash, and only the marker was left.
      if (!isMissing(error)) {
        stuck.add(name);

        return;
      }
    }

    try {
      await fs.rm(fileOf(name, MARKER_FILE));
      await syncQuietly(path.join(root, name));
    } catch {
      // Still down: the next save takes it away before it moves capture.json aside.
      markers.set(CaptureIdSchema.parse(name), Promise.resolve(true));
    }
  };

  /** Temp files a quit left behind go, and a Discard it cut short is finished. */
  const tidy = async (name: string): Promise<void> => {
    if (!CaptureIdSchema.safeParse(name).success) {
      return;
    }

    let children: string[] = [];

    try {
      children = await fs.readdir(path.join(root, name));
    } catch {
      // An entry that can't be listed is read, or reported unreadable, below.
      return;
    }

    await Promise.all(
      children
        .filter((child) => child.endsWith(".tmp"))
        .map(async (child) => {
          await removeQuietly(fileOf(name, child));
        })
    );

    if (children.includes(MARKER_FILE)) {
      await finishDiscard(name);
    }
  };

  /** Folders the panel withdrew before a quit or a crash could remove them; the tombstone goes last. */
  const dropWithdrawn = async (id: string): Promise<void> => {
    try {
      await fs.rm(path.join(root, id));
      await fs.rm(path.join(root, `${id}${TOMBSTONE}`));
    } catch {
      // The tombstone stays, so the next start tries again; this one doesn't list the capture.
    }
  };

  await fs.mkdir(root);
  await fs.mkdir(path.join(root, STAGING));
  await fs.mkdir(path.join(root, TRASH));
  await clearDirectory(path.join(root, STAGING));
  await clearDirectory(path.join(root, TRASH));

  const names = await fs.readdir(root);

  const buried = new Set(
    names
      .filter((name) => name.endsWith(TOMBSTONE))
      .map((name) => name.slice(0, -TOMBSTONE.length))
      .filter((id) => CaptureIdSchema.safeParse(id).success)
  );

  await Promise.all([...buried].map(dropWithdrawn));

  const kept = names.filter((name) => !buried.has(name));

  await Promise.all(kept.map(tidy));

  const entries = await Promise.all(kept.map(readEntry));

  for (const entry of entries) {
    if (entry !== null) {
      cache.set(entry.id, entry);
    }
  }

  const commit = (entry: StoredEntry): void => {
    cache.set(entry.id, entry);
    notify();
  };

  const adoptExisting = async (
    record: CaptureRecord
  ): Promise<CaptureRecord | null> => {
    const entry = await readEntry(record.id);

    return entry?.kind === "ok" && sameCapture(entry.record, record)
      ? entry.record
      : null;
  };

  const publishNow = async (
    record: CaptureRecord,
    png: Uint8Array,
    progress: Progress
  ): Promise<StoreResult<CaptureRecord>> => {
    if (withdrawn.has(record.id)) {
      return failure("discarded", WITHDRAWN_TEXT);
    }

    const cached = cache.get(record.id);

    if (cached !== undefined) {
      return cached.kind === "ok" && sameCapture(cached.record, record)
        ? success(cached.record)
        : failure("writeFailed", "Another entry already uses this capture id.");
    }

    const parsed = CaptureRecordSchema.safeParse(record);

    if (!parsed.success) {
      return failure("invalid", z.prettifyError(parsed.error));
    }

    const staging = path.join(root, STAGING, `${record.id}.${nonce()}`);

    try {
      await fs.mkdir(staging);
      await fs.writeFileDurable(path.join(staging, IMAGE_FILE), png);
      await fs.writeFileDurable(
        path.join(staging, RECORD_FILE),
        JSON.stringify(parsed.data, null, 2)
      );

      // Withdrawn while it was being written: it is never placed.
      if (withdrawn.has(record.id)) {
        await removeQuietly(staging);

        return failure("discarded", WITHDRAWN_TEXT);
      }

      progress.moving = true;
      await renameWithRetry(staging, path.join(root, record.id));
    } catch (error) {
      await removeQuietly(staging);

      const adopted = await adoptExisting(record);

      if (adopted === null) {
        return failure("writeFailed", saveErrorText(error));
      }

      commit({
        id: record.id,
        kind: "ok",
        migratedFrom: null,
        record: adopted,
      });

      return success(adopted);
    }

    await syncQuietly(root);
    commit({
      id: record.id,
      kind: "ok",
      migratedFrom: null,
      record: parsed.data,
    });

    return success(parsed.data);
  };

  /** The entry a change starts from, or why there is none. */
  const editable = (id: CaptureId): OkEntry | StoreResult<CaptureRecord> => {
    const entry = cache.get(id);

    if (entry === undefined) {
      return failure("notFound", "This capture no longer exists.");
    }

    if (entry.kind !== "ok") {
      return failure("readOnly", "This capture is read-only.");
    }

    return entry;
  };

  const stamped = (record: CaptureRecord) =>
    CaptureRecordSchema.safeParse({
      ...record,
      updatedAt: now().toISOString(),
    });

  /**
   * A library save. A save whose epoch Discard ended is dropped before it
   * moves capture.json aside, and puts it back if it did: it is never
   * renamed in. One a Discard catches while it is renamed in is undone by
   * that Discard, whose marker goes down first.
   *
   * While an earlier Discard is still owed, capture.json.prev stays what it
   * puts back: the save replaces capture.json without moving it aside, and
   * keeps what it wrote only once the marker is gone.
   */
  const saveNow = async (
    id: CaptureId,
    fields: EditableFields,
    tag: SaveTag,
    progress: Progress
  ): Promise<StoreResult<CaptureRecord>> => {
    if (isEnded(id, tag)) {
      return failure("discarded", DISCARDED_TEXT);
    }

    const entry = editable(id);

    if ("ok" in entry) {
      return entry;
    }

    const parsed = stamped({ ...entry.record, ...fields });

    if (!parsed.success) {
      return failure("invalid", z.prettifyError(parsed.error));
    }

    const current = fileOf(id, RECORD_FILE);
    const backup = fileOf(id, PREVIOUS_FILE);
    const temporary = `${current}.${nonce()}.tmp`;

    try {
      await fs.writeFileDurable(temporary, json(parsed.data));
    } catch (error) {
      await removeQuietly(temporary);

      return failure("writeFailed", saveErrorText(error));
    }

    if (isEnded(id, tag)) {
      await removeQuietly(temporary);

      return failure("discarded", DISCARDED_TEXT);
    }

    progress.moving = true;

    const owed = undo.get(id);
    const keeps = owed?.marked === true;

    if (!keeps) {
      try {
        await unmark(id);
        await renameWithRetry(current, backup);
      } catch (error) {
        await removeQuietly(temporary);

        return failure("writeFailed", saveErrorText(error));
      }
    }

    const mine: Undo = {
      marked: keeps,
      previous: owed !== undefined && keeps ? owed.previous : entry,
      tag,
    };

    // Discarded while capture.json was moved aside: the Discard queued behind puts it back.
    if (isEnded(id, tag)) {
      undo.set(id, { ...mine, marked: true });
      await removeQuietly(temporary);

      return failure("discarded", DISCARDED_TEXT);
    }

    undo.set(id, mine);

    try {
      await renameWithRetry(temporary, current);
    } catch (error) {
      await removeQuietly(temporary);

      if (owed !== undefined && keeps) {
        undo.set(id, { ...owed, marked: true });
      } else {
        undo.delete(id);
        await quietly(renameWithRetry(backup, current));
      }

      return failure("writeFailed", saveErrorText(error));
    }

    commit({ id, kind: "ok", migratedFrom: null, record: parsed.data });

    // Caught by a Discard while it was renamed in: the Discard queued behind undoes it.
    if (isEnded(id, tag)) {
      return failure("discarded", DISCARDED_TEXT);
    }

    if (!keeps) {
      return success(parsed.data);
    }

    try {
      await unmark(id);
    } catch (error) {
      // Still owed: a start after a crash goes back to the version Discard puts back, and Retry tries again.
      return failure("writeFailed", saveErrorText(error));
    }

    // Discarded while its marker went: it goes back down before the Discard queued behind runs.
    if (isEnded(id, tag)) {
      void mark(id);

      return failure("discarded", DISCARDED_TEXT);
    }

    undo.set(id, { ...mine, marked: false });

    return success(parsed.data);
  };

  /**
   * Mark as done or not. After a library save, capture.json.prev takes the
   * change first, so Discard keeps it; if it can't, the change fails rather
   * than leave a backup a Discard would undo it with. If capture.json then
   * can't take it, the backup goes back to what it held, so a Discard never
   * puts back a change that failed.
   */
  const statusNow = async (
    id: CaptureId,
    done: boolean
  ): Promise<StoreResult<CaptureRecord>> => {
    const entry = editable(id);

    if ("ok" in entry) {
      return entry;
    }

    const change = (record: CaptureRecord): CaptureRecord => ({
      ...record,
      status: done
        ? { at: now().toISOString(), kind: "done" }
        : { kind: "active" },
    });

    const parsed = stamped(change(entry.record));
    const owed = undo.get(id);

    const carried =
      owed === undefined
        ? undefined
        : CaptureRecordSchema.safeParse(change(owed.previous.record));

    if (!parsed.success || carried?.success === false) {
      return failure("invalid", "This capture can’t be changed.");
    }

    const current = fileOf(id, RECORD_FILE);
    const backup = fileOf(id, PREVIOUS_FILE);
    const temporary = `${current}.${nonce()}.tmp`;
    const backupTemporary = `${backup}.${nonce()}.tmp`;
    const backupBefore = `${backup}.${nonce()}.tmp`;
    let backupChanged = false;

    /** Discard puts back what capture.json.prev holds, so the undo slot follows it. */
    const backedUp = (record: CaptureRecord): void => {
      const slot = undo.get(id);

      if (slot !== undefined) {
        undo.set(id, {
          ...slot,
          previous: { id, kind: "ok", migratedFrom: null, record },
        });
      }
    };

    try {
      await fs.writeFileDurable(temporary, json(parsed.data));

      if (owed !== undefined && carried !== undefined) {
        await fs.writeFileDurable(backupBefore, json(owed.previous.record));
        await fs.writeFileDurable(backupTemporary, json(carried.data));
        await renameWithRetry(backupTemporary, backup);
        backupChanged = true;
      }

      await renameWithRetry(temporary, current);
    } catch (error) {
      if (backupChanged && carried !== undefined) {
        try {
          await renameWithRetry(backupBefore, backup);
        } catch {
          // The backup keeps the change, so a Discard puts it back with the saved fields.
          backedUp(carried.data);
        }
      }

      await removeQuietly(temporary);
      await removeQuietly(backupTemporary);
      await removeQuietly(backupBefore);

      return failure("writeFailed", saveErrorText(error));
    }

    await removeQuietly(backupBefore);

    if (carried !== undefined) {
      backedUp(carried.data);
    }

    commit({ id, kind: "ok", migratedFrom: null, record: parsed.data });

    return success(parsed.data);
  };

  /** Puts back what capture.json.prev holds, when the tagged save replaced capture.json or an earlier Discard is still owed. */
  const restoreNow = async (
    id: CaptureId,
    tag: SaveTag
  ): Promise<StoreResult<null>> => {
    if (!owes(id, tag)) {
      return success(null);
    }

    await markers.get(id);

    try {
      await renameWithRetry(fileOf(id, PREVIOUS_FILE), fileOf(id, RECORD_FILE));
    } catch (error) {
      return failure("writeFailed", saveErrorText(error, "undo"));
    }

    const slot = undo.get(id);

    undo.delete(id);

    if (slot !== undefined) {
      commit(slot.previous);
    }

    try {
      await unmark(id);
    } catch {
      // Nothing is left for it to put back; the next save takes it away before it moves capture.json aside, and so does the next start.
    }

    return success(null);
  };

  const removeNow = async (id: CaptureId): Promise<StoreResult<null>> => {
    const entry = cache.get(id);

    if (entry === undefined) {
      return failure("notFound", "This capture no longer exists.");
    }

    if (entry.kind !== "ok") {
      return failure("readOnly", "This capture is read-only.");
    }

    const trash = path.join(root, TRASH, `${id}.${nonce()}`);

    try {
      await renameWithRetry(path.join(root, id), trash);
    } catch (error) {
      return failure("writeFailed", saveErrorText(error, "delete"));
    }

    cache.delete(id);
    undo.delete(id);
    ended.delete(id);
    markers.delete(id);
    notify();
    await removeQuietly(trash);

    return success(null);
  };

  /** The tombstone first; then the capture goes if its save placed it, and the tombstone after it. */
  const withdraw = async (id: CaptureId): Promise<StoreResult<null>> => {
    const tombstone = path.join(root, `${id}${TOMBSTONE}`);
    const down = { done: false };

    withdrawn.add(id);

    const bury = async (): Promise<void> => {
      down.done = await touch(tombstone);
    };

    const burying = beside(bury());

    wake();

    return await enqueue(
      async () => {
        await burying;

        const result = cache.has(id) ? await removeNow(id) : success(null);

        if (result.ok) {
          await removeQuietly(tombstone);
        }

        return result;
      },
      () => down.done
    );
  };

  return {
    discard: async (id, tag) => {
      ended.set(id, new Set([...(ended.get(id) ?? []), tag.epoch]));

      const slot = undo.get(id);

      // Landed, on its way into capture.json, or owed already: the marker goes down at once, ahead of the queue.
      if (owes(id, tag) && slot !== undefined) {
        undo.set(id, { ...slot, marked: true });
        void mark(id);
      }

      wake();

      return await enqueue(
        async () => await restoreNow(id, tag),
        () => !owes(id, tag)
      );
    },
    get: (id) => cache.get(id),
    imageFile: (id) =>
      cache.get(id)?.kind === "ok" ? fileOf(id, IMAGE_FILE) : null,
    list: () => [...cache.values()].toSorted(newestFirst),
    publish: async (record, png) => {
      const progress: Progress = { moving: false };

      return await enqueue(
        async () => await publishNow(record, png, progress),
        () => withdrawn.has(record.id) && !progress.moving
      );
    },
    remove: async (id) => await enqueue(async () => await removeNow(id)),
    setDone: async (id, done) =>
      await enqueue(async () => await statusNow(id, done)),
    settled: async () => {
      while (![...pending].every((write) => write.harmless())) {
        // oxlint-disable-next-line no-await-in-loop, promise/avoid-new -- woken whenever a write ends or a discard drops one.
        await new Promise<void>((resolve) => {
          waking.add(resolve);
        });
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    update: async (id, fields, tag) => {
      const progress: Progress = { moving: false };

      return await enqueue(
        async () => await saveNow(id, fields, tag, progress),
        () => isEnded(id, tag) && !progress.moving
      );
    },
    withdraw,
  };
};
