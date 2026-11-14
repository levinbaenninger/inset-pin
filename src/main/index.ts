import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { CaptureIdSchema } from "@shared/capture-record";
import type { CaptureId, PointVia } from "@shared/capture-record";
import {
  captureContract,
  onboardingContract,
  pinContract,
  settingsContract,
} from "@shared/contracts";
import type { SavedEdits } from "@shared/contracts";
import type { OnboardingView } from "@shared/onboarding";
import type { IconPlace, SettingsView } from "@shared/settings";
import {
  CAPTURE_ACCELERATOR,
  shortcutLabel,
  TRAY_CAPTURE_DELAY_MS,
} from "@shared/shortcut";
import {
  app,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  Notification,
  shell,
  systemPreferences,
} from "electron";
// electron-updater defines autoUpdater as a getter, which an ESM named import cannot see.
import electronUpdater from "electron-updater";

import { appMenuTemplate, HELP_URL } from "./app-menu";
import type { AppMenuActions, AppMenuState } from "./app-menu";
import { captureDisplay, sampleAnchor } from "./capture";
import { createPinnedImage } from "./capture-export";
import { createCopyGate, electronClipboard } from "./copy-gate";
import { createDraftController } from "./draft";
import { e2eLog } from "./e2e-log";
import { serveContract } from "./ipc-kit";
import { toDetail } from "./library-view";
import { createLibraryWindow } from "./library-window";
import type { LibraryWindow } from "./library-window";
import { createOnboardingWindow } from "./onboarding-window";
import { appBundlePath, createAppTile } from "./permissions/bundle";
import { createOnboarding } from "./permissions/onboarding";
import { createOnboardingStore } from "./permissions/store";
import { createPermissionChecks } from "./permissions/system";
import { createPinExamples } from "./pin-examples";
import {
  osMajor,
  PIN_HANDOFF,
  PIN_PERMISSIONS,
  PIN_TAGLINE,
} from "./pin-onboarding";
import {
  CAPTURE_PAGE,
  CHECKLIST_TITLE,
  EXAMPLE_IMAGE,
  checklistDoneText,
  HOME_PAGE,
  PIN_TASK_IDS,
  pinExamples,
  pinHints,
  pinSpotlight,
  pinTasks,
} from "./pin-tutorial";
import { createPinWindows } from "./pin-windows";
import { handleInsetProtocol, registerInsetScheme } from "./protocol";
import { createQuitGate } from "./quit-gate";
import { createQuitPath } from "./quit-path";
import { nodeSettingsFs, openSettingsStore } from "./settings-store";
import { createSettingsWindow } from "./settings-window";
import { failNextWrite, nodeStoreFs, openCaptureStore } from "./store";
import { createCaptureSurface } from "./surface";
import { createTray, toMenuItem } from "./tray";
import type { MenuRunner, TrayIcon } from "./tray";
import { dockMenu, trayMenu } from "./tray-menu";
import type { TrayAction, TrayModel } from "./tray-menu";
import { createTutorialStore } from "./tutorial/store";
import { createTutorial } from "./tutorial/tutorial";
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

