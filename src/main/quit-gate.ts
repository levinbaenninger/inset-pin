export interface QuitGateDeps {
  /** "hold" means a draft asks the user first, and calls resume once it lets the quit go on. */
  readonly holdIfNeeded: () => "allow" | "hold";
  readonly releaseWindows: () => void;
  readonly quit: () => void;
  /** Starts a held restart again from the top, which comes back through `restartToUpdate`. */
  readonly restart: () => void;
  readonly restartToUpdate: () => void;
}

export interface QuitGate {
  /** For before-quit: false means the quit must be prevented. */
  readonly allowQuit: () => boolean;
  readonly restartToUpdate: () => void;
  readonly resume: () => void;
}

type QuitKind = "quit" | "restartToUpdate";

/** Remembers which kind of quit a draft held, so the draft's answer resumes that one. */
export const createQuitGate = (deps: QuitGateDeps): QuitGate => {
  let held: QuitKind = "quit";

  const release = (kind: QuitKind): boolean => {
    if (deps.holdIfNeeded() === "hold") {
      held = kind;

      return false;
    }

    deps.releaseWindows();

    return true;
  };

  return {
    allowQuit: () => release("quit"),
    restartToUpdate: () => {
      if (release("restartToUpdate")) {
        deps.restartToUpdate();
      }
    },
    resume: () => {
      if (held === "restartToUpdate") {
        held = "quit";
        deps.restart();
      } else {
        deps.quit();
      }
    },
  };
};
