/* oxlint-disable unicorn/consistent-function-scoping -- addInitScript serializes installBridge, so every helper must live inside it. */

/**
 * Stands in for each window's preload inside the page: its contract, answered
 * from the scene's data. scripts/screens.ts passes this function to
 * `page.addInitScript`, which runs it before the renderer starts, so it must
 * not reach anything outside its own body.
 */

declare global {
  /** The height a fitted window (the capture panel, Settings) reported last. */
  var __fitted: number | undefined;
  /** The library calls that act on a capture, as `name:id`, for the checks in scripts/screens.ts to read. */
  var __calls: string[] | undefined;
  /** What the capture panel sent main (edit, save, dismiss), apart from `__calls` so the quit checks keep their exact lists. */
  var __panelCalls: string[] | undefined;
  /** Every copy the page asked for, as `name:id`, whether or not it was made. */
  var __asked: string[] | undefined;
  /** While true, saving a capture's typing fails, as a full disk would. */
  var __failSaves: boolean | undefined;
  /** While true, saves wait for `__releaseSaves`, as a slow disk would. */
  var __holdSaves: boolean | undefined;
  /** While true, a save is written and then its answer waits for `__releaseSaves`, as an acknowledgement main is slow to send would. */
  var __holdAnswers: boolean | undefined;
  /** While true, Discard can't put back what a save replaced, as a lock on capture.json.prev would. */
  var __failDiscards: boolean | undefined;
  /** While true, a Discard waits for `__releaseDiscards` before main acts on it, as a rename a lock holds would. */
  var __holdDiscards: boolean | undefined;
  /** Lets every held Discard go on, each failing or not as `__failDiscards` says then. */
  var __releaseDiscards: (() => void) | undefined;
  /** Answers every held save, each failing or not as `__failSaves` says then. */
  var __releaseSaves: (() => void) | undefined;
  /** Answers only the oldest held save, so a check can look between two saves landing. */
  var __releaseOldest: (() => void) | undefined;
  /** While true, reading one capture waits for `__releaseGets`, as a reload main is slow to answer would. */
  var __holdGets: boolean | undefined;
  /** Answers every held read, each with the capture as it was when it was asked for. */
  var __releaseGets: (() => void) | undefined;
  /** The title each copy that was made carries, as the clipboard would get it. */
  var __clipboard: string[] | undefined;
  /** What the page last told main about its menus. */
  var __menuOpen: boolean | undefined;
  /** The title the fake disk holds for a capture. */
  var __storedTitle: ((id: string) => string | null) | undefined;
  /** What a check saw on screen, frame by frame. */
  var __seen: string[] | undefined;
  /** Every unsaved count the page sent main, in order. */
  var __unsavedCounts: number[] | undefined;
  /** How many times the page said its unsaved-changes prompt is on screen. */
  var __promptShown: number | undefined;
  /** The floating window's capture has changes main couldn't save, until a Retry saves them. */
  var __pinUnsaved: boolean | undefined;
  /** Sends the page an event as main would, such as a command from the app menu. */
  var __emit: ((name: string, payload: Payload) => void) | undefined;

  /** Asks the page, as main does before the window closes or the app quits, and hands back its answer. */
  var __leave:
    | ((leaving: "close" | "quit" | "restart") => Promise<Saved>)
    | undefined;
}

/** A capture as the fake bridge keeps it; a read-only entry has no status. */
interface FixtureCapture {
  readonly id: string;
  status?: { readonly kind: string; readonly at?: string };
  title?: string;
}

export interface BridgeInput {
  readonly page: "capture" | "library" | "settings" | "pin";
  readonly view?: object;
  readonly captures?: readonly FixtureCapture[];
  readonly capture?: object;
  /** Commands main sends as soon as the page listens, as the tray's Keyboard shortcuts… does. */
  readonly commands?: readonly string[];
  /** Discards main still owes as the library loads, as after a close whose Discard failed. */
  readonly owed?: readonly OwedFixture[];
  /** How many lookups of `owed` fail before one answers, as a closed IPC channel would; "always" never answers. */
  readonly owedFails?: number | "always";
}

