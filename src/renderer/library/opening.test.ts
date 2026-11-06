import { CaptureIdSchema } from "@shared/capture-record";
import type { EditableFields } from "@shared/capture-record";
import type { OwedDiscard } from "@shared/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DraftStore } from "./drafts";
import { openLibrary } from "./opening";

const A = CaptureIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c");

const SAVED: EditableFields = {
  description: "",
  due: null,
  pins: [],
  steps: [],
  title: "Saved title",
};

const OWED: OwedDiscard = {
  confirmed: SAVED,
  id: A,
  message: "Inset can’t write to its data folder.",
  tag: { epoch: "closed-page.1", seq: 3 },
  values: { ...SAVED, title: "Discarded title" },
};

const nothing = (): void => undefined;

/** The fake clock's time, in seconds. */
const at = (): string => `${String(Date.now() / 1000)}s`;

/** A library opening against lookups the test answers, recording what it showed and told main, at which second. */
const setup = (lookup: (asked: number) => Promise<readonly OwedDiscard[]>) => {
  const log: string[] = [];
  let asked = 0;

  const drafts = new DraftStore({
    discard: async () => await Promise.resolve({ ok: true }),
    update: async ({ fields }) => {
      log.push(`${at()} save:${fields.title}`);

      return await Promise.resolve({ ok: true });
    },
  });

  const opening = openLibrary({
    drafts,
    owed: async () => {
      asked += 1;
      log.push(`${at()} ask ${String(asked)}`);

      return await lookup(asked);
    },
    report: (count) => {
      log.push(`${at()} count ${String(count)}`);
    },
  });

  opening.subscribe(() => {
    log.push(`${at()} ${opening.get()}`);
  });

  return { drafts, log, opening };
};

const never = async (): Promise<readonly OwedDiscard[]> =>
  // oxlint-disable-next-line promise/avoid-new -- a lookup main never answers.
  await new Promise<readonly OwedDiscard[]>(nothing);

const late = async (
  ms: number,
  list: readonly OwedDiscard[]
): Promise<readonly OwedDiscard[]> =>
  // oxlint-disable-next-line promise/avoid-new -- an answer that comes after a delay.
  await new Promise<readonly OwedDiscard[]>((resolve) => {
    setTimeout(() => {
      resolve(list);
    }, ms);
  });

describe("opening the library while main may not say which Discards it owes (SPEC round 10)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
    vi.spyOn(console, "error").mockImplementation(nothing);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows nothing and reports nothing after a failed lookup, asks again a second later, and opens with the owed Discard failed", async () => {
    const { drafts, log, opening } = setup(async (asked) => {
      if (asked === 1) {
        throw new Error("The IPC channel closed.");
      }

      return await Promise.resolve([OWED]);
    });

    await vi.advanceTimersByTimeAsync(999);

    const beforeRetry = [...log];

    await vi.advanceTimersByTimeAsync(1);
    await opening.opened;

    drafts.edit(
      A,
      { ...OWED.values, description: "Typed after opening" },
      SAVED,
      {
        now: true,
      }
    );
    await vi.advanceTimersByTimeAsync(5000);

    expect({
      after: log.slice(beforeRetry.length),
      beforeRetry,
      draft: drafts.get(A)?.error,
    }).toStrictEqual({
      after: ["1s ask 2", "1s count 1", "1s open"],
      beforeRetry: ["0s ask 1", "0s unread"],
      draft: {
        during: "discard",
        message: "Inset can’t write to its data folder.",
      },
    });
  });

  it("goes unread once a lookup hasn't answered within 3 s, and asks again a second after each lookup gives up", async () => {
    const { log, opening } = setup(never);

    await vi.advanceTimersByTimeAsync(9000);

    expect({ log, state: opening.get() }).toStrictEqual({
      log: ["0s ask 1", "3s unread", "4s ask 2", "8s ask 3"],
      state: "unread",
    });
  });

  it("opens with a lookup's answer that comes after the limit, as main's does while it waits for a Discard on its way, without waiting for the next lookup", async () => {
    const { log, opening } = setup(async (asked) =>
      asked === 1 ? await late(3200, [OWED]) : await never()
    );

    await vi.advanceTimersByTimeAsync(3200);
    await opening.opened;

    expect({ log, state: opening.get() }).toStrictEqual({
      log: ["0s ask 1", "3s unread", "3.2s count 1", "3.2s open"],
      state: "open",
    });
  });

  it("opens at once with a count of 0 when main owes nothing", async () => {
    const { log, opening } = setup(async () => await Promise.resolve([]));

    await vi.advanceTimersByTimeAsync(0);
    await opening.opened;

    expect(log).toStrictEqual(["0s ask 1", "0s count 0", "0s open"]);
  });
});
