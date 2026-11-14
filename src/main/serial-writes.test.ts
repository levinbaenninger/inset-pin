import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { serialWrites } from "./serial-writes";

/** A disk where a write takes until it is released, and two at once onto one file fail, as renames do on Windows. */
const slowDisk = () => {
  const files = new Map<string, string>();
  const pending: (() => void)[] = [];
  const writing = new Set<string>();
  let clashes = 0;

  return {
    clashes: () => clashes,
    files,
    fs: {
      readFile: async (file: string) =>
        await Promise.resolve(files.get(file) ?? ""),
      writeAtomic: async (file: string, data: string) => {
        if (writing.has(file)) {
          clashes += 1;

          throw new Error("EPERM: operation not permitted, rename");
        }

        writing.add(file);

        try {
          // oxlint-disable-next-line promise/avoid-new -- the test releases each write by hand.
          await new Promise<void>((resolve) => {
            pending.push(resolve);
          });
          files.set(file, data);
        } finally {
          writing.delete(file);
        }
      },
    },
    /** Lets every write on its way finish, one after another. */
    settle: async () => {
      for (let round = 0; round < 10; round += 1) {
        pending.shift()?.();
        // A finished write lets the next one start, a few promise steps later.
        // oxlint-disable-next-line no-await-in-loop
        await delay(0);
      }
    },
  };
};

describe(serialWrites, () => {
  it("writes one file one write at a time, in the order asked, so none is lost", async () => {
    const disk = slowDisk();
    const fs = serialWrites(disk.fs);

    const writes = [
      fs.writeAtomic("tutorial.json", "1"),
      fs.writeAtomic("tutorial.json", "2"),
      fs.writeAtomic("tutorial.json", "3"),
    ];

    await disk.settle();
    await Promise.all(writes);

    expect({
      clashes: disk.clashes(),
      last: disk.files.get("tutorial.json"),
    }).toStrictEqual({ clashes: 0, last: "3" });
  });

  it("lets a write go ahead after the one before it failed", async () => {
    let calls = 0;

    const fs = serialWrites({
      readFile: async () => await Promise.resolve(""),
      writeAtomic: async () => {
        calls += 1;

        if (calls === 1) {
          throw new Error("disk full");
        }

        await Promise.resolve();
      },
    });

    const first = fs.writeAtomic("f", "a");
    const second = fs.writeAtomic("f", "b");

    await expect(first).rejects.toThrow("disk full");
    await expect(second).resolves.toBeUndefined();
  });
});
