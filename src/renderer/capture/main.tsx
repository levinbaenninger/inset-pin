import "@/shared/zod-jitless";
import "@/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { isMac } from "@/shared/platform";
import { followSystemTheme } from "@/shared/theme";

import { CaptureApp } from "./capture-app";

followSystemTheme();

// The panel window is transparent on Windows and draws its own corners (src/main/surface.ts).
if (!isMac) {
  document.documentElement.dataset.corners = "drawn";
}

const root = document.querySelector("#root");

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <TooltipProvider delayDuration={400}>
        <CaptureApp />
      </TooltipProvider>
    </StrictMode>
  );
}
