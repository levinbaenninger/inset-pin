import { setTimeout as delay } from "node:timers/promises";

import { placePopover, POPOVER_WIDTH_DIP, rect, size } from "@shared/geometry";
import type { Rect } from "@shared/geometry";
import { app, BrowserWindow, nativeTheme, screen } from "electron";
import type { Rectangle, WebContents } from "electron";

import type { Anchor, DraftSurface } from "./draft";
import { harden, secureWebPreferences } from "./window-security";

const INITIAL_HEIGHT = 320;
const HEIGHT_WAIT_MS = 250;

/** Lets the compositor drop the hidden panel before a capture; not measured, see report. */
const HIDE_SETTLE_MS = 150;

export interface CaptureSurface extends DraftSurface {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  readonly setContentHeight: (px: number, surfaceKey: string) => void;
  readonly onDismissRequest: (listener: () => void) => void;
  readonly onShown: (listener: (bounds: Rectangle) => void) => void;
  readonly onHidden: (listener: () => void) => void;
  /** Once quitting is allowed, close the window instead of dismissing it. */
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

const workAreaFor = (anchor: Anchor): Rect<"screen"> => {
  const display =
    screen
      .getAllDisplays()
      .find((candidate) => candidate.id === anchor.display.id) ??
    screen.getDisplayNearestPoint(anchor.point);

  const { height, width, x, y } = display.workArea;

  return rect(x, y, width, height);
};

/** Waits briefly for the renderer's content height before showing, so the panel opens at its final size. */
export const createCaptureSurface = (
  options: SurfaceOptions
): CaptureSurface => {
  const window = new BrowserWindow({
    alwaysOnTop: false,
    // Windows rounds a frameless window by only 8 px, so there the page draws the panel's corners itself.
    backgroundColor: isMac ? backgroundColor() : "#00000000",
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
    transparent: !isMac,
    type: isMac ? "panel" : undefined,
    useContentSize: true,
    webPreferences: secureWebPreferences(options.preload),
    width: POPOVER_WIDTH_DIP,
  });

  let anchor: Anchor | null = null;
  let contentHeight = INITIAL_HEIGHT;
  let revealTimer: NodeJS.Timeout | undefined;
  let pendingKey: string | null = null;
  let hiddenAt = 0;
  let closable = false;
  const listeners = { dismiss: noop, hidden: noop, shown: noopBounds };

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

  const settlePending = (): void => {
    clearTimeout(revealTimer);
    pendingKey = null;
  };

  const reveal = (): void => {
    settlePending();

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
    settlePending();

    if (!window.isVisible()) {
      return;
    }

    window.setAlwaysOnTop(false);

    if (!isMac && window.isFocused()) {
      // Windows hides a window without activating another, so the hidden panel would keep the keyboard.
      window.blur();
    }

    window.hide();
    hiddenAt = Date.now();

    if (isMac && !options.otherWindowVisible()) {
      // Hands activation back to the app the user was working in.
      app.hide();
    }

    listeners.hidden();
  };

  window.on("blur", () => {
    if (window.isVisible()) {
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
    setContentHeight: (px, surfaceKey) => {
      contentHeight = px;

      if (pendingKey === surfaceKey) {
        reveal();
      } else if (window.isVisible()) {
        place();
      }
    },
    show: (next, surfaceKey) => {
      anchor = next;
      pendingKey = surfaceKey;
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
