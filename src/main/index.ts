import { randomUUID } from "node:crypto";
import path from "node:path";

import { CaptureIdSchema, deriveTitle } from "@shared/capture-record";
import type { PointVia } from "@shared/capture-record";
import {
  captureContract,
  pinContract,
  settingsContract,
} from "@shared/contracts";
import type { IconPlace, SettingsView } from "@shared/settings";
import {
  CAPTURE_ACCELERATOR,
  shortcutLabel,
  TRAY_CAPTURE_DELAY_MS,
} from "@shared/shortcut";
import {
  app,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  Notification,
  shell,
} from "electron";

import { appMenuTemplate, HELP_URL } from "./app-menu";
import type { AppMenuActions, AppMenuState } from "./app-menu";
import { captureDisplay, sampleAnchor } from "./capture";
import { createCaptureExport } from "./capture-export";
import { createDraftController } from "./draft";
import { e2eLog } from "./e2e-log";
import { serveContract } from "./ipc-kit";
import { toDetail } from "./library-view";
import { createLibraryWindow } from "./library-window";
import { createPinWindows } from "./pin-windows";
import { handleInsetProtocol, registerInsetScheme } from "./protocol";
import { nodeSettingsFs, openSettingsStore } from "./settings-store";
import { createSettingsWindow } from "./settings-window";
import { failNextWrite, nodeStoreFs, openCaptureStore } from "./store";
import { createCaptureSurface } from "./surface";
import { createTray, toMenuItem } from "./tray";
import type { MenuRunner, TrayIcon } from "./tray";
import { dockMenu, trayMenu } from "./tray-menu";
import type { TrayAction, TrayModel } from "./tray-menu";
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

/** macOS tints the template; Windows needs the glyph that contrasts with its taskbar, which has its own theme. */
const trayIconPath = (): string => {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, "resources")
    : path.join(app.getAppPath(), "resources");

  if (isMac) {
    return path.join(base, "trayTemplate.png");
  }

  return path.join(
    base,
    nativeTheme.shouldUseDarkColorsForSystemIntegratedUI
      ? "tray-white.png"
      : "tray-black.png"
  );
};

const ignore = (): void => undefined;

