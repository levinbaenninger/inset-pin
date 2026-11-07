import type { LibraryCommand } from "@shared/contracts";

import { libraryBridge } from "@/shared/bridge";
import { promptOpen } from "@/shared/key-targets";

type Listener = (command: LibraryCommand) => void;

const listeners = new Set<Listener>();

/** A command that arrived before anything listened, such as the sheet asked for while the window opened. */
let waiting: LibraryCommand[] = [];

/**
 * Listens once for the app menu's and the tray's commands, from the moment
 * the page loads. While a prompt is open it owns the window, so a command
 * is dropped rather than acting on the capture or the list behind it (SPEC
 * round 8).
 */
export const startCommandBus = (): void => {
  libraryBridge().on("command", (command) => {
    if (promptOpen()) {
      return;
    }

    if (listeners.size === 0) {
      waiting.push(command);
    }

    for (const listener of listeners) {
      listener(command);
    }
  });
};

/** Hands commands that arrived early to every listener that subscribed by then. */
const replay = (): void => {
  const kept = waiting;

  waiting = [];

  for (const command of kept) {
    for (const listener of listeners) {
      listener(command);
    }
  }
};

/**
 * Every listener sees every command and picks its own. Commands that came
 * before the first listener are replayed once the page's listeners have all
 * subscribed, a task later, so none of them misses one.
 */
export const onCommand = (listener: Listener): (() => void) => {
  listeners.add(listener);

  if (waiting.length > 0) {
    setTimeout(replay, 0);
  }

  return () => {
    listeners.delete(listener);
  };
};
