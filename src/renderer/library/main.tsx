import "@/shared/zod-jitless";
import "@/styles.css";
import { CaptureIdSchema } from "@shared/capture-record";
import type { ActionResult, FlushRequest, SavedEdits } from "@shared/contracts";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { libraryBridge } from "@/shared/bridge";
import { handleMenuKeys } from "@/shared/keys";
import { reportMenusTo } from "@/shared/menu-keys";
import { markPlatform } from "@/shared/platform";
import { followSystemTheme } from "@/shared/theme";

import { startCommandBus } from "./command-bus";
import { drafts, leaveHold } from "./library-drafts";
import { router } from "./router";

followSystemTheme();

markPlatform();

startCommandBus();

reportMenusTo((open) => {
  libraryBridge().menuOpen(open);
});

libraryBridge().on("changed", () => {
  void router.invalidate();
});

const withoutFields = (result: ActionResult): SavedEdits =>
  result.ok ? { fields: null, ok: true } : result;

// Before a copy, a close or a quit, main waits for what is typed to be saved, and hears how it went.
const answerFlush = async (request: FlushRequest): Promise<void> => {
  const result =
    request.id === null
      ? withoutFields(await leaveHold.ask(request.leaving))
      : await drafts.settle(request.id);

  libraryBridge().flushed({ result, token: request.token });
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
