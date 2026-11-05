import { canSaveTitle } from "@shared/capture-record";
import type { CaptureId, EditableFields } from "@shared/capture-record";
import type { ActionResult } from "@shared/contracts";

export const SAVE_AFTER_MS = 600;

export interface FieldStore {
  readonly update: (input: {
    readonly id: CaptureId;
    readonly fields: EditableFields;
  }) => Promise<ActionResult>;
}

/**
 * What main stores: a trimmed title, steps and pin labels, no blank steps, no
 * blank pin labels. The description is kept as typed, so a thought migrated
 * from v1 keeps every space and line break when another field is edited; only
 * a blank one is stored as empty. Comparing in this form keeps a trailing
 * space being typed in the title from reading as a change.
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
    .map((step) => ({ ...step, text: step.text.trim() })),
  title: fields.title.trim(),
});

const same = (a: EditableFields, b: EditableFields): boolean =>
  JSON.stringify(storedFields(a)) === JSON.stringify(storedFields(b));

/** A rejected call, such as a closed IPC channel, reads as a failed save. */
const settle = async (
  call: () => Promise<ActionResult>
): Promise<ActionResult> => {
  try {
    return await call();
  } catch (error) {
    return { message: String(error), ok: false };
  }
};

export interface InlineState {
  /** Null until the first stored copy is adopted. */
  readonly fields: EditableFields | null;
  /** What went wrong with the last save, or null once one succeeds. */
  readonly failure: string | null;
}

const BLANK: EditableFields = {
  description: "",
  due: null,
  pins: [],
  steps: [],
  title: "",
};

/**
 * Saves a capture's fields as they are edited in place, as in Window Links: a
 * while after the last change, or at once on flush. It compares with what it
 * last sent, so a flush with nothing new sends nothing and leaves the edited
 * time alone. Every save goes through one promise chain, in order.
 */
export class InlineSaver {
  readonly #id: CaptureId;
  readonly #store: FieldStore;
  readonly #listeners = new Set<() => void>();
  /** What was last sent, in stored form. */
  #saved: EditableFields = BLANK;
  /** What main last confirmed, so a failed save is sent again on the next flush. */
  #confirmed: EditableFields = BLANK;
  #state: InlineState = { failure: null, fields: null };
  #timer: ReturnType<typeof setTimeout> | undefined;
  #chain: Promise<void> = Promise.resolve();
  #inFlight = 0;
  /** Bumped when the page goes away: saves queued before then are dropped, not sent late. */
  #generation = 0;

  constructor(id: CaptureId, store: FieldStore) {
    this.#id = id;
    this.#store = store;
  }

  /** For useSyncExternalStore: the same object until something changes. */
  readonly state = (): InlineState => this.#state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  };

  get #latest(): EditableFields {
    return this.#state.fields ?? this.#saved;
  }

  edit(fields: EditableFields): void {
    this.#set({ ...this.#state, fields });
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.flush();
    }, SAVE_AFTER_MS);
  }

  /** Changes that are no typing, such as a ticked step or a moved pin, save at once. */
  editNow(fields: EditableFields): void {
    this.#set({ ...this.#state, fields });
    this.flush();
  }

  /**
   * Nothing is saved while the title is blank; the capture keeps its last
   * title. When the page is going away, the whole latest copy goes straight
   * to main whenever anything is unconfirmed, and queued saves are dropped.
   */
  flush({ leaving = false }: { readonly leaving?: boolean } = {}): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;

    const fields = this.#latest;

    if (this.#state.fields === null || !canSaveTitle(fields.title)) {
      return;
    }

    const sent = storedFields(fields);

    if (leaving) {
      const unconfirmed = this.#inFlight > 0 || !same(fields, this.#confirmed);

      this.#generation += 1;

      if (unconfirmed) {
        this.#saved = sent;
        void settle(
          async () => await this.#store.update({ fields: sent, id: this.#id })
        );
      }

      return;
    }

    if (!same(fields, this.#saved)) {
      this.#saved = sent;
      this.#enqueue(sent);
    }
  }

  /**
   * Saves what is on screen and waits until main has it, so a copy, export or
   * quit that follows sees the same. Fails when the save fails.
   */
  async settle(): Promise<ActionResult> {
    this.flush();
    await this.#chain;

    const { failure } = this.#state;

    return failure === null ? { ok: true } : { message: failure, ok: false };
  }

  /**
   * Takes the stored copy: the first one always, later ones when nothing here
   * is unsaved or on its way, and they differ.
   */
  adopt(fields: EditableFields): void {
    const later =
      this.#state.fields !== null &&
      (this.#inFlight > 0 ||
        !same(this.#latest, this.#saved) ||
        same(fields, this.#saved));

    if (later) {
      return;
    }

    this.#saved = storedFields(fields);
    this.#confirmed = this.#saved;
    this.#set({ ...this.#state, fields });
  }

  /** A title left blank goes back to the saved one. */
  restoreBlankTitle(): void {
    if (!canSaveTitle(this.#latest.title)) {
      this.#set({
        ...this.#state,
        fields: { ...this.#latest, title: this.#saved.title },
      });
    }
  }

  #set(state: InlineState): void {
    this.#state = state;

    for (const listener of this.#listeners) {
      listener();
    }
  }

  #enqueue(sent: EditableFields): void {
    this.#inFlight += 1;
    this.#chain = this.#send(this.#chain, this.#generation, sent);
  }

  /** Waits for the save before it, so saves reach main in order. */
  async #send(
    previous: Promise<void>,
    generation: number,
    sent: EditableFields
  ): Promise<void> {
    await previous;

    if (generation !== this.#generation) {
      this.#inFlight -= 1;

      return;
    }

    const result = await settle(
      async () => await this.#store.update({ fields: sent, id: this.#id })
    );

    this.#inFlight -= 1;

    if (result.ok) {
      this.#confirmed = sent;
    } else {
      this.#saved = this.#confirmed;
    }

    this.#set({
      ...this.#state,
      failure: result.ok ? null : result.message,
    });
  }
}
