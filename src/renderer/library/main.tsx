import "@/shared/zod-jitless";
import "@/styles.css";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { libraryBridge } from "@/shared/bridge";
import { isMac } from "@/shared/platform";
import { followSystemTheme } from "@/shared/theme";

import { router } from "./router";

followSystemTheme();

libraryBridge().on("changed", () => {
  void router.invalidate();
});

// macOS closes the window with Cmd+W through its app menu; Windows has no menu, so Ctrl+W is handled here.
if (!isMac) {
  window.addEventListener("keydown", (event) => {
    if (
      event.key.toLowerCase() === "w" &&
      event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      window.close();
    }
  });
}

const root = document.querySelector("#root");

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
}
