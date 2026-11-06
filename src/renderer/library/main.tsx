import "@/shared/zod-jitless";
import "@/styles.css";
import { CaptureIdSchema } from "@shared/capture-record";
import type { FlushRequest } from "@shared/contracts";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { libraryBridge } from "@/shared/bridge";
import { handleMenuKeys } from "@/shared/keys";
import { markPlatform } from "@/shared/platform";
import { followSystemTheme } from "@/shared/theme";

import { startCommandBus } from "./command-bus";
import { settleAllEdits, settleEdits } from "./pending-edits";
import { router } from "./router";

followSystemTheme();

markPlatform();

startCommandBus();

libraryBridge().on("changed", () => {
  void router.invalidate();
});

// Before a copy, a close or a quit, main waits for what is typed to be saved, and hears how it went.
const answerFlush = async ({ id, token }: FlushRequest): Promise<void> => {
  const result = await (id === null ? settleAllEdits() : settleEdits(id));

  libraryBridge().flushed({ result, token });
};

libraryBridge().on("flush", (request) => {
  void answerFlush(request);
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
