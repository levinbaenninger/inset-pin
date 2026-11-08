import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src/renderer"),
      "@shared": path.resolve(import.meta.dirname, "src/shared"),
      // Unit tests never load Electron: requiring it downloads its binary (scripts/fixtures/no-electron.ts).
      electron: path.resolve(
        import.meta.dirname,
        "scripts/fixtures/no-electron.ts"
      ),
    },
  },
  test: { include: ["src/**/*.test.ts", "scripts/**/*.test.ts"] },
});
