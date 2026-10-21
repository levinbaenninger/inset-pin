import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const renderer = resolve(import.meta.dirname, "src/renderer");

export default defineConfig({
  main: {
    resolve: { alias: { "@shared": resolve(import.meta.dirname, "src/shared") } },
  },
  preload: {
    resolve: { alias: { "@shared": resolve(import.meta.dirname, "src/shared") } },
    build: {
      rolldownOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } },
    },
  },
  renderer: {
    root: renderer,
    resolve: {
      alias: {
        "@": renderer,
        "@shared": resolve(import.meta.dirname, "src/shared"),
      },
    },
    build: {
      rolldownOptions: {
        input: {
          capture: resolve(renderer, "capture.html"),
          library: resolve(renderer, "library.html"),
        },
      },
    },
    plugins: [
      tanstackRouter({
        target: "react",
        routesDirectory: resolve(renderer, "library/routes"),
        generatedRouteTree: resolve(renderer, "library/routeTree.gen.ts"),
      }),
      react(),
      tailwindcss(),
    ],
  },
});
