import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const renderer = path.resolve(import.meta.dirname, "src/renderer");
const shared = path.resolve(import.meta.dirname, "src/shared");
const preload = path.resolve(import.meta.dirname, "src/preload");

export default defineConfig({
  main: {
    resolve: { alias: { "@shared": shared } },
  },
  preload: {
    resolve: { alias: { "@shared": shared } },
    build: {
      // Sandboxed preloads cannot load ESM or node_modules: each entry is one standalone CJS file.
      externalizeDeps: false,
      isolatedEntries: true,
      rolldownOptions: {
        input: {
          capture: path.resolve(preload, "capture.ts"),
          library: path.resolve(preload, "library.ts"),
        },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: renderer,
    resolve: { alias: { "@": renderer, "@shared": shared } },
    build: {
      rolldownOptions: {
        input: {
          capture: path.resolve(renderer, "capture.html"),
          library: path.resolve(renderer, "library.html"),
        },
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
