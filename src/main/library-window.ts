import { once } from "node:events";
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

import type { PinnedImageOf } from "./capture-export";
import type { CopyGate } from "./copy-gate";
import { serveContract } from "./ipc-kit";
import { toDetail, toSummary } from "./library-view";
import type { CaptureStore } from "./store";
import { appOrigin, harden, secureWebPreferences } from "./window-security";

const DRAG_ICON_WIDTH = 128;

/** The panes' header strips are h-11 (src/renderer/library/pane-header.tsx). */
const TITLE_BAR_HEIGHT = 44;

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

/** How long a close or a quit waits for the page to save what is typed. */
const FLUSH_TIMEOUT_MS = 1000;

/** A copy waits longer: it copies nothing unless the save is known to have reached the disk. */
const COPY_FLUSH_TIMEOUT_MS = 5000;

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
  /** Whether the capture on screen is done; null when none is shown. */
  readonly shownDone: () => boolean | null;
  /** Runs once the page has loaded; the page keeps a command that arrives before it listens. */
  readonly whenLoaded: (run: () => void) => void;
  /** Asks the page to save what is typed, and waits for it, at most a second. */
  readonly flushEdits: () => Promise<void>;
  /** Asks the page to save what is typed into one capture, for a copy; fails when that save fails or doesn't finish. */
  readonly saveEdits: (id: CaptureId) => Promise<ActionResult>;
  /** For a quit that already saved the edits: the window closes without asking again. */
  readonly allowClose: () => void;
}

export interface LibraryOptions {
  readonly store: CaptureStore;
  readonly pinnedImage: PinnedImageOf;
  readonly copy: CopyGate;
  readonly preload: string;
  readonly url: string;
  readonly onOpened: () => void;
  readonly onClosed: () => void;
  /** The library gained or lost the keyboard, or shows another capture. */
  readonly onFocusChange: () => void;
  readonly onRejected: (channel: string, reason: string) => void;
  readonly status: () => AppStatus;
  readonly floatOnTop: (id: CaptureId) => void;
  readonly captureSoon: () => void;
  readonly openSettings: () => void;
}

const OK: ActionResult = { ok: true };

const fail = (message: string): ActionResult => ({ message, ok: false });

/** Where macOS draws the traffic lights: centred in the page's title strip (--titlebar-height in styles.css). */
const TRAFFIC_LIGHTS = { x: 18, y: 18 };

export const createLibraryWindow = (options: LibraryOptions): LibraryWindow => {
  const { copy, store } = options;
  let window: BrowserWindow | null = null;
  let floatOnTop = false;
  let shownDone: boolean | null = null;
  let quitting = false;
  /** The page's answers to `flush`, by token; null while one is awaited. */
  const answers = new Map<string, ActionResult | null>();
  const flushed = new EventTarget();
  let flushCount = 0;

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
      captureSoon: options.captureSoon,
      copyDetails: async (id) => await copy(id, "details"),
      copyImage: async (id) => await copy(id, "image"),
      copyText: async (id) => await copy(id, "text"),
      floatOnTop: options.floatOnTop,
      flushed: ({ result, token }) => {
        if (answers.has(token)) {
          answers.set(token, result);
          flushed.dispatchEvent(new Event(token));
        }
      },
      get: (id) => {
        const entry = store.get(id);

        return entry === undefined ? null : toDetail(entry);
      },
      list: () => store.list().map(toSummary),
      openSettings: options.openSettings,
      reportShown: (shown) => {
        shownDone = shown?.done ?? null;
        options.onFocusChange();
      },
      remove: async (id) => {
        const result = await store.remove(id);

        if (!result.ok) {
          return fail(result.message);
        }

        clearStaging(id);

        return OK;
      },
      setDone: async ({ done, id }) => {
        const result = await store.setDone(id, done);

        return result.ok ? OK : fail(result.message);
      },
      status: options.status,
      startImageDrag: ({ id, pins, title }) => {
        const pinned = options.pinnedImage(id, { pins, title });

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
      update: async ({ fields, id }) => {
        const result = await store.update(id, fields);

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

  /** A page that is closed or still loading has nothing typed to save. */
  const askToSave = async (
    id: CaptureId | null,
    timeoutMs: number
  ): Promise<ActionResult> => {
    if (window === null || window.webContents.isLoading()) {
      return OK;
    }

    flushCount += 1;

    const token = String(flushCount);
    const tooLong = fail("Saving took too long.");

    answers.set(token, null);

    const answer = once(flushed, token, {
      signal: AbortSignal.timeout(timeoutMs),
    });

    server.emit("flush", { id, token });

    try {
      await answer;

      return answers.get(token) ?? tooLong;
    } catch {
      return tooLong;
    } finally {
      answers.delete(token);
    }
  };

  // A page that doesn't answer in time keeps what its pagehide save manages.
  const flushEdits = async (): Promise<void> => {
    await askToSave(null, FLUSH_TIMEOUT_MS);
  };

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
      height: 720,
      minHeight: 460,
      minWidth: 640,
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
    // The page saves what is typed first; its own pagehide save can't reach main from a closed window.
    let saved = false;

    const closeAfterSaving = async (): Promise<void> => {
      await flushEdits();
      saved = true;

      if (!created.isDestroyed()) {
        created.close();
      }
    };

    created.on("close", (event) => {
      if (saved || quitting) {
        return;
      }

      event.preventDefault();
      void closeAfterSaving();
    });
    created.on("focus", options.onFocusChange);
    created.on("blur", options.onFocusChange);
    created.on("closed", () => {
      nativeTheme.off("updated", followTheme);
      window = null;
      shownDone = null;
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
    allowClose: () => {
      quitting = true;
    },
    command: (command) => {
      if (window !== null) {
        if (command === "find" || command === "shortcuts") {
          bringToFront();
          window.show();
          window.focus();
        }

        server.emit("command", command);
      }
    },
    flushEdits,
    isFloating: () => floatOnTop,
    saveEdits: async (id) => await askToSave(id, COPY_FLUSH_TIMEOUT_MS),
    shownDone: () => shownDone,
    whenLoaded: (run) => {
      if (window === null) {
        return;
      }

      if (window.webContents.isLoading()) {
        window.webContents.once("did-finish-load", run);
      } else {
        run();
      }
    },
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
