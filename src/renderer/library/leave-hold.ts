import {
  DISCARD_PENDING,
  LEAVE_SAVE_WAIT_MS,
  SAVE_TOO_SLOW,
} from "@shared/contracts";
import type { ActionResult, Leaving } from "@shared/contracts";

import type { Discarding, DraftStore } from "./drafts";

/**
 * What the prompt asks, and so its buttons:
 * - retry: changes couldn't be saved, or not in time. Retry, or Discard and close.
 * - keep: main couldn't discard them (SPEC round 9). Keep changes, or Discard again.
 * - wait: only Discards main hasn't answered within the limit (SPEC round 10). Wait, or Close (Quit) anyway.
 */
export type LeaveAsks = "retry" | "keep" | "wait";

/** A close or a quit held while changes couldn't be saved: what the prompt says. */
export interface LeavePrompt {
  readonly count: number;
  readonly message: string;
  readonly leaving: Leaving;
  readonly asks: LeaveAsks;
}

export interface LeaveHold {
  /**
   * Main asks before it closes the window or quits, and hears at once: go
   * on, or held. A held close goes on by itself once every save lands within
   * the wait, and asks the user otherwise.
   */
  readonly ask: (leaving: Leaving) => ActionResult;
  readonly get: () => LeavePrompt | null;
  readonly subscribe: (listener: () => void) => () => void;
  /** The prompt's default action: Retry, Keep changes, or Wait. */
  readonly retry: () => void;
  /** The prompt's other action: Discard and close, Discard again, or Close (Quit) anyway. */
  readonly discard: () => void;
  readonly cancel: () => void;
}

export interface LeaveHoldDeps {
  readonly drafts: DraftStore;
  /** The held close or quit goes on. */
  readonly resume: () => void;
  /** The prompt is on screen, so main brings the window in front. */
  readonly shown: () => void;
}

/**
 * - waiting: main holds the close while the saves get up to the wait limit; nothing shows yet.
 * - asking: the prompt shows. `overdue` once the latest wait (the first, a Retry's, a Discard again's or Wait's) ran out.
 */
type State =
  | { readonly kind: "idle" }
  | { readonly kind: "waiting"; readonly leaving: Leaving }
  | {
      readonly kind: "asking";
      readonly leaving: Leaving;
      readonly overdue: boolean;
    };

const IDLE: State = { kind: "idle" };

const OK: ActionResult = { ok: true };

const HELD: ActionResult = {
  message: "The library holds this to save or ask first.",
  ok: false,
};

const same = (a: LeavePrompt | null, b: LeavePrompt | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.count === b.count &&
    a.message === b.message &&
    a.leaving === b.leaving &&
    a.asks === b.asks);

/** Why the close waits on main, what leaving now does about it, and what it loses. */
const discardingMessage = (
  leaving: Leaving,
  { typed }: Discarding,
  overdue: boolean
): string =>
  [
    overdue
      ? DISCARD_PENDING
      : "Waiting for Inset to put the earlier version back…",
    leaving === "close"
      ? "Close anyway lets it finish on its own."
      : "Quit anyway finishes it the next time Inset starts.",
    typed ? "What you typed since won’t be kept." : null,
  ]
    .filter((part) => part !== null)
    .join(" ");

/**
 * Before the window closes or the app quits, every draft is saved, waiting
 * at most the save limit, except a Discard main couldn't finish, which only
 * the user settles. Whatever is still unsaved then holds the close, and the
 * prompt asks about it. The close goes on once every save lands (after Retry
 * or by itself), or when the user discards the changes: at once, or, for a
 * Discard again, once main has put back what is saved. Cancel keeps both the
 * drafts and the window.
 *
 * A Discard main hasn't answered within the limit never traps the close
 * (SPEC round 10): the prompt offers Wait, which waits for main again, and
 * Close (Quit) anyway, which goes on at once. Main's marker finishes that
 * Discard at the next start, and a library opened before then shows it.
 */
