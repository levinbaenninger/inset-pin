import "@/shared/zod-jitless";
import "@/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { followSystemTheme } from "@/shared/theme";

import { CaptureApp } from "./capture-app";

followSystemTheme();

const root = document.querySelector("#root");

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <CaptureApp />
    </StrictMode>
  );
}
