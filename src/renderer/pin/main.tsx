import "@/shared/zod-jitless";
import "@/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { handleMenuKeys } from "@/shared/keys";
import { followSystemTheme } from "@/shared/theme";

import { PinApp } from "./pin-app";

followSystemTheme();

handleMenuKeys({});

const root = document.querySelector("#root");

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <PinApp />
    </StrictMode>
  );
}
