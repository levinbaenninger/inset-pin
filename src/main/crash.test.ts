import { existsSync } from "node:fs";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { CaptureIdSchema } from "@shared/capture-record";
import type { CaptureRecord, EditableFields } from "@shared/capture-record";
import { describe, expect, it, vi } from "vitest";

import { nodeStoreFs, openCaptureStore } from "./store";
import type { CaptureStore, StoreFs } from "./store";

const ID = CaptureIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c");
const OTHER = CaptureIdSchema.parse("7a2d3c63-4e5f-4a71-9b82-a3c4d5e6f708");
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const TAG = { epoch: "page.1", seq: 1 };
const KEEP = { epoch: "page.2", seq: 2 };

const SAVED: EditableFields = {
  description: "Saved description",
  due: null,
  pins: [],
  steps: [],
  title: "SAVED title",
};

const DISCARDED: EditableFields = { ...SAVED, title: "DISCARDED title" };

const recordOf = (id: typeof ID): CaptureRecord => ({
  ...SAVED,
  capturedAt: "2026-11-06T01:00:00.000Z",
  id,
  image: { file: "crop.png", heightPx: 600, pixelsPerDip: 2, widthPx: 960 },
  invokedVia: "shortcut",
  schemaVersion: 2,
  source: { kind: "display", label: "Built-in Retina Display" },
  status: { kind: "active" },
  updatedAt: "2026-11-06T01:00:00.000Z",
});

interface Latch {
  readonly promise: Promise<void>;
  readonly open: () => void;
}

const nothing = (): void => undefined;

const latch = (): Latch => {
  let open = nothing;

  // oxlint-disable-next-line promise/avoid-new -- opened later by the test, through this callback.
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { open, promise };
};

const fault = (code: string): Error =>
  Object.assign(new Error(`Injected ${code}`), { code });

/**
 * A disk that keeps every state a crash could leave. Once `armed`, it copies
 * the whole captures folder after each write, rename and removal lands, one
 * operation at a time, so every copy falls between two of them. `hold` stops
 * the first operation it matches until released; `fail` makes the operations
 * it matches throw while set.
 */
const crashDisk = (root: string) => {
  const crashes: string[] = [];
  const ops: string[] = [];
  const state = { armed: false };
  const failing = new Map<(op: string) => boolean, string>();

  const holds: {
    readonly match: (op: string) => boolean;
    readonly gate: Latch;
    readonly reached: Latch;
    used: boolean;
  }[] = [];

  let turn: Promise<void> = Promise.resolve();

  const run = async (op: string, act: () => Promise<void>): Promise<void> => {
    const hold = holds.find((each) => !each.used && each.match(op));

    if (hold !== undefined) {
      hold.used = true;
      hold.reached.open();
      await hold.gate.promise;
    }

    const previous = turn;
    const done = latch();

    turn = done.promise;
    await previous;

    try {
      const code = [...failing].find(([match]) => match(op))?.[1];

      if (code !== undefined) {
        throw fault(code);
      }

      await act();

      if (state.armed) {
        ops.push(op);

        const copy = await mkdtemp(path.join(tmpdir(), "inset-pin-crash-"));

        await cp(root, copy, { recursive: true });
        crashes.push(copy);
      }
    } finally {
      done.open();
    }
  };

  const name = (file: string): string =>
    path.relative(root, file).split(path.sep).join("/");

  const fs: StoreFs = {
    ...nodeStoreFs,
    rename: async (from, to) => {
      await run(`rename ${name(from)} -> ${name(to)}`, async () => {
        await nodeStoreFs.rename(from, to);
      });
    },
    rm: async (target) => {
      await run(`rm ${name(target)}`, async () => {
        await nodeStoreFs.rm(target);
      });
    },
    writeFileDurable: async (target, data) => {
      await run(`write ${name(target)}`, async () => {
        await nodeStoreFs.writeFileDurable(target, data);
      });
    },
  };

  return {
    crashes,
    fail: (match: (op: string) => boolean, code: string): (() => void) => {
      failing.set(match, code);

      return () => {
        failing.delete(match);
      };
    },
    fs,
    hold: (match: (op: string) => boolean) => {
      const hold = { gate: latch(), match, reached: latch(), used: false };

      holds.push(hold);

      return { reached: hold.reached.promise, release: hold.gate.open };
    },
    ops,
    state,
  };
};

/** What a fresh start finds in a folder: the capture's title and status, or "gone". */
const startFrom = async (folder: string): Promise<string> => {
  const started = await openCaptureStore(folder);
  const entry = started.get(ID);

  return entry?.kind === "ok"
    ? `${entry.record.title} (${entry.record.status.kind})`
    : "gone";
};

