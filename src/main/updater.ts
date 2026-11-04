// electron-updater defines autoUpdater as a getter, which an ESM named import cannot see.
import electronUpdater from "electron-updater";

import { canCheck, IDLE, nextUpdateState } from "./update-state";
import type { UpdateEvent, UpdateState } from "./update-state";

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

export interface UpdaterOptions {
  /** Replaces the feed in app-update.yml, for testing against a local server. */
  readonly feedUrl: string | undefined;
  readonly onChange: (state: UpdateState) => void;
  /** Called once, when an update has downloaded and waits for a restart. */
  readonly onReady: (version: string) => void;
}

export interface Updater {
  readonly state: () => UpdateState;
  readonly check: () => void;
  readonly install: () => void;
}

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const startUpdater = (options: UpdaterOptions): Updater => {
  const { autoUpdater } = electronUpdater;
  let state = IDLE;

  const dispatch = (event: UpdateEvent): void => {
    const next = nextUpdateState(state, event);

    if (next === state) {
      return;
    }

    const wasReady = state.kind === "ready";

    state = next;
    options.onChange(state);

    if (!wasReady && state.kind === "ready") {
      options.onReady(state.version);
    }
  };

  if (options.feedUrl !== undefined && options.feedUrl !== "") {
    autoUpdater.setFeedURL({ provider: "generic", url: options.feedUrl });
  }

  autoUpdater.on("checking-for-update", () => {
    dispatch({ type: "checkStarted" });
  });
  autoUpdater.on("update-available", (info) => {
    dispatch({ type: "found", version: info.version });
  });
  autoUpdater.on("update-not-available", () => {
    dispatch({ type: "notFound" });
  });
  autoUpdater.on("download-progress", (progress) => {
    dispatch({ percent: progress.percent, type: "progress" });
  });
  autoUpdater.on("update-downloaded", (info) => {
    dispatch({ type: "downloaded", version: info.version });
  });
  autoUpdater.on("error", (error) => {
    dispatch({ message: errorMessage(error), type: "failed" });
  });

  const check = async (): Promise<void> => {
    if (!canCheck(state)) {
      return;
    }

    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      dispatch({ message: errorMessage(error), type: "failed" });
    }
  };

  const checkInBackground = (): void => {
    void check();
  };

  checkInBackground();
  setInterval(checkInBackground, CHECK_EVERY_MS);

  return {
    check: checkInBackground,
    install: () => {
      if (state.kind === "ready") {
        autoUpdater.quitAndInstall();
      }
    },
    state: () => state,
  };
};