const setTimer = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms);

  return () => {
    clearTimeout(timer);
  };
};

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

  // Read before the store below creates its folder: an install from before the onboarding existed.
  const ranBefore =
    existsSync(capturesDir) || existsSync(path.join(dataDir, "settings.json"));

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
  const pinnedImage = createPinnedImage(store);

  // Set once the windows the tutorial hints in, and their IPC servers, exist.
  const tutorialPages = {
    emit: ignore,
    visible: (_page: string): boolean => false,
  };

  /**
   * The in-app tutorial (src/main/tutorial/): the Getting started checklist,
   * one-time hints, the walkthrough and the example captures, on macOS and
   * Windows alike.
   */
  const tutorial = createTutorial({
    doneText: checklistDoneText(isMac),
    examples: createPinExamples({
      examples: pinExamples(isMac),
      newId: () => CaptureIdSchema.parse(randomUUID()),
      now: () => new Date(),
      // Found from this file in development, so a start with the script's path (out/main/index.js) finds it too.
      readImage: async () =>
        await readFile(
          app.isPackaged
            ? path.join(process.resourcesPath, "resources", EXAMPLE_IMAGE.file)
            : path.join(
                import.meta.dirname,
                "..",
                "..",
                "resources",
                EXAMPLE_IMAGE.file
              )
        ),
      store: {
        has: (id) => store.get(id) !== undefined,
        publish: async (record, png) => await store.publish(record, png),
        remove: async (id) => {
          await store.remove(id);
        },
      },
      warn: (message) => {
        console.warn(message);
      },
    }),
    firstRun: async () => await Promise.resolve(!ranBefore),
    hints: pinHints(isMac),
    home: HOME_PAGE,
    onChange: () => {
      tutorialPages.emit();
    },
    pageVisible: (page) => tutorialPages.visible(page),
    spotlight: pinSpotlight(isMac),
    store: createTutorialStore(
      path.join(dataDir, "tutorial.json"),
      nodeSettingsFs
    ),
    tasks: pinTasks(isMac),
    title: CHECKLIST_TITLE,
    warn: (message) => {
      console.warn(message);
    },
  });

  await tutorial.load();

  /** One of the first run's example captures, while it is still in the library. */
  const isExample = (id: string): boolean =>
    tutorial.view(HOME_PAGE).examples.includes(id);

  /** A capture the user made: the library has more than the examples. */
  const hasOwnCapture = (): boolean =>
    store.list().some((entry) => !isExample(entry.id));

  // The library saves its typing before every copy; it is created further down, and has nothing typed until then.
  const libraryEdits = {
    save: async (_id: CaptureId): Promise<SavedEdits> =>
      await Promise.resolve({ fields: null, ok: true as const }),
  };

  const copy = createCopyGate({
    clipboard: electronClipboard,
    pinnedImage,
    saveEdits: async (id) => await libraryEdits.save(id),
    store,
  });

  // A copy the user asked for, from the library or a floating capture: the tutorial's last task.
  const copyOut: typeof copy = async (id, format) => {
    const copied = await copy(id, format);

    if (copied.ok) {
      tutorial.complete(PIN_TASK_IDS.copy);
    }

    return copied;
  };

  // A floating capture's own menu on Windows has no page to say a failed copy on.
  const copyAndSay = async (id: CaptureId): Promise<void> => {
    const copied = await copyOut(id, "image");

    if (!copied.ok) {
      showNotification(copied.message);
    }
  };

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
    copyImage: (id) => {
      void copyAndSay(id);
    },
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
    copy: copyOut,
    onClosed: () => {
      e2eLog("libraryClosed");
      tutorial.pageClosed(HOME_PAGE);
      menus.refresh();
    },
    onOpened: () => {
      e2eLog("libraryOpened");
      // oxlint-disable-next-line no-use-before-define -- defined once the library exists.
      findInLibrary();
      menus.refresh();
    },
    onFocusChange: () => {
      // The library coming to the front again, from Recent captures… or the taskbar: Find it in the library.
      // oxlint-disable-next-line no-use-before-define -- defined once the library exists.
      findInLibrary();
      menus.refresh();
    },
    onRejected: logRejected,
    openSettings: () => {
      settingsWindow.open();
    },
    floatOnTop: pins.open,
    pinnedImage,
    preload: preloadPath("library"),
    status: () => ({
      iconIn: settings.current().iconIn,
      shortcutRegistered,
    }),
    store,
    tutorial: {
      act: (action) => {
        tutorial.act(HOME_PAGE, action);
      },
      view: () => tutorial.view(HOME_PAGE),
    },
    url: pageUrl("library"),
  });

  /** Find it in the library: the library is on screen with a capture of the user's own in it. */
  const findInLibrary = (): void => {
    if (library.isVisible() && hasOwnCapture()) {
      tutorial.complete(PIN_TASK_IDS.library);
    }
  };

  openLibrary = library.open;
  libraryEdits.save = library.saveEdits;

  const permissions = createPermissionChecks({
    desktopCapturer,
    osMajor: osMajor(process.getSystemVersion()),
    platform: process.platform,
    setTimer,
    shell,
    systemPreferences,
  });

  const onboardingWindow = createOnboardingWindow({
    preload: preloadPath("onboarding"),
    url: pageUrl("onboarding"),
  });

  const appTile = createAppTile({
    bundlePath: appBundlePath(app.getPath("exe"), { packaged: app.isPackaged }),
    loadIcon: async (bundle) =>
      await app.getFileIcon(bundle, { size: "normal" }),
    startDrag: ({ file, icon }) => {
      onboardingWindow.webContents()?.startDrag({ file, icon });
    },
  });

  const surface = createCaptureSurface({
    // The panel never activates the app, so the app in front keeps the keyboard without app.hide().
    otherWindowVisible: () =>
      library.isVisible() ||
      settingsWindow.isVisible() ||
      pins.anyVisible() ||
      onboardingWindow.isVisible(),
    preload: preloadPath("capture"),
    url: pageUrl("capture"),
  });

  // How the capture under way was started: only the shortcut ticks off the tutorial's first task.
  let capturingVia: PointVia | null = null;

  const draft = createDraftController({
    capture: async (display) => {
      const result = await captureDisplay(display);

      if (result.ok) {
        e2eLog("capture");

        if (capturingVia === "shortcut") {
          tutorial.complete(PIN_TASK_IDS.capture);
        }
      }

      return result;
    },
    newId: () => CaptureIdSchema.parse(randomUUID()),
    notify: showNotification,
    now: () => new Date(),
    publish: async (record, png) => {
      const result = await store.publish(record, png);

      e2eLog(result.ok ? "saved" : "saveFailed", { draftId: record.id });

      if (result.ok) {
        tutorial.complete(PIN_TASK_IDS.save);
      }

      const shown = draft.view();

      // A capture discarded while its save was on its way is withdrawn, so it isn’t copied either.
      if (
        result.ok &&
        settings.current().copyAfterSave &&
        shown.kind === "draft" &&
        shown.draftId === record.id
      ) {
        const copied = await copy(record.id, "imageAndDetails");

        if (!copied.ok) {
          showNotification(`Saved, but not copied. ${copied.message}`);
        }
      }

      return result;
    },
    quit: () => {
      resumeQuit();
    },
    withdraw: async (id) => {
      await store.withdraw(id);
    },
    surface,
  });

  const currentDraftId = (): string | undefined => {
    const view = draft.view();

    return view.kind === "draft" ? view.draftId : undefined;
  };

  // The draft's gate and the onboarding, set below once they exist.
  const quitSteps = { allowQuit: (): boolean => true, dropped: ignore };

  /** Every quit: the library saves first, then the draft may hold it. A quit it starts can carry a relaunch. */
  const quitPath = createQuitPath({
    allowQuit: () => quitSteps.allowQuit(),
    leave: (then) => {
      library.leave("quit", then);
    },
    onDropped: () => {
      quitSteps.dropped();
    },
    requestQuit: () => {
      app.quit();
    },
  });

  // Set once the onboarding's IPC server exists.
  let showOnboardingView: (view: OnboardingView) => void = ignore;

  /** Opens the library and starts the walkthrough there once its page has loaded. */
  const showMeAround = (): void => {
    library.open();
    library.whenLoaded(() => {
      tutorial.showMeAround();
    });
  };

  // The first-run setup: the permission kit (src/main/permissions/) wired to Pin's window, quit path and library.
  const onboarding = createOnboarding({
    appName: PRODUCT_NAME,
    checks: permissions,
    handOff: PIN_HANDOFF,
    mac: isMac,
    // Done hands over to the library, which holds Getting started; Show Me Around starts the walkthrough there.
    onClosed: (how) => {
      if (how === "showAround") {
        showMeAround();
      } else if (how === "start") {
        library.open();
      }
    },
    // The first run opened setup in place of the library, which comes now, Not now included.
    onEnded: () => {
      if (!library.isOpen()) {
        library.open();
      }
    },
    onView: (view) => {
      showOnboardingView(view);
    },
    osMajor: osMajor(process.getSystemVersion()),
    permissions: PIN_PERMISSIONS,
    // Screen Recording is seen only after a reopen, so nothing polls for it.
    pollFast: ignore,
    // The reopen goes through the normal quit: it relaunches only if the quit really ends the app.
    quit: (atExit) => {
      quitPath.quit(atExit);
    },
    ranBefore: async () => await Promise.resolve(ranBefore),
    relaunch: () => {
      app.relaunch();
    },
    setTimer,
    store: createOnboardingStore(
      path.join(dataDir, "onboarding.json"),
      nodeSettingsFs
    ),
    tagline: PIN_TAGLINE,
    tile: appTile.view,
    warn: (message) => {
      console.warn(message);
    },
    window: onboardingWindow,
  });

  quitSteps.dropped = onboarding.quitCancelled;

  onboardingWindow.onClose(onboarding.close);

  const onboardingServer = serveContract(
    onboardingContract,
    {
      allow: onboarding.allow,
      back: onboarding.back,
      finish: onboarding.finish,
      fitHeight: onboardingWindow.fitHeight,
      getView: onboarding.view,
      next: onboarding.next,
      reopen: () => {
        void onboarding.reopen();
      },
      skip: onboarding.skip,
      startDrag: appTile.drag,
    },
    {
      appOrigin: appOrigin(),
      ipc: ipcMain,
      onRejected: logRejected,
      target: onboardingWindow.webContents,
    }
  );

  showOnboardingView = (view) => {
    onboardingServer.emit("view", view);
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

        // The held quit is over; a reopen it carried must not run at a later quit.
        if (choice === "cancel") {
          quitPath.cancelled();
        }
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

        // A pin placed in the panel: the tutorial's second task.
        if (content.pins.length > 0) {
          tutorial.complete(PIN_TASK_IDS.pin);
        }
      },
      getTutorial: () => tutorial.view(CAPTURE_PAGE),
      getView: () => draft.view(),
      openScreenSettings: () => {
        permissions.openPane("screen");
      },
      relaunch: () => {
        quitPath.quit(() => {
          app.relaunch();
        });
      },
      reportHeight: ({ height, surfaceKey }) => {
        surface.setContentHeight(height, surfaceKey);
      },
      save: ({ content, id }) => {
        draft.save(id, content);
      },
      setUpScreenRecording: () => {
        // Shown first, so closing the panel doesn't hide the app with it.
        onboarding.open("screen");
        draft.dismiss();
      },
      tutorial: (action) => {
        tutorial.act(CAPTURE_PAGE, action);
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
          ? { message: "This pin has no capture.", ok: false, retry: false }
          : await copyOut(id, "image");
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
      retrySave: async (_input, sender) => {
        const id = pins.captureOf(sender.id);

        return id === null
          ? { message: "This pin has no capture.", ok: false }
          : await library.retryEdits(id);
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
    capturingVia = via;
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
    // The draft let a held quit go on: it keeps the relaunch it carries.
    quit: quitPath.resume,
    // quitAndInstall closes every window before before-quit fires, so the gate releases them first.
    releaseWindows: () => {
      surface.allowClose();
      settingsWindow.allowClose();
      library.allowClose();
      onboardingWindow.allowClose();
    },
    // A restart the draft held starts again from the top, so the library saves its typing and the disk finishes first.
    restart: () => {
      library.leave("restart", () => {
        quitGate.restartToUpdate();
      });
    },
    // Set only as the install starts, so a restart the draft holds still saves the library's typing on the next quit.
    restartToUpdate: () => {
      quitPath.editsSaved();
      updater?.install();
    },
  });

  resumeQuit = quitGate.resume;
  quitSteps.allowQuit = quitGate.allowQuit;

  const installUpdate = (): void => {
    if (updater?.state().kind === "ready") {
      library.leave("restart", () => {
        quitGate.restartToUpdate();
      });
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
    } else if (action === "setUpPermissions") {
      onboarding.open();
    } else if (action === "gettingStarted") {
      tutorial.showChecklist();
      library.open();
    } else if (action === "showMeAround") {
      showMeAround();
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
    pageMenuOpen: library.menuOpen,
    gettingStarted: () => {
      tutorial.showChecklist();
      library.open();
    },
    setUpPermissions: () => {
      onboarding.open();
    },
    showMeAround,
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
    tips: tutorial.tips(),
    version: app.getVersion(),
  });

  const settingsServer = serveContract(
    settingsContract,
    {
      fitHeight: settingsWindow.fitHeight,
      getView: settingsView,
      resetTutorial: () => {
        tutorial.reset();
        // Reset turns tips back on: the switch follows.
        settingsServer.emit("view", settingsView());
        showNotification(
          "Tutorial reset. Getting started is back in the library."
        );
      },
      setOpenAtLogin: (on) => {
        app.setLoginItemSettings({ openAtLogin: on });
        settingsServer.emit("view", settingsView());
      },
      setTips: (on) => {
        tutorial.setTips(on);
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

  // The capture panel is on screen: its hints may show.
  let panelVisible = false;

  draft.subscribe(() => {
    captureServer.emit("view", draft.view());
    menus.refresh();
  });
  store.subscribe(() => {
    pinServer.emit("changed", null);
    // The examples arrive after launch, and one may be removed: the library's tags follow.
    tutorialPages.emit();
    findInLibrary();
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
    panelVisible = true;
    tutorialPages.emit();
  });
  surface.onHidden(() => {
    e2eLog("panelHidden");
    panelVisible = false;
    // A hidden panel lets go of the bubble it held, so it never blocks the library's.
    tutorial.pageClosed(CAPTURE_PAGE);
  });

  // The tutorial in every window it hints in: each sees its own part.
  tutorialPages.visible = (page) =>
    page === HOME_PAGE
      ? library.isVisible()
      : page === CAPTURE_PAGE && panelVisible;
  tutorialPages.emit = () => {
    captureServer.emit("tutorial", tutorial.view(CAPTURE_PAGE));
    library.emitTutorial(tutorial.view(HOME_PAGE));
  };

  await explainFailure(
    Promise.all([surface.load(), settingsWindow.load(), appTile.load()]),
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

  app.on("before-quit", quitPath.beforeQuit);
  app.on("will-quit", () => {
    // Reopen to finish relaunches here, once the quit can no longer be cancelled.
    quitPath.willQuit();
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

  // On macOS's first run setup opens; the library comes after it.
  const onboardingShown = await onboarding.launch();

  // Until the first capture of the user's own, the library opens at launch with Getting started.
  if (!onboardingShown && !hasOwnCapture()) {
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
