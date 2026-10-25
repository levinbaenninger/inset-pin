import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { readSettings } from "@shared/settings";
import type { Settings } from "@shared/settings";

export interface SettingsFs {
  readonly readFile: (file: string) => Promise<string>;
  /** Replaces the file in one step, so a crash never leaves half of it. */
  readonly writeAtomic: (file: string, text: string) => Promise<void>;
}

export const nodeSettingsFs: SettingsFs = {
  readFile: async (file) => await readFile(file, "utf-8"),
  writeAtomic: async (file, text) => {
    const staged = `${file}.${randomUUID()}.tmp`;

    await writeFile(staged, text, { flush: true });
    await rename(staged, file);
  },
};

export interface SettingsStore {
  readonly current: () => Settings;
  /** Applies a change and writes the whole file; a failed write keeps the change for this run. */
  readonly update: (change: Partial<Settings>) => Promise<Settings>;
}

/** The app's settings, kept in settings.json beside the captures folder. */
export const openSettingsStore = async (
  dataDir: string,
  fs: SettingsFs
): Promise<SettingsStore> => {
  const file = path.join(dataDir, "settings.json");

  let settings = readSettings(await fs.readFile(file).catch((): null => null));

  return {
    current: () => settings,
    update: async (change) => {
      settings = { ...settings, ...change };
      await fs.writeAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);

      return settings;
    },
  };
};
