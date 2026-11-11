import { app, BrowserWindow, screen } from "electron";
import type { WebContents } from "electron";

import type { Presentation } from "./permissions/onboarding";
import { harden, secureWebPreferences } from "./window-security";

const WIDTH = 460;

/** Until the page reports its own height (fitHeight). */
const FIRST_HEIGHT = 320;

/** Off the screen's edge, beside System Settings. */
const EDGE_GAP = 16;

/** The traffic lights' centres on the page's 48-point header (src/renderer/shared/window-header.tsx). */
const TRAFFIC_LIGHTS = { x: 18, y: 18 };

const isMac = process.platform === "darwin";

const ignore = (): void => undefined;

const workArea = () =>
  screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;

const float = (target: BrowserWindow, on: boolean): void => {
  if (on) {
    target.setAlwaysOnTop(true, "floating");
  } else {
    target.setAlwaysOnTop(false);
  }

  if (isMac) {
    // Without skipTransformProcessType, turning this off would give a menu-bar-only app a Dock icon.
    target.setVisibleOnAllWorkspaces(on, {
      skipTransformProcessType: true,
      visibleOnFullScreen: on,
    });
  }
};

export interface OnboardingWindowHandle {
  /** Null until the window is first shown, and again once the flow ends. */
  readonly webContents: () => WebContents | null;
  readonly present: (presentation: Presentation) => void;
  readonly hide: () => void;
  readonly isVisible: () => boolean;
  readonly isFocused: () => boolean;
  /** The close button: the flow decides what closing means. */
  readonly onClose: (listener: () => void) => void;
  /** Sizes the window to the page, keeping its middle where it was. */
  readonly fitHeight: (height: number) => void;
  /** Once quitting, closing must not be held back, or it would cancel the quit. */
  readonly allowClose: () => void;
}

/**
 * The first-run setup: a small window like Settings, as tall as its page,
 * made only when it shows and gone once the flow ends, since most launches
 * never show it. While it asks for a permission it floats above every
 * window, on every Space and over full-screen apps, so it stays beside
 * System Settings.
 */
export const createOnboardingWindow = (options: {
  readonly preload: string;
  readonly url: string;
}): OnboardingWindowHandle => {
  let window: BrowserWindow | null = null;
  let loaded = false;
  // What the flow asked for while the page was still loading; shown once it has.
  let wanted: Presentation | null = null;
  let closable = false;
  let onClose = ignore;
  let height = FIRST_HEIGHT;

  const live = (): BrowserWindow | null =>
    window === null || window.isDestroyed() ? null : window;

  const center = (target: BrowserWindow): void => {
    const area = workArea();

    target.setContentBounds({
      height,
      width: WIDTH,
      x: Math.round(area.x + (area.width - WIDTH) / 2),
      y: Math.round(area.y + (area.height - height) / 3),
    });
  };

  /** System Settings opens near the middle of the screen: the right edge of the work area is clear of most of it. */
  const toEdge = (target: BrowserWindow): void => {
    const area = workArea();

    target.setContentBounds({
      height,
      width: WIDTH,
      x: Math.round(area.x + area.width - WIDTH - EDGE_GAP),
      y: Math.round(area.y + (area.height - height) / 2),
    });
  };

  const show = (
    target: BrowserWindow,
    { floating, focus, place }: Presentation
  ): void => {
    float(target, floating);

    if (place === "center" || (place === "keep" && !target.isVisible())) {
      center(target);
    } else if (place === "edge") {
      toEdge(target);
    }

    if (!focus) {
      // Beside System Settings, which keeps the keyboard.
      target.showInactive();

      return;
    }

    if (isMac) {
      // Undo app.hide() from a dismissed capture panel; the app has no Dock icon when it lives in the menu bar.
      app.show();
      app.focus({ steal: true });
    }

    target.show();
    target.focus();
  };

  const create = (): BrowserWindow => {
    const created = new BrowserWindow({
      backgroundColor: isMac ? "#00000000" : undefined,
      fullscreenable: false,
      height,
      maximizable: false,
      minimizable: false,
      resizable: false,
      show: false,
      title: "Inset Context Pin Setup",
      titleBarStyle: isMac ? "hiddenInset" : "default",
      trafficLightPosition: TRAFFIC_LIGHTS,
      useContentSize: true,
      vibrancy: isMac ? "sidebar" : undefined,
      webPreferences: secureWebPreferences(options.preload),
      width: WIDTH,
    });

    harden(created.webContents, "onboarding");

    if (!isMac) {
      created.removeMenu();
    }

    created.on("close", (event) => {
      if (!closable) {
        event.preventDefault();
        onClose();
      }
    });

    created.on("closed", () => {
      if (window === created) {
        window = null;
        loaded = false;
      }
    });

    const load = async (): Promise<void> => {
      try {
        await created.loadURL(options.url);
      } catch (error) {
        console.error("The setup page failed to load:", error);

        return;
      }

      // The flow ended while it loaded, and maybe opened again in a new window.
      if (window !== created || created.isDestroyed()) {
        return;
      }

      loaded = true;

      const next = wanted;

      wanted = null;

      if (next !== null) {
        show(created, next);
      }
    };

    void load();

    return created;
  };

  return {
    allowClose: () => {
      closable = true;
    },
    fitHeight: (next) => {
      if (next === height) {
        return;
      }

      height = next;

      const target = live();

      if (target === null) {
        return;
      }

      const bounds = target.getContentBounds();
      const middle = bounds.y + bounds.height / 2;

      target.setContentBounds({
        ...bounds,
        height,
        y: Math.round(middle - height / 2),
      });
    },
    hide: () => {
      wanted = null;

      const target = live();

      if (target !== null) {
        window = null;
        loaded = false;
        // Gone rather than hidden: it is shown again only through Set Up Permissions….
        target.destroy();
      }
    },
    isFocused: () => {
      const target = live();

      return target !== null && target.isVisible() && target.isFocused();
    },
    isVisible: () => live()?.isVisible() ?? false,
    onClose: (listener) => {
      onClose = listener;
    },
    present: (presentation) => {
      const target = live() ?? create();

      window = target;

      if (loaded) {
        show(target, presentation);
      } else {
        wanted = presentation;
      }
    },
    webContents: () => live()?.webContents ?? null,
  };
};
