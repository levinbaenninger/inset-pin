import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import shadcn from "ultracite/oxlint/shadcn";
import tanstack from "ultracite/oxlint/tanstack";
import vitest from "ultracite/oxlint/vitest";

export default defineConfig({
  env: core.env,
  extends: [core, react, tanstack, vitest, shadcn, antiSlop],
  ignorePatterns: [...core.ignorePatterns, "src/renderer/components/ui/**"],
  jsPlugins: shadcn.jsPlugins,
  options: { typeAware: true },
  overrides: [
    {
      files: ["src/shared/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                message:
                  "src/shared is imported by every process; keep Electron out.",
                name: "electron",
              },
            ],
          },
        ],
      },
    },
  ],
});
