import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { CaptureId } from "@shared/capture-record";
import { libraryContract } from "@shared/contracts";
import type { ActionResult } from "@shared/contracts";
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  ipcMain,
  nativeImage,
  nativeTheme,
} from "electron";

import { serveContract } from "./ipc-kit";
import { exportFileName, toDetail, toSummary } from "./library-view";
import { drawPinMark } from "./pin-mark";
import type { CaptureStore } from "./store";
import { appOrigin, harden, secureWebPreferences } from "./window-security";

const DRAG_ICON_WIDTH = 128;

export interface LibraryWindow {
  readonly open: () => void;
  readonly isVisible: () => boolean;
}

export interface LibraryOptions {
  readonly store: CaptureStore;
  readonly preload: string;
  readonly url: string;
  readonly onOpened: () => void;
  readonly onClosed: () => void;
  readonly onRejected: (channel: string, reason: string) => void;
}

const OK: ActionResult = { ok: true };

const fail = (message: string): ActionResult => ({ message, ok: false });

interface PinnedImage {
  readonly image: Electron.NativeImage;
  readonly png: Buffer;
  readonly fileName: string;
}

export const createLibraryWindow = (options: LibraryOptions): LibraryWindow => {
  const { store } = options;
  let window: BrowserWindow | null = null;

  /** The saved crop with the pin drawn on it, so the receiving app sees what mattered. */
  const pinnedImage = (id: CaptureId): PinnedImage | null => {
    const entry = store.get(id);
    const file = store.imageFile(id);

    if (entry?.kind !== "ok" || file === null) {
      return null;
    }

    const saved = nativeImage.createFromPath(file);

    if (saved.isEmpty()) {
      return null;
    }

    const { height, width } = saved.getSize();
    const { pin, image } = entry.record;

    const marked = nativeImage.createFromBitmap(
      Buffer.from(
        drawPinMark(
          { data: saved.toBitmap(), height, width },
          pin,
          image.pixelsPerDip
        )
      ),
      { height, width }
    );

    return {
      fileName: exportFileName(entry.record.thought),
      image: marked,
      png: marked.toPNG(),
    };
  };

  const server = serveContract(
    libraryContract,
    {
      copyImage: async (id) => {
        const pinned = pinnedImage(id);

        if (pinned === null) {
          return fail("This capture has no readable image.");
        }

        try {
          const png = new Blob([pinned.png], { type: "image/png" });

          await clipboard.write([new ClipboardItem({ "image/png": png })]);

          return OK;
        } catch {
          return fail("The image could not be copied.");
        }
      },
      copyNote: async (id) => {
        const entry = store.get(id);

        if (entry?.kind !== "ok") {
          return fail("This capture can't be copied.");
        }

        await clipboard.writeText(entry.record.thought);

        return OK;
      },
      get: (id) => {
        const entry = store.get(id);

        return entry === undefined ? null : toDetail(entry);
      },
      list: () => store.list().map(toSummary),
      remove: async (id) => {
        const result = await store.remove(id);

        return result.ok ? OK : fail(result.message);
      },
      startImageDrag: (id) => {
        const pinned = pinnedImage(id);

        if (window === null || pinned === null) {
          return;
        }

        // A named copy, so the dropped file says what it is instead of "crop.png".
        const folder = path.join(app.getPath("temp"), "Inset Context Pin", id);
        const file = path.join(folder, pinned.fileName);

        mkdirSync(folder, { recursive: true });
        writeFileSync(file, pinned.png);
        window.webContents.startDrag({
          file,
          icon: pinned.image.resize({ width: DRAG_ICON_WIDTH }),
        });
      },
      updateThought: async ({ id, thought }) => {
        const result = await store.updateThought(id, thought);

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

  const open = (): void => {
    if (window !== null) {
      if (window.isMinimized()) {
        window.restore();
      }

      window.show();
      window.focus();

      return;
    }

    const created = new BrowserWindow({
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
      height: 680,
      minHeight: 420,
      minWidth: 560,
      show: false,
      title: "Recent captures",
      webPreferences: secureWebPreferences(options.preload),
      width: 960,
    });

    window = created;

    if (process.platform !== "darwin") {
      created.removeMenu();
    }

    harden(created.webContents, "library");
    created.once("ready-to-show", () => {
      created.show();

      if (process.platform === "darwin") {
        // Explicitly requested from the menu bar: bring it in front of the active app.
        app.focus({ steal: true });
      }

      options.onOpened();
    });
    created.on("closed", () => {
      window = null;
      options.onClosed();
    });
    void created.loadURL(options.url);
  };

  return { isVisible: () => window?.isVisible() ?? false, open };
};
