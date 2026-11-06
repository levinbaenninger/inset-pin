import { LEAVE_SAVE_WAIT_MS, SAVE_TOO_SLOW } from "@shared/contracts";
import type { ActionResult, Leaving } from "@shared/contracts";

import type { DraftStore } from "./drafts";

/** A close or a quit held while changes couldn't be saved: what the prompt says. */
export interface LeavePrompt {
  readonly count: number;
  readonly message: string;
  readonly leaving: Leaving;
  /** Every change it asks about is one main couldn't discard. */
  readonly undiscarded: boolean;
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
  readonly retry: () => void;
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
 * - asking: the prompt shows. `overdue` once the latest wait (the first, or a Retry's) ran out.
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
    a.undiscarded === b.undiscarded);

/**
 * Before the window closes or the app quits, every draft is saved, waiting
 * at most the save limit, except a Discard main couldn't finish, which only
 * the user settles. Whatever is still unsaved then holds the close, and the
 * prompt asks about it. The close goes on once every save lands (after Retry
 * or by itself), or when the user discards the changes: at once, or, for a
 * Discard again, once main has put back what is saved. Cancel keeps both the
 * drafts and the window.
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

  const publish = (): void => {
    const unsaved = drafts.unsaved();

    const next: LeavePrompt | null =
      state.kind !== "asking" || unsaved === null
        ? null
        : {
            count: unsaved.count,
            leaving: state.leaving,
            message:
              unsaved.error === null || (state.overdue && unsaved.pending)
                ? SAVE_TOO_SLOW
                : unsaved.error,
            undiscarded: unsaved.undiscarded,
          };

    if (same(prompt, next)) {
      return;
    }

    prompt = next;

    for (const listener of listeners) {
      listener();
    }
  };

  const become = (next: State): void => {
    clearTimeout(timer);
    state = next;
    publish();
  };

  /** The prompt's message turns to "didn't finish in time" if saves are still on their way once the limit is over. */
  const startLimit = (): void => {
    timer = setTimeout(() => {
      if (state.kind === "asking") {
        state = { ...state, overdue: true };
        publish();
      }
    }, LEAVE_SAVE_WAIT_MS);
  };

  drafts.subscribe(() => {
    if (state.kind === "idle" || discarding) {
      return;
    }

    if (drafts.unsaved() === null) {
      become(IDLE);
      resume();
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
    // A Discard again main hasn't answered still holds the close: it goes on once main puts back what is saved, and asks again if it can't.
    discard: () => {
      if (state.kind === "idle") {
        return;
      }

      discarding = true;
      drafts.discardAll();
      discarding = false;

      if (drafts.unsaved() === null) {
        become(IDLE);
        resume();
      } else {
        publish();
      }
    },
    get: () => prompt,
    retry: () => {
      if (state.kind !== "asking") {
        return;
      }

      become({ ...state, overdue: false });
      startLimit();
      drafts.retryAll();
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
};
