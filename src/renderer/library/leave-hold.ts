import { LEAVE_SAVE_WAIT_MS } from "@shared/contracts";
import type { ActionResult, Leaving } from "@shared/contracts";

import type { DraftStore, Unsaved } from "./drafts";

/** A close or a quit held while changes couldn't be saved: what the prompt says. */
export interface LeavePrompt extends Unsaved {
  readonly leaving: Leaving;
}

export interface LeaveHold {
  /** Main asks before it closes the window or quits; a failure tells main to hold it. */
  readonly ask: (leaving: Leaving) => Promise<ActionResult>;
  readonly get: () => LeavePrompt | null;
  readonly subscribe: (listener: () => void) => () => void;
  readonly retry: () => void;
  readonly discard: () => void;
  readonly cancel: () => void;
}

/**
 * Before the window closes or the app quits, every draft is saved, waiting a
 * second at most. Whatever is still unsaved then holds the close, and the
 * prompt asks about it. The close goes on once every save lands, after Retry
 * or by itself, or once the user discards the changes. Cancel keeps both the
 * drafts and the window.
 */
export const createLeaveHold = (
  drafts: DraftStore,
  resume: () => void
): LeaveHold => {
  let shown: LeavePrompt | null = null;
  const listeners = new Set<() => void>();

  const show = (next: LeavePrompt | null): void => {
    shown = next;

    for (const listener of listeners) {
      listener();
    }
  };

  drafts.subscribe(() => {
    if (shown === null) {
      return;
    }

    const unsaved = drafts.unsaved();

    if (unsaved === null) {
      show(null);
      resume();
    } else if (
      unsaved.count !== shown.count ||
      unsaved.message !== shown.message
    ) {
      show({ ...unsaved, leaving: shown.leaving });
    }
  });

  return {
    ask: async (leaving) => {
      await drafts.settleAll(LEAVE_SAVE_WAIT_MS);

      const unsaved = drafts.unsaved();

      show(unsaved === null ? null : { ...unsaved, leaving });

      return unsaved === null
        ? { ok: true }
        : { message: unsaved.message, ok: false };
    },
    cancel: () => {
      show(null);
    },
    // Hidden first, so the drafts it drops don't resume the close a second time.
    discard: () => {
      show(null);
      drafts.discardAll();
      resume();
    },
    get: () => shown,
    retry: () => {
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
