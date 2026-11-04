import type { AppUpdater } from "electron-updater";

import { canCheck, IDLE, nextUpdateState } from "./update-state";
import type { UpdateEvent, UpdateState } from "./update-state";

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

/** The part of electron-updater's autoUpdater the app uses, with its events in the app's terms. */
export interface UpdateSource {
  readonly subscribe: (listener: (event: UpdateEvent) => void) => void;
  readonly checkForUpdates: () => Promise<{
    readonly downloadPromise?: Promise<unknown> | null;
  } | null>;
  readonly quitAndInstall: () => void;
  readonly setFeedURL: (options: {
    readonly provider: "generic";
    readonly url: string;
  }) => void;
}

export const fromAutoUpdater = (autoUpdater: AppUpdater): UpdateSource => ({
  checkForUpdates: async () => await autoUpdater.checkForUpdates(),
  quitAndInstall: () => {
    autoUpdater.quitAndInstall();
  },
  setFeedURL: (options) => {
    autoUpdater.setFeedURL(options);
  },
  subscribe: (listener) => {
    autoUpdater.on("checking-for-update", () => {
      listener({ type: "checkStarted" });
    });
    autoUpdater.on("update-available", (info) => {
      listener({ type: "found", version: info.version });
    });
    autoUpdater.on("update-not-available", () => {
      listener({ type: "notFound" });
    });
    autoUpdater.on("download-progress", (progress) => {
      listener({ percent: progress.percent, type: "progress" });
    });
    autoUpdater.on("update-downloaded", (info) => {
      listener({ type: "downloaded", version: info.version });
    });
    autoUpdater.on("error", (error) => {
      listener({ message: error.message, type: "failed" });
    });
  },
});

export interface UpdaterOptions {
  readonly source: UpdateSource;
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
  const { source } = options;
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
    source.setFeedURL({ provider: "generic", url: options.feedUrl });
  }

  source.subscribe(dispatch);

  const check = async (): Promise<void> => {
    if (!canCheck(state)) {
      return;
    }

    try {
      const result = await source.checkForUpdates();

      // The download runs apart from the check, and its failure rejects here as well as emitting "error".
      await result?.downloadPromise;
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
        source.quitAndInstall();
      }
    },
    state: () => state,
  };
};
