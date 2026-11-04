export type UpdateState =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "available"; readonly version: string }
  | {
      readonly kind: "downloading";
      readonly version: string;
      readonly percent: number;
    }
  | { readonly kind: "ready"; readonly version: string }
  | { readonly kind: "upToDate" }
  | { readonly kind: "error"; readonly message: string };

export type UpdateEvent =
  | { readonly type: "checkStarted" }
  | { readonly type: "found"; readonly version: string }
  | { readonly type: "notFound" }
  | { readonly type: "progress"; readonly percent: number }
  | { readonly type: "downloaded"; readonly version: string }
  | { readonly type: "failed"; readonly message: string };

export const IDLE: UpdateState = { kind: "idle" };

export const canCheck = (state: UpdateState): boolean =>
  state.kind === "idle" || state.kind === "upToDate" || state.kind === "error";

export const nextUpdateState = (
  state: UpdateState,
  event: UpdateEvent
): UpdateState => {
  // A downloaded update waits for the restart; a later failure must not hide it.
  if (state.kind === "ready") {
    return state;
  }

  switch (event.type) {
    case "checkStarted": {
      return canCheck(state) ? { kind: "checking" } : state;
    }

    case "found": {
      return { kind: "available", version: event.version };
    }

    case "notFound": {
      return { kind: "upToDate" };
    }

    case "progress": {
      return state.kind === "available" || state.kind === "downloading"
        ? {
            kind: "downloading",
            percent: Math.floor(event.percent),
            version: state.version,
          }
        : state;
    }

    case "downloaded": {
      return { kind: "ready", version: event.version };
    }

    case "failed": {
      return { kind: "error", message: event.message };
    }

    default: {
      return state;
    }
  }
};
