import type { CaptureId } from "@shared/capture-record";
import { Menu, nativeImage, nativeTheme, Tray } from "electron";
import type { MenuItemConstructorOptions } from "electron";

import { trayTooltip } from "./tray-menu";
import type { TrayAction, TrayItem } from "./tray-menu";

export interface MenuRunner {
  readonly run: (action: TrayAction) => void;
  readonly openCapture: (id: CaptureId) => void;
}

export const toMenuItem = (
  item: TrayItem,
  { openCapture, run }: MenuRunner
): MenuItemConstructorOptions => {
  if (item.kind === "separator") {
    return { type: "separator" };
  }

  if (item.kind === "capture") {
    return {
      click: () => {
        openCapture(item.id);
      },
      label: item.label,
    };
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

export interface TrayOptions {
  /** Read again when the system theme changes. */
  readonly iconPath: () => string;
  readonly items: () => readonly TrayItem[];
  readonly runner: MenuRunner;
}

export interface TrayIcon {
  /** Rebuilds the menu from the current state. */
  readonly refresh: () => void;
  readonly destroy: () => void;
}

export const createTray = (options: TrayOptions): TrayIcon => {
  const tray = new Tray(nativeImage.createFromPath(options.iconPath()));

  const followTheme = (): void => {
    tray.setImage(nativeImage.createFromPath(options.iconPath()));
  };

  const refresh = (): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate(
        options.items().map((item) => toMenuItem(item, options.runner))
      )
    );
  };

  nativeTheme.on("updated", followTheme);
  tray.setToolTip(trayTooltip({ isMac: process.platform === "darwin" }));
  refresh();

  if (process.platform === "win32") {
    tray.on("click", () => {
      tray.popUpContextMenu();
    });
  }

  return {
    destroy: () => {
      nativeTheme.off("updated", followTheme);
      tray.destroy();
    },
    refresh,
  };
};
