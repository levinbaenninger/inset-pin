import { canSaveThought } from "@shared/capture-record";
import type {
  CaptureId,
  CaptureRecordV1,
  PointVia,
} from "@shared/capture-record";
import type {
  CaptureProblem,
  CaptureView,
  DraftContent,
  WriteStatus,
} from "@shared/contracts";
import {
  defaultCrop,
  normalizeGeometry,
  pinInCrop,
  screenToImage,
} from "@shared/geometry";
import type { DisplaySnapshot, Point, Rect, Size } from "@shared/geometry";
import { insetUrl } from "@shared/inset-url";

export interface Anchor {
  readonly point: Point<"screen">;
  readonly display: DisplaySnapshot;
}

export interface FramePixels {
  /** Memoised; served only as inset://draft/<id>. */
  readonly previewJpeg: () => Uint8Array;
  readonly cropPng: (crop: Rect<"image">) => Uint8Array;
}

/** The full-display capture. Memory only, never persisted. */
export interface CapturedFrame {
  readonly size: Size<"image">;
  readonly ppd: number;
  readonly pixels: FramePixels;
}

export type CaptureResult =
  | { readonly ok: true; readonly frame: CapturedFrame }
  | { readonly ok: false; readonly problem: CaptureProblem };

export type Invocation =
  | {
      readonly kind: "point";
      readonly via: PointVia;
      readonly anchor: Anchor;
      readonly at: Date;
    }
  /** Tray "Show unsaved draft": never captures. */
  | { readonly kind: "reopen" };

export type PointInvocation = Extract<Invocation, { kind: "point" }>;

export interface Draft {
  /** Also the future capture id, so a publish retry is idempotent. */
  readonly id: CaptureId;
  /** Invocation time; kept across dismiss and reopen. */
  readonly capturedAt: Date;
  readonly via: PointVia;
  readonly anchor: Anchor;
  readonly frame: CapturedFrame;
  /** The renderer's latest content, normalised against the frame. */
  readonly content: DraftContent;
}

export type QuitState = "none" | "asking" | "afterSave";

export type QuitChoice = "save" | "discard" | "cancel";

export type DraftState =
  | { readonly phase: "idle" }
  /** The surface is hidden by construction. */
  | { readonly phase: "capturing"; readonly invocation: PointInvocation }
  /** Shown by construction. */
  | {
      readonly phase: "problem";
      readonly problem: CaptureProblem;
      readonly anchor: Anchor;
    }
  | {
      readonly phase: "draft";
      readonly draft: Draft;
      readonly surface: "shown" | "hidden";
      readonly write: WriteStatus;
      readonly quit: QuitState;
      readonly shownSeq: number;
    };

type DraftPhase = Extract<DraftState, { phase: "draft" }>;

export type DraftEvent =
  | { readonly type: "invoked"; readonly invocation: Invocation }
  | {
      readonly type: "captured";
      readonly id: CaptureId;
      readonly frame: CapturedFrame;
    }
  | { readonly type: "captureFailed"; readonly problem: CaptureProblem }
  | {
      readonly type: "edited" | "saveRequested";
      readonly id: CaptureId;
      readonly content: DraftContent;
    }
  | { readonly type: "published"; readonly id: CaptureId }
  | {
      readonly type: "publishFailed";
      readonly id: CaptureId;
      readonly message: string;
    }
  /** Escape or blur. */
  | { readonly type: "dismissed" }
  | { readonly type: "discarded"; readonly id: CaptureId }
  /** before-quit was prevented. */
  | { readonly type: "quitHeld" }
  | { readonly type: "quitChoice"; readonly choice: QuitChoice };

/** Async I/O and one-shot actions only. Window visibility and the view are derived from state. */
export type Effect =
  | { readonly type: "capture"; readonly display: DisplaySnapshot }
  | { readonly type: "publish"; readonly draft: Draft }
  | { readonly type: "askQuitChoice" }
  | { readonly type: "focus" }
  | { readonly type: "quit" }
  | { readonly type: "notify"; readonly message: string };

