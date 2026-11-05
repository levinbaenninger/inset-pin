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

/** The events a page waits on here: the library's "changed", and a command name. */
type Listener = (payload: string | null) => void;

export const installBridge = (input: BridgeInput): void => {
  const OK = { ok: true } as const;
  const listeners = new Map<string, Listener[]>();
  const captures = [...(input.captures ?? [])];

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

  const resolve = async <T>(value: T): Promise<T> =>
    await Promise.resolve(value);

  const find = (id: string): FixtureCapture | undefined =>
    captures.find((capture) => capture.id === id);

  const fitHeight = (height: number): void => {
    globalThis.__fitted = height;
  };

  const apis = {
    capture: {
      answerQuit: nothing,
      discard: nothing,
      dismiss: nothing,
      edit: nothing,
      getView: async () => await resolve(input.view),
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
      copyDetails: async () => await resolve(OK),
      copyImage: async () => await resolve(OK),
      copyText: async () => await resolve(OK),
      floatOnTop: nothing,
      flushed: nothing,
      get: async (id: string) => await resolve(find(id) ?? null),
      list: async () => await resolve(captures),
      on,
      openSettings: nothing,
      remove: async () => await resolve(OK),
      reportShown: nothing,
      setDone: async ({ done, id }: { done: boolean; id: string }) => {
        const found = find(id);

        if (found !== undefined) {
          found.status = done
            ? { at: new Date().toISOString(), kind: "done" }
            : { kind: "active" };
        }

        for (const listener of listeners.get("changed") ?? []) {
          listener(null);
        }

        return await resolve(OK);
      },
      startImageDrag: nothing,
      status: async () =>
        await resolve({ iconIn: "dockAndMenuBar", shortcutRegistered: true }),
      update: async ({ fields, id }: { fields: object; id: string }) => {
        const found = find(id);

        if (found !== undefined) {
          Object.assign(found, fields);
        }

        return await resolve(OK);
      },
    },
    pin: {
      close: nothing,
      copyImage: async () => await resolve(OK),
      get: async () => await resolve(input.capture),
      on,
      openInLibrary: nothing,
    },
    settings: {
      fitHeight,
      getView: async () => await resolve(input.view),
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
