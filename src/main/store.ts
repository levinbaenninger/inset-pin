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
   * Rewrites the record as the current version, so a v1 file becomes v2 on
   * its first edit. A library save carries its tag, so Discard changes can
   * drop it or put back what it replaced.
   */
  readonly update: (
    id: CaptureId,
    fields: EditableFields,
    tag?: SaveTag
  ) => Promise<StoreResult<CaptureRecord>>;
  /**
   * Discard changes while the tagged save is on its way (SPEC round 8). Its
   * epoch ends at once, so a save of it that hasn't replaced capture.json is
   * dropped; one that has is undone by renaming the file it moved aside back
   * into place. Nothing is written, so a full disk can't stop it.
   */
  readonly discard: (id: CaptureId, tag: SaveTag) => Promise<StoreResult<null>>;
  readonly setDone: (
    id: CaptureId,
    done: boolean
  ) => Promise<StoreResult<CaptureRecord>>;
  readonly remove: (id: CaptureId) => Promise<StoreResult<null>>;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Resolves once no queued write can still change what is on disk,
   * including writes queued meanwhile. A discarded save that hasn't
   * replaced capture.json will be dropped, so it doesn't count.
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

/** What capture.json held before the last save, moved aside by that save. */
const PREVIOUS_FILE = "capture.json.prev";
const IMAGE_FILE = "crop.png";
const RETRYABLE_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const ErrorCodeSchema = z.object({ code: z.string() });

const isRetryable = (cause: unknown): boolean => {
  const parsed = ErrorCodeSchema.safeParse(cause);

  return parsed.success && RETRYABLE_CODES.has(parsed.data.code);
};

const isMissing = (cause: unknown): boolean =>
  ErrorCodeSchema.safeParse(cause).data?.code === "ENOENT";

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

/**
 * The library save that wrote an entry's capture.json last, and the entry as
 * it was before, which capture.json.prev holds. Refused once a later change,
 * such as Mark as done, couldn't be carried into capture.json.prev: renaming
 * that back would undo the change too.
 */
type Undo =
  | {
      readonly kind: "backup";
      readonly tag: SaveTag;
      readonly previous: StoredEntry & { readonly kind: "ok" };
    }
  | { readonly kind: "refused"; readonly tag: SaveTag; readonly why: string };

/** A queued write, and whether it can still change what is on disk. */
interface Pending {
  readonly harmless: () => boolean;
}

/** Where a library save is: it can be dropped until it starts replacing capture.json. */
interface SaveProgress {
  replacing: boolean;
}

const DISCARDED_TEXT = "The changes were discarded.";

const json = (record: CaptureRecord): string => JSON.stringify(record, null, 2);

