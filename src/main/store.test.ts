import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { CaptureIdSchema } from "@shared/capture-record";
import type { CaptureRecord, EditableFields } from "@shared/capture-record";
import { DueDateSchema } from "@shared/due";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { failNextWrite, nodeStoreFs, openCaptureStore } from "./store";
import type { CaptureStore, StoreFs } from "./store";

const ID = CaptureIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c");

const FOREIGN_ID = CaptureIdSchema.parse(
  "11111111-2222-4333-8444-555555555555"
);

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const EDIT_TIME = new Date("2026-10-21T19:00:00.000Z");

const record: CaptureRecord = {
  capturedAt: "2026-10-21T18:40:12.345Z",
  description: "",
  due: null,
  id: ID,
  image: { file: "crop.png", heightPx: 600, pixelsPerDip: 2, widthPx: 960 },
  invokedVia: "shortcut",
  pins: [{ x: 240, y: 100 }],
  schemaVersion: 2,
  source: { kind: "display", label: "Built-in Retina Display" },
  status: { kind: "active" },
  steps: [],
  title: "This total ignores the discount row",
  updatedAt: "2026-10-21T18:40:31.002Z",
};

const v1Json = JSON.stringify({
  capturedAt: record.capturedAt,
  id: ID,
  image: record.image,
  invokedVia: "shortcut",
  pin: { x: 240, y: 100 },
  schemaVersion: 1,
  source: record.source,
  thought: "This total ignores the discount row\nCheck with finance",
  updatedAt: record.updatedAt,
});

const fields = (change: Partial<EditableFields> = {}): EditableFields => ({
  description: record.description,
  due: record.due,
  pins: record.pins,
  steps: record.steps,
  title: record.title,
  ...change,
});

const retried: CaptureRecord = {
  ...record,
  updatedAt: "2026-10-21T18:45:00.000Z",
};

type Op = "mkdir" | "readdir" | "readFile" | "write" | "rename" | "rm" | "sync";

type FailWhen = (op: Op, target: string) => boolean;

interface FaultControl {
  failWhen: FailWhen | null;
}

let root = "";

const relative = (target: string): string =>
  path.relative(root, target).split(path.sep).join("/") || ".";

const createFaultFs = () => {
  const log: string[] = [];
  const control: FaultControl = { failWhen: null };

  const guard = async <T>(
    op: Op,
    target: string,
    run: () => Promise<T>
  ): Promise<T> => {
    log.push(`${op} ${relative(target)}`);

    if (control.failWhen?.(op, target) === true) {
      throw Object.assign(new Error(`Injected ${op} failure`), { code: "EIO" });
    }

    return await run();
  };

  const fs: StoreFs = {
    mkdir: async (target) => {
      await guard("mkdir", target, async () => {
        await nodeStoreFs.mkdir(target);
      });
    },
    readFile: async (target) =>
      await guard(
        "readFile",
        target,
        async () => await nodeStoreFs.readFile(target)
      ),
    readdir: async (target) =>
      await guard(
        "readdir",
        target,
        async () => await nodeStoreFs.readdir(target)
      ),
    rename: async (from, to) => {
      await guard("rename", to, async () => {
        await nodeStoreFs.rename(from, to);
      });
    },
    rm: async (target) => {
      await guard("rm", target, async () => {
        await nodeStoreFs.rm(target);
      });
    },
    syncDirectory: async (target) => {
      await guard("sync", target, async () => {
        await nodeStoreFs.syncDirectory(target);
      });
    },
    writeFileDurable: async (target, data) => {
      await guard("write", target, async () => {
        await nodeStoreFs.writeFileDurable(target, data);
      });
    },
  };

  return { control, fs, log };
};

const counterNonce = (): (() => string) => {
  let next = 0;

  return () => {
    next += 1;

    return `n${next}`;
  };
};

const open = async (fs?: StoreFs): Promise<CaptureStore> =>
  await openCaptureStore(root, {
    fs,
    nonce: counterNonce(),
    now: () => EDIT_TIME,
    retryDelaysMs: [0, 0, 0],
  });

const listDir = async (...segments: string[]): Promise<string[]> => {
  const names = await readdir(path.join(root, ...segments));

  return names.toSorted();
};

const layout = async () => ({
  root: await listDir(),
  staging: await listDir(".staging"),
  trash: await listDir(".trash"),
});