export interface Step {
  readonly state: DraftState;
  readonly effects: readonly Effect[];
}

export const IDLE: DraftState = { phase: "idle" };

export const SAVE_FAILED_NOTICE =
  "Your capture wasn't saved. Choose “Show unsaved draft” in the Inset menu to retry.";

const stay = (state: DraftState): Step => ({ effects: [], state });

const to = (state: DraftState, ...effects: readonly Effect[]): Step => ({
  effects,
  state,
});

const show = (state: DraftPhase): DraftPhase =>
  state.surface === "shown"
    ? state
    : { ...state, shownSeq: state.shownSeq + 1, surface: "shown" };

const normalize = (draft: Draft, content: DraftContent): DraftContent => ({
  ...normalizeGeometry(content, draft.frame.size, draft.frame.ppd),
  thought: content.thought,
});

const withContent = (state: DraftPhase, content: DraftContent): DraftPhase => ({
  ...state,
  draft: { ...state.draft, content: normalize(state.draft, content) },
});

const currentDraft = (state: DraftState, id: CaptureId): DraftPhase | null =>
  state.phase === "draft" && state.draft.id === id ? state : null;

/** The current draft unless a save is running or the quit dialog is open; the panel cannot change it then. */
const editableDraft = (state: DraftState, id: CaptureId): DraftPhase | null => {
  const current = currentDraft(state, id);

  return current === null ||
    current.write.kind === "saving" ||
    current.quit === "asking"
    ? null
    : current;
};

const onInvoked = (state: DraftState, invocation: Invocation): Step => {
  if (state.phase === "draft") {
    return state.surface === "shown"
      ? to(state, { type: "focus" })
      : stay(show(state));
  }

  if (invocation.kind === "reopen" || state.phase === "capturing") {
    return stay(state);
  }

  return to(
    { invocation, phase: "capturing" },
    { display: invocation.anchor.display, type: "capture" }
  );
};

const onCaptured = (
  state: DraftState,
  id: CaptureId,
  frame: CapturedFrame
): Step => {
  if (state.phase !== "capturing") {
    return stay(state);
  }

  const { anchor, at, via } = state.invocation;
  const pin = screenToImage(anchor.point, anchor.display.bounds, frame.size);

  return stay({
    draft: {
      anchor,
      capturedAt: at,
      content: {
        crop: defaultCrop(pin, frame.size, frame.ppd),
        pin,
        thought: "",
      },
      frame,
      id,
      via,
    },
    phase: "draft",
    quit: "none",
    shownSeq: 1,
    surface: "shown",
    write: { kind: "editing" },
  });
};

const onSaveRequested = (
  state: DraftState,
  id: CaptureId,
  content: DraftContent
): Step => {
  const current = editableDraft(state, id);

  if (current === null || !canSaveThought(content.thought)) {
    return stay(state);
  }

  const next: DraftPhase = {
    ...withContent(current, content),
    write: { kind: "saving" },
  };

  return to(next, { draft: next.draft, type: "publish" });
};

const onPublishFailed = (
  state: DraftState,
  id: CaptureId,
  message: string
): Step => {
  const current = currentDraft(state, id);

  if (current === null) {
    return stay(state);
  }

  const failed: DraftPhase = { ...current, write: { kind: "failed", message } };

  if (current.quit === "afterSave") {
    return stay(show({ ...failed, quit: "none" }));
  }

  return failed.surface === "hidden"
    ? to(failed, { message: SAVE_FAILED_NOTICE, type: "notify" })
    : stay(failed);
};

const onDismissed = (state: DraftState): Step => {
  if (state.phase === "problem") {
    return stay(IDLE);
  }

  if (state.phase === "draft" && state.quit === "none") {
    return stay({ ...state, surface: "hidden" });
  }

  return stay(state);
};

