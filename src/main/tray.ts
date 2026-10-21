import { TRAY_CAPTURE_DELAY_MS } from "@shared/shortcut";
import { Menu, nativeImage, Tray } from "electron";
import type { MenuItemConstructorOptions } from "electron";

import type { TrayState } from "./draft";
import { trayMenu } from "./tray-menu";
import type { TrayAction, TrayItem } from "./tray-menu";

export interface TrayOptions {
  readonly iconPath: string;
  readonly shortcutRegistered: boolean;
  readonly draftState: () => TrayState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly showDraft: () => void;
  /** Called after the delay, so the user can move the pointer back over their work. */
  readonly captureNow: () => void;
  readonly openLibrary: () => void;
  readonly quit: () => void;
}

const toMenuItem = (
  item: TrayItem,
  run: (action: TrayAction) => void
): MenuItemConstructorOptions => {
  if (item.kind === "separator") {
    return { type: "separator" };
  }

  const { action } = item;

  return {
    click:
      action === null
        ? undefined
        : () => {
            run(action);
          },
    enabled: item.enabled,
    label: item.label,
  };
};

export const createTray = (options: TrayOptions): Tray => {
  const tray = new Tray(nativeImage.createFromPath(options.iconPath));
  let countdown: NodeJS.Timeout | null = null;

  const run = (action: TrayAction, refresh: () => void): void => {
    if (action === "showDraft") {
      options.showDraft();
    } else if (action === "openLibrary") {
      options.openLibrary();
    } else if (action === "quit") {
      options.quit();
    } else if (countdown === null) {
      countdown = setTimeout(() => {
        countdown = null;
        refresh();
        options.captureNow();
      }, TRAY_CAPTURE_DELAY_MS);
      refresh();
    }
  };

  const rebuild = (): void => {
    const items = trayMenu({
      countdownPending: countdown !== null,
      draft: options.draftState(),
      isMac: process.platform === "darwin",
      shortcutRegistered: options.shortcutRegistered,
    });

    tray.setContextMenu(
      Menu.buildFromTemplate(
        items.map((item) =>
          toMenuItem(item, (action) => {
            run(action, rebuild);
          })
        )
      )
    );
  };

  tray.setToolTip("Inset Context Pin");
  options.subscribe(rebuild);
  rebuild();

  if (process.platform === "win32") {
    tray.on("click", () => {
      tray.popUpContextMenu();
    });
  }

  return tray;
};
