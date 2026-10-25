import { app, BrowserWindow, nativeTheme } from "electron";
import type { WebContents } from "electron";

import { harden, secureWebPreferences } from "./window-security";

const WIDTH = 420;

/** Until the page reports its own height (fitHeight). */
const FIRST_HEIGHT = 260;

const isMac = process.platform === "darwin";

/** On macOS the translucent material shows through; elsewhere the page's own background (styles.css). */
const background = (): string => {
  if (isMac) {
    return "#00000000";
  }

  return nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff";
};

export interface SettingsWindow {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  readonly open: () => void;
  readonly isVisible: () => boolean;
  /** Sizes the window to the page's content. */
  readonly fitHeight: (height: number) => void;
  /** Once quitting, closing must not be held back, or it would cancel the quit. */
  readonly allowClose: () => void;
}

/**
 * A small settings window like a Mac app's Settings, as tall as its content.
 * On macOS it has the sidebar's translucent material and draws its own title
 * under the traffic lights.
 */
export const createSettingsWindow = (options: {
  readonly preload: string;
  readonly url: string;
}): SettingsWindow => {
  let height = FIRST_HEIGHT;

  const window = new BrowserWindow({
    backgroundColor: background(),
    fullscreenable: false,
    height,
    maximizable: false,
    minimizable: false,
    resizable: false,
    show: false,
    title: "Settings",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    // Centred in the page's 40-point title strip (settings-app.tsx).
    trafficLightPosition: { x: 14, y: 13 },
    useContentSize: true,
    vibrancy: isMac ? "sidebar" : undefined,
    webPreferences: secureWebPreferences(options.preload),
    width: WIDTH,
  });

  if (!isMac) {
    window.removeMenu();
    nativeTheme.on("updated", () => {
      window.setBackgroundColor(background());
    });
  }

  harden(window.webContents, "settings");

  let closable = false;

  // Kept for the next time, so it opens at once with the current values.
  window.on("close", (event) => {
    if (!closable) {
      event.preventDefault();
      window.hide();
    }
  });

  return {
    allowClose: () => {
      closable = true;
    },
    fitHeight: (next) => {
      height = next;
      window.setContentSize(WIDTH, height);
    },
    isVisible: () => window.isVisible(),
    load: async () => {
      await window.loadURL(options.url);
    },
    open: () => {
      if (!window.isVisible()) {
        window.setContentSize(WIDTH, height);
        window.center();
      }

      if (isMac) {
        // Undo app.hide() from a dismissed capture panel.
        app.show();
        app.focus({ steal: true });
      }

      window.show();
      window.focus();
    },
    webContents: window.webContents,
  };
};
