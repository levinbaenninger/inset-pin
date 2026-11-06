import { canSaveTitle } from "@shared/capture-record";
import type { EditableFields } from "@shared/capture-record";
import { SAVE_TOO_SLOW } from "@shared/contracts";
import type { ActionResult, SaveTag } from "@shared/contracts";

/**
 * What main stores: a trimmed title, steps and pin labels, no blank steps, no
 * blank pin labels. The description is kept as typed, so a thought migrated
 * from v1 keeps every space and line break when another field is edited; only
 * a blank one is stored as empty.
 */
export const storedFields = (fields: EditableFields): EditableFields => ({
  description: fields.description.trim() === "" ? "" : fields.description,
  due: fields.due,
  pins: fields.pins.map(({ label, x, y }) =>
    label === undefined || label.trim() === ""
      ? { x, y }
      : { label: label.trim(), x, y }
  ),
  steps: fields.steps
    .filter((step) => step.text.trim() !== "")
    .map((step) => ({ done: step.done, id: step.id, text: step.text.trim() })),
  title: fields.title.trim(),
});

/**
 * What saving these values writes, and so what a copy of them carries. A
 * blank title is never saved: the capture keeps the title it has on disk.
 */
export const savable = (
  values: EditableFields,
  confirmed: EditableFields
): EditableFields => {
  const stored = storedFields(values);

  return canSaveTitle(stored.title)
    ? stored
    : { ...stored, title: confirmed.title };
};

/** Both in stored form. Comparing so keeps a trailing space being typed from reading as a change. */
const equal = (a: EditableFields, b: EditableFields): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** Whether saving these values would write exactly what is stored. */
export const writesNothing = (
  values: EditableFields,
  stored: EditableFields
): boolean => {
  const confirmed = storedFields(stored);

  return equal(savable(values, confirmed), confirmed);
};

/** A save sent to main and not answered yet: the edit it carries and what it writes. */
export interface InFlight {
  readonly rev: number;
  readonly payload: EditableFields;
}

/** Why a draft's changes aren't where the user left them: a save failed, or Discard changes couldn't put back what is saved. */
export interface DraftError {
  readonly message: string;
  readonly during: "save" | "discard";
}

interface DraftBase {
  /** Counts this draft's edits; a higher rev is a later edit. */
  readonly rev: number;
  /** The fields as typed, which the capture shows while the draft lasts. */
  readonly values: EditableFields;
  /** What the disk holds, as far as the library knows, in stored form; after a Discard main couldn't finish, what it still puts back. */
  readonly confirmed: EditableFields;
  /**
   * A save main wrote that Discard changes couldn't take back. The next
   * Discard asks main again; a save of this draft keeps what it writes
   * instead, even when that is what `confirmed` holds.
   */
  readonly undo: SaveTag | null;
}

/**
 * Unsaved edits to one capture. Clean is no draft at all. A draft goes away
 * only when the save of its latest rev succeeds (or there turns out to be
 * nothing to save), or when the user discards it.
 *
 * - dirty: edited since the last save was sent; an older save may still be on its way.
 * - saving: the latest rev is on its way to the disk.
 * - failed: the latest rev's save failed, or Discard changes couldn't put
 *   back what is saved. Only Retry (Keep changes) sends it again. A failed
 *   save ends with Discard changes or a new edit; a failed Discard only with
 *   Keep changes or Discard again, and typing just updates it.
 *
 * Discard changes ends the draft at once. Main drops or undoes the save on
 * its way (SPEC round 8), and that save's answer never reaches this draft.
 * If main can't put back what is saved, the draft comes back failed, with
 * `undo` naming the save main still holds (SPEC round 9).
 *
 * `error` stays from a failed save until a save succeeds, so the failure
 * stays on screen while the user types on or retries.
 */
export type Draft =
  | (DraftBase & {
      readonly kind: "dirty";
      readonly inFlight: InFlight | null;
      readonly error: DraftError | null;
    })
  | (DraftBase & {
      readonly kind: "saving";
      readonly inFlight: InFlight;
      readonly error: DraftError | null;
    })
  | (DraftBase & { readonly kind: "failed"; readonly error: DraftError });

export type DraftEvent =
  /** The user changed a field. `stored` is the capture as loaded, which a new draft starts from. */
  | {
      readonly kind: "edit";
      readonly values: EditableFields;
      readonly stored: EditableFields;
    }
  /** Save the latest rev now: after a pause in typing, on leaving, or for a copy. A failed draft waits for Retry. */
  | { readonly kind: "send" }
  /** The user asked to save again: Retry or Keep changes beside the error, in the prompt, or on a refused copy. */
  | { readonly kind: "retry" }
  /** Main answered the save of this rev. */
  | {
      readonly kind: "answered";
      readonly rev: number;
      readonly result: ActionResult;
    }
  | { readonly kind: "discard" }
  /** Main couldn't put back what was saved before `draft` was discarded, and still holds save `tag`. */
  | {
      readonly kind: "undiscarded";
      readonly draft: Draft;
      readonly tag: SaveTag;
      readonly message: string;
    }
  /** A Retry's wait ran out while its save is still on its way: the capture says so, and Retry may wait again. */
  | { readonly kind: "overdue" }
  /** The capture was deleted; a save on its way has nothing left to write into. */
  | { readonly kind: "removed" };

