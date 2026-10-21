import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  CaptureIdSchema,
  CaptureRecordV1Schema,
  parseStoredEntry,
} from "@shared/capture-record";
import type {
  CaptureId,
  CaptureRecordV1,
  StoredEntry,
} from "@shared/capture-record";
import { z } from "zod";

/** Every filesystem call the store makes; tests wrap it to inject faults. */
export interface StoreFs {
  readonly mkdir: (target: string) => Promise<void>;
  readonly readdir: (target: string) => Promise<string[]>;
  readonly readFile: (target: string) => Promise<Uint8Array>;
  /** Exclusive create, write, fsync, close. */
  readonly writeFileDurable: (
    target: string,
    data: Uint8Array | string
  ) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
  /** Recursive and forced. */
  readonly rm: (target: string) => Promise<void>;
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

/** INSET_FAIL_NEXT_WRITE: the next durable write fails once, for verifying the failed-save UI. */
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

export type StoreError = "notFound" | "readOnly" | "invalid" | "writeFailed";

export type StoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: StoreError;
      readonly message: string;
    };

export interface CaptureStore {
  /** From the cache, newest capture first. */
  readonly list: () => readonly StoredEntry[];
  readonly get: (id: CaptureId) => StoredEntry | undefined;
  /** Main-process only (protocol, clipboard, drag); ok entries only. */
  readonly imageFile: (id: CaptureId) => string | null;
  readonly publish: (
    record: CaptureRecordV1,
    png: Uint8Array
  ) => Promise<StoreResult<CaptureRecordV1>>;
  readonly updateThought: (
    id: CaptureId,
    thought: string
  ) => Promise<StoreResult<CaptureRecordV1>>;
  readonly remove: (id: CaptureId) => Promise<StoreResult<null>>;
  /** Fires after each committed mutation. */
  readonly subscribe: (listener: () => void) => () => void;
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
const IMAGE_FILE = "crop.png";
const RETRYABLE_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const ErrorCodeSchema = z.object({ code: z.string() });

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Unknown error";

const isRetryable = (cause: unknown): boolean => {
  const parsed = ErrorCodeSchema.safeParse(cause);

  return parsed.success && RETRYABLE_CODES.has(parsed.data.code);
};

const failure = <T>(error: StoreError, message: string): StoreResult<T> => ({
  error,
  message,
  ok: false,
});

const success = <T>(value: T): StoreResult<T> => ({ ok: true, value });

/** A retry of the same draft: the times may differ, the content may not. */
const sameCapture = (a: CaptureRecordV1, b: CaptureRecordV1): boolean =>
  a.thought === b.thought &&
  a.pin.x === b.pin.x &&
  a.pin.y === b.pin.y &&
  a.image.widthPx === b.image.widthPx &&
  a.image.heightPx === b.image.heightPx;

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

const settled = async <T>(run: Promise<T>): Promise<void> => {
  try {
    await run;
  } catch {
    // The caller of `run` sees the rejection; the queue only needs to continue.
  }
};

/**
 * Directory-per-capture store under `root`. A capture is published by
 * renaming a fully written staging directory, so a listed entry is always
 * complete. Mutations run one at a time; the cache changes only after the
 * filesystem commit succeeded. The single-instance lock makes this process
 * the only writer, so the cache is authoritative.
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
  let tail: Promise<void> = Promise.resolve();

  /** Serialises mutations; the tail never rejects, so one failure never blocks the next task. */
  const enqueue = async <T>(task: () => Promise<T>): Promise<T> => {
    const run = after(tail, task);

    tail = settled(run);

    return await run;
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

  const readEntry = async (name: string): Promise<StoredEntry | null> => {
    const id = CaptureIdSchema.safeParse(name);

    if (!id.success) {
      return null;
    }

    try {
      return parseStoredEntry(
        name,
        decoder.decode(await fs.readFile(path.join(root, name, RECORD_FILE)))
      );
    } catch {
      return {
        id: id.data,
        kind: "unreadable",
        reason: `${RECORD_FILE} could not be read`,
      };
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

  const names = await fs.readdir(root);
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

  /** A same-id v1 entry already at the final path counts as this publish if it holds the same capture. */
  const adoptExisting = async (
    record: CaptureRecordV1
  ): Promise<CaptureRecordV1 | null> => {
    const entry = await readEntry(record.id);

    return entry?.kind === "ok" && sameCapture(entry.record, record)
      ? entry.record
      : null;
  };

  const publishNow = async (
    record: CaptureRecordV1,
    png: Uint8Array
  ): Promise<StoreResult<CaptureRecordV1>> => {
    const cached = cache.get(record.id);

    if (cached !== undefined) {
      return cached.kind === "ok" && sameCapture(cached.record, record)
        ? success(cached.record)
        : failure("writeFailed", "Another entry already uses this capture id.");
    }

    const parsed = CaptureRecordV1Schema.safeParse(record);

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
        return failure("writeFailed", errorMessage(error));
      }

      commit({ id: record.id, kind: "ok", record: adopted });

      return success(adopted);
    }

    commit({ id: record.id, kind: "ok", record: parsed.data });

    return success(parsed.data);
  };

  const updateThoughtNow = async (
    id: CaptureId,
    thought: string
  ): Promise<StoreResult<CaptureRecordV1>> => {
    const entry = cache.get(id);

    if (entry === undefined) {
      return failure("notFound", "This capture no longer exists.");
    }

    if (entry.kind !== "ok") {
      return failure("readOnly", "This capture is read-only.");
    }

    const parsed = CaptureRecordV1Schema.safeParse({
      ...entry.record,
      thought,
      updatedAt: now().toISOString(),
    });

    if (!parsed.success) {
      return failure("invalid", z.prettifyError(parsed.error));
    }

    const temporary = path.join(root, id, `${RECORD_FILE}.${nonce()}.tmp`);

    try {
      await fs.writeFileDurable(
        temporary,
        JSON.stringify(parsed.data, null, 2)
      );
      await renameWithRetry(temporary, path.join(root, id, RECORD_FILE));
    } catch (error) {
      await removeQuietly(temporary);

      return failure("writeFailed", errorMessage(error));
    }

    commit({ id, kind: "ok", record: parsed.data });

    return success(parsed.data);
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
      return failure("writeFailed", errorMessage(error));
    }

    cache.delete(id);
    notify();
    await removeQuietly(trash);

    return success(null);
  };

  return {
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
    updateThought: async (id, thought) =>
      await enqueue(async () => await updateThoughtNow(id, thought)),
  };
};