const readText = async (...segments: string[]): Promise<string> =>
  await readFile(path.join(root, ...segments), "utf-8");

const reopenList = async () => {
  const store = await open();

  return store.list();
};

const seed = async (id: string, json: string): Promise<void> => {
  await mkdir(path.join(root, id));
  await writeFile(path.join(root, id, "capture.json"), json);
  await writeFile(path.join(root, id, "crop.png"), PNG);
};

describe(openCaptureStore, () => {
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "inset-store-"));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("publishes a capture that survives reopening", async () => {
    const store = await open();

    await expect(store.publish(record, PNG)).resolves.toStrictEqual({
      ok: true,
      value: record,
    });
    await expect(reopenList()).resolves.toStrictEqual([
      { id: ID, kind: "ok", migratedFrom: null, record },
    ]);
    await expect(
      readFile(path.join(root, ID, "crop.png"))
    ).resolves.toStrictEqual(Buffer.from(PNG));
    await expect(layout()).resolves.toStrictEqual({
      root: [".staging", ".trash", ID],
      staging: [],
      trash: [],
    });
  });

  it.each<[string, FailWhen, string]>([
    [
      "writing crop.png",
      (op, target) => op === "write" && target.endsWith("crop.png"),
      "Injected write failure",
    ],
    [
      "writing capture.json",
      (op, target) => op === "write" && target.endsWith("capture.json"),
      "Injected write failure",
    ],
    [
      "renaming staging into place",
      (op, target) => op === "rename" && target.endsWith(ID),
      "Injected rename failure",
    ],
  ])(
    "leaves no partial entry when %s fails",
    async (_label, failWhen, message) => {
      const fault = createFaultFs();
      const store = await open(fault.fs);

      fault.control.failWhen = failWhen;

      await expect(store.publish(record, PNG)).resolves.toStrictEqual({
        error: "writeFailed",
        message,
        ok: false,
      });
      expect(store.list()).toStrictEqual([]);
      await expect(layout()).resolves.toStrictEqual({
        root: [".staging", ".trash"],
        staging: [],
        trash: [],
      });
    }
  );

  it("succeeds when the same draft is retried after a failed write", async () => {
    const fault = createFaultFs();
    const store = await open(fault.fs);

    fault.control.failWhen = (op) => op === "write";
    await store.publish(record, PNG);
    fault.control.failWhen = null;

    await expect(store.publish(record, PNG)).resolves.toStrictEqual({
      ok: true,
      value: record,
    });
    await expect(reopenList()).resolves.toStrictEqual([
      { id: ID, kind: "ok", migratedFrom: null, record },
    ]);
  });

  it("treats a second publish of the same capture as success with one directory", async () => {
    const store = await open();

    await store.publish(record, PNG);

    await expect(store.publish(retried, PNG)).resolves.toStrictEqual({
      ok: true,
      value: record,
    });
    await expect(listDir()).resolves.toStrictEqual([".staging", ".trash", ID]);
  });

  it("refuses a second publish of the same id with a different title", async () => {
    const store = await open();

    await store.publish(record, PNG);

    await expect(
      store.publish({ ...retried, title: "Edited before the retry" }, PNG)
    ).resolves.toStrictEqual({
      error: "writeFailed",
      message: "Another entry already uses this capture id.",
      ok: false,
    });
    expect(store.list()).toStrictEqual([
      { id: ID, kind: "ok", migratedFrom: null, record },
    ]);
    await expect(readText(ID, "capture.json")).resolves.toBe(
      JSON.stringify(record, null, 2)
    );
  });

  it("adopts an identical entry that already exists at the final path", async () => {
    const store = await open();

    await seed(ID, JSON.stringify(record));

    await expect(store.publish(retried, PNG)).resolves.toStrictEqual({
      ok: true,
      value: record,
    });
    expect(store.list()).toStrictEqual([
      { id: ID, kind: "ok", migratedFrom: null, record },
    ]);
    await expect(listDir(".staging")).resolves.toStrictEqual([]);
  });

  it.each<[string, Partial<CaptureRecord>]>([
    ["title", { title: "Edited before the retry" }],
    ["pin", { pins: [{ x: 241, y: 100 }] }],
    ["pin count", { pins: [] }],
    ["crop size", { image: { ...record.image, widthPx: 1358 } }],
  ])(
    "keeps the draft when the entry at the final path has a different %s",
    async (_label, change) => {
      const store = await open();

      await seed(ID, JSON.stringify(record));

      await expect(
        store.publish({ ...retried, ...change }, PNG)
      ).resolves.toMatchObject({ error: "writeFailed", ok: false });
      expect(store.list()).toStrictEqual([]);
      await expect(readText(ID, "capture.json")).resolves.toBe(
        JSON.stringify(record)
      );
      await expect(listDir(".staging")).resolves.toStrictEqual([]);
    }
  );

  it("never rewrites or removes an entry from a newer version", async () => {
    const foreignJson = `{"schemaVersion":3,"id":"${FOREIGN_ID}"}`;

    await seed(FOREIGN_ID, foreignJson);

    const store = await open();

    expect(store.list()).toStrictEqual([
      { id: FOREIGN_ID, kind: "foreign", schemaVersion: 3 },
    ]);
    await expect(store.update(FOREIGN_ID, fields())).resolves.toMatchObject({
      error: "readOnly",
    });
    await expect(store.remove(FOREIGN_ID)).resolves.toMatchObject({
      error: "readOnly",
    });
    await expect(readText(FOREIGN_ID, "capture.json")).resolves.toBe(
      foreignJson
    );
    expect(store.imageFile(FOREIGN_ID)).toBeNull();
  });

  it("updates the fields, stamps updatedAt and keeps unknown keys", async () => {
    await seed(ID, JSON.stringify({ ...record, future: 1 }));

    const store = await open();

    const change = fields({
      description: "Check with finance",
      due: DueDateSchema.parse("2026-11-07"),
      pins: [
        { label: "Total", x: 240, y: 100 },
        { x: 10, y: 20 },
      ],
      steps: [{ done: true, id: "s1", text: "Ask" }],
      title: "New title",
    });

    const updated = {
      ...record,
      ...change,
      future: 1,
      updatedAt: "2026-10-21T19:00:00.000Z",
    };

    await expect(store.update(ID, change)).resolves.toStrictEqual({
      ok: true,
      value: updated,
    });
    await expect(readText(ID, "capture.json")).resolves.toBe(
      JSON.stringify(updated, null, 2)
    );
    await expect(reopenList()).resolves.toStrictEqual([
      { id: ID, kind: "ok", migratedFrom: null, record: updated },
    ]);
  });

  it("reads a v1 capture as v2 and leaves its file alone until an edit", async () => {
    await seed(ID, v1Json);

    const store = await open();

    expect(store.get(ID)).toMatchObject({
      kind: "ok",
      migratedFrom: 1,
      record: {
        description: "This total ignores the discount row\nCheck with finance",
        pins: [{ x: 240, y: 100 }],
        title: "This total ignores the discount row",
      },
    });
    await expect(readText(ID, "capture.json")).resolves.toBe(v1Json);

    await store.setDone(ID, true);

    const written = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(await readText(ID, "capture.json")));

    expect(written).toMatchObject({
      description: "This total ignores the discount row\nCheck with finance",
      pins: [{ x: 240, y: 100 }],
      schemaVersion: 2,
      status: { at: "2026-10-21T19:00:00.000Z", kind: "done" },
      title: "This total ignores the discount row",
    });
    expect("thought" in written).toBeFalsy();
    expect("pin" in written).toBeFalsy();
  });

  it("settles only once every queued write, and any queued meanwhile, is done", async () => {
    const store = await open();

    await store.publish(record, PNG);

    const first = store.update(ID, fields({ title: "First" }));
    const settled = store.settled();
    const second = store.update(ID, fields({ title: "Second" }));

    await settled;

    expect(store.get(ID)).toMatchObject({ record: { title: "Second" } });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("marks a capture done and active again", async () => {
    const store = await open();

    await store.publish(record, PNG);

    await expect(store.setDone(ID, true)).resolves.toMatchObject({
      value: { status: { kind: "done" } },
    });
    await expect(store.setDone(ID, false)).resolves.toMatchObject({
      value: { status: { kind: "active" } },
    });
  });

  it("keeps the old record on disk and in the cache when an edit cannot be committed", async () => {
    const fault = createFaultFs();
    const store = await open(fault.fs);

    await store.publish(record, PNG);
    fault.control.failWhen = (op, target) =>
      op === "rename" && target.endsWith("capture.json");

    await expect(
      store.update(ID, fields({ title: "Lost?" }))
    ).resolves.toMatchObject({
      error: "writeFailed",
    });
    expect(store.get(ID)).toStrictEqual({
      id: ID,
      kind: "ok",
      migratedFrom: null,
      record,
    });
    await expect(readText(ID, "capture.json")).resolves.toBe(
      JSON.stringify(record, null, 2)
    );
    await expect(listDir(ID)).resolves.toStrictEqual([
      "capture.json",
      "crop.png",
    ]);
  });

  it("refuses a blank title and a pin outside the crop", async () => {
    const store = await open();

    await store.publish(record, PNG);

    await expect(
      store.update(ID, fields({ title: "  " }))
    ).resolves.toMatchObject({
      error: "invalid",
    });
    await expect(
      store.update(ID, fields({ pins: [{ x: 960, y: 0 }] }))
    ).resolves.toMatchObject({
      error: "invalid",
    });
  });

  it("removes crash leftovers from staging at open", async () => {
    await mkdir(path.join(root, ".staging", `${ID}.x`), { recursive: true });
    await writeFile(path.join(root, ".staging", `${ID}.x`, "crop.png"), PNG);

    const store = await open();

    expect(store.list()).toStrictEqual([]);
    await expect(listDir(".staging")).resolves.toStrictEqual([]);
  });

  it("runs mutations in issue order", async () => {
    const fault = createFaultFs();
    const store = await open(fault.fs);

    fault.log.length = 0;

    const results = await Promise.all([
      store.publish(record, PNG),
      store.update(ID, fields({ title: "Edited" })),
      store.remove(ID),
    ]);

    expect(results.map((result) => result.ok)).toStrictEqual([
      true,
      true,
      true,
    ]);
    expect(fault.log).toStrictEqual([
      `mkdir .staging/${ID}.n1`,
      `write .staging/${ID}.n1/crop.png`,
      `write .staging/${ID}.n1/capture.json`,
      `rename ${ID}`,
      "sync .",
      `write ${ID}/capture.json.n2.tmp`,
      `rename ${ID}/capture.json`,
      `rename .trash/${ID}.n3`,
      `rm .trash/${ID}.n3`,
    ]);
    expect(store.list()).toStrictEqual([]);
    await expect(listDir()).resolves.toStrictEqual([".staging", ".trash"]);
  });

  it("flushes the captures directory right after publishing", async () => {
    const fault = createFaultFs();
    const store = await open(fault.fs);

    fault.log.length = 0;
    await store.publish(record, PNG);

    expect(fault.log.slice(-2)).toStrictEqual([`rename ${ID}`, "sync ."]);
    await expect(nodeStoreFs.syncDirectory(root)).resolves.toBeUndefined();
  });

  it("still publishes when the directory flush fails", async () => {
    const fault = createFaultFs();
    const store = await open(fault.fs);

    fault.control.failWhen = (op) => op === "sync";

    await expect(store.publish(record, PNG)).resolves.toStrictEqual({
      ok: true,
      value: record,
    });
    await expect(reopenList()).resolves.toStrictEqual([
      { id: ID, kind: "ok", migratedFrom: null, record },
    ]);
  });

  it("retries a rename blocked by a transient lock", async () => {
    let failures = 2;

    const busy: StoreFs = {
      ...nodeStoreFs,
      rename: async (from, to) => {
        if (failures > 0) {
          failures -= 1;
          throw Object.assign(new Error("busy"), { code: "EBUSY" });
        }

        await nodeStoreFs.rename(from, to);
      },
    };

    const store = await open(busy);

    await expect(store.publish(record, PNG)).resolves.toStrictEqual({
      ok: true,
      value: record,
    });
    expect(failures).toBe(0);
  });

  it("fails the next write once when armed by INSET_FAIL_NEXT_WRITE", async () => {
    const store = await open(failNextWrite(nodeStoreFs));

    await expect(store.publish(record, PNG)).resolves.toStrictEqual({
      error: "writeFailed",
      message: "Simulated write failure (INSET_FAIL_NEXT_WRITE)",
      ok: false,
    });
    await expect(store.publish(record, PNG)).resolves.toStrictEqual({
      ok: true,
      value: record,
    });
  });
});