const onQuitHeld = (state: DraftState): Step => {
  if (state.phase !== "draft" || state.quit !== "none") {
    return stay(state);
  }

  if (state.write.kind === "saving") {
    return stay({ ...state, quit: "afterSave" });
  }

  return to(show({ ...state, quit: "asking" }), { type: "askQuitChoice" });
};

const onQuitChoice = (state: DraftState, choice: QuitChoice): Step => {
  if (state.phase !== "draft" || state.quit !== "asking") {
    return stay(state);
  }

  if (choice === "cancel") {
    return to({ ...state, quit: "none" }, { type: "focus" });
  }

  // Never quit during a write: wait for it, and keep the draft if it fails.
  if (state.write.kind === "saving") {
    return stay({ ...state, quit: "afterSave" });
  }

  if (choice === "discard") {
    return to(IDLE, { type: "quit" });
  }

  if (canSaveThought(state.draft.content.thought)) {
    const saving: DraftPhase = {
      ...state,
      quit: "afterSave",
      write: { kind: "saving" },
    };

    return to(saving, { draft: saving.draft, type: "publish" });
  }

  return to({ ...state, quit: "none" }, { type: "focus" });
};

/** The whole draft lifecycle. Pure; unknown or stale events leave the state unchanged. */
export const step = (state: DraftState, event: DraftEvent): Step => {
  switch (event.type) {
    case "invoked": {
      return onInvoked(state, event.invocation);
    }

    case "captured": {
      return onCaptured(state, event.id, event.frame);
    }

    case "captureFailed": {
      return state.phase === "capturing"
        ? stay({
            anchor: state.invocation.anchor,
            phase: "problem",
            problem: event.problem,
          })
        : stay(state);
    }

    case "edited": {
      const current = editableDraft(state, event.id);

      return current === null
        ? stay(state)
        : stay(withContent(current, event.content));
    }

    case "saveRequested": {
      return onSaveRequested(state, event.id, event.content);
    }

    case "published": {
      const current = currentDraft(state, event.id);

      if (current === null) {
        return stay(state);
      }

      return current.quit === "afterSave"
        ? to(IDLE, { type: "quit" })
        : stay(IDLE);
    }

    case "publishFailed": {
      return onPublishFailed(state, event.id, event.message);
    }

    case "dismissed": {
      return onDismissed(state);
    }

    case "discarded": {
      return editableDraft(state, event.id) === null ? stay(state) : stay(IDLE);
    }

    case "quitHeld": {
      return onQuitHeld(state);
    }

    case "quitChoice": {
      return onQuitChoice(state, event.choice);
    }

    default: {
      return stay(state);
    }
  }
};

const PROBLEM_SURFACE_KEY = "problem";

const draftSurfaceKey = (state: DraftPhase): string =>
  `${state.draft.id}:${state.shownSeq}`;

export const viewOf = (state: DraftState): CaptureView => {
  if (state.phase === "problem") {
    return {
      kind: "problem",
      problem: state.problem,
      surfaceKey: PROBLEM_SURFACE_KEY,
    };
  }

  if (state.phase !== "draft") {
    return { kind: "none" };
  }

  const { draft } = state;

  return {
    capturedAt: draft.capturedAt.toISOString(),
    draftId: draft.id,
    frame: {
      ppd: draft.frame.ppd,
      size: draft.frame.size,
      url: insetUrl.draftImage(draft.id),
    },
    kind: "draft",
    seed: draft.content,
    sourceLabel: draft.anchor.display.label,
    surfaceKey: draftSurfaceKey(state),
    write: state.write,
  };
};

export type SurfaceState =
  | { readonly visible: false }
  /** A new key means "show again", even when already visible. */
  | { readonly visible: true; readonly anchor: Anchor; readonly key: string };

