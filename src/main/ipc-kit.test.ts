import { captureContract } from "@shared/contracts";
import type { CaptureContract, DraftContent } from "@shared/contracts";
import { methodChannel } from "@shared/ipc";
import type { Handlers } from "@shared/ipc";
import { describe, expect, it } from "vitest";

import { serveContract } from "./ipc-kit";
import type { IpcRegistrar, IpcSenderEvent } from "./ipc-kit";

const ID = "3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c";

type SendListener = (
  event: IpcSenderEvent,
  ...args: readonly unknown[]
) => void;

type InvokeListener = (
  event: IpcSenderEvent,
  ...args: readonly unknown[]
) => Promise<string>;

const noop = (): void => undefined;

const panel = { id: 7, isDestroyed: () => false, send: noop };

const fromPanel: IpcSenderEvent = {
  sender: { id: 7 },
  senderFrame: { parent: null, url: "inset://app/capture.html" },
};

const content = {
  crop: { height: 600, width: 960, x: 0, y: 0 },
  pin: { x: 10, y: 20 },
  thought: "hello",
};

const setup = () => {
  const sends = new Map<string, SendListener>();
  const invokes = new Map<string, InvokeListener>();
  const saved: { id: string; content: DraftContent }[] = [];
  const rejected: string[] = [];

  const ipc: IpcRegistrar = {
    handle: (channel, listener) => {
      // The fake answers with JSON so tests compare plain strings.
      invokes.set(channel, async (event, ...args) =>
        JSON.stringify(await listener(event, ...args))
      );
    },
    on: (channel, listener) => {
      sends.set(channel, listener);
    },
  };

  const handlers: Handlers<CaptureContract> = {
    discard: noop,
    dismiss: noop,
    edit: noop,
    getView: () => ({ kind: "none" }),
    openScreenSettings: noop,
    relaunch: noop,
    reportHeight: noop,
    save: (input) => {
      saved.push(input);
    },
  };

  serveContract(captureContract, handlers, {
    appOrigin: "inset://app",
    ipc,
    onRejected: (channel, reason) => {
      rejected.push(`${channel}: ${reason}`);
    },
    target: () => panel,
  });

  const send = (
    method: string,
    event: IpcSenderEvent,
    ...args: readonly unknown[]
  ): void => {
    sends.get(methodChannel(captureContract, method))?.(event, ...args);
  };

  const invoke = async (
    method: string,
    event: IpcSenderEvent
  ): Promise<string | undefined> =>
    await invokes.get(methodChannel(captureContract, method))?.(event);

  return { invoke, rejected, saved, send };
};

describe(serveContract, () => {
  it("calls the handler with the parsed value from the trusted panel", () => {
    const { send, saved } = setup();

    send("save", fromPanel, { content, id: ID });

    expect(saved).toStrictEqual([{ content, id: ID }]);
  });

  it.each([
    ["another webContents", { ...fromPanel, sender: { id: 8 } }],
    [
      "a subframe",
      {
        ...fromPanel,
        senderFrame: {
          parent: fromPanel.senderFrame,
          url: "inset://app/capture.html",
        },
      },
    ],
    [
      "a foreign origin",
      {
        ...fromPanel,
        senderFrame: { parent: null, url: "https://example.com/" },
      },
    ],
    ["a destroyed frame", { ...fromPanel, senderFrame: null }],
  ])("drops a message from %s", (_label, event: IpcSenderEvent) => {
    const { send, rejected, saved } = setup();

    send("save", event, { content, id: ID });

    expect(saved).toStrictEqual([]);
    expect(rejected).toStrictEqual(["capture:save: untrusted sender"]);
  });

  it("drops input that fails the schema", () => {
    const { send, rejected, saved } = setup();

    send("save", fromPanel, {
      content: { ...content, pin: { x: -1, y: 0 } },
      id: ID,
    });
    send("save", fromPanel, { content, id: ID.toUpperCase() });
    send("save", fromPanel, { content, id: ID }, "extra");

    expect(saved).toStrictEqual([]);
    expect(rejected).toStrictEqual([
      "capture:save: invalid input",
      "capture:save: invalid input",
      "capture:save: invalid input",
    ]);
  });

  it("rejects an invoke from an untrusted sender", async () => {
    const { invoke } = setup();

    await expect(
      invoke("getView", { ...fromPanel, sender: { id: 1 } })
    ).rejects.toThrow("capture:getView rejected: untrusted sender");
  });

  it("answers a trusted invoke", async () => {
    const { invoke } = setup();

    await expect(invoke("getView", fromPanel)).resolves.toBe('{"kind":"none"}');
  });

  it("derives channel names from the contract", () => {
    expect(methodChannel(captureContract, "save")).toBe("capture:save");
  });

  it("requires a handler for every method at compile time", () => {
    // @ts-expect-error discard is missing
    const partial: Handlers<CaptureContract> = {
      dismiss: noop,
      edit: noop,
      getView: () => ({ kind: "none" }),
      openScreenSettings: noop,
      relaunch: noop,
      reportHeight: noop,
      save: noop,
    };

    expect(Object.keys(partial)).not.toContain("discard");
  });
});