const edit = (
  draft: Draft | null,
  values: EditableFields,
  stored: EditableFields
): Draft | null => {
  if (draft === null) {
    return writesNothing(values, stored)
      ? null
      : {
          confirmed: storedFields(stored),
          error: null,
          inFlight: null,
          kind: "dirty",
          rev: 1,
          undo: null,
          values,
        };
  }

  // Typing doesn't answer a Discard main couldn't finish: only Keep changes or Discard again does.
  if (draft.kind === "failed" && draft.error.during === "discard") {
    return { ...draft, rev: draft.rev + 1, values };
  }

  return {
    confirmed: draft.confirmed,
    error: draft.error,
    inFlight: draft.kind === "failed" ? null : draft.inFlight,
    kind: "dirty",
    rev: draft.rev + 1,
    undo: draft.undo,
    values,
  };
};

/** Whether a save of this draft is on its way to the disk and may still land. */
export const isWriting = (draft: Draft): boolean =>
  draft.kind === "saving" ||
  (draft.kind === "dirty" && draft.inFlight !== null);

/** Saves run one at a time, so a dirty draft behind a save on its way waits for its answer. */
const send = (draft: Draft | null, retry: boolean): Draft | null => {
  if (
    draft === null ||
    isWriting(draft) ||
    (draft.kind === "failed" && !retry)
  ) {
    return draft;
  }

  const payload = savable(draft.values, draft.confirmed);

  // While main still holds a discarded save, even the saved fields must reach it, so it keeps them.
  if (draft.undo === null && equal(payload, draft.confirmed)) {
    return null;
  }

  return {
    confirmed: draft.confirmed,
    error: draft.error,
    inFlight: { payload, rev: draft.rev },
    kind: "saving",
    rev: draft.rev,
    undo: draft.undo,
    values: draft.values,
  };
};

const answered = (
  draft: Draft | null,
  rev: number,
  result: ActionResult
): Draft | null => {
  if (
    draft === null ||
    draft.kind === "failed" ||
    draft.inFlight?.rev !== rev
  ) {
    return draft;
  }

  if (result.ok) {
    return draft.kind === "saving"
      ? null
      : {
          ...draft,
          confirmed: draft.inFlight.payload,
          error: null,
          inFlight: null,
          undo: null,
        };
  }

  const error: DraftError = { during: "save", message: result.message };

  if (draft.kind === "dirty") {
    return { ...draft, error, inFlight: null };
  }

  return {
    confirmed: draft.confirmed,
    error,
    kind: "failed",
    rev: draft.rev,
    undo: draft.undo,
    values: draft.values,
  };
};

/**
 * The discarded changes come back as not discarded, with the typing done
 * since the Discard when there is some: nothing of it was sent meanwhile,
 * and only Keep changes or Discard again settles it.
 */
const undiscarded = (
  draft: Draft | null,
  discarded: Draft,
  tag: SaveTag,
  message: string
): Draft => ({
  confirmed: discarded.confirmed,
  error: { during: "discard", message },
  kind: "failed",
  rev: (draft ?? discarded).rev,
  undo: tag,
  values: (draft ?? discarded).values,
});

/** The draft lifecycle, the same for every capture; null is clean. */
export const reduceDraft = (
  draft: Draft | null,
  event: DraftEvent
): Draft | null => {
  switch (event.kind) {
    case "edit": {
      return edit(draft, event.values, event.stored);
    }

    case "send": {
      return send(draft, false);
    }

    case "retry": {
      return send(draft, true);
    }

    case "answered": {
      return answered(draft, event.rev, event.result);
    }

    case "discard": {
      return null;
    }

    case "undiscarded": {
      return undiscarded(draft, event.draft, event.tag, event.message);
    }

    case "overdue": {
      return draft !== null && isWriting(draft)
        ? { ...draft, error: { during: "save", message: SAVE_TOO_SLOW } }
        : draft;
    }

    case "removed": {
      return null;
    }

    default: {
      return draft;
    }
  }
};

/** What a copy started now carries: the latest rev and what saving it writes. */
export const snapshotOf = (draft: Draft): InFlight => ({
  payload: savable(draft.values, draft.confirmed),
  rev: draft.rev,
});
