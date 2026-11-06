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
  /** Every copy the page asked for, as `name:id`, whether or not it was made. */
  var __asked: string[] | undefined;
  /** While true, saving a capture's typing fails, as a full disk would. */
  var __failSaves: boolean | undefined;
  /** Sends the page an event as main would, such as a command from the app menu. */
  var __emit: ((name: string, payload: Payload) => void) | undefined;
}

/** A capture as the fake bridge keeps it; a read-only entry has no status. */
interface FixtureCapture {
  readonly id: string;
  status?: { readonly kind: string; readonly at?: string };
}

export interface BridgeInput {
  readonly page: "capture" | "library" | "settings" | "pin";
  readonly view?: object;
  readonly captures?: readonly FixtureCapture[];
  readonly capture?: object;
  /** Commands main sends as soon as the page listens, as the tray's Keyboard shortcuts… does. */
  readonly commands?: readonly string[];
}

/** What the page's events carry here: nothing for "changed", a command name, or a flush request. */
type Payload = string | null | { readonly id: string; readonly token: string };

type Listener = (payload: Payload) => void;

type Result =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export const installBridge = (input: BridgeInput): void => {
  const OK = { ok: true } as const;
  const listeners = new Map<string, Listener[]>();
  const captures = [...(input.captures ?? [])];
  /** The page's answers to a flush, by token, as main waits for them. */
  const answers = new Map<string, (result: Result) => void>();
  let flushes = 0;

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

  const fitHeight = (height: number): void => {
    globalThis.__fitted = height;
  };

  const record = (call: string): void => {
    globalThis.__calls = [...(globalThis.__calls ?? []), call];
  };

  const recorded =
    (name: string) =>
    async (id: string): Promise<typeof OK> => {
      record(`${name}:${id}`);

      return await respond(OK);
    };

  const refusal = (message: string): Result => ({
    message: `Couldn’t save your changes, so nothing was copied. ${message}`,
    ok: false,
  });

  /** As main's copy gate: the page saves the capture's typing first, and nothing is copied unless that worked. */
  const gated =
    (name: string) =>
    async (id: string): Promise<Result> => {
      globalThis.__asked = [...(globalThis.__asked ?? []), `${name}:${id}`];
      flushes += 1;

      const token = `flush-${flushes}`;

      // oxlint-disable-next-line promise/avoid-new -- the page answers on another channel, so this waits on its callback.
      const answer = new Promise<Result>((resolve) => {
        answers.set(token, resolve);
      });

      emit("flush", { id, token });

      const saved = await answer;

      answers.delete(token);

      if (!saved.ok) {
        return refusal(saved.message);
      }

      record(`${name}:${id}`);

      return OK;
    };

  const apis = {
    capture: {
      answerQuit: nothing,
      discard: nothing,
      dismiss: nothing,
      edit: nothing,
      getView: async () => await respond(input.view),
      on,
      openScreenSettings: nothing,
      relaunch: nothing,
      reportHeight: (report: { readonly height: number }) => {
        fitHeight(report.height);
      },
      save: nothing,
    },
    library: {
      captureSoon: nothing,
      copyDetails: gated("copyDetails"),
      copyImage: gated("copyImage"),
      copyText: gated("copyText"),
      floatOnTop: (id: string) => {
        record(`floatOnTop:${id}`);
      },
      flushed: ({ result, token }: { result: Result; token: string }) => {
        answers.get(token)?.(result);
      },
      get: async (id: string) => await respond(find(id) ?? null),
      list: async () => await respond(captures),
      on,
      openSettings: () => {
        record("openSettings");
      },
      remove: recorded("remove"),
      reportShown: nothing,
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
      status: async () =>
        await respond({ iconIn: "dockAndMenuBar", shortcutRegistered: true }),
      update: async ({
        fields,
        id,
      }: {
        fields: { readonly title?: string };
        id: string;
      }) => {
        const found = find(id);

        record(`update:${id}:${fields.title ?? ""}`);

        if (globalThis.__failSaves === true) {
          return await respond({ message: "The disk is full.", ok: false });
        }

        if (found !== undefined) {
          Object.assign(found, fields);
        }

        return await respond(OK);
      },
    },
    pin: {
      close: nothing,
      // The floating window has no typing of its own; its copy fails when main's gate can't save the library's.
      copyImage: async (): Promise<Result> => {
        if (globalThis.__failSaves === true) {
          return await respond(refusal("The disk is full."));
        }

        record("copyImage:pin");

        return await respond(OK);
      },
      get: async () => await respond(input.capture),
      on,
      openInLibrary: nothing,
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