export const createLeaveHold = ({
  drafts,
  resume,
  shown,
}: LeaveHoldDeps): LeaveHold => {
  let state: State = IDLE;
  let prompt: LeavePrompt | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** While Discard hands every capture to main: the close goes on only once all of them are sent. */
  let discarding = false;
  const listeners = new Set<() => void>();

  /** What the prompt shows now: null when nothing, undefined to leave it as it is. */
  const promptNow = (): LeavePrompt | null | undefined => {
    const unsaved = drafts.unsaved();

    if (state.kind !== "asking" || unsaved === null) {
      return null;
    }

    const owed = drafts.discarding();
    const { count } = unsaved;
    const { leaving, overdue } = state;

    if (owed !== null && owed.count === count) {
      // Main usually answers a Discard again at once, so the prompt that sent it stays until the limit runs out.
      if (!overdue && prompt !== null && prompt.asks !== "wait") {
        return undefined;
      }

      return {
        asks: "wait",
        count,
        leaving,
        message: discardingMessage(leaving, owed, overdue),
      };
    }

    return {
      asks: unsaved.undiscarded ? "keep" : "retry",
      count,
      leaving,
      message:
        unsaved.error === null || (overdue && unsaved.pending)
          ? SAVE_TOO_SLOW
          : unsaved.error,
    };
  };

  const publish = (): void => {
    const shows = promptNow();

    if (shows === undefined || same(prompt, shows)) {
      return;
    }

    prompt = shows;

    for (const listener of listeners) {
      listener();
    }
  };

  const become = (following: State): void => {
    clearTimeout(timer);
    state = following;
    publish();
  };

  /** The prompt changes once the limit is over and saves or Discards are still on their way. */
  const startLimit = (): void => {
    timer = setTimeout(() => {
      if (state.kind === "asking") {
        state = { ...state, overdue: true };
        publish();
      }
    }, LEAVE_SAVE_WAIT_MS);
  };

  /** Asks again, giving what was just sent to main up to the limit. */
  const waitAgain = (): void => {
    if (state.kind === "asking") {
      become({ ...state, overdue: false });
      startLimit();
    }
  };

  const leave = (): void => {
    become(IDLE);
    resume();
  };

  drafts.subscribe(() => {
    if (state.kind === "idle" || discarding) {
      return;
    }

    if (drafts.unsaved() === null) {
      leave();
    } else {
      publish();
    }
  });

  const wait = async (): Promise<void> => {
    const outcome = await drafts.settleAll(LEAVE_SAVE_WAIT_MS);

    if (state.kind === "waiting") {
      become({
        kind: "asking",
        leaving: state.leaving,
        overdue: outcome === "overdue",
      });
      shown();
    }
  };

  return {
    ask: (leaving) => {
      // Saved first, so a draft with nothing left to write is gone before the answer: a resume sent before main hears "held" would be lost.
      if (state.kind === "idle") {
        drafts.saveAll();
      }

      if (drafts.unsaved() === null) {
        become(IDLE);

        return OK;
      }

      if (state.kind === "idle") {
        state = { kind: "waiting", leaving };
        void wait();
      } else {
        state = { ...state, leaving };
        publish();

        if (state.kind === "asking") {
          shown();
        }
      }

      return HELD;
    },
    cancel: () => {
      become(IDLE);
    },
    // Close (Quit) anyway leaves the Discards on their way to main. Discard again holds the close until main puts back what is saved, and asks again if it can't or doesn't answer in time.
    discard: () => {
      if (state.kind === "idle") {
        return;
      }

      if (prompt?.asks === "wait") {
        leave();

        return;
      }

      discarding = true;
      drafts.discardAll();
      discarding = false;

      if (drafts.unsaved() === null) {
        leave();
      } else {
        waitAgain();
      }
    },
    get: () => prompt,
    retry: () => {
      if (state.kind !== "asking") {
        return;
      }

      const asks = prompt?.asks;

      waitAgain();

      if (asks !== "wait") {
        drafts.retryAll();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
};
