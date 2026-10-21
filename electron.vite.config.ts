import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const renderer = path.resolve(import.meta.dirname, "src/renderer");

export default defineConfig({
  main: {
    resolve: {
      alias: { "@shared": path.resolve(import.meta.dirname, "src/shared") },
    },
  },
  preload: {
    resolve: {
      alias: { "@shared": path.resolve(import.meta.dirname, "src/shared") },
    },
    build: {
      rolldownOptions: {
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: renderer,
    resolve: {
      alias: {
        "@": renderer,
        "@shared": path.resolve(import.meta.dirname, "src/shared"),
      },
    },
    build: {
      rolldownOptions: {
        input: {
          capture: path.resolve(renderer, "capture.html"),
          library: path.resolve(renderer, "library.html"),
        },
      },
    },
    plugins: [
      tanstackRouter({
        target: "react",
        routesDirectory: path.resolve(renderer, "library/routes"),
        generatedRouteTree: path.resolve(renderer, "library/routeTree.gen.ts"),
      }),
      react(),
      tailwindcss(),
    ],
  },
});
