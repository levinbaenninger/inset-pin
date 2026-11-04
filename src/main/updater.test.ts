import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdateEvent } from "./update-state";
import { startUpdater } from "./updater";
import type { UpdateSource } from "./updater";

type CheckResult = Awaited<ReturnType<UpdateSource["checkForUpdates"]>>;

const fakeSource = (check: () => CheckResult) => {
  const listeners: ((event: UpdateEvent) => void)[] = [];

  const source = {
    checkForUpdates: vi.fn<UpdateSource["checkForUpdates"]>(async () => {
      await Promise.resolve();

      return check();
    }),
    quitAndInstall: vi.fn<UpdateSource["quitAndInstall"]>(),
    setFeedURL: vi.fn<UpdateSource["setFeedURL"]>(),
    subscribe: (listener: (event: UpdateEvent) => void) => {
      listeners.push(listener);
    },
  } satisfies UpdateSource;

  return {
    emit: (event: UpdateEvent) => {
      for (const listener of listeners) {
        listener(event);
      }
    },
    source,
  };
};

const start = (source: UpdateSource) =>
  startUpdater({
    feedUrl: undefined,
    onChange: vi.fn<() => void>(),
    onReady: vi.fn<() => void>(),
    source,
  });

describe(startUpdater, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a failed download and checks again", async () => {
    const { source } = fakeSource(() => ({
      downloadPromise: Promise.reject(new Error("socket hang up")),
    }));

    const updater = start(source);

    await vi.waitFor(() => {
      expect(updater.state()).toStrictEqual({
        kind: "error",
        message: "socket hang up",
      });
    });

    updater.check();

    expect(source.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("restarts into a downloaded update", () => {
    const { emit, source } = fakeSource(() => null);
    const updater = start(source);

    emit({ type: "downloaded", version: "0.1.58" });
    updater.install();

    expect(updater.state()).toStrictEqual({ kind: "ready", version: "0.1.58" });
    expect(source.quitAndInstall).toHaveBeenCalledOnce();
  });
});
