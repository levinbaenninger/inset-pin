import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { CaptureId } from "@shared/capture-record";
import {
  LEAVE_SAVE_WAIT_MS,
  libraryContract,
  SAVE_TOO_SLOW,
} from "@shared/contracts";
import type {
  ActionResult,
  AppStatus,
  Leaving,
  LibraryCommand,
  SavedEdits,
} from "@shared/contracts";
import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from "electron";

import type { PinnedImageOf } from "./capture-export";
import type { CopyGate } from "./copy-gate";
import { serveContract } from "./ipc-kit";
import type { Unconfirmed } from "./leave-gate";
import { createLibraryLink } from "./library-link";
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

/** Whether `work` finished within the save limit. */
const withinLimit = async (work: () => Promise<void>): Promise<boolean> => {
  let timer: NodeJS.Timeout | undefined;

  // oxlint-disable-next-line promise/avoid-new -- a deadline: it resolves on a timer.
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, LEAVE_SAVE_WAIT_MS);
  });

  const done = await Promise.race([
    (async () => {
      await work();

      return true;
    })(),
    late,
  ]);

  clearTimeout(timer);

  return done;
};

const CHOICES: readonly Unconfirmed[] = ["wait", "leave", "cancel"];

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
   * Before a quit: the page saves what is typed and the disk writes it, then
   * `then` runs. While changes couldn't be saved, the page holds the quit and
   * asks the user, and `then` runs only once the user retries or discards
   * them. When the page or the disk doesn't answer in time, a native dialog
   * asks instead.
   */
  readonly leave: (leaving: "quit" | "restart", then: () => void) => void;
  /** Asks the page to save what is typed into one capture, for a copy, and hands back what the copy carries; fails when that save fails or doesn't finish. */
  readonly saveEdits: (id: CaptureId) => Promise<SavedEdits>;
  /** Retry on a refused copy: the page saves this capture's changes again. */
  readonly retryEdits: (id: CaptureId) => Promise<ActionResult>;
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

  // The page reaches main's link to it through this; the link needs the server first.
  const page = {
    answered: (_token: string, _result: SavedEdits): void => undefined,
    reported: (_count: number): void => undefined,
    resume: (): void => undefined,
    shown: (): void => undefined,
  };

  // Dragged copies wait here for the drop; a drop can finish after startDrag returns, so they are cleared on delete and at launch.
  const dragStaging = path.join(app.getPath("temp"), "Inset Context Pin");

  const clearStaging = (id?: CaptureId): void => {
    rmSync(id === undefined ? dragStaging : path.join(dragStaging, id), {
      force: true,
      recursive: true,
    });
  };

  clearStaging();

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

  const server = serveContract(
    libraryContract,
    {
      captureSoon: options.captureSoon,
      copyDetails: async (id) => await copy(id, "details"),
      copyImage: async (id) => await copy(id, "image"),
      copyText: async (id) => await copy(id, "text"),
      discard: async ({ id, tag }) => {
        const result = await store.discard(id, tag);

        return result.ok ? OK : fail(result.message);
      },
      floatOnTop: options.floatOnTop,
      flushed: ({ result, token }) => {
        page.answered(token, result);
      },
      get: (id) => {
        const entry = store.get(id);

        return entry === undefined ? null : toDetail(entry);
      },
      leavePromptShown: () => {
        page.shown();
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
        page.resume();
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
      unsavedCount: (count) => {
        page.reported(count);
      },
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
      update: async ({ fields, id, tag }) => {
        const result = await store.update(id, fields, tag);

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

  const TOO_SLOW: SavedEdits = { message: SAVE_TOO_SLOW, ok: false };

  /** Asked when the page can't be: it doesn't answer, or the disk is slow to write what it sent. */
  const confirmUnsaved = async (
    leaving: Leaving,
    count: number | null
  ): Promise<Unconfirmed> => {
    const changes = count === 1 ? "1 change" : `${String(count)} changes`;

    const box: Electron.MessageBoxOptions = {
      buttons: [
        "Wait",
        leaving === "close" ? "Close anyway" : "Quit anyway",
        "Cancel",
      ],
      cancelId: 2,
      defaultId: 0,
      detail:
        count === null
          ? "Saving is taking longer than it should. Wait gives it more time."
          : `The library window stopped responding, so ${changes} may not be saved. Wait gives it more time to answer.`,
      message: "Inset Context Pin couldn’t confirm your changes were saved",
      type: "warning",
    };

    const { response } =
      window === null || window.isDestroyed()
        ? await dialog.showMessageBox(box)
        : await dialog.showMessageBox(window, box);

    return CHOICES[response] ?? "cancel";
  };

  const link = createLibraryLink({
    confirm: confirmUnsaved,
    // The page's own wait comes first, then as long again to show its prompt.
    promptWithinMs: LEAVE_SAVE_WAIT_MS * 2,
    send: (request) => {
      server.emit("flush", request);
    },
    surface,
    waitMs: LEAVE_SAVE_WAIT_MS,
    windowOpen: () => window !== null && !window.webContents.isDestroyed(),
    written: async () => await withinLimit(store.settled),
  });

  page.answered = link.answered;
  page.reported = link.reported;
  page.resume = link.resume;
  page.shown = link.shown;

  const saveEdits = async (id: CaptureId): Promise<SavedEdits> =>
    (await link.ask({ id, retry: false })) ?? TOO_SLOW;

  const retryEdits = async (id: CaptureId): Promise<ActionResult> => {
    const saved = (await link.ask({ id, retry: true })) ?? TOO_SLOW;

    return saved.ok ? OK : fail(saved.message);
  };

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
    link.gone();
    menu = trackMenuOpen({ contents: created.webContents, window: created });

    // The page main asked is gone with whatever it held; its count stays until a fresh page reports.
    created.webContents.on("did-navigate", link.gone);
    created.webContents.on("render-process-gone", link.gone);

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
      void link.leave("close", closeNow);
    });
    created.on("focus", options.onFocusChange);
    created.on("blur", options.onFocusChange);
    created.on("closed", () => {
      nativeTheme.off("updated", followTheme);
      window = null;
      menu = null;
      link.gone();
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
      void link.leave(leaving, then);
    },
    retryEdits,
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
