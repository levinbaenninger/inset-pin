import "@/shared/zod-jitless";
import "@/styles.css";
import { CaptureIdSchema } from "@shared/capture-record";
import type { ActionResult, FlushRequest, SavedEdits } from "@shared/contracts";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import { libraryBridge } from "@/shared/bridge";
import { promptOpen } from "@/shared/key-targets";
import { handleMenuKeys } from "@/shared/keys";
import { reportMenusTo } from "@/shared/menu-keys";
import { markPlatform } from "@/shared/platform";
import { followSystemTheme } from "@/shared/theme";

import { startCommandBus } from "./command-bus";
import { drafts, leaveHold } from "./library-drafts";
import { openLibrary } from "./opening";
import { OwedUnread } from "./owed-unread";
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

// A Discard a closed or reloaded page sent may still be owed, so this page shows it before it answers or reports anything. Main asks a page that may not answer, so it keeps the count it last heard until this page reports its own.
const opening = openLibrary({
  drafts,
  owed: async () => await libraryBridge().owedDiscards(),
  report: (count) => {
    libraryBridge().unsavedCount(count);
  },
});

/** Before a copy, a close or a quit, main waits for what is typed to be saved, and hears how it went. */
const answerFlush = async (request: FlushRequest): Promise<SavedEdits> => {
  await opening.opened;

  if (request.id === null) {
    return withoutFields(leaveHold.ask(request.leaving));
  }

  return request.retry
    ? withoutFields(await drafts.retry(request.id))
    : await drafts.settle(request.id);
};

libraryBridge().on("flush", (request) => {
  void (async () => {
    libraryBridge().flushed({
      result: await answerFlush(request),
      token: request.token,
    });
  })();
});

// A capture chosen from the tray or the Dock menu; while a prompt is open, the capture behind it stays.
libraryBridge().on("show", (id) => {
  const parsed = CaptureIdSchema.safeParse(id);

  if (parsed.success && !promptOpen()) {
    void router.navigate({
      params: { captureId: parsed.data },
      to: "/captures/$captureId",
    });
  }
});

handleMenuKeys({
  ",": () => {
    if (!promptOpen()) {
      libraryBridge().openSettings();
    }
  },
});

/** The captures show only once the page knows which Discards main still owes. */
const Library = () => {
  const state = useSyncExternalStore(opening.subscribe, opening.get);

  if (state === "reading") {
    return null;
  }

  if (state === "unread") {
    return <OwedUnread />;
  }

  return <RouterProvider router={router} />;
};

const root = document.querySelector("#root");

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <Library />
    </StrictMode>
  );
}