const start = async (): Promise<void> => {
  await app.whenReady();
  secureSession();

  const dataDir = app.getPath("userData");
  const capturesDir = path.join(dataDir, "captures");

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

  const settings = await openSettingsStore(dataDir, nodeSettingsFs);
  const exporter = createCaptureExport(store);

  let shortcutRegistered = false;
  let countdown: NodeJS.Timeout | null = null;
  let tray: TrayIcon | null = null;

  // Set once every window exists; until then there is no menu to rebuild.
  const menus = { refresh: ignore };

  const pins = createPinWindows({
    preload: preloadPath("pin"),
    store,
    url: pageUrl("pin"),
  });

  const library = createLibraryWindow({
    exporter,
    onClosed: () => {
      e2eLog("libraryClosed");
      menus.refresh();
    },
    onOpened: () => {
      e2eLog("libraryOpened");
      menus.refresh();
    },
    onRejected: logRejected,
    pinToScreen: pins.open,
    preload: preloadPath("library"),
    status: () => ({
      iconIn: settings.current().iconIn,
      shortcutRegistered,
    }),
    store,
    url: pageUrl("library"),
  });

  const settingsWindow = createSettingsWindow({
    preload: preloadPath("settings"),
    url: pageUrl("settings"),
  });

  const surface = createCaptureSurface({
    // The panel never activates the app, so the app in front keeps the keyboard without app.hide().
    otherWindowVisible: () =>
      library.isVisible() || settingsWindow.isVisible() || pins.anyVisible(),
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

      if (result.ok && settings.current().copyAfterSave) {
        const copied = await exporter.copyBoth(record.id);

        if (!copied.ok) {
          showNotification(`Saved, but not copied. ${copied.message}`);
        }
      }

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
      answerQuit: (choice) => {
        draft.answerQuit(choice);
      },
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

  const pinServer = serveContract(
    pinContract,
    {
      close: (_input, sender) => {
        const id = pins.captureOf(sender.id);

        if (id !== null) {
          pins.close(id);
        }
      },
      copyImage: async (_input, sender) => {
        const id = pins.captureOf(sender.id);

        return id === null
          ? { message: "This pin has no capture.", ok: false }
          : await exporter.copyImage(id);
      },
      get: (_input, sender) => {
        const id = pins.captureOf(sender.id);
        const entry = id === null ? undefined : store.get(id);

        return entry === undefined ? null : toDetail(entry);
      },
      openInLibrary: (_input, sender) => {
        const id = pins.captureOf(sender.id);

        if (id !== null) {
          library.open(id);
        }
      },
    },
    {
      appOrigin: appOrigin(),
      ipc: ipcMain,
      onRejected: logRejected,
      target: pins.webContents,
    }
  );

  const pointNow = (via: PointVia): void => {
    draft.invoke({
      anchor: sampleAnchor(),
      at: new Date(),
      kind: "point",
      via,
    });
  };

  // From a menu: the delay lets the user move the pointer back over their work.
  const captureAfterDelay = (): void => {
    if (countdown !== null || draft.tray() !== "none") {
      return;
    }

    countdown = setTimeout(() => {
      countdown = null;
      menus.refresh();
      pointNow("trayDelayed");
    }, TRAY_CAPTURE_DELAY_MS);
    menus.refresh();
  };

  const menuModel = (): TrayModel => ({
    countdownPending: countdown !== null,
    draft: draft.tray(),
    isMac,
    recent: store
      .list()
      .flatMap((entry) =>
        entry.kind === "ok"
          ? [{ id: entry.record.id, title: deriveTitle(entry.record.thought) }]
          : []
      ),
    shortcutRegistered,
  });

  const run = (action: TrayAction): void => {
    if (action === "showDraft") {
      draft.invoke({ kind: "reopen" });
    } else if (action === "openLibrary") {
      library.open();
    } else if (action === "openSettings") {
      settingsWindow.open();
    } else if (action === "quit") {
      app.quit();
    } else {
      captureAfterDelay();
    }
  };

  const runner: MenuRunner = {
    openCapture: (id) => {
      library.open(id);
    },
    run,
  };

  const menuActions: AppMenuActions = {
    captureAfterDelay,
    libraryCommand: library.command,
    openHelp: () => {
      void shell.openExternal(HELP_URL);
    },
    openLibrary: () => {
      library.open();
    },
    openSettings: settingsWindow.open,
    setFloatOnTop: (on) => {
      library.setFloating(on);
      menus.refresh();
    },
  };

  // The draft reports every keystroke; menus are rebuilt only when what they show changes.
  let shownMenus = "";

  menus.refresh = () => {
    const model = menuModel();

    const appState: AppMenuState = {
      canCapture: model.draft === "none" && !model.countdownPending,
      floatOnTop: library.isFloating(),
      libraryOpen: library.isOpen(),
    };

    const key = JSON.stringify([model, appState, tray !== null]);

    if (key === shownMenus) {
      return;
    }

    shownMenus = key;
    tray?.refresh();

    if (isMac) {
      app.dock?.setMenu(
        Menu.buildFromTemplate(
          dockMenu(model).map((item) => toMenuItem(item, runner))
        )
      );
      Menu.setApplicationMenu(
        Menu.buildFromTemplate(appMenuTemplate(appState, menuActions))
      );
    }
  };

  /** macOS: the Dock, the menu bar or both. Elsewhere the notification-area icon is the only one. */
  const placeIcon = (place: IconPlace): void => {
    const wantsTray = !isMac || place !== "dock";

    if (wantsTray && tray === null) {
      tray = createTray({
        iconPath: trayIconPath,
        items: () => trayMenu(menuModel()),
        runner,
      });
    } else if (!wantsTray && tray !== null) {
      tray.destroy();
      tray = null;
    }

    if (isMac) {
      app.setActivationPolicy(place === "menuBar" ? "accessory" : "regular");
    }

    shownMenus = "";
    menus.refresh();
  };

  const settingsView = (): SettingsView => ({
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    settings: settings.current(),
    version: app.getVersion(),
  });

  const settingsServer = serveContract(
    settingsContract,
    {
      fitHeight: settingsWindow.fitHeight,
      getView: settingsView,
      setOpenAtLogin: (on) => {
        app.setLoginItemSettings({ openAtLogin: on });
        settingsServer.emit("view", settingsView());
      },
      update: (change) => {
        const before = settings.current().iconIn;

        const apply = async (): Promise<void> => {
          try {
            await settings.update(change);
          } catch (error) {
            console.warn(`Settings not saved: ${errorMessage(error)}`);
          }

          if (settings.current().iconIn !== before) {
            placeIcon(settings.current().iconIn);
            // Turning into an accessory can send the app's windows away.
            settingsWindow.open();
          }

          settingsServer.emit("view", settingsView());
        };

        void apply();
      },
    },
    {
      appOrigin: appOrigin(),
      ipc: ipcMain,
      onRejected: logRejected,
      target: () => settingsWindow.webContents,
    }
  );

  draft.subscribe(() => {
    captureServer.emit("view", draft.view());
    menus.refresh();
  });
  store.subscribe(() => {
    pinServer.emit("changed", null);
    menus.refresh();
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
    Promise.all([surface.load(), settingsWindow.load()]),
    (cause) =>
      `${PRODUCT_NAME} failed to load its windows.\n\n${cause}\n\nOpen ${PRODUCT_NAME} again. If this keeps happening, reinstall it.`
  );

  shortcutRegistered =
    globalShortcut.register(CAPTURE_ACCELERATOR, () => {
      pointNow("shortcut");
    }) && globalShortcut.isRegistered(CAPTURE_ACCELERATOR);

  if (!isMac) {
    Menu.setApplicationMenu(null);
  }

  placeIcon(settings.current().iconIn);

  if (!shortcutRegistered) {
    showNotification(
      `${shortcutLabel(isMac)} is in use by another app. Choose “New capture in 3 seconds” from the pin icon instead.`
    );
  }

  // A click on the Dock icon, or opening the app again while it runs, shows the library.
  app.on("activate", () => {
    library.open();
  });
  app.on("second-instance", () => {
    library.open();
  });
  app.on("before-quit", (event) => {
    if (draft.holdQuitIfNeeded() === "hold") {
      event.preventDefault();
    } else {
      surface.allowClose();
      settingsWindow.allowClose();
    }
  });
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  // Until the first capture, the library is a welcome that says how to capture and where the app lives.
  if (store.list().length === 0) {
    library.open();
  }

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
