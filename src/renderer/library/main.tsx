import "@/shared/zod-jitless";
import "@/styles.css";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { libraryBridge } from "@/shared/bridge";
import { followSystemTheme } from "@/shared/theme";

import { router } from "./router";

followSystemTheme();

libraryBridge().on("changed", () => {
  void router.invalidate();
});

const root = document.querySelector("#root");

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
}
