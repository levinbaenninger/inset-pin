import { randomUUID } from "node:crypto";
import path from "node:path";

import { CaptureIdSchema } from "@shared/capture-record";
import type { PointVia } from "@shared/capture-record";
import { captureContract } from "@shared/contracts";
import { CAPTURE_ACCELERATOR, shortcutLabel } from "@shared/shortcut";
import {
  app,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  Notification,
  shell,
} from "electron";

import { captureDisplay, sampleAnchor } from "./capture";
import { createDraftController } from "./draft";
import { e2eLog } from "./e2e-log";
import { serveContract } from "./ipc-kit";
import { createLibraryWindow } from "./library-window";
import { handleInsetProtocol, registerInsetScheme } from "./protocol";
import { failNextWrite, nodeStoreFs, openCaptureStore } from "./store";
import { createCaptureSurface } from "./surface";
import { createTray } from "./tray";
import {
  appOrigin,
  pageUrl,
  preloadPath,
  rendererRoot,
  secureSession,
} from "./window-security";

const PRODUCT_NAME = "Inset Context Pin";
const APP_ID = "ch.inset.prototype.contextpin";

/** Fixed constant: never built from renderer input. */
const MAC_SCREEN_CAPTURE_SETTINGS =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

const isMac = process.platform === "darwin";

const showNotification = (body: string): void => {
  if (Notification.isSupported()) {
    const notice = new Notification({ body, title: PRODUCT_NAME });

    notice.show();
  }
};

const logRejected = (channel: string, reason: string): void => {
  console.warn(`Rejected IPC on ${channel}: ${reason}`);
};

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Unknown error";

/** Its message is shown to the user, so it must say how to act on it. */
class StartupError extends Error {
  override readonly name = "StartupError";
}

const explainFailure = async <T>(
  task: Promise<T>,
  explain: (cause: string) => string
): Promise<T> => {
  try {
    return await task;
  } catch (error) {
    throw new StartupError(explain(errorMessage(error)), { cause: error });
  }
};

const trayIconPath = (): string => {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, "resources")
    : path.join(app.getAppPath(), "resources");

  return path.join(base, isMac ? "trayTemplate.png" : "tray.png");
};

