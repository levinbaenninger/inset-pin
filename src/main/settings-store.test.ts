import { DEFAULT_SETTINGS } from "@shared/settings";
import { describe, expect, it } from "vitest";

import { openSettingsStore } from "./settings-store";
import type { SettingsFs } from "./settings-store";

const memoryFs = (): SettingsFs & { readonly files: Map<string, string> } => {
  const files = new Map<string, string>();

  return {
    files,
    readFile: async (file) => {
      const text = files.get(file);

      if (text === undefined) {
        throw new Error("ENOENT");
      }

      return await Promise.resolve(text);
    },
    writeAtomic: async (file, text) => {
      files.set(file, text);
      await Promise.resolve();
    },
  };
};

describe(openSettingsStore, () => {
  it("starts from the defaults without a file", async () => {
    const store = await openSettingsStore("/data", memoryFs());

    expect(store.current()).toStrictEqual(DEFAULT_SETTINGS);
  });

  it("writes a change and reads it back", async () => {
    const fs = memoryFs();
    const first = await openSettingsStore("/data", fs);

    await first.update({ copyAfterSave: true });

    const second = await openSettingsStore("/data", fs);

    expect(second.current()).toStrictEqual({
      ...DEFAULT_SETTINGS,
      copyAfterSave: true,
    });
  });

  it("keeps a change for this run when the write fails", async () => {
    const store = await openSettingsStore("/data", {
      ...memoryFs(),
      writeAtomic: async () => {
        await Promise.reject(new Error("EACCES"));
      },
    });

    await expect(store.update({ iconIn: "menuBar" })).rejects.toThrow("EACCES");
    expect(store.current().iconIn).toBe("menuBar");
  });
});
