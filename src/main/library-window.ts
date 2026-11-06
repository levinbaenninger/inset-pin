import { once } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { CaptureId } from "@shared/capture-record";
import { LEAVE_SAVE_WAIT_MS, libraryContract } from "@shared/contracts";
import type {
  ActionResult,
  AppStatus,
  Leaving,
  LibraryCommand,
  SavedEdits,
} from "@shared/contracts";
import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";

import type { PinnedImageOf } from "./capture-export";
import type { CopyGate } from "./copy-gate";
import { serveContract } from "./ipc-kit";
import { createLeaveGate } from "./leave-gate";
import { toDetail, toSummary } from "./library-view";
import { trackMenuOpen } from "./menu-open";
import type { MenuOpen } from "./menu-open";
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

/** The page answers a close or a quit once its own wait for the saves is over; one that hasn't answered by then is gone or hung. */
const LEAVE_ANSWER_TIMEOUT_MS = LEAVE_SAVE_WAIT_MS + 2000;

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
  /**
   * Before a quit: the page saves what is typed, then `then` runs. While
   * changes couldn't be saved, the page holds the quit and asks the user, and
   * `then` runs only once the user retries or discards them.
   */
  readonly leave: (leaving: "quit" | "restart", then: () => void) => void;
  /** Asks the page to save what is typed into one capture, for a copy, and hands back what the copy carries; fails when that save fails or doesn't finish. */
  readonly saveEdits: (id: CaptureId) => Promise<SavedEdits>;
  /** For a quit that already saved the edits: the window closes without asking again. */
  readonly allowClose: () => void;
  /** Whether a menu is open in the focused library, so the app menu's keys skip. */
  readonly menuOpen: () => boolean;
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
  /** The page let this window close: its typing is saved or discarded. */
  let mayClose = false;
  let menu: MenuOpen | null = null;
  /** The page's answers to `flush`, by token; null while one is awaited. */
  const answers = new Map<string, SavedEdits | null>();
  const flushed = new EventTarget();
  let flushCount = 0;
  // The page's prompt resumes a close or a quit through this; the gate that held it needs the server first.
  const held = { resume: (): void => undefined };

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
      menuOpen: (open) => {
        menu?.set(open);
      },
      openSettings: options.openSettings,
      reportShown: (shown) => {
        shownDone = shown?.done ?? null;
        options.onFocusChange();
      },
      resumeLeaving: () => {
        held.resume();
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

  /** The page's answer, or null when it doesn't answer in time. A page that is closed or still loading has nothing typed to save. */
  const askToSave = async (
    request:
      | { readonly id: CaptureId }
      | { readonly id: null; readonly leaving: Leaving },
    timeoutMs: number
  ): Promise<SavedEdits | null> => {
    if (window === null || window.webContents.isLoading()) {
      return { fields: null, ok: true };
    }

    flushCount += 1;

    const token = String(flushCount);

    answers.set(token, null);

    const answer = once(flushed, token, {
      signal: AbortSignal.timeout(timeoutMs),
    });

    server.emit("flush", { ...request, token });

    try {
      await answer;

      return answers.get(token) ?? null;
    } catch {
      return null;
    } finally {
      answers.delete(token);
    }
  };

  const saveEdits = async (id: CaptureId): Promise<SavedEdits> =>
    (await askToSave({ id }, COPY_FLUSH_TIMEOUT_MS)) ?? {
      message: "Saving took too long.",
      ok: false,
    };

  const surface = (): void => {
    if (window === null) {
      return;
    }

    if (window.isMinimized()) {
      window.restore();
    }

    bringToFront();
    window.show();
    window.focus();
  };

  // A page that doesn't answer in time keeps what its pagehide save manages.
  const leaveGate = createLeaveGate({
    ask: async (leaving) =>
      await askToSave({ id: null, leaving }, LEAVE_ANSWER_TIMEOUT_MS),
    surface,
  });

  held.resume = leaveGate.resume;

  const open = (id?: CaptureId): void => {
    if (window !== null) {
      if (id !== undefined) {
        server.emit("show", id);
      }

      surface();

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
    menu = trackMenuOpen({ contents: created.webContents, window: created });

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

    const closeNow = (): void => {
      mayClose = true;

      if (!created.isDestroyed()) {
        created.close();
      }
    };

    // The page saves what is typed first; its own pagehide save can't reach main from a closed window.
    created.on("close", (event) => {
      if (mayClose || quitting) {
        return;
      }

      event.preventDefault();
      void leaveGate.leave("close", closeNow);
    });
    created.on("focus", options.onFocusChange);
    created.on("blur", options.onFocusChange);
    created.on("closed", () => {
      nativeTheme.off("updated", followTheme);
      window = null;
      menu = null;
      mayClose = false;
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
    isFloating: () => floatOnTop,
    leave: (leaving, then) => {
      void leaveGate.leave(leaving, then);
    },
    saveEdits,
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
    menuOpen: () => menu?.holdsKeys() ?? false,
    open,
    setFloating: (on) => {
      floatOnTop = on;
      window?.setAlwaysOnTop(on, "floating");
    },
  };
};
