import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { CaptureId } from "@shared/capture-record";
import { libraryContract } from "@shared/contracts";
import type {
  ActionResult,
  AppStatus,
  LibraryCommand,
} from "@shared/contracts";
import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";

import type { CaptureExport } from "./capture-export";
import { serveContract } from "./ipc-kit";
import { toDetail, toSummary } from "./library-view";
import type { CaptureStore } from "./store";
import { appOrigin, harden, secureWebPreferences } from "./window-security";

const DRAG_ICON_WIDTH = 128;

/** Matches --titlebar-height in src/renderer/styles.css. */
const TITLE_BAR_HEIGHT = 40;

const isMac = process.platform === "darwin";

/** Explicitly requested from the menu bar: bring it in front of the active app. */
const bringToFront = (): void => {
  if (isMac) {
    // Undo app.hide() from a dismissed capture panel, then take focus from the app in front.
    app.show();
    app.focus({ steal: true });
  }
};

/** The page's background and text colours in the current theme, from src/renderer/styles.css. On macOS the list shows the window's material, so the window itself is clear. */
const themeColors = (): { background: string; foreground: string } =>
  nativeTheme.shouldUseDarkColors
    ? { background: "#0a0a0a", foreground: "#fafafa" }
    : { background: "#ffffff", foreground: "#0a0a0a" };

const titleBarOverlay = (): Electron.TitleBarOverlayOptions => {
  const { background, foreground } = themeColors();

  return {
    color: background,
    height: TITLE_BAR_HEIGHT,
    symbolColor: foreground,
  };
};

export interface LibraryWindow {
  /** Opens the library, on one capture when an id is given. */
  readonly open: (id?: CaptureId) => void;
  readonly isOpen: () => boolean;
  readonly isFocused: () => boolean;
  readonly isVisible: () => boolean;
  /** Runs a command from the app menu on the shown capture. */
  readonly command: (command: LibraryCommand) => void;
  readonly isFloating: () => boolean;
  readonly setFloating: (on: boolean) => void;
}

export interface LibraryOptions {
  readonly store: CaptureStore;
  readonly exporter: CaptureExport;
  readonly preload: string;
  readonly url: string;
  readonly onOpened: () => void;
  readonly onClosed: () => void;
  /** The library gained or lost the keyboard. */
  readonly onFocusChange: () => void;
  readonly onRejected: (channel: string, reason: string) => void;
  readonly status: () => AppStatus;
  readonly pinToScreen: (id: CaptureId) => void;
  readonly openSettings: () => void;
}

const OK: ActionResult = { ok: true };

const fail = (message: string): ActionResult => ({ message, ok: false });

/** Where macOS draws the traffic lights: centred in the page's title strip (--titlebar-height in styles.css). */
const TRAFFIC_LIGHTS = { x: 18, y: 18 };

export const createLibraryWindow = (options: LibraryOptions): LibraryWindow => {
  const { exporter, store } = options;
  let window: BrowserWindow | null = null;
  let floatOnTop = false;

  // Dragged copies wait here for the drop; a drop can finish after startDrag returns, so they are cleared on delete and at launch.
  const dragStaging = path.join(app.getPath("temp"), "Inset Context Pin");

  const clearStaging = (id?: CaptureId): void => {
    rmSync(id === undefined ? dragStaging : path.join(dragStaging, id), {
      force: true,
      recursive: true,
    });
  };

  clearStaging();

  const server = serveContract(
    libraryContract,
    {
      copyImage: exporter.copyImage,
      copyNote: exporter.copyNote,
      get: (id) => {
        const entry = store.get(id);

        return entry === undefined ? null : toDetail(entry);
      },
      list: () => store.list().map(toSummary),
      openSettings: options.openSettings,
      pinToScreen: options.pinToScreen,
      remove: async (id) => {
        const result = await store.remove(id);

        if (!result.ok) {
          return fail(result.message);
        }

        clearStaging(id);

        return OK;
      },
      status: options.status,
      startImageDrag: (id) => {
        const pinned = exporter.pinnedImage(id);

        if (window === null || pinned === null) {
          return;
        }

        // A named copy, so the dropped file says what it is instead of "crop.png".
        const folder = path.join(dragStaging, id);
        const file = path.join(folder, pinned.fileName);

        mkdirSync(folder, { recursive: true });
        writeFileSync(file, pinned.png);
        window.webContents.startDrag({
          file,
          icon: pinned.image.resize({ width: DRAG_ICON_WIDTH }),
        });
      },
      updateThought: async ({ id, thought }) => {
        const result = await store.updateThought(id, thought);

        return result.ok ? OK : fail(result.message);
      },
    },
    {
      appOrigin: appOrigin(),
      ipc: ipcMain,
      onRejected: options.onRejected,
      target: () => window?.webContents ?? null,
    }
  );

  store.subscribe(() => {
    server.emit("changed", null);
  });

  const open = (id?: CaptureId): void => {
    if (window !== null) {
      if (window.isMinimized()) {
        window.restore();
      }

      if (id !== undefined) {
        server.emit("show", id);
      }

      bringToFront();
      window.show();
      window.focus();

      return;
    }

    const created = new BrowserWindow({
      backgroundColor: isMac ? "#00000000" : themeColors().background,
      height: 680,
      minHeight: 420,
      minWidth: 560,
      show: false,
      title: "Recent captures",
      // On Windows only the caption buttons stay, drawn over the page; on macOS the traffic lights sit on the list.
      titleBarOverlay: isMac ? false : titleBarOverlay(),
      titleBarStyle: isMac ? "hiddenInset" : "hidden",
      trafficLightPosition: TRAFFIC_LIGHTS,
      vibrancy: isMac ? "sidebar" : undefined,
      webPreferences: secureWebPreferences(options.preload),
      width: 960,
    });

    window = created;

    if (floatOnTop) {
      created.setAlwaysOnTop(true, "floating");
    }

    if (!isMac) {
      created.removeMenu();
    }

    const followTheme = (): void => {
      if (!isMac) {
        created.setBackgroundColor(themeColors().background);
        created.setTitleBarOverlay(titleBarOverlay());
      }
    };

    nativeTheme.on("updated", followTheme);

    harden(created.webContents, "library");
    created.once("ready-to-show", () => {
      created.show();
      bringToFront();

      options.onOpened();
    });
    created.on("focus", options.onFocusChange);
    created.on("blur", options.onFocusChange);
    created.on("closed", () => {
      nativeTheme.off("updated", followTheme);
      window = null;
      options.onClosed();
    });

    // The app scheme refuses addresses with a fragment, so the capture follows once the page listens.
    if (id !== undefined) {
      created.webContents.once("did-finish-load", () => {
        server.emit("show", id);
      });
    }

    void created.loadURL(options.url);
  };

  return {
    command: (command) => {
      if (window !== null) {
        if (command === "find") {
          bringToFront();
          window.show();
          window.focus();
        }

        server.emit("command", command);
      }
    },
    isFloating: () => floatOnTop,
    isFocused: () => window?.isFocused() ?? false,
    isOpen: () => window !== null,
    isVisible: () => window?.isVisible() ?? false,
    open,
    setFloating: (on) => {
      floatOnTop = on;
      window?.setAlwaysOnTop(on, "floating");
    },
  };
};
