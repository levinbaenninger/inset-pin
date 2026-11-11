import { describe, expect, it } from "vitest";

import { createSafeRelaunch } from "./permissions/relaunch";
import { createQuitGate } from "./quit-gate";
import { createQuitPath } from "./quit-path";
import type { QuitPath } from "./quit-path";

const ignore = (): void => undefined;

/**
 * Inset's quit as main wires it (src/main/index.ts): Electron's app, which
 * emits before-quit inside app.quit() and ends at will-quit unless a
 * listener prevented it; the library, which saves what is typed and whose
 * page can hold the quit and be cancelled without telling main; the draft,
 * held through the real quit gate; and the onboarding's Reopen to finish,
 * through the permission kit's safe relaunch.
 */
const setUp = () => {
  const log: string[] = [];
  let ended = false;
  let quitting = false;
  // The library's leave keeps one turn: a newer leave replaces the older, whose `then` never runs.
  let leaving: (() => void) | null = null;
  let draftOpen = false;
  let draftHeld = false;

  let made: QuitPath | null = null;

  const quitPath = (): QuitPath => {
    if (made === null) {
      throw new Error("quit path not set up");
    }

    return made;
  };

  const gate = createQuitGate({
    holdIfNeeded: () => {
      if (!draftOpen) {
        return "allow";
      }

      draftHeld = true;

      return "hold";
    },
    quit: () => {
      quitPath().resume();
    },
    releaseWindows: () => {
      log.push("release");
    },
    restart: () => {
      log.push("restart");
    },
    restartToUpdate: () => {
      log.push("restartToUpdate");
    },
  });

  /** Electron's app.quit(): ignored while the windows already close for a quit. */
  const appQuit = (): void => {
    if (ended || quitting) {
      return;
    }

    let prevented = false;

    quitPath().beforeQuit({
      preventDefault: () => {
        prevented = true;
      },
    });

    if (prevented) {
      return;
    }

    quitting = true;
    quitPath().willQuit();
    log.push("exit");
    ended = true;
  };

  made = createQuitPath({
    allowQuit: gate.allowQuit,
    leave: (then) => {
      leaving = then;
    },
    onDropped: () => {
      log.push("dropped");
    },
    requestQuit: appQuit,
  });

  const relaunch = createSafeRelaunch({
    quit: (atExit) => {
      quitPath().quit(atExit);
    },
    relaunch: () => {
      log.push("relaunch");
    },
  });

  return {
    /** A quit Electron starts itself: ⌘Q, Quit in the Dock menu, a logout. */
    appQuit,
    /** The panel's answer to a held quit. */
    answer: (choice: "save" | "cancel") => {
      draftHeld = false;

      if (choice === "cancel") {
        quitPath().cancelled();
        relaunch.disarm();
      } else {
        draftOpen = false;
        gate.resume();
      }
    },
    /** The draft is saved or discarded outside a quit. */
    closeDraft: () => {
      draftOpen = false;
    },
    draftHeld: () => draftHeld,
    log,
    openDraft: () => {
      draftOpen = true;
    },
    path: quitPath,
    relaunch,
    /** The library's page saved what is typed, or had nothing to save. */
    saved: () => {
      const then = leaving;

      leaving = null;
      then?.();
    },
    /** Cancel in the library page's prompt: main never hears of it. */
    pageCancels: () => {
      leaving = null;
    },
  };
};

describe(createQuitPath, () => {
  it("relaunches once, at the exit, after the library saved", () => {
    const quit = setUp();

    quit.relaunch.request();

    expect(quit.log).toStrictEqual([]);

    quit.saved();

    expect(quit.log).toStrictEqual(["release", "relaunch", "exit"]);
  });

  it("never relaunches at a later plain Quit after the library page's Cancel, which main never hears of", () => {
    const quit = setUp();

    quit.relaunch.request();
    quit.pageCancels();
    // Quit Inset Context Pin from the pin icon.
    quit.path().quit();
    quit.saved();

    expect(quit.log).toStrictEqual(["dropped", "release", "exit"]);
  });

  it("never relaunches at a later ⌘Q after the library page's Cancel", () => {
    const quit = setUp();

    quit.relaunch.request();
    quit.pageCancels();
    quit.appQuit();
    quit.saved();

    expect(quit.log).toStrictEqual(["dropped", "release", "exit"]);
  });

  it("never relaunches after the draft's Cancel, at a later quit", () => {
    const quit = setUp();

    quit.openDraft();
    quit.relaunch.request();
    quit.saved();

    expect(quit.draftHeld()).toBeTruthy();

    quit.answer("cancel");

    expect(quit.relaunch.pending()).toBeFalsy();

    quit.closeDraft();
    quit.appQuit();
    quit.saved();

    expect(quit.log).toStrictEqual(["dropped", "release", "exit"]);
  });

  it("relaunches exactly once through a held draft: leave, hold, Save, leave again, exit", () => {
    const quit = setUp();

    quit.openDraft();
    quit.relaunch.request();
    quit.saved();

    expect(quit.draftHeld()).toBeTruthy();
    expect(quit.log).toStrictEqual([]);

    quit.answer("save");
    // The resumed quit asks the library again, as the held quit cleared its save.
    quit.saved();

    expect(quit.log).toStrictEqual(["release", "relaunch", "exit"]);
  });

  it("drops the reopen when a plain Quit takes its place while the library saves", () => {
    const quit = setUp();

    quit.relaunch.request();
    quit.appQuit();
    quit.saved();

    expect(quit.log).toStrictEqual(["dropped", "release", "exit"]);
  });

  it("relaunches once for a reopen pressed again after a Cancel main never heard of", () => {
    const quit = setUp();

    quit.relaunch.request();
    quit.pageCancels();
    quit.relaunch.request();
    quit.saved();

    expect(quit.log).toStrictEqual(["release", "relaunch", "exit"]);
  });

  it("treats the next before-quit as someone else's when its own app.quit() emitted none", () => {
    const log: string[] = [];
    let emits = false;

    const quitPath = createQuitPath({
      allowQuit: () => true,
      leave: (then) => {
        then();
      },
      requestQuit: () => {
        // A quit already closing the windows: Electron ignores app.quit().
        if (emits) {
          quitPath.beforeQuit({ preventDefault: ignore });
        }
      },
    });

    quitPath.quit(() => {
      log.push("relaunch");
    });

    // Electron's own quit, later: not the reopen's.
    emits = true;
    quitPath.beforeQuit({ preventDefault: ignore });
    quitPath.willQuit();

    expect(log).toStrictEqual([]);
  });

  it("goes straight to the draft's gate after an update install saved the library", () => {
    const quit = setUp();

    quit.path().editsSaved();
    quit.appQuit();

    expect(quit.log).toStrictEqual(["release", "exit"]);
  });
});
