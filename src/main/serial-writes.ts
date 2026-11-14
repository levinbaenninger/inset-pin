/** Writes a whole text file in one step, as the app's own atomic write does. */
export interface TextFileWriter {
  readonly readFile: (file: string) => Promise<string>;
  readonly writeAtomic: (file: string, data: string) => Promise<void>;
}

/**
 * The same files, written one at a time per file. A write that starts while
 * another to the same file is on its way waits for it, so they land in the
 * order they were asked for. On Windows two renames onto the same file at
 * once fail with EPERM, which lost one of them.
 */
export const serialWrites = (fs: TextFileWriter): TextFileWriter => {
  const queues = new Map<string, Promise<void>>();

  return {
    readFile: fs.readFile,
    writeAtomic: async (file, data) => {
      const before = queues.get(file);

      const run = async (): Promise<void> => {
        try {
          await before;
        } catch {
          // The previous write's failure is its caller's: this one still goes ahead.
        }

        await fs.writeAtomic(file, data);
      };

      const mine = run();

      queues.set(file, mine);

      try {
        await mine;
      } finally {
        if (queues.get(file) === mine) {
          queues.delete(file);
        }
      }
    },
  };
};
