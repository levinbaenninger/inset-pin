import "@/shared/zod-jitless";
import "@/styles.css";
import { CaptureIdSchema } from "@shared/capture-record";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { libraryBridge } from "@/shared/bridge";
import { handleMenuKeys } from "@/shared/keys";
import { markPlatform } from "@/shared/platform";
import { followSystemTheme } from "@/shared/theme";

import { startCommandBus } from "./command-bus";
import { settleAllEdits } from "./pending-edits";
import { router } from "./router";

followSystemTheme();

markPlatform();

startCommandBus();

libraryBridge().on("changed", () => {
  void router.invalidate();
});

// Before the window closes or the app quits, main waits for what is typed to be saved.
const answerFlush = async (token: string): Promise<void> => {
  await settleAllEdits();
  libraryBridge().flushed(token);
};

libraryBridge().on("flush", (token) => {
  void answerFlush(token);
});

// A capture chosen from the tray or the Dock menu.
libraryBridge().on("show", (id) => {
  const parsed = CaptureIdSchema.safeParse(id);

  if (parsed.success) {
    void router.navigate({
      params: { captureId: parsed.data },
      to: "/captures/$captureId",
    });
  }
});

handleMenuKeys({
  ",": () => {
    libraryBridge().openSettings();
  },
});

const root = document.querySelector("#root");

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
}
