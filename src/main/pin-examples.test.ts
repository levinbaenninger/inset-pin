import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { CaptureIdSchema } from "@shared/capture-record";
import type { CaptureId } from "@shared/capture-record";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPinExamples } from "./pin-examples";
import { pinExamples } from "./pin-tutorial";
import { nodeStoreFs, openCaptureStore } from "./store";
import type { CaptureStore, StoreFs } from "./store";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

let root = "";

const examplesOn = (store: CaptureStore) => {
  let next = 0;

  return createPinExamples({
    examples: pinExamples(true),
    newId: (): CaptureId => {
      next += 1;

      return CaptureIdSchema.parse(
        `00000000-0000-4000-8000-00000000000${next}`
      );
    },
    now: () => new Date("2026-11-11T09:00:00.000Z"),
    readImage: async () => await Promise.resolve(PNG),
    store: {
      has: (id) => store.get(id) !== undefined,
      publish: async (record, png) => await store.publish(record, png),
      remove: async (id) => await store.remove(id),
    },
    warn: () => {},
  });
};

/** The capture folders left in the library's folder. */
const folders = async (): Promise<string[]> => {
  const names = await readdir(root);

  return names.filter((name) => !name.startsWith(".")).toSorted();
};

describe("Pin's examples on a real capture store", () => {
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "inset-pin-examples-"));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("reports an example removed only once its folder has left the disk, and keeps one whose delete failed", async () => {
    let deletesFail = true;

    // A delete moves the capture's folder into the trash; this disk refuses that while deletesFail is set.
    const disk: StoreFs = {
      ...nodeStoreFs,
      rename: async (from, to) => {
        if (deletesFail && to.includes(`${path.sep}.trash${path.sep}`)) {
          throw Object.assign(new Error("access denied"), { code: "EACCES" });
        }

        await nodeStoreFs.rename(from, to);
      },
    };

    const store = await openCaptureStore(root, {
      fs: disk,
      retryDelaysMs: [0, 0, 0],
    });

    const examples = examplesOn(store);
    const ids = examples.seed();

    await vi.waitFor(() => {
      expect(store.list()).toHaveLength(ids.length);
    });

    const failed = await examples.remove(ids);
    const keptOnDisk = await folders();

    deletesFail = false;

    const removed = await examples.remove(ids);
    const reopened = await openCaptureStore(root);

    expect({
      afterRetry: { removed, onDisk: await folders() },
      afterRestart: reopened.list().map((entry) => entry.id),
      whileFailing: { removed: failed, onDisk: keptOnDisk },
    }).toStrictEqual({
      afterRetry: { onDisk: [], removed: ids },
      afterRestart: [],
      whileFailing: { onDisk: [...ids].toSorted(), removed: [] },
    });
  });
});
