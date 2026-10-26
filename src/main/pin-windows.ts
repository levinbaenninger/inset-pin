import type { CaptureId } from "@shared/capture-record";
import type { ActionResult } from "@shared/contracts";
import { BrowserWindow, Menu, screen } from "electron";
import type { WebContents } from "electron";

import { MIN_WIDTH, pinSize, fitToCrop } from "./pin-size";
import type { PinSize } from "./pin-size";
import type { CaptureStore } from "./store";
import { harden, secureWebPreferences } from "./window-security";

/** From the top-right corner of the work area; each further pin steps down and left. */
const MARGIN = 24;
const CASCADE = 28;

const isMac = process.platform === "darwin";

const isWindows = process.platform === "win32";

export interface PinWindows {
  readonly open: (id: CaptureId) => void;
  readonly close: (id: CaptureId) => void;
  /** The capture a pin window shows, by its webContents id. */
  readonly captureOf: (webContentsId: number) => CaptureId | null;
  readonly anyVisible: () => boolean;
  readonly webContents: () => readonly WebContents[];
}

/**
 * Windows applies an aspect ratio to a frameless window's outer frame, its
 * invisible resize borders included, so the crop would open and resize
 * stretched. The page letterboxes the crop while the user resizes, and the
 * window then snaps to the crop's shape.
 */
const fitToCropOnWindows = (window: BrowserWindow, opened: PinSize): void => {
  let before = opened;

  window.on("resized", () => {
    const [width = opened.width, height = opened.height] =
      window.getContentSize();

    const snapped = fitToCrop(opened, before, { height, width });

    before = snapped;

    if (snapped.width !== width || snapped.height !== height) {
      window.setContentSize(snapped.width, snapped.height);
    }
  });
};

/**
 * Captures pinned to the screen: small windows that float above other apps on
 * every Space until they are closed, one per capture.
 */
export const createPinWindows = (options: {
  readonly store: CaptureStore;
  readonly preload: string;
  readonly url: string;
  /** The pin's right-click menu on Windows. */
  readonly copyImage: (id: CaptureId) => Promise<ActionResult>;
  readonly showInLibrary: (id: CaptureId) => void;
}): PinWindows => {
  const windows = new Map<CaptureId, BrowserWindow>();

  const close = (id: CaptureId): void => {
    windows.get(id)?.close();
  };

  // A deleted capture takes its pin with it.
  options.store.subscribe(() => {
    for (const id of windows.keys()) {
      if (options.store.get(id)?.kind !== "ok") {
        close(id);
      }
    }
  });

  /**
   * The whole pin moves the window, so a right-click on Windows opens the
   * system's window menu; the pin's own commands are more use there.
   */
  const replaceSystemMenu = (window: BrowserWindow, id: CaptureId): void => {
    window.on("system-context-menu", (event) => {
      event.preventDefault();
      Menu.buildFromTemplate([
        {
          click: () => {
            void options.copyImage(id);
          },
          label: "Copy image",
        },
        {
          click: () => {
            options.showInLibrary(id);
          },
          label: "Show in library",
        },
        { type: "separator" },
        {
          click: () => {
            close(id);
          },
          label: "Close",
        },
      ]).popup({ window });
    });
  };

  const open = (id: CaptureId): void => {
    const existing = windows.get(id);

    if (existing !== undefined) {
      existing.show();
      existing.focus();

      return;
    }

    const entry = options.store.get(id);

    if (entry?.kind !== "ok") {
      return;
    }

    const { height, width } = pinSize(entry.record.image);

    const area = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint()
    ).workArea;

    const step = (windows.size % 6) * CASCADE;

    const window = new BrowserWindow({
      backgroundColor: "#000000",
      frame: false,
      fullscreenable: false,
      hasShadow: true,
      height,
      maximizable: false,
      minHeight: Math.round((MIN_WIDTH * height) / width),
      minWidth: MIN_WIDTH,
      minimizable: false,
      show: false,
      skipTaskbar: true,
      title: entry.record.thought.split("\n")[0] ?? "Pinned capture",
      webPreferences: secureWebPreferences(options.preload),
      width,
      x: area.x + area.width - width - MARGIN - step,
      y: area.y + MARGIN + step,
    });

    windows.set(id, window);

    if (isWindows) {
      fitToCropOnWindows(window, { height, width });
      replaceSystemMenu(window, id);
    } else {
      window.setAspectRatio(width / height);
    }

    // "floating" sits above normal windows and below menus and the Dock.
    window.setAlwaysOnTop(true, "floating");

    if (isMac) {
      window.setVisibleOnAllWorkspaces(true, {
        skipTransformProcessType: true,
        visibleOnFullScreen: true,
      });
    }

    harden(window.webContents, "pin");
    // The page's own title would name every pin in Alt+Tab "Pinned capture".
    window.on("page-title-updated", (event) => {
      event.preventDefault();
    });
    window.once("ready-to-show", () => {
      window.showInactive();
    });
    window.on("closed", () => {
      windows.delete(id);
    });
    void window.loadURL(options.url);
  };

  return {
    captureOf: (webContentsId) => {
      for (const [id, window] of windows) {
        if (!window.isDestroyed() && window.webContents.id === webContentsId) {
          return id;
        }
      }

      return null;
    },
    close,
    open,
    anyVisible: () => [...windows.values()].some((one) => one.isVisible()),
    webContents: () => [...windows.values()].map((one) => one.webContents),
  };
};