/** Every state a fresh start can find after a crash at any step, once each. */
const afterCrashes = async (crashes: readonly string[]) => {
  const found = await Promise.all(crashes.map(startFrom));

  return { crashed: crashes.length > 0, found: [...new Set(found)] };
};

const setUp = async () => {
  const root = path.join(
    await mkdtemp(path.join(tmpdir(), "inset-pin-crash-root-")),
    "captures"
  );

  const disk = crashDisk(root);

  const store = await openCaptureStore(root, {
    fs: disk.fs,
    retryDelaysMs: [],
  });

  await store.publish(recordOf(ID), PNG);
  await store.publish(recordOf(OTHER), PNG);

  const marker = path.join(root, ID, "capture.json.discard");

  return { disk, marker, root, startFrom, store };
};

const idle = async (store: CaptureStore): Promise<void> => {
  await store.settled();
};

describe("Discard changes survives a crash at any step (SPEC round 8)", () => {
  it("never renames the discarded save in when Discard arrives while capture.json is moved aside", async () => {
    const { disk, root, store } = await setUp();

    const aside = disk.hold(
      (op) => op === `rename ${ID}/capture.json -> ${ID}/capture.json.prev`
    );

    const saving = store.update(ID, DISCARDED, TAG);

    await aside.reached;
    disk.state.armed = true;

    const discarded = store.discard(ID, TAG);

    aside.release();
    await saving;
    await discarded;
    await idle(store);

    expect({
      ...(await afterCrashes(disk.crashes)),
      live: await startFrom(root),
      renamedIn: disk.ops.filter((op) => op.includes(".tmp -> ")),
    }).toStrictEqual({
      crashed: true,
      found: ["SAVED title (active)"],
      live: "SAVED title (active)",
      renamedIn: [],
    });
  });

  it("comes back to the saved version when Discard arrives while the discarded save is renamed in", async () => {
    const { disk, marker, root, store } = await setUp();

    const renamingIn = disk.hold(
      (op) =>
        op.startsWith(`rename ${ID}/capture.json.`) &&
        op.endsWith(`.tmp -> ${ID}/capture.json`)
    );

    const saving = store.update(ID, DISCARDED, TAG);

    await renamingIn.reached;
    disk.state.armed = true;

    const discarded = store.discard(ID, TAG);

    await vi.waitFor(() => {
      expect(existsSync(marker)).toBeTruthy();
    });
    renamingIn.release();
    await saving;
    await discarded;
    await idle(store);

    expect({
      ...(await afterCrashes(disk.crashes)),
      live: await startFrom(root),
      marker: existsSync(marker),
    }).toStrictEqual({
      crashed: true,
      found: ["SAVED title (active)"],
      live: "SAVED title (active)",
      marker: false,
    });
  });

  it("comes back to the saved version when Discard of a landed save waits behind another capture's write", async () => {
    const { disk, marker, root, store } = await setUp();

    await store.update(ID, DISCARDED, TAG);

    const other = disk.hold(
      (op) => op.startsWith(`write ${OTHER}/`) && op.endsWith(".tmp")
    );

    const otherDone = store.setDone(OTHER, true);

    await other.reached;
    disk.state.armed = true;

    const discarded = store.discard(ID, TAG);

    await vi.waitFor(() => {
      expect(existsSync(marker)).toBeTruthy();
    });
    other.release();
    await otherDone;
    await discarded;
    await idle(store);

    expect({
      ...(await afterCrashes(disk.crashes)),
      live: await startFrom(root),
    }).toStrictEqual({
      crashed: true,
      found: ["SAVED title (active)"],
      live: "SAVED title (active)",
    });
  });

  it("keeps a Mark as done queued ahead of the Discard, at every step", async () => {
    const { disk, marker, root, store } = await setUp();

    await store.update(ID, DISCARDED, TAG);

    const doneWrite = disk.hold(
      (op) => op.startsWith(`write ${ID}/`) && op.endsWith(".tmp")
    );

    const done = store.setDone(ID, true);

    await doneWrite.reached;
    disk.state.armed = true;

    const discarded = store.discard(ID, TAG);

    await vi.waitFor(() => {
      expect(existsSync(marker)).toBeTruthy();
    });
    doneWrite.release();

    const doneResult = await done;
    const discardResult = await discarded;
    const results = [doneResult.ok, discardResult.ok];

    await idle(store);

    const { crashed, found } = await afterCrashes(disk.crashes);

    expect({
      crashed,
      live: await startFrom(root),
      results,
      titles: [...new Set(found.map((each) => each.split(" (")[0]))],
    }).toStrictEqual({
      crashed: true,
      live: "SAVED title (done)",
      results: [true, true],
      titles: ["SAVED title"],
    });
  });

  it("fails a Mark as done whose backup can't take it, so Discard still puts back the saved version, done or not", async () => {
    const { disk, root, store } = await setUp();

    await store.update(ID, DISCARDED, TAG);

    const healed = disk.fail(
      (op) =>
        op.startsWith(`rename ${ID}/capture.json.prev.`) &&
        op.endsWith(`-> ${ID}/capture.json.prev`),
      "EPERM"
    );

    const done = await store.setDone(ID, true);

    healed();
    disk.state.armed = true;

    const discarded = await store.discard(ID, TAG);

    await idle(store);

    expect({
      ...(await afterCrashes(disk.crashes)),
      discarded: discarded.ok,
      done,
      live: await startFrom(root),
    }).toStrictEqual({
      crashed: true,
      discarded: true,
      done: {
        error: "writeFailed",
        message: "Inset can’t write to its data folder.",
        ok: false,
      },
      found: ["SAVED title (active)"],
      live: "SAVED title (active)",
    });
  });

  it("finishes at the next start a Discard that couldn't put the saved version back, and a second Discard finishes it now", async () => {
    const { disk, marker, root, store } = await setUp();

    await store.update(ID, DISCARDED, TAG);

    const healed = disk.fail(
      (op) => op === `rename ${ID}/capture.json.prev -> ${ID}/capture.json`,
      "EPERM"
    );

    const first = await store.discard(ID, TAG);
    const restart = await mkdtemp(path.join(tmpdir(), "inset-pin-restart-"));

    await cp(root, restart, { recursive: true });

    const stranded = {
      live: store.get(ID)?.kind === "ok" ? "DISCARDED title" : "?",
      marker: existsSync(marker),
      restart: await startFrom(restart),
      result: first,
    };

    healed();
    disk.state.armed = true;

    const second = await store.discard(ID, { epoch: "page.9", seq: 9 });

    await idle(store);

    expect({
      ...(await afterCrashes(disk.crashes)),
      live: await startFrom(root),
      marker: existsSync(marker),
      second: second.ok,
      stranded,
    }).toStrictEqual({
      crashed: true,
      found: ["SAVED title (active)"],
      live: "SAVED title (active)",
      marker: false,
      second: true,
      stranded: {
        live: "DISCARDED title",
        marker: true,
        restart: "SAVED title (active)",
        result: {
          error: "writeFailed",
          message: "Inset can’t write to its data folder.",
          ok: false,
        },
      },
    });
  });

  it("keeps a Discard that couldn't finish when a later page's save is dropped before it starts", async () => {
    const { disk, marker, root, store } = await setUp();

    await store.update(ID, DISCARDED, TAG);
    disk.fail(
      (op) => op === `rename ${ID}/capture.json.prev -> ${ID}/capture.json`,
      "EPERM"
    );
    await store.discard(ID, TAG);

    const writing = disk.hold(
      (op) => op.startsWith(`write ${ID}/`) && op.endsWith(".tmp")
    );

    const dropped = store.update(ID, { ...SAVED, title: "Dropped" }, KEEP);

    await writing.reached;
    void store.discard(ID, KEEP);
    writing.release();
    await dropped;
    await idle(store);

    const restart = await mkdtemp(path.join(tmpdir(), "inset-pin-restart-"));

    await cp(root, restart, { recursive: true });

    expect({
      marker: existsSync(marker),
      restart: await startFrom(restart),
    }).toStrictEqual({ marker: true, restart: "SAVED title (active)" });
  });

  it("keeps the edit a Retry saves after a failed Discard: a crash before it lands comes back to the saved version, one after it to the edit", async () => {
    const { disk, marker, root, store } = await setUp();

    await store.update(ID, DISCARDED, TAG);

    const stuck = disk.fail(
      (op) => op === `rename ${ID}/capture.json.prev -> ${ID}/capture.json`,
      "EPERM"
    );

    await store.discard(ID, TAG);
    stuck();
    disk.state.armed = true;

    const kept = await store.update(
      ID,
      { ...SAVED, title: "KEPT title" },
      KEEP
    );

    await idle(store);

    const found = await Promise.all(disk.crashes.map(startFrom));

    expect({
      kept: kept.ok,
      live: await startFrom(root),
      marker: existsSync(marker),
      order: found.filter((each, index) => each !== found[index - 1]),
    }).toStrictEqual({
      kept: true,
      live: "KEPT title (active)",
      marker: false,
      order: ["SAVED title (active)", "KEPT title (active)"],
    });
  });

  it("still goes back to the version saved before the failed Discard when the Retry that keeps it is discarded on its way in", async () => {
    const { disk, marker, root, store } = await setUp();

    await store.update(ID, DISCARDED, TAG);

    const stuck = disk.fail(
      (op) => op === `rename ${ID}/capture.json.prev -> ${ID}/capture.json`,
      "EPERM"
    );

    await store.discard(ID, TAG);
    stuck();

    const renamingIn = disk.hold(
      (op) =>
        op.startsWith(`rename ${ID}/capture.json.`) &&
        op.endsWith(`.tmp -> ${ID}/capture.json`)
    );

    const keeping = store.update(ID, { ...SAVED, title: "KEPT title" }, KEEP);

    await renamingIn.reached;
    disk.state.armed = true;

    const discarded = store.discard(ID, KEEP);

    renamingIn.release();
    await keeping;
    await discarded;
    await idle(store);

    expect({
      ...(await afterCrashes(disk.crashes)),
      live: await startFrom(root),
      marker: existsSync(marker),
    }).toStrictEqual({
      crashed: true,
      found: ["SAVED title (active)"],
      live: "SAVED title (active)",
      marker: false,
    });
  });

  it("never lets a marker left by a finished Discard undo a later save", async () => {
    const { disk, marker, root, store } = await setUp();

    await store.update(ID, DISCARDED, TAG);

    const stuck = disk.fail(
      (op) => op === `rm ${ID}/capture.json.discard`,
      "EPERM"
    );

    await store.discard(ID, TAG);

    const left = existsSync(marker);

    stuck();
    disk.state.armed = true;

    const later = await store.update(
      ID,
      { ...SAVED, title: "LATER title" },
      KEEP
    );

    await idle(store);

    const found = await Promise.all(disk.crashes.map(startFrom));

    expect({
      later: later.ok,
      left,
      live: await startFrom(root),
      order: found.filter((each, index) => each !== found[index - 1]),
    }).toStrictEqual({
      later: true,
      left: true,
      live: "LATER title (active)",
      order: ["SAVED title (active)", "LATER title (active)"],
    });
  });
});

