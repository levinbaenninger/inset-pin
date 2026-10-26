import "@/shared/zod-jitless";
import "@/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { handleMenuKeys } from "@/shared/keys";
import { markPlatform } from "@/shared/platform";
import { followSystemTheme } from "@/shared/theme";

import { SettingsApp } from "./settings-app";

followSystemTheme();

markPlatform();

handleMenuKeys({});

const root = document.querySelector("#root");

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <SettingsApp />
    </StrictMode>
  );
}