export const surfaceOf = (state: DraftState): SurfaceState => {
  if (state.phase === "problem") {
    return { anchor: state.anchor, key: PROBLEM_SURFACE_KEY, visible: true };
  }

  if (state.phase === "draft" && state.surface === "shown") {
    return {
      anchor: state.draft.anchor,
      key: draftSurfaceKey(state),
      visible: true,
    };
  }

  return { visible: false };
};

export type TrayState =
  | "none"
  | "capturing"
  | "shown"
  | "hidden"
  | "saveFailed";

export const trayOf = (state: DraftState): TrayState => {
  if (state.phase === "capturing") {
    return "capturing";
  }

  if (state.phase !== "draft") {
    return "none";
  }

  return state.surface === "hidden" && state.write.kind === "failed"
    ? "saveFailed"
    : state.surface;
};

/** Quit gate. Meaningful means savable, so the dialog's Save is never a dead end. */
export const mayQuit = (state: DraftState): boolean =>
  !(
    state.phase === "draft" &&
    (canSaveThought(state.draft.content.thought) ||
      state.write.kind === "saving")
  );

export const toRecord = (draft: Draft, savedAt: Date): CaptureRecordV1 => {
  const { crop, pin, thought } = draft.content;
  const relative = pinInCrop(pin, crop);

  return {
    capturedAt: draft.capturedAt.toISOString(),
    id: draft.id,
    image: {
      file: "crop.png",
      heightPx: crop.height,
      pixelsPerDip: draft.frame.ppd,
      widthPx: crop.width,
    },
    invokedVia: draft.via,
    pin: { x: relative.x, y: relative.y },
    schemaVersion: 1,
    source: { kind: "display", label: draft.anchor.display.label },
    thought,
    updatedAt: savedAt.toISOString(),
  };
};

export interface DraftSurface {
  /** Shows beside the anchor once the renderer reports its height for this surface key. */
  readonly show: (anchor: Anchor, surfaceKey: string) => void;
  readonly hide: () => void;
  readonly focus: () => void;
  /** Resolves once the panel is off screen and the compositor has settled. */
  readonly whenHidden: () => Promise<void>;
  readonly askQuitChoice: () => Promise<QuitChoice>;
}

export type PublishResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export interface DraftDeps {
  readonly capture: (display: DisplaySnapshot) => Promise<CaptureResult>;
  readonly publish: (
    record: CaptureRecordV1,
    png: Uint8Array
  ) => Promise<PublishResult>;
  readonly surface: DraftSurface;
  readonly newId: () => CaptureId;
  readonly now: () => Date;
  readonly quit: () => void;
  readonly notify: (message: string) => void;
}

export interface DraftController {
  readonly invoke: (invocation: Invocation) => void;
  readonly edit: (id: CaptureId, content: DraftContent) => void;
  readonly save: (id: CaptureId, content: DraftContent) => void;
  readonly dismiss: () => void;
  readonly discard: (id: CaptureId) => void;
  /**
   * For before-quit. 'hold' means the caller must prevent the quit; the
   * controller has started (or is already running) the Save/Discard/Cancel
   * flow. Not a predicate: it dispatches.
   */
  readonly holdQuitIfNeeded: () => "allow" | "hold";
  readonly view: () => CaptureView;
  readonly tray: () => TrayState;
  /** The current draft's frame only; serves inset://draft/<id>. */
  readonly frame: (id: CaptureId) => CapturedFrame | null;
  /** Fires when the view (ignoring the seed) or the tray state changes. */
  readonly subscribe: (listener: () => void) => () => void;
}

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Unknown error";

type Dispatch = (event: DraftEvent) => void;

/**
 * What subscribers observe. Content edits change only the seed, which is
 * read at mount. The quit phase counts so the panel gets a fresh view when
 * the dialog closes, which ends the wait of a Save it sent meanwhile.
 */
const publicKey = (state: DraftState): string => {
  const view = viewOf(state);

  return JSON.stringify([
    view.kind === "draft" ? { ...view, seed: null } : view,
    trayOf(state),
    state.phase === "draft" ? state.quit : null,
  ]);
};

