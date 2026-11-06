import type { Leaving, SavedEdits } from "@shared/contracts";

/** The native dialog's answer when the page couldn't confirm its changes were saved. */
export type Unconfirmed = "wait" | "leave" | "cancel";

export interface LeaveGateDeps {
  /** Asks the page whether it may close or quit; null when it doesn't answer within the limit. */
  readonly ask: (leaving: Leaving) => Promise<SavedEdits | null>;
  /** How many captures the page last said hold unsaved changes. */
  readonly unsaved: () => number;
  /** Waits, within the limit, for what the page sent to reach the disk; false when it ran out. */
  readonly written: () => Promise<boolean>;
  /**
   * Asks natively when the page can't: wait for it again, leave anyway, or
   * cancel. `count` is how many changes may be lost, or null when only the
   * disk is slow.
   */
  readonly confirm: (
    leaving: Leaving,
    count: number | null
  ) => Promise<Unconfirmed>;
  /** Brings the window that asks the user in front. */
  readonly surface: () => void;
  /** How long a page that held the close has to show its prompt or let it go on, before the native dialog asks. */
  readonly promptWithinMs: number;
}

export interface LeaveGate {
  /** Runs `then` once the page's changes are saved or discarded, unless the user cancels. */
  readonly leave: (leaving: Leaving, then: () => void) => Promise<void>;
  /** The page's prompt let the held close or quit go on. */
  readonly resume: () => void;
  /** The page's prompt is on screen, so the user answers there. */
  readonly shown: () => void;
}

/**
 * A close or a quit (SPEC rounds 6 and 7). The page answers at once: go on,
 * or held while it saves and maybe asks the user, resuming the close once it
 * may. An answer that never comes is never read as saved: with unsaved
 * changes on record, a native dialog asks instead, as it does when a page
 * that held the close neither asks nor lets it go on in time. Before a quit,
 * what the page sent must also reach the disk within the limit, or the
 * dialog asks.
 */
export const createLeaveGate = (deps: LeaveGateDeps): LeaveGate => {
  let turn = 0;
  let held: (() => void) | null = null;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  /** The turn whose prompt the page last showed; a prompt already on screen may say so before the page answers. */
  let shownTurn = 0;

  const clearDeadline = (): void => {
    clearTimeout(deadline);
    deadline = undefined;
  };

  const leave = async (leaving: Leaving, then: () => void): Promise<void> => {
    turn += 1;
    clearDeadline();

    const mine = turn;
    let settled = false;
    const current = (): boolean => !settled && mine === turn;

    const stop = (): void => {
      settled = true;
      held = null;
      clearDeadline();
    };

    /** The disk is slow: go on once it has written, or as the user says. */
    const goOnce = async (): Promise<void> => {
      if (!current()) {
        return;
      }

      stop();

      if (leaving === "close") {
        then();

        return;
      }

      const written = await deps.written();

      // A newer close or quit took over while the disk wrote: it decides now.
      if (mine !== turn) {
        return;
      }

      if (written) {
        then();

        return;
      }

      deps.surface();

      const choice = await deps.confirm(leaving, null);

      if (mine !== turn) {
        return;
      }

      if (choice === "leave") {
        then();
      } else if (choice === "wait") {
        settled = false;
        await goOnce();
      }
    };

    const resume = (): void => {
      void goOnce();
    };

    /** The page didn't answer, or held the close and then went quiet: only main can ask now. Wait asks the page `again`. */
    const unanswered = async (again: () => Promise<void>): Promise<void> => {
      if (!current()) {
        return;
      }

      const count = deps.unsaved();

      if (count === 0) {
        await goOnce();

        return;
      }

      deps.surface();

      const choice = await deps.confirm(leaving, count);

      if (!current()) {
        return;
      }

      if (choice === "leave") {
        await goOnce();
      } else if (choice === "wait") {
        await again();
      } else {
        stop();
      }
    };

    const askPage = async (): Promise<void> => {
      const answer = await deps.ask(leaving);

      if (!current()) {
        return;
      }

      if (answer?.ok === true) {
        await goOnce();

        return;
      }

      // The page holds it: it resumes once the saves land, or asks the user and resumes after Retry or Discard.
      held = resume;

      if (answer === null) {
        await unanswered(askPage);
      } else if (shownTurn !== mine) {
        deadline = setTimeout(() => {
          deadline = undefined;
          void unanswered(askPage);
        }, deps.promptWithinMs);
      }
    };

    held = null;
    await askPage();
  };

  return {
    leave,
    resume: () => {
      held?.();
    },
    shown: () => {
      shownTurn = turn;
      clearDeadline();
      deps.surface();
    },
  };
};
