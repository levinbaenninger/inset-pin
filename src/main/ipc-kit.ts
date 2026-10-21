import { originOf } from "@shared/inset-url";
import { eventChannel, methodChannel } from "@shared/ipc";
import type { Contract, EventName, EventPayload, Handlers } from "@shared/ipc";
import type { z } from "zod";

export interface SenderFrame {
  readonly url: string;
  readonly parent: SenderFrame | null;
}

export interface IpcSenderEvent {
  readonly sender: { readonly id: number };
  readonly senderFrame: SenderFrame | null;
}

export interface IpcRegistrar {
  readonly handle: <T>(
    channel: string,
    listener: (event: IpcSenderEvent, ...args: readonly unknown[]) => Promise<T>
  ) => void;
  readonly on: (
    channel: string,
    listener: (event: IpcSenderEvent, ...args: readonly unknown[]) => void
  ) => void;
}

export interface EventTarget {
  readonly id: number;
  readonly isDestroyed: () => boolean;
  readonly send: (channel: string, ...args: readonly unknown[]) => void;
}

export interface ServeOptions {
  readonly ipc: IpcRegistrar;
  readonly appOrigin: string;
  /** The one webContents allowed to call this contract and to receive its events. */
  readonly target: () => EventTarget | null;
  readonly onRejected: (channel: string, reason: string) => void;
}

export interface ContractServer<C extends Contract> {
  readonly emit: <E extends EventName<C>>(
    name: E,
    payload: EventPayload<C, E>
  ) => void;
}

type Parsed = z.output<z.ZodType>;

type ParsedHandler = (input: Parsed) => Parsed;

export const isTrustedSender = (
  event: IpcSenderEvent,
  expected: { readonly id: number } | null,
  appOrigin: string
): boolean => {
  const frame = event.senderFrame;

  return (
    expected !== null &&
    event.sender.id === expected.id &&
    frame !== null &&
    frame.parent === null &&
    originOf(frame.url) === appOrigin
  );
};

export const serveContract = <C extends Contract>(
  contract: C,
  handlers: Handlers<C>,
  options: ServeOptions
): ContractServer<C> => {
  // SAFETY: Handlers<C> has one function per method, each called only with its own schema's output.
  const table = handlers as Readonly<Record<string, ParsedHandler | undefined>>;

  const accept = (
    schema: z.ZodType,
    event: IpcSenderEvent,
    args: readonly unknown[]
  ):
    | { readonly ok: true; readonly input: Parsed }
    | { readonly ok: false; readonly reason: string } => {
    if (!isTrustedSender(event, options.target(), options.appOrigin)) {
      return { ok: false, reason: "untrusted sender" };
    }

    const parsed = schema.safeParse(args[0]);

    if (args.length > 1 || !parsed.success) {
      return { ok: false, reason: "invalid input" };
    }

    return { input: parsed.data, ok: true };
  };

  for (const [name, spec] of Object.entries(contract.methods)) {
    const handler = table[name];

    if (handler === undefined) {
      throw new Error(`No handler for ${contract.name}.${name}`);
    }

    const channel = methodChannel(contract, name);

    if (spec.kind === "invoke") {
      options.ipc.handle(channel, async (event, ...args) => {
        const accepted = accept(spec.input, event, args);

        if (!accepted.ok) {
          options.onRejected(channel, accepted.reason);
          throw new Error(`${channel} rejected: ${accepted.reason}`);
        }

        return await handler(accepted.input);
      });
    } else {
      options.ipc.on(channel, (event, ...args) => {
        const accepted = accept(spec.input, event, args);

        if (accepted.ok) {
          handler(accepted.input);
        } else {
          options.onRejected(channel, accepted.reason);
        }
      });
    }
  }

  return {
    emit: (name, payload) => {
      const target = options.target();

      if (target !== null && !target.isDestroyed()) {
        target.send(eventChannel(contract, name), payload);
      }
    },
  };
};