export const createDraftController = (deps: DraftDeps): DraftController => {
  let state: DraftState = IDLE;
  const listeners = new Set<() => void>();
  const queue: DraftEvent[] = [];
  let draining = false;

  const reconcileSurface = (
    before: SurfaceState,
    after: SurfaceState
  ): void => {
    if (!after.visible) {
      if (before.visible) {
        deps.surface.hide();
      }

      return;
    }

    if (!before.visible || before.key !== after.key) {
      deps.surface.show(after.anchor, after.key);
    }
  };

  const runCapture = async (
    display: DisplaySnapshot,
    dispatch: Dispatch
  ): Promise<void> => {
    try {
      await deps.surface.whenHidden();

      const result = await deps.capture(display);

      dispatch(
        result.ok
          ? { frame: result.frame, id: deps.newId(), type: "captured" }
          : { problem: result.problem, type: "captureFailed" }
      );
    } catch (error) {
      dispatch({
        problem: { kind: "failed", message: errorMessage(error) },
        type: "captureFailed",
      });
    }
  };

  const runPublish = async (
    draft: Draft,
    dispatch: Dispatch
  ): Promise<void> => {
    try {
      const png = draft.frame.pixels.cropPng(draft.content.crop);
      const result = await deps.publish(toRecord(draft, deps.now()), png);

      dispatch(
        result.ok
          ? { id: draft.id, type: "published" }
          : { id: draft.id, message: result.message, type: "publishFailed" }
      );
    } catch (error) {
      dispatch({
        id: draft.id,
        message: errorMessage(error),
        type: "publishFailed",
      });
    }
  };

  const runAskQuitChoice = async (dispatch: Dispatch): Promise<void> => {
    const choice = await deps.surface.askQuitChoice();

    dispatch({ choice, type: "quitChoice" });
  };

  const run = (effect: Effect, dispatch: Dispatch): void => {
    switch (effect.type) {
      case "capture": {
        void runCapture(effect.display, dispatch);
        break;
      }

      case "publish": {
        void runPublish(effect.draft, dispatch);
        break;
      }

      case "askQuitChoice": {
        void runAskQuitChoice(dispatch);
        break;
      }

      case "focus": {
        deps.surface.focus();
        break;
      }

      case "quit": {
        deps.quit();
        break;
      }

      case "notify": {
        deps.notify(effect.message);
        break;
      }

      default: {
        break;
      }
    }
  };

  const apply = (event: DraftEvent, dispatch: Dispatch): void => {
    const before = state;
    const { effects, state: after } = step(before, event);

    state = after;
    reconcileSurface(surfaceOf(before), surfaceOf(after));

    if (publicKey(before) !== publicKey(after)) {
      for (const listener of listeners) {
        listener();
      }
    }

    for (const effect of effects) {
      run(effect, dispatch);
    }
  };

  const dispatch = (event: DraftEvent): void => {
    queue.push(event);

    if (draining) {
      return;
    }

    draining = true;

    try {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        apply(next, dispatch);
      }
    } finally {
      draining = false;
    }
  };

  return {
    discard: (id) => {
      dispatch({ id, type: "discarded" });
    },
    dismiss: () => {
      dispatch({ type: "dismissed" });
    },
    edit: (id, content) => {
      dispatch({ content, id, type: "edited" });
    },
    frame: (id) =>
      state.phase === "draft" && state.draft.id === id
        ? state.draft.frame
        : null,
    holdQuitIfNeeded: () => {
      if (mayQuit(state)) {
        return "allow";
      }

      dispatch({ type: "quitHeld" });

      return "hold";
    },
    invoke: (invocation) => {
      dispatch({ invocation, type: "invoked" });
    },
    save: (id, content) => {
      dispatch({ content, id, type: "saveRequested" });
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    tray: () => trayOf(state),
    view: () => viewOf(state),
  };
};
