import { once } from "node:events";

import type { CaptureId } from "@shared/capture-record";
import type { FlushRequest, Leaving, SavedEdits } from "@shared/contracts";

import { createLeaveGate } from "./leave-gate";
import type { LeaveGate, LeaveGateDeps } from "./leave-gate";

/** What main asks the page to save: one capture before a copy (or again, for Retry), or everything before a close or a quit. */
export type SaveRequest =
  | { readonly id: CaptureId; readonly retry: boolean }
  | { readonly id: null; readonly leaving: Leaving };

export interface LibraryLinkDeps extends Omit<
  LeaveGateDeps,
  "ask" | "unsaved"
> {
  /** Whether the library window is open, with a page that may answer. */
  readonly windowOpen: () => boolean;
  /** Sends the page main's request; it answers through `answered`. */
  readonly send: (request: FlushRequest) => void;
  /** How long main waits for a page to report after it loads, and for its answer. */
  readonly waitMs: number;
}

export interface LibraryLink {
  /** Asks the page to save; null when it can't answer in time, which is never read as saved. */
  readonly ask: (request: SaveRequest) => Promise<SavedEdits | null>;
  /** The page's answer to a request. */
  readonly answered: (token: string, result: SavedEdits) => void;
  /** The page's unsaved count; the first report of a freshly loaded page says it can answer. */
  readonly reported: (count: number) => void;
  /** The page crashed, navigated or closed: it can't answer, and its count stays. */
  readonly gone: () => void;
  /**
   * Runs `then` once the page's changes are saved or discarded, or the user
   * chose to leave without them, unless the user cancels. Either way nothing
   * is left to ask about, so the count is cleared.
   */
  readonly leave: LeaveGate["leave"];
  readonly resume: LeaveGate["resume"];
  readonly shown: LeaveGate["shown"];
}

/**
 * The library page as main knows it (SPEC round 8): the unsaved count it
 * last reported, whether it can answer, and the close or quit that waits on
 * it. A crash, a reload or a navigation is never permission to leave: the
 * count stays until a freshly loaded page reports its own, and a close or
 * quit waiting on a page that went asks natively at once.
 */
export const createLibraryLink = (deps: LibraryLinkDeps): LibraryLink => {
  let unsaved = 0;
  let live = false;
  const events = new EventTarget();
  const answers = new Map<string, SavedEdits | null>();
  let tokens = 0;

  const within = async (event: string): Promise<boolean> => {
    try {
      await once(events, event, { signal: AbortSignal.timeout(deps.waitMs) });

      return true;
    } catch {
      return false;
    }
  };

  /** A page that can't answer yet gets the limit to report only while it may hold unsaved changes. */
  const ask = async (request: SaveRequest): Promise<SavedEdits | null> => {
    if (
      !deps.windowOpen() ||
      !(live || (unsaved > 0 && (await within("live"))))
    ) {
      return unsaved === 0 ? { fields: null, ok: true } : null;
    }

    tokens += 1;

    const token = String(tokens);

    answers.set(token, null);

    const answer = within(token);

    deps.send({ ...request, token });

    try {
      return (await answer) ? (answers.get(token) ?? null) : null;
    } finally {
      answers.delete(token);
    }
  };

  const gate = createLeaveGate({
    ...deps,
    ask: async (leaving) => await ask({ id: null, leaving }),
    unsaved: () => unsaved,
  });

  return {
    answered: (token, result) => {
      if (answers.has(token)) {
        answers.set(token, result);
        events.dispatchEvent(new Event(token));
      }
    },
    ask,
    gone: () => {
      live = false;
      gate.pageGone();
    },
    leave: async (leaving, then) => {
      await gate.leave(leaving, () => {
        unsaved = 0;
        then();
      });
    },
    reported: (count) => {
      unsaved = count;
      live = true;
      events.dispatchEvent(new Event("live"));
    },
    resume: gate.resume,
    shown: gate.shown,
  };
};
