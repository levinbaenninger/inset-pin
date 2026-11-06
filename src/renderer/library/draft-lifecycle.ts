import { canSaveTitle } from "@shared/capture-record";
import type { EditableFields } from "@shared/capture-record";
import { SAVE_TOO_SLOW } from "@shared/contracts";
import type { ActionResult } from "@shared/contracts";

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

/**
 * A save that Discard changes wrote the saved values over. `landed` is
 * whether it reached the disk, null until main answers it.
 */
export interface Discarded {
  readonly rev: number;
  readonly payload: EditableFields;
  readonly landed: boolean | null;
}

interface DraftBase {
  /** Counts this draft's edits; a higher rev is a later edit. */
  readonly rev: number;
  /** The fields as typed, which the capture shows while the draft lasts. */
  readonly values: EditableFields;
  /** What the disk holds, as far as the library knows, in stored form. */
  readonly confirmed: EditableFields;
}

/**
 * Unsaved edits to one capture. Clean is no draft at all. A draft goes away
 * only when the save of its latest rev succeeds (or there turns out to be
 * nothing to save), or when the user discards it.
 *
 * - dirty: edited since the last save was sent; an older save may still be on its way.
 * - saving: the latest rev is on its way to the disk. After Discard changes
 *   it writes the saved values over the discarded save, `discarded`.
 * - failed: the latest rev's save failed; only Retry sends it again, and
 *   Discard changes or a new edit end it.
 *
 * `error` stays from a failed save until a save succeeds, so the failure
 * stays on screen while the user types on or retries.
 */
export type Draft =
  | (DraftBase & {
      readonly kind: "dirty";
      readonly inFlight: InFlight | null;
      readonly error: string | null;
    })
  | (DraftBase & {
      readonly kind: "saving";
      readonly inFlight: InFlight;
      readonly error: string | null;
      readonly discarded: Discarded | null;
    })
  | (DraftBase & { readonly kind: "failed"; readonly error: string });

export type DraftEvent =
  /** The user changed a field. `stored` is the capture as loaded, which a new draft starts from. */
  | {
      readonly kind: "edit";
      readonly values: EditableFields;
      readonly stored: EditableFields;
    }
  /** Save the latest rev now: after a pause in typing, on leaving, or for a copy. A failed draft waits for Retry. */
  | { readonly kind: "send" }
  /** The user asked to save again: Retry beside the error, in the prompt, or on a refused copy. */
  | { readonly kind: "retry" }
  /** Main answered the save of this rev. */
  | {
      readonly kind: "answered";
      readonly rev: number;
      readonly result: ActionResult;
    }
  | { readonly kind: "discard" }
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
          values,
        };
  }

  return {
    confirmed: draft.confirmed,
    error: draft.error,
    inFlight: draft.kind === "failed" ? null : draft.inFlight,
    kind: "dirty",
    rev: draft.rev + 1,
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

  if (equal(payload, draft.confirmed)) {
    return null;
  }

  return {
    confirmed: draft.confirmed,
    discarded: null,
    error: draft.error,
    inFlight: { payload, rev: draft.rev },
    kind: "saving",
    rev: draft.rev,
    values: draft.values,
  };
};

const answered = (
  draft: Draft | null,
  rev: number,
  result: ActionResult
): Draft | null => {
  if (draft === null || draft.kind === "failed") {
    return draft;
  }

  // The discarded save: until the saved values land after it, the disk holds whatever it wrote.
  if (draft.kind === "saving" && draft.discarded?.rev === rev) {
    return {
      ...draft,
      confirmed: result.ok ? draft.discarded.payload : draft.confirmed,
      discarded: { ...draft.discarded, landed: result.ok },
    };
  }

  if (draft.inFlight?.rev !== rev) {
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
        };
  }

  if (draft.kind === "dirty") {
    return { ...draft, error: result.message, inFlight: null };
  }

  // Writing the saved values back failed, but the discarded save never reached the disk either.
  return draft.discarded?.landed === false
    ? null
    : {
        confirmed: draft.confirmed,
        error: result.message,
        kind: "failed",
        rev: draft.rev,
        values: draft.values,
      };
};

/**
 * Discard changes while a save is on its way: that save may still write the
 * discarded text, so what the disk held before is written after it, and the
 * capture shows that meanwhile. Saves reach main in order, so this one lands
 * last, and the answer to the discarded save is ignored.
 */
const revert = (draft: Draft): Draft => {
  // Already writing the saved values back: there is nothing new to discard.
  if (draft.kind === "failed" || draft.inFlight === null) {
    return draft;
  }

  if (draft.kind === "saving" && draft.discarded !== null) {
    return draft;
  }

  const rev = draft.rev + 1;

  return {
    confirmed: draft.confirmed,
    discarded: { ...draft.inFlight, landed: null },
    error: null,
    inFlight: { payload: draft.confirmed, rev },
    kind: "saving",
    rev,
    values: draft.confirmed,
  };
};

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
      return draft !== null && isWriting(draft) ? revert(draft) : null;
    }

    case "overdue": {
      return draft !== null && isWriting(draft)
        ? { ...draft, error: SAVE_TOO_SLOW }
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