/**
 * Publishing renames a fully written staging directory, so a listed entry is
 * always complete. The cache changes only after the filesystem commit, and
 * the single-instance lock makes it authoritative.
 *
 * Every rewrite moves capture.json aside as capture.json.prev before it
 * renames the new file into place, so Discard changes can undo a library
 * save with a rename instead of writing the old content again.
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
  const pending = new Set<Pending>();
  /** Saves replacing capture.json right now, so the Discard queued behind them still has work. */
  const replacing = new Set<SaveTag>();
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

  const isEnded = (id: CaptureId, tag: SaveTag | undefined): boolean =>
    tag !== undefined && (ended.get(id)?.has(tag.epoch) ?? false);

  /** Whether discarding this save still has a file to put back. */
  const undoes = (id: CaptureId, tag: SaveTag): boolean => {
    const slot = undo.get(id);

    return (
      (slot !== undefined && sameSave(slot.tag, tag)) ||
      [...replacing].some((save) => sameSave(save, tag))
    );
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

  const readEntry = async (name: string): Promise<StoredEntry | null> => {
    const id = CaptureIdSchema.safeParse(name);

    if (!id.success) {
      return null;
    }

    const read = async (): Promise<StoredEntry | null> =>
      parseStoredEntry(
        name,
        decoder.decode(await fs.readFile(path.join(root, name, RECORD_FILE)))
      );

    const unreadable: StoredEntry = {
      id: id.data,
      kind: "unreadable",
      reason: `${RECORD_FILE} could not be read`,
    };

    try {
      return await read();
    } catch (error) {
      if (!isMissing(error)) {
        return unreadable;
      }
    }

    // Quit between moving capture.json aside and renaming the new one in: the version moved aside is the last one saved.
    try {
      await fs.rename(
        path.join(root, name, PREVIOUS_FILE),
        path.join(root, name, RECORD_FILE)
      );

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

  await fs.mkdir(root);
  await fs.mkdir(path.join(root, STAGING));
  await fs.mkdir(path.join(root, TRASH));
  await clearDirectory(path.join(root, STAGING));
  await clearDirectory(path.join(root, TRASH));

  /** A save cut off by a quit leaves its temp file behind; nothing reads it, so it goes at the next open. */
  const clearTemporaries = async (name: string): Promise<void> => {
    if (!CaptureIdSchema.safeParse(name).success) {
      return;
    }

    try {
      const children = await fs.readdir(path.join(root, name));

      await Promise.all(
        children
          .filter((child) => child.endsWith(".tmp"))
          .map(async (child) => {
            await removeQuietly(path.join(root, name, child));
          })
      );
    } catch {
      // An entry that can't be listed is read, or reported unreadable, below.
    }
  };

  const names = await fs.readdir(root);

  await Promise.all(names.map(clearTemporaries));

  const entries = await Promise.all(names.map(readEntry));

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
    png: Uint8Array
  ): Promise<StoreResult<CaptureRecord>> => {
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

  /**
   * Renames the new file into place. A save first moves capture.json aside
   * as capture.json.prev, and moves it back if the new file can't follow; a
   * status change that carries a save's undo leaves the backup alone.
   */
  const replaceRecord = async (
    dir: string,
    temporary: string,
    movesAside: boolean
  ): Promise<void> => {
    const current = path.join(dir, RECORD_FILE);
    const backup = path.join(dir, PREVIOUS_FILE);

    if (!movesAside) {
      await renameWithRetry(temporary, current);

      return;
    }

    await renameWithRetry(current, backup);

    try {
      await renameWithRetry(temporary, current);
    } catch (error) {
      await renameWithRetry(backup, current);
      throw error;
    }
  };

  /**
   * A status change after a library save: the backup gets the change too, so
   * a later Discard keeps it. When it can't, Discard of that save is refused
   * rather than undoing the change with it.
   */
  const carryUndo = async (
    id: CaptureId,
    kept: Undo,
    copy: { readonly record: CaptureRecord; readonly temporary: string } | null
  ): Promise<Undo> => {
    if (kept.kind === "refused") {
      return kept;
    }

    if (copy === null) {
      return {
        kind: "refused",
        tag: kept.tag,
        why: saveErrorText(null, "undo"),
      };
    }

    try {
      await renameWithRetry(copy.temporary, path.join(root, id, PREVIOUS_FILE));

      return { ...kept, previous: { ...kept.previous, record: copy.record } };
    } catch (error) {
      await removeQuietly(copy.temporary);

      return {
        kind: "refused",
        tag: kept.tag,
        why: saveErrorText(error, "undo"),
      };
    }
  };

  /**
   * A library save carries its tag and progress; a status change carries
   * neither. A save whose epoch Discard ended is dropped before it replaces
   * capture.json.
   */
  const rewriteNow = async (
    id: CaptureId,
    change: (record: CaptureRecord) => CaptureRecord,
    save?: { readonly tag: SaveTag; readonly progress: SaveProgress }
  ): Promise<StoreResult<CaptureRecord>> => {
    const entry = cache.get(id);

    if (isEnded(id, save?.tag)) {
      return failure("discarded", DISCARDED_TEXT);
    }

    if (entry === undefined) {
      return failure("notFound", "This capture no longer exists.");
    }

    if (entry.kind !== "ok") {
      return failure("readOnly", "This capture is read-only.");
    }

    const parsed = CaptureRecordSchema.safeParse({
      ...change(entry.record),
      updatedAt: now().toISOString(),
    });

    if (!parsed.success) {
      return failure("invalid", z.prettifyError(parsed.error));
    }

    const dir = path.join(root, id);
    const temporary = path.join(dir, `${RECORD_FILE}.${nonce()}.tmp`);
    const kept = save === undefined ? undo.get(id) : undefined;

    const carried =
      kept?.kind === "backup"
        ? CaptureRecordSchema.safeParse(change(kept.previous.record)).data
        : undefined;

    const copy =
      carried === undefined
        ? null
        : {
            record: carried,
            temporary: path.join(dir, `${PREVIOUS_FILE}.${nonce()}.tmp`),
          };

    const cleanUp = async (): Promise<void> => {
      await removeQuietly(temporary);

      if (copy !== null) {
        await removeQuietly(copy.temporary);
      }
    };

    try {
      await fs.writeFileDurable(temporary, json(parsed.data));

      if (copy !== null) {
        await fs.writeFileDurable(copy.temporary, json(copy.record));
      }
    } catch (error) {
      await cleanUp();

      return failure("writeFailed", saveErrorText(error));
    }

    // Discarded while it was being written: dropped before it replaces anything.
    if (isEnded(id, save?.tag)) {
      await cleanUp();

      return failure("discarded", DISCARDED_TEXT);
    }

    if (save !== undefined) {
      save.progress.replacing = true;
      replacing.add(save.tag);
    }

    try {
      await replaceRecord(dir, temporary, copy === null);
    } catch (error) {
      await cleanUp();

      return failure("writeFailed", saveErrorText(error));
    } finally {
      if (save !== undefined) {
        replacing.delete(save.tag);
      }
    }

    if (save !== undefined) {
      undo.set(id, { kind: "backup", previous: entry, tag: save.tag });
    } else if (kept !== undefined) {
      undo.set(id, await carryUndo(id, kept, copy));
    }

    commit({ id, kind: "ok", migratedFrom: null, record: parsed.data });

    return success(parsed.data);
  };

  /** Puts back what the tagged save replaced, when it is still the last save that replaced capture.json. */
  const restoreNow = async (
    id: CaptureId,
    tag: SaveTag
  ): Promise<StoreResult<null>> => {
    const slot = undo.get(id);

    if (slot === undefined || !sameSave(slot.tag, tag)) {
      return success(null);
    }

    if (slot.kind === "refused") {
      undo.delete(id);

      return failure("writeFailed", slot.why);
    }

    try {
      await renameWithRetry(
        path.join(root, id, PREVIOUS_FILE),
        path.join(root, id, RECORD_FILE)
      );
    } catch (error) {
      return failure("writeFailed", saveErrorText(error, "undo"));
    }

    undo.delete(id);
    commit(slot.previous);

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
    notify();
    await removeQuietly(trash);

    return success(null);
  };

  return {
    discard: async (id, tag) => {
      ended.set(id, new Set([...(ended.get(id) ?? []), tag.epoch]));
      wake();

      return await enqueue(
        async () => await restoreNow(id, tag),
        () => !undoes(id, tag)
      );
    },
    get: (id) => cache.get(id),
    imageFile: (id) =>
      cache.get(id)?.kind === "ok" ? path.join(root, id, IMAGE_FILE) : null,
    list: () => [...cache.values()].toSorted(newestFirst),
    publish: async (record, png) =>
      await enqueue(async () => await publishNow(record, png)),
    remove: async (id) => await enqueue(async () => await removeNow(id)),
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    settled: async () => {
      while (![...pending].every((write) => write.harmless())) {
        // oxlint-disable-next-line no-await-in-loop, promise/avoid-new -- woken whenever a queued write ends or a discard drops one.
        await new Promise<void>((resolve) => {
          waking.add(resolve);
        });
      }
    },
    setDone: async (id, done) =>
      await enqueue(
        async () =>
          await rewriteNow(id, (record) => ({
            ...record,
            status: done
              ? { at: now().toISOString(), kind: "done" }
              : { kind: "active" },
          }))
      ),
    update: async (id, fields, tag) => {
      if (tag === undefined) {
        return await enqueue(
          async () =>
            await rewriteNow(id, (record) => ({ ...record, ...fields }))
        );
      }

      const progress: SaveProgress = { replacing: false };

      return await enqueue(
        async () =>
          await rewriteNow(id, (record) => ({ ...record, ...fields }), {
            progress,
            tag,
          }),
        () => isEnded(id, tag) && !progress.replacing
      );
    },
  };
};
