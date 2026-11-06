import type { Leaving, SavedEdits } from "@shared/contracts";

export interface LeaveGateDeps {
  /** Asks the page to save what is typed; null when it doesn't answer in time. */
  readonly ask: (leaving: Leaving) => Promise<SavedEdits | null>;
  /** Brings the window that asks the user in front. */
  readonly surface: () => void;
}

export interface LeaveGate {
  /** Saves the page's typing, then runs `then`, unless the page holds it to ask the user. */
  readonly leave: (leaving: Leaving, then: () => void) => Promise<void>;
  /** The page's prompt let the held close or quit go on. */
  readonly resume: () => void;
}

/**
 * A close or a quit the page holds while changes couldn't be saved. Only the
 * page saying so holds: a page that is gone or hung can't ask the user, so
 * without an answer the close goes on.
 */
export const createLeaveGate = (deps: LeaveGateDeps): LeaveGate => {
  let held: (() => void) | null = null;

  return {
    leave: async (leaving, then) => {
      held = null;

      const answer = await deps.ask(leaving);

      if (answer?.ok === false) {
        held = then;
        deps.surface();

        return;
      }

      then();
    },
    resume: () => {
      const resumed = held;

      held = null;
      resumed?.();
    },
  };
};
