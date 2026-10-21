import { setTimeout as delay } from "node:timers/promises";

import { placePopover, POPOVER_WIDTH_DIP, rect, size } from "@shared/geometry";
import type { Rect } from "@shared/geometry";
import { app, BrowserWindow, dialog, nativeTheme, screen } from "electron";
import type { Rectangle, WebContents } from "electron";

import type { Anchor, DraftSurface, QuitChoice } from "./draft";
import { harden, secureWebPreferences } from "./window-security";

/** First guess before the renderer reports its real content height. */
const INITIAL_HEIGHT = 320;

/** Upper bound on waiting for the renderer's height before showing anyway. */
const HEIGHT_WAIT_MS = 250;

/** Time for the compositor to drop the hidden panel before a capture. Not measured; see report. */
const HIDE_SETTLE_MS = 150;
const QUIT_CHOICES: readonly QuitChoice[] = ["save", "discard", "cancel"];

export interface CaptureSurface extends DraftSurface {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  readonly setContentHeight: (px: number) => void;
  readonly onDismissRequest: (listener: () => void) => void;
  readonly onShown: (listener: (bounds: Rectangle) => void) => void;
  readonly onHidden: (listener: () => void) => void;
  /** After the quit gate allowed quitting, let the window close instead of dismissing. */
  readonly allowClose: () => void;
}

export interface SurfaceOptions {
  readonly preload: string;
  readonly url: string;
  /** Another Inset window (the library) is visible, so app.hide() would hide it too. */
  readonly otherWindowVisible: () => boolean;
}

const isMac = process.platform === "darwin";

const noop = (): void => undefined;

const noopBounds = (_bounds: Rectangle): void => undefined;

const backgroundColor = (): string =>
  nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff";

/** The display of the original point if still attached, else the nearest one. */
const workAreaFor = (anchor: Anchor): Rect<"screen"> => {
  const display =
    screen
      .getAllDisplays()
      .find((candidate) => candidate.id === anchor.display.id) ??
    screen.getDisplayNearestPoint(anchor.point);

  const { height, width, x, y } = display.workArea;

  return rect(x, y, width, height);
};

/**
 * The capture panel: one small frameless window, created hidden at launch
 * and reused. It is shown beside the anchor only after the renderer has
 * reported its content height, so it opens at its final size.
 */
export const createCaptureSurface = (
  options: SurfaceOptions
): CaptureSurface => {
  const window = new BrowserWindow({
    alwaysOnTop: false,
    backgroundColor: backgroundColor(),
    frame: false,
    fullscreenable: false,
    hasShadow: true,
    height: INITIAL_HEIGHT,
    maximizable: false,
    minimizable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    title: "Inset Context Pin",
    type: isMac ? "panel" : undefined,
    useContentSize: true,
    webPreferences: secureWebPreferences(options.preload),
    width: POPOVER_WIDTH_DIP,
  });

  let anchor: Anchor | null = null;
  let contentHeight = INITIAL_HEIGHT;
  let revealTimer: NodeJS.Timeout | undefined;
  let waitingForHeight = false;
  let hiddenAt = 0;
  let blurSuppressed = 0;
  let closable = false;
  const listeners = { dismiss: noop, hidden: noop, shown: noopBounds };

  window.setContentProtection(true);

  if (isMac) {
    window.setVisibleOnAllWorkspaces(true, {
      skipTransformProcessType: true,
      visibleOnFullScreen: true,
    });
  }

  harden(window.webContents, "capture");

  const place = (): void => {
    if (anchor !== null) {
      window.setBounds(
        placePopover(
          anchor.point,
          size(POPOVER_WIDTH_DIP, contentHeight),
          workAreaFor(anchor)
        )
      );
    }
  };

  const reveal = (): void => {
    clearTimeout(revealTimer);
    waitingForHeight = false;

    if (anchor === null) {
      return;
    }

    place();

    if (isMac) {
      // Undo app.hide() from the last dismissal, otherwise the window stays hidden with the app.
      app.show();
    }

    window.setAlwaysOnTop(true, "floating");
    window.show();
    window.focus();
    listeners.shown(window.getBounds());
  };

  const hide = (): void => {
    clearTimeout(revealTimer);
    waitingForHeight = false;

    if (!window.isVisible()) {
      return;
    }

    window.setAlwaysOnTop(false);
    window.hide();
    hiddenAt = Date.now();

    if (isMac && !options.otherWindowVisible()) {
      // Hands activation back to the app the user was working in.
      app.hide();
    }

    listeners.hidden();
  };

  window.on("blur", () => {
    if (blurSuppressed === 0 && window.isVisible()) {
      listeners.dismiss();
    }
  });

  window.on("close", (event) => {
    if (!closable) {
      event.preventDefault();
      listeners.dismiss();
    }
  });

  window.webContents.on("render-process-gone", () => {
    if (!window.isDestroyed()) {
      window.reload();
    }
  });

  return {
    allowClose: () => {
      closable = true;
    },
    askQuitChoice: async () => {
      blurSuppressed += 1;

      try {
        if (isMac) {
          app.focus({ steal: true });
        }

        const { response } = await dialog.showMessageBox({
          buttons: ["Save", "Discard", "Cancel"],
          cancelId: 2,
          defaultId: 0,
          detail: "This capture has a thought that has not been saved yet.",
          message: "Save your capture before quitting?",
          noLink: true,
          title: "Inset Context Pin",
          type: "question",
        });

        return QUIT_CHOICES[response] ?? "cancel";
      } finally {
        blurSuppressed -= 1;
      }
    },
    focus: () => {
      if (window.isVisible()) {
        window.show();
        window.focus();
      }
    },
    hide,
    load: async () => {
      await window.loadURL(options.url);
    },
    onDismissRequest: (listener) => {
      listeners.dismiss = listener;
    },
    onHidden: (listener) => {
      listeners.hidden = listener;
    },
    onShown: (listener) => {
      listeners.shown = listener;
    },
    setContentHeight: (px) => {
      contentHeight = px;

      if (waitingForHeight) {
        reveal();
      } else if (window.isVisible()) {
        place();
      }
    },
    show: (next) => {
      anchor = next;
      waitingForHeight = true;
      clearTimeout(revealTimer);
      revealTimer = setTimeout(reveal, HEIGHT_WAIT_MS);
    },
    webContents: window.webContents,
    whenHidden: async () => {
      hide();

      const remaining = HIDE_SETTLE_MS - (Date.now() - hiddenAt);

      if (remaining > 0) {
        await delay(remaining);
      }
    },
  };
};