/** A capture's editable fields, as main stores them. */
interface FixtureFields {
  readonly title: string;
  readonly description: string;
  readonly due: string | null;
  readonly pins: readonly {
    readonly x: number;
    readonly y: number;
    readonly label?: string;
  }[];
  readonly steps: readonly {
    readonly done: boolean;
    readonly id: string;
    readonly text: string;
  }[];
}

/** A Discard main still owes, as `owedDiscards` answers it. */
export interface OwedFixture {
  readonly id: string;
  readonly tag: { readonly epoch: string; readonly seq: number };
  readonly values: FixtureFields;
  readonly confirmed: FixtureFields;
  readonly message: string;
}

/** What the page's events carry here: nothing for "changed", a command name, or a flush request. */
type Payload =
  | string
  | null
  | { readonly id: string; readonly retry: boolean; readonly token: string }
  | { readonly id: null; readonly leaving: string; readonly token: string };

type Listener = (payload: Payload) => void;

type Result =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/** The page's answer to a flush: the fields a copy carries, or null when nothing is typed. */
type Saved =
  | { readonly ok: true; readonly fields: { readonly title: string } | null }
  | {
      readonly ok: false;
      readonly message: string;
      readonly during?: "save" | "discard";
    };

export const installBridge = (input: BridgeInput): void => {
  const OK = { ok: true } as const;
  const listeners = new Map<string, Listener[]>();
  const captures = [...(input.captures ?? [])];
  /** The page's answers to a flush, by token, as main waits for them. */
  const answers = new Map<string, (result: Saved) => void>();
  let flushes = 0;
  /** How many times the page asked which Discards main still owes. */
  let owedAsks = 0;
  /** Saves waiting for `__releaseSaves`, oldest first. */
  let held: (() => void)[] = [];
  /** Reads waiting for `__releaseGets`. */
  let heldGets: (() => void)[] = [];
  /** Discards waiting for `__releaseDiscards`. */
  let heldDiscards: (() => void)[] = [];

  interface Tag {
    readonly epoch: string;
    readonly seq: number;
  }

  /** As main's store (SPEC round 8): the epochs Discard ended, and per capture the last save that landed with what it replaced, owed once a Discard of it failed. */
  const ended = new Set<string>();
  const titles = new Map<string, string>();

  const undo = new Map<
    string,
    { readonly tag: Tag; readonly previous: object; readonly owed: boolean }
  >();

  const tagKey = (tag: Tag): string => `${tag.epoch}#${String(tag.seq)}`;

  for (const owed of input.owed ?? []) {
    titles.set(tagKey(owed.tag), owed.values.title);
    undo.set(owed.id, {
      owed: true,
      previous: structuredClone(owed.confirmed),
      tag: owed.tag,
    });
  }

  globalThis.__releaseGets = () => {
    const waiting = heldGets;

    heldGets = [];

    for (const answer of waiting) {
      answer();
    }
  };

  globalThis.__releaseSaves = () => {
    const waiting = held;

    held = [];

    for (const answer of waiting) {
      answer();
    }
  };

  globalThis.__releaseDiscards = () => {
    const waiting = heldDiscards;

    heldDiscards = [];

    for (const answer of waiting) {
      answer();
    }
  };

  globalThis.__releaseOldest = () => {
    held.shift()?.();
  };

  const on = (name: string, listener: Listener): (() => void) => {
    listeners.set(name, [...(listeners.get(name) ?? []), listener]);

    if (name === "command") {
      for (const command of input.commands ?? []) {
        listener(command);
      }
    }

    return () => {
      listeners.set(
        name,
        (listeners.get(name) ?? []).filter((one) => one !== listener)
      );
    };
  };

  const nothing = (): undefined => undefined;

  const emit = (name: string, payload: Payload): void => {
    for (const listener of listeners.get(name) ?? []) {
      listener(payload);
    }
  };

  globalThis.__emit = emit;

  const respond = async <T>(value: T): Promise<T> =>
    await Promise.resolve(value);

  const find = (id: string): FixtureCapture | undefined =>
    captures.find((capture) => capture.id === id);

  globalThis.__storedTitle = (id) => find(id)?.title ?? null;

  const fitHeight = (height: number): void => {
    globalThis.__fitted = height;
  };

  const record = (call: string): void => {
    globalThis.__calls = [...(globalThis.__calls ?? []), call];
  };

  const panelCall = (call: string): void => {
    globalThis.__panelCalls = [...(globalThis.__panelCalls ?? []), call];
  };

  const recorded =
    (name: string) =>
    async (id: string): Promise<typeof OK> => {
      record(`${name}:${id}`);

      return await respond(OK);
    };

  const refusal = (message: string, during = "save") => ({
    message:
      during === "discard"
        ? `Couldn’t discard your changes, so nothing was copied. ${message}`
        : `Couldn’t save your changes, so nothing was copied. ${message}`,
    ok: false as const,
    retry: true,
  });

  /** Asks the page to save, as main does, and waits for its answer. */
  const askPage = async (
    request:
      | { readonly id: string; readonly retry: boolean }
      | { readonly id: null; readonly leaving: string }
  ): Promise<Saved> => {
    flushes += 1;

    const token = `flush-${flushes}`;

    // oxlint-disable-next-line promise/avoid-new -- the page answers on another channel, so this waits on its callback.
    const answer = new Promise<Saved>((resolve) => {
      answers.set(token, resolve);
    });

    emit("flush", { ...request, token });

    const saved = await answer;

    answers.delete(token);

    return saved;
  };

  globalThis.__leave = async (leaving) => await askPage({ id: null, leaving });

  /** As main's copy gate: the page saves the capture's typing first, nothing is copied unless that worked, and the copy carries the page's snapshot. */
  const gated = (name: string) => async (id: string) => {
    globalThis.__asked = [...(globalThis.__asked ?? []), `${name}:${id}`];

    const saved = await askPage({ id, retry: false });

    if (!saved.ok) {
      return refusal(saved.message, saved.during);
    }

    record(`${name}:${id}`);
    globalThis.__clipboard = [
      ...(globalThis.__clipboard ?? []),
      saved.fields?.title ?? find(id)?.title ?? "",
    ];

    return OK;
  };

  const unsavedPin = (): boolean =>
    globalThis.__failSaves === true || globalThis.__pinUnsaved === true;

  const apis = {
    capture: {
      answerQuit: (choice: string) => {
        record(`answerQuit:${choice}`);
      },
      discard: nothing,
      dismiss: () => {
        panelCall("dismiss");
      },
      edit: () => {
        panelCall("edit");
      },
      getView: async () => await respond(input.view),
      on,
      openScreenSettings: nothing,
      relaunch: nothing,
      reportHeight: (report: { readonly height: number }) => {
        fitHeight(report.height);
      },
      save: () => {
        panelCall("save");
      },
    },
    library: {
      captureSoon: nothing,
      copyDetails: gated("copyDetails"),
      // As main: the save on its way is dropped, or what it replaced is renamed back; nothing is written. One that can't be stays owed.
      discard: async ({ id, tag }: { id: string; tag: Tag }) => {
        record(`discard:${id}:${titles.get(tagKey(tag)) ?? "?"}`);
        ended.add(tag.epoch);

        if (globalThis.__holdDiscards === true) {
          // oxlint-disable-next-line promise/avoid-new -- __releaseDiscards lets the held Discard go on through this callback.
          await new Promise<void>((resolve) => {
            heldDiscards.push(resolve);
          });
        }

        const slot = undo.get(id);
        const found = find(id);

        if (
          slot !== undefined &&
          (slot.owed || tagKey(slot.tag) === tagKey(tag))
        ) {
          if (globalThis.__failDiscards === true) {
            undo.set(id, { ...slot, owed: true });

            return await respond({
              message: "Inset can’t write to its data folder.",
              ok: false,
            });
          }

          undo.delete(id);

          if (found !== undefined) {
            Object.assign(found, slot.previous);
          }

          emit("changed", null);
        }

        return await respond(OK);
      },
      copyImage: gated("copyImage"),
      copyText: gated("copyText"),
      floatOnTop: (id: string) => {
        record(`floatOnTop:${id}`);
      },
      flushed: ({ result, token }: { result: Saved; token: string }) => {
        answers.get(token)?.(result);
      },
      get: async (id: string) => {
        const found = structuredClone(find(id) ?? null);

        if (globalThis.__holdGets === true) {
          // oxlint-disable-next-line promise/avoid-new -- __releaseGets answers the held read through this callback.
          await new Promise<void>((resolve) => {
            heldGets.push(resolve);
          });
        }

        return await respond(found);
      },
      list: async () => await respond(captures),
      leavePromptShown: () => {
        globalThis.__promptShown = (globalThis.__promptShown ?? 0) + 1;
      },
      menuOpen: (open: boolean) => {
        globalThis.__menuOpen = open;
      },
      on,
      openSettings: () => {
        record("openSettings");
      },
      owedDiscards: async () => {
        owedAsks += 1;

        const fails = input.owedFails ?? 0;

        if (fails === "always" || owedAsks <= fails) {
          throw new Error("The IPC channel closed.");
        }

        return await respond(input.owed ?? []);
      },
      remove: recorded("remove"),
      reportShown: nothing,
      resumeLeaving: () => {
        record("resumeLeaving");
      },
      setDone: async ({ done, id }: { done: boolean; id: string }) => {
        const found = find(id);

        record(`setDone:${id}:${String(done)}`);

        if (found !== undefined) {
          found.status = done
            ? { at: new Date().toISOString(), kind: "done" }
            : { kind: "active" };
        }

        emit("changed", null);

        return await respond(OK);
      },
      startImageDrag: nothing,
      unsavedCount: (count: number) => {
        globalThis.__unsavedCounts = [
          ...(globalThis.__unsavedCounts ?? []),
          count,
        ];
      },
      status: async () =>
        await respond({ iconIn: "dockAndMenuBar", shortcutRegistered: true }),
      update: async ({
        fields,
        id,
        tag,
      }: {
        fields: { readonly title?: string };
        id: string;
        tag: Tag;
      }) => {
        const found = find(id);

        record(`update:${id}:${fields.title ?? ""}`);
        titles.set(tagKey(tag), fields.title ?? "");

        if (globalThis.__holdSaves === true) {
          // oxlint-disable-next-line promise/avoid-new -- __releaseSaves answers the held save through this callback.
          await new Promise<void>((resolve) => {
            held.push(resolve);
          });
        }

        // Discarded while held: dropped before it replaces anything.
        if (ended.has(tag.epoch)) {
          return await respond({
            message: "The changes were discarded.",
            ok: false,
          });
        }

        if (globalThis.__failSaves === true) {
          return await respond({ message: "The disk is full.", ok: false });
        }

        if (found !== undefined) {
          const owed = undo.get(id);

          // As main: while a Discard is owed, what it puts back stays the same, and this save keeps what it writes.
          const previous =
            owed?.owed === true ? owed.previous : structuredClone({ ...found });

          undo.set(id, { owed: false, previous, tag });
          Object.assign(found, structuredClone(fields));
        }

        // As main: the store tells every page once the capture is written.
        emit("changed", null);

        if (globalThis.__holdAnswers === true) {
          // oxlint-disable-next-line promise/avoid-new -- __releaseSaves answers the held save through this callback.
          await new Promise<void>((resolve) => {
            held.push(resolve);
          });
        }

        return await respond(OK);
      },
    },
    pin: {
      close: nothing,
      // The floating window has no typing of its own; its copy fails when main's gate can't save the library's, and keeps failing until a Retry saves it.
      copyImage: async () => {
        if (unsavedPin()) {
          globalThis.__pinUnsaved = true;

          return await respond(refusal("The disk is full."));
        }

        record("copyImage:pin");

        return await respond(OK);
      },
      get: async () => await respond(input.capture),
      on,
      openInLibrary: nothing,
      // As main: the library saves the capture's changes again.
      retrySave: async (): Promise<Result> => {
        record("retrySave:pin");

        if (globalThis.__failSaves === true) {
          return await respond({ message: "The disk is full.", ok: false });
        }

        globalThis.__pinUnsaved = false;

        return await respond(OK);
      },
    },
    settings: {
      fitHeight,
      getView: async () => await respond(input.view),
      on,
      setOpenAtLogin: nothing,
      update: nothing,
    },
  };

  const globals = {
    capture: "insetCapture",
    library: "insetLibrary",
    pin: "insetPin",
    settings: "insetSettings",
  } as const;

  Object.assign(globalThis, { [globals[input.page]]: apis[input.page] });
};
