import type { z } from "zod";

export interface InvokeSpec<I extends z.ZodType, O> {
  readonly kind: "invoke";
  readonly input: I;
  readonly __out?: O;
}

export interface SendSpec<I extends z.ZodType> {
  readonly kind: "send";
  readonly input: I;
}

export interface EventSpec<T> {
  readonly kind: "event";
  readonly __payload?: T;
}

/** Outputs are authored by main, so they are typed rather than validated. */
export interface OutputType<T> {
  readonly __out?: T;
}

export const out = <T>(): OutputType<T> => ({});

export const invoke = <I extends z.ZodType, O>(
  input: I,
  _output: OutputType<O>
): InvokeSpec<I, O> => ({ input, kind: "invoke" });

export const send = <I extends z.ZodType>(input: I): SendSpec<I> => ({
  input,
  kind: "send",
});

export const event = <T>(): EventSpec<T> => ({ kind: "event" });

export type MethodSpec =
  | InvokeSpec<z.ZodType, z.output<z.ZodType>>
  | SendSpec<z.ZodType>;

export interface Contract {
  readonly name: string;
  readonly global: string;
  readonly methods: Readonly<Record<string, MethodSpec>>;
  readonly events: Readonly<Record<string, EventSpec<z.output<z.ZodType>>>>;
}

export const defineContract = <const C extends Contract>(contract: C): C =>
  contract;

export const methodChannel = (contract: Contract, method: string): string =>
  `${contract.name}:${method}`;

export const eventChannel = (contract: Contract, name: string): string =>
  `${contract.name}:on:${name}`;

export type EventName<C extends Contract> = keyof C["events"] & string;

export type EventPayload<C extends Contract, E extends EventName<C>> =
  C["events"][E] extends EventSpec<infer T> ? T : never;

type MethodClient<M> =
  M extends InvokeSpec<infer I extends z.ZodType, infer O>
    ? (input: z.input<I>) => Promise<O>
    : M extends SendSpec<infer I extends z.ZodType>
      ? (input: z.input<I>) => void
      : never;

export type Client<C extends Contract> = {
  readonly [K in keyof C["methods"]]: MethodClient<C["methods"][K]>;
} & {
  readonly on: <E extends EventName<C>>(
    name: E,
    listener: (payload: EventPayload<C, E>) => void
  ) => () => void;
};

type MethodHandler<M> =
  M extends InvokeSpec<infer I extends z.ZodType, infer O>
    ? (input: z.output<I>) => O | Promise<O>
    : M extends SendSpec<infer I extends z.ZodType>
      ? (input: z.output<I>) => void
      : never;

export type Handlers<C extends Contract> = {
  readonly [K in keyof C["methods"]]: MethodHandler<C["methods"][K]>;
};