const start = async (): Promise<void> => {
  await app.whenReady();

  if (isMac) {
    app.dock?.hide();
  }

  // macOS routes Cmd+C/V/X/Z/A and Cmd+W through the application menu; Windows needs none.
  Menu.setApplicationMenu(
    isMac
      ? Menu.buildFromTemplate([
          { role: "appMenu" },
          { role: "fileMenu" },
          { role: "editMenu" },
          { role: "windowMenu" },
        ])
      : null
  );
  secureSession();

  const capturesDir = path.join(app.getPath("userData"), "captures");

  const store = await explainFailure(
    openCaptureStore(capturesDir, {
      fs:
        process.env.INSET_FAIL_NEXT_WRITE === "1"
          ? failNextWrite(nodeStoreFs)
          : nodeStoreFs,
    }),
    (cause) =>
      `${PRODUCT_NAME} can't open its captures folder:\n${capturesDir}\n\n${cause}\n\nCheck that you can read and write this folder, then open ${PRODUCT_NAME} again.`
  );

  const library = createLibraryWindow({
    onClosed: () => {
      e2eLog("libraryClosed");
    },
    onOpened: () => {
      e2eLog("libraryOpened");
    },
    onRejected: logRejected,
    preload: preloadPath("library"),
    store,
    url: pageUrl("library"),
  });

  const surface = createCaptureSurface({
    otherWindowVisible: library.isVisible,
    preload: preloadPath("capture"),
    url: pageUrl("capture"),
  });

  const draft = createDraftController({
    capture: async (display) => {
      const result = await captureDisplay(display);

      if (result.ok) {
        e2eLog("capture");
      }

      return result;
    },
    newId: () => CaptureIdSchema.parse(randomUUID()),
    notify: showNotification,
    now: () => new Date(),
    publish: async (record, png) => {
      const result = await store.publish(record, png);

      e2eLog(result.ok ? "saved" : "saveFailed", { draftId: record.id });

      return result;
    },
    quit: () => {
      app.quit();
    },
    surface,
  });

  const currentDraftId = (): string | undefined => {
    const view = draft.view();

    return view.kind === "draft" ? view.draftId : undefined;
  };

  handleInsetProtocol({
    captureImageFile: store.imageFile,
    draftPreview: (id) => draft.frame(id)?.pixels.previewJpeg() ?? null,
    rendererRoot: rendererRoot(),
  });

  const captureServer = serveContract(
    captureContract,
    {
      discard: (id) => {
        draft.discard(id);

        if (draft.view().kind === "none") {
          e2eLog("discarded", { draftId: id });
        }
      },
      dismiss: () => {
        draft.dismiss();
      },
      edit: ({ content, id }) => {
        draft.edit(id, content);
      },
      getView: () => draft.view(),
      openScreenSettings: () => {
        if (isMac) {
          void shell.openExternal(MAC_SCREEN_CAPTURE_SETTINGS);
        }
      },
      relaunch: () => {
        app.relaunch();
        app.quit();
      },
      reportHeight: ({ height, surfaceKey }) => {
        surface.setContentHeight(height, surfaceKey);
      },
      save: ({ content, id }) => {
        draft.save(id, content);
      },
    },
    {
      appOrigin: appOrigin(),
      ipc: ipcMain,
      onRejected: logRejected,
      target: () => surface.webContents,
    }
  );

  draft.subscribe(() => {
    captureServer.emit("view", draft.view());
  });
  surface.onDismissRequest(() => {
    draft.dismiss();
  });
  surface.onShown((bounds) => {
    e2eLog("panelShown", { bounds, draftId: currentDraftId() });
  });
  surface.onHidden(() => {
    e2eLog("panelHidden");
  });
  await explainFailure(
    surface.load(),
    (cause) =>
      `The capture panel failed to load.\n\n${cause}\n\nOpen ${PRODUCT_NAME} again. If this keeps happening, reinstall it.`
  );

  const pointNow = (via: PointVia): void => {
    draft.invoke({
      anchor: sampleAnchor(),
      at: new Date(),
      kind: "point",
      via,
    });
  };

  const shortcutRegistered =
    globalShortcut.register(CAPTURE_ACCELERATOR, () => {
      pointNow("shortcut");
    }) && globalShortcut.isRegistered(CAPTURE_ACCELERATOR);

  createTray({
    captureNow: () => {
      pointNow("trayDelayed");
    },
    draftState: draft.tray,
    iconPath: trayIconPath(),
    openLibrary: library.open,
    quit: () => {
      app.quit();
    },
    shortcutRegistered,
    showDraft: () => {
      draft.invoke({ kind: "reopen" });
    },
    subscribe: draft.subscribe,
  });

  if (!shortcutRegistered) {
    showNotification(
      `${shortcutLabel(isMac)} is in use by another app. Use “New capture in 3 seconds” in the Inset menu instead.`
    );
  }

  app.on("before-quit", (event) => {
    if (draft.holdQuitIfNeeded() === "hold") {
      event.preventDefault();
    } else {
      surface.allowClose();
    }
  });
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  e2eLog("launch");
};

/** Without this, a failed start leaves a process with no tray holding the instance lock. */
const startOrExit = async (): Promise<void> => {
  try {
    await start();
  } catch (error) {
    dialog.showErrorBox(
      `${PRODUCT_NAME} couldn't start`,
      error instanceof StartupError
        ? error.message
        : `${errorMessage(error)}\n\nOpen ${PRODUCT_NAME} again.`
    );
    app.exit(1);
  }
};

// The instance lock is keyed by userData, so the path must be final before it is taken.
app.setPath(
  "userData",
  process.env.INSET_USER_DATA_DIR ??
    path.join(app.getPath("appData"), PRODUCT_NAME)
);

if (app.requestSingleInstanceLock()) {
  if (process.platform === "win32") {
    app.setAppUserModelId(APP_ID);
  }

  registerInsetScheme();
  app.on("window-all-closed", () => {
    // A tray utility keeps running without windows.
  });
  void startOrExit();
} else {
  app.exit(0);
}
