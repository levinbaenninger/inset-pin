import { LEAVE_SAVE_WAIT_MS } from "@shared/contracts";
import type { OwedDiscard } from "@shared/contracts";

import type { DraftStore } from "./drafts";

/**
 * How far the library is in opening. It shows captures, and tells main its
 * unsaved count, only once it knows which Discards main still owes, since a
 * capture main owes one for must open as not discarded (SPEC round 10).
 * - reading: it is asking main; nothing shows yet.
 * - unread: main couldn't say, or not within the limit. No capture shows, so
 *   none can be copied or edited over the words a Discard puts back, and the
 *   page asks again every OWED_RETRY_MS.
 * - open: it took them in and told main its count.
 */
export type Opening = "reading" | "unread" | "open";

/** How long the page waits before it asks main again which Discards it still owes. */
export const OWED_RETRY_MS = 1000;

export interface LibraryOpening {
  readonly get: () => Opening;
  readonly subscribe: (listener: () => void) => () => void;
  /** Resolves once the page took in what main owes and told main its count. */
  readonly opened: Promise<void>;
}

export interface OpeningDeps {
  readonly drafts: DraftStore;
  /** Main's list of the Discards it still owes. */
  readonly owed: () => Promise<readonly OwedDiscard[]>;
  /** Tells main how many captures hold changes that aren't on disk. */
  readonly report: (count: number) => void;
}

const after = async (ms: number): Promise<void> => {
  // oxlint-disable-next-line promise/avoid-new -- a pause: it resolves on a timer.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

/**
 * Asks main which Discards it still owes until it answers. A lookup that
 * fails, or doesn't answer within the limit, leaves the page unread and asks
 * again a second later. A late answer to any lookup still counts: main waits
 * for a Discard on its way before it answers, up to that same limit.
 */
export const openLibrary = ({
  drafts,
  owed,
  report,
}: OpeningDeps): LibraryOpening => {
  const listeners = new Set<() => void>();
  let state: Opening = "reading";
  let list: readonly OwedDiscard[] | null = null;
  let wake: (() => void) | null = null;

  // oxlint-disable-next-line promise/avoid-new -- settled by whichever lookup answers first.
  const answered = new Promise<void>((resolve) => {
    wake = resolve;
  });

  const take = (heard: readonly OwedDiscard[]): void => {
    list ??= heard;
    wake?.();
  };

  const isAnswered = (): boolean => list !== null;

  const set = (next: Opening): void => {
    if (state !== next) {
      state = next;

      for (const listener of listeners) {
        listener();
      }
    }
  };

  /** One lookup: over once main answers, it fails, or the limit passes; its answer counts whenever it comes. */
  const ask = async (): Promise<void> => {
    if (isAnswered()) {
      return;
    }

    const heard = (async () => {
      try {
        take(await owed());
      } catch (error) {
        console.error("Couldn’t hear which Discards main still owes", error);
      }
    })();

    await Promise.race([heard, answered, after(LEAVE_SAVE_WAIT_MS)]);
  };

  const opened = (async () => {
    await ask();

    while (!isAnswered()) {
      set("unread");
      // oxlint-disable-next-line no-await-in-loop -- each lookup waits for the one before it to fail, and a pause.
      await Promise.race([answered, after(OWED_RETRY_MS)]);
      // oxlint-disable-next-line no-await-in-loop -- as above.
      await ask();
    }

    drafts.owe(list ?? []);

    let reported = drafts.unsaved()?.count ?? 0;

    report(reported);

    drafts.subscribe(() => {
      const count = drafts.unsaved()?.count ?? 0;

      if (count !== reported) {
        reported = count;
        report(count);
      }
    });

    set("open");
  })();

  return {
    get: () => state,
    opened,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
};