describe("A new capture withdrawn while its save is on its way", () => {
  it("is never listed after a crash at any step, once its tombstone is down", async () => {
    const root = path.join(
      await mkdtemp(path.join(tmpdir(), "inset-pin-crash-root-")),
      "captures"
    );

    const disk = crashDisk(root);

    const store = await openCaptureStore(root, {
      fs: disk.fs,
      retryDelaysMs: [],
    });

    const placing = disk.hold((op) => op.startsWith("rename .staging/"));
    const publishing = store.publish(recordOf(ID), PNG);

    await placing.reached;

    const withdrawn = store.withdraw(ID);

    await vi.waitFor(() => {
      expect(existsSync(path.join(root, `${ID}.withdrawn`))).toBeTruthy();
    });
    disk.state.armed = true;
    placing.release();
    await publishing;
    await withdrawn;
    await idle(store);

    expect({
      ...(await afterCrashes(disk.crashes)),
      listed: store.list().map((entry) => entry.id),
      live: await startFrom(root),
    }).toStrictEqual({
      crashed: true,
      found: ["gone"],
      listed: [],
      live: "gone",
    });
  });

  it("drops a save that hasn't started placing its folder, so a quit doesn't wait for it", async () => {
    const root = path.join(
      await mkdtemp(path.join(tmpdir(), "inset-pin-crash-root-")),
      "captures"
    );

    const disk = crashDisk(root);

    const store = await openCaptureStore(root, {
      fs: disk.fs,
      retryDelaysMs: [],
    });

    const writing = disk.hold((op) => op.startsWith("write .staging/"));
    const publishing = store.publish(recordOf(ID), PNG);

    await writing.reached;

    const withdrawn = store.withdraw(ID);

    const whileHeld = await Promise.race([
      store.settled().then(() => "settled"),
      delay(500).then(() => "still waiting"),
    ]);

    writing.release();

    const published = await publishing;
    const result = await withdrawn;

    expect({
      live: await startFrom(root),
      published,
      whileHeld,
      withdrawn: result.ok,
    }).toStrictEqual({
      live: "gone",
      published: {
        error: "discarded",
        message: "The capture was discarded.",
        ok: false,
      },
      whileHeld: "settled",
      withdrawn: true,
    });
  });
});
