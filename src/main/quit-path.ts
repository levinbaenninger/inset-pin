export interface QuitEvent {
  readonly preventDefault: () => void;
}

export interface QuitPathDeps {
  /** `app.quit()`: emits before-quit at once, and quits unless a listener prevents it. */
  readonly requestQuit: () => void;
  /**
   * The library saves what is typed, then runs `then`. While changes can't
   * be saved its page asks the user, and a Cancel there never runs `then`
   * and never tells main.
   */
  readonly leave: (then: () => void) => void;
  /** The draft's gate: false holds the quit while the panel asks, and the draft resumes it through `resume`. */
  readonly allowQuit: () => boolean;
  /** The exit hook of a quit was dropped: that quit was cancelled, or another quit took its place. */
  readonly onDropped?: () => void;
}

export interface QuitPath {
  /** For `app.on("before-quit")`. */
  readonly beforeQuit: (event: QuitEvent) => void;
  /** For `app.on("will-quit")`: the quit goes ahead, so its exit hook runs. */
  readonly willQuit: () => void;
  /**
   * Quits through the app's whole quit path. `atExit` runs at the exit, and
   * only if this quit gets there: a quit the user cancels, or any other
   * quit that starts meanwhile, drops it.
   */
  readonly quit: (atExit?: () => void) => void;
  /** A quit the draft held goes on: it keeps its exit hook. */
  readonly resume: () => void;
  /** The user cancelled a held quit: its exit hook is dropped. */
  readonly cancelled: () => void;
  /** An update install saved the library's typing first, so this quit doesn't ask the library again. */
  readonly editsSaved: () => void;
}

/**
 * Inset's quit, in order: the library saves what is typed, then the draft
 * may hold the quit and ask, and only then do the windows close. A quit
 * this path starts carries an exit hook (Reopen to finish relaunches with
 * it), which runs only at the exit of that same quit. Electron emits
 * before-quit inside `app.quit()`, so a before-quit that arrives while
 * this path isn't asking is a new quit (a Quit in a menu, a logout, an
 * update install) and drops the hook: a reopen whose quit was cancelled
 * can't relaunch the app at a later, plain Quit.
 */
export const createQuitPath = (deps: QuitPathDeps): QuitPath => {
  let saved = false;
  let atExit: (() => void) | null = null;
  // True only while this path's own app.quit() runs.
  let asking = false;

  const drop = (): void => {
    if (atExit !== null) {
      atExit = null;
      deps.onDropped?.();
    }
  };

  const request = (): void => {
    asking = true;

    try {
      deps.requestQuit();
    } finally {
      // A quit already closing the windows ignores app.quit() and emits nothing: the next before-quit is someone else's.
      asking = false;
    }
  };

  return {
    beforeQuit: (event) => {
      const ours = asking;

      asking = false;

      if (!ours) {
        drop();
      }

      if (!saved) {
        event.preventDefault();
        deps.leave(() => {
          saved = true;
          request();
        });

        return;
      }

      if (!deps.allowQuit()) {
        event.preventDefault();
        saved = false;
      }
    },
    cancelled: drop,
    editsSaved: () => {
      saved = true;
    },
    quit: (hook) => {
      // A new hook replaces the old one quietly: its owner armed it just now, and onDropped would disarm it.
      if (hook === undefined) {
        drop();
      } else {
        atExit = hook;
      }

      request();
    },
    resume: request,
    willQuit: () => {
      const hook = atExit;

      atExit = null;
      hook?.();
    },
  };
};
