/**
 * Pin edits to undo and redo, one step per gesture: a drag, a click that adds
 * a pin, a removal, a run of nudges to one pin, or typing one pin's label. A
 * change in the gesture the last step belongs to adds no step, so a long drag
 * undoes in one go. A null gesture always takes a step of its own.
 */
export interface PinHistory<P> {
  readonly undo: readonly (readonly P[])[];
  readonly redo: readonly (readonly P[])[];
  readonly gesture: string | null;
}

const LIMIT = 100;

export const emptyHistory = <P>(): PinHistory<P> => ({
  gesture: null,
  redo: [],
  undo: [],
});

/** Notes the pins as they were before a change made as part of `gesture`. */
export const recordPins = <P>(
  history: PinHistory<P>,
  before: readonly P[],
  gesture: string | null
): PinHistory<P> =>
  gesture !== null && gesture === history.gesture
    ? history
    : { gesture, redo: [], undo: [...history.undo, before].slice(-LIMIT) };

/** The next change starts a step of its own, even in the same gesture. */
export const endGesture = <P>(history: PinHistory<P>): PinHistory<P> =>
  history.gesture === null ? history : { ...history, gesture: null };

export interface HistoryStep<P> {
  readonly history: PinHistory<P>;
  readonly pins: readonly P[];
}

/** The pins before the last step, or null when there is nothing to undo. */
export const undoPins = <P>(
  history: PinHistory<P>,
  current: readonly P[]
): HistoryStep<P> | null => {
  const previous = history.undo.at(-1);

  return previous === undefined
    ? null
    : {
        history: {
          gesture: null,
          redo: [...history.redo, current],
          undo: history.undo.slice(0, -1),
        },
        pins: previous,
      };
};

/** The pins the last undo took back, or null when there is nothing to redo. */
export const redoPins = <P>(
  history: PinHistory<P>,
  current: readonly P[]
): HistoryStep<P> | null => {
  const next = history.redo.at(-1);

  return next === undefined
    ? null
    : {
        history: {
          gesture: null,
          redo: history.redo.slice(0, -1),
          undo: [...history.undo, current],
        },
        pins: next,
      };
};

/**
 * Takes back the gesture still going on, and only that one, as Esc does in a
 * pin's label: the label goes back to what it held when it took the focus.
 * Null when that gesture made no change.
 */
export const undoGesture = <P>(
  history: PinHistory<P>,
  current: readonly P[],
  gesture: string
): HistoryStep<P> | null =>
  history.gesture === gesture ? undoPins(history, current) : null;
