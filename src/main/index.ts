import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { CaptureIdSchema } from "@shared/capture-record";
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
// electron-updater defines autoUpdater as a getter, which an ESM named import cannot see.
import electronUpdater from "electron-updater";

import { appMenuTemplate, HELP_URL } from "./app-menu";
import type { AppMenuActions, AppMenuState } from "./app-menu";
import { captureDisplay, sampleAnchor } from "./capture";
import { createCaptureExport } from "./capture-export";
import { createDraftController } from "./draft";
import { e2eLog } from "./e2e-log";
import { serveContract } from "./ipc-kit";
import { toDetail } from "./library-view";
import { createLibraryWindow } from "./library-window";
import type { LibraryWindow } from "./library-window";
import { createPinWindows } from "./pin-windows";
import { handleInsetProtocol, registerInsetScheme } from "./protocol";
import { createQuitGate } from "./quit-gate";
import { nodeSettingsFs, openSettingsStore } from "./settings-store";
import { createSettingsWindow } from "./settings-window";
import { failNextWrite, nodeStoreFs, openCaptureStore } from "./store";
import { createCaptureSurface } from "./surface";
import { createTray, toMenuItem } from "./tray";
import type { MenuRunner, TrayIcon } from "./tray";
import { dockMenu, trayMenu } from "./tray-menu";
import type { TrayAction, TrayModel } from "./tray-menu";
import { fromAutoUpdater, startUpdater } from "./updater";
import type { Updater } from "./updater";
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

/**
 * Only release builds carry the feed in app-update.yml; CI builds of a pull request don't.
 * On Windows only the NSIS install can update; a portable copy has no uninstaller beside it.
 */
const canSelfUpdate = (): boolean =>
  app.isPackaged &&
  existsSync(path.join(process.resourcesPath, "app-update.yml")) &&
  (process.platform !== "win32" ||
    readdirSync(path.dirname(process.execPath)).some((file) =>
      file.startsWith("Uninstall ")
    ));

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

  let updater: Updater | null = null;

  // The library's New capture button reaches the delayed capture, defined further down, through this.
  const startCapture = { soon: ignore };

  // A pin and the library open each other, so a pin reaches the library through this once it exists.
  let openLibrary: LibraryWindow["open"] = ignore;

  // The draft resumes a quit it held through the quit gate, which needs the draft first.
  let resumeQuit = ignore;

  const settingsWindow = createSettingsWindow({
    preload: preloadPath("settings"),
    url: pageUrl("settings"),
  });

  const pins = createPinWindows({
    copyImage: exporter.copyImage,
    preload: preloadPath("pin"),
    showInLibrary: (id) => {
      openLibrary(id);
    },
    store,
    url: pageUrl("pin"),
  });

  const library = createLibraryWindow({
    captureSoon: () => {
      startCapture.soon();
    },
    exporter,
    onClosed: () => {
      e2eLog("libraryClosed");
      menus.refresh();
    },
    onOpened: () => {
      e2eLog("libraryOpened");
      menus.refresh();
    },
    onFocusChange: () => {
      menus.refresh();
    },
    onRejected: logRejected,
    openSettings: () => {
      settingsWindow.open();
    },
    floatOnTop: pins.open,
    preload: preloadPath("library"),
    status: () => ({
      iconIn: settings.current().iconIn,
      shortcutRegistered,
    }),
    store,
    url: pageUrl("library"),
  });

  openLibrary = library.open;

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
      resumeQuit();
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

  startCapture.soon = captureAfterDelay;

  const menuModel = (): TrayModel => ({
    countdownPending: countdown !== null,
    draft: draft.tray(),
    isMac,
    libraryOnTop: library.isFloating(),
    libraryOpen: library.isOpen(),
    recent: store
      .list()
      .flatMap((entry) =>
        entry.kind === "ok"
          ? [{ id: entry.record.id, title: entry.record.title }]
          : []
      ),
    shortcutRegistered,
    update: updater?.state() ?? null,
    version: app.getVersion(),
  });

  const quitGate = createQuitGate({
    holdIfNeeded: draft.holdQuitIfNeeded,
    quit: () => {
      app.quit();
    },
    // quitAndInstall closes every window before before-quit fires, so the gate releases them first.
    releaseWindows: () => {
      surface.allowClose();
      settingsWindow.allowClose();
      library.allowClose();
    },
    restartToUpdate: () => {
      updater?.install();
    },
  });

  resumeQuit = quitGate.resume;

  /** Set once the library's typing is saved for this quit; a quit the draft holds clears it. */
  let editsSaved = false;

  const saveEdits = async (): Promise<void> => {
    await library.flushEdits();
    await store.settled();
    editsSaved = true;
  };

  const restartAfterSaving = async (): Promise<void> => {
    await saveEdits();
    quitGate.restartToUpdate();
  };

  const installUpdate = (): void => {
    if (updater?.state().kind === "ready") {
      void restartAfterSaving();
    }
  };

  /** The sheet lives in the library, which opens first when it is closed. */
  const showShortcuts = (): void => {
    if (library.isOpen()) {
      library.command("shortcuts");
    } else {
      library.open();
      library.whenLoaded(() => {
        library.command("shortcuts");
      });
    }
  };

  const run = (action: TrayAction): void => {
    if (action === "showDraft") {
      draft.invoke({ kind: "reopen" });
    } else if (action === "openLibrary") {
      library.open();
    } else if (action === "openSettings") {
      settingsWindow.open();
    } else if (action === "showShortcuts") {
      showShortcuts();
    } else if (action === "toggleLibraryOnTop") {
      library.setFloating(!library.isFloating());
      menus.refresh();
    } else if (action === "checkForUpdates") {
      updater?.check();
    } else if (action === "installUpdate") {
      installUpdate();
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
    checkForUpdates: () => {
      updater?.check();
    },
    installUpdate,
    libraryCommand: library.command,
    openHelp: () => {
      void shell.openExternal(HELP_URL);
    },
    openLibrary: () => {
      library.open();
    },
    openSettings: settingsWindow.open,
    showShortcuts: () => {
      showShortcuts();
    },
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
      libraryFocused: library.isFocused(),
      libraryOpen: library.isOpen(),
      shownDone: library.shownDone(),
      update: model.update,
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
    const view = draft.view();
    const pointer = view.kind === "draft" ? draft.pointer(view.draftId) : null;

    const preview =
      view.kind === "draft" && pointer !== null
        ? { crop: view.seed.crop, frame: view.frame.size, pointer }
        : undefined;

    e2eLog("panelShown", { bounds, draftId: currentDraftId(), preview });
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

  const quitAfterSaving = async (): Promise<void> => {
    await saveEdits();
    app.quit();
  };

  app.on("before-quit", (event) => {
    if (!editsSaved) {
      event.preventDefault();
      void quitAfterSaving();

      return;
    }

    if (!quitGate.allowQuit()) {
      event.preventDefault();
      editsSaved = false;
    }
  });
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  if (canSelfUpdate()) {
    updater = startUpdater({
      feedUrl: process.env.INSET_UPDATE_FEED_URL,
      source: fromAutoUpdater(electronUpdater.autoUpdater),
      onChange: () => {
        menus.refresh();
      },
      onReady: (version) => {
        showNotification(
          `Version ${version} is ready. Choose “Restart to update” from the pin icon, or it installs when you quit.`
        );
      },
    });
  }

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
