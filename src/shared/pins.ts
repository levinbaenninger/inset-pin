import { PINS_MAX } from "./capture-record";
import type { PinKeyAction } from "./shortcuts";

/** A pin anywhere: the panel keeps pins in screen-image pixels, a saved capture in crop pixels. */
export interface PinPoint {
  readonly x: number;
  readonly y: number;
  readonly label?: string;
}

export interface PinArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One arrow press moves a pin this many image pixels, whatever the display's density; Shift moves it ten. */
export const NUDGE_PX = 1;
export const NUDGE_FAR_PX = 10;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

/** A pin kept on a pixel of the area. */
export const clampPinTo = <P extends PinPoint>(pin: P, area: PinArea): P => ({
  ...pin,
  x: clamp(Math.round(pin.x), area.x, area.x + area.width - 1),
  y: clamp(Math.round(pin.y), area.y, area.y + area.height - 1),
});

/** Appends the next numbered pin; null when the list is full. */
export const addPin = <P extends PinPoint>(
  pins: readonly P[],
  pin: P,
  area: PinArea
): readonly P[] | null =>
  pins.length >= PINS_MAX ? null : [...pins, clampPinTo(pin, area)];

/** Removes a pin; the ones after it take the next lower numbers. */
export const removePin = <P extends PinPoint>(
  pins: readonly P[],
  index: number
): readonly P[] => pins.filter((_, position) => position !== index);

export const movePin = <P extends PinPoint>(
  pins: readonly P[],
  index: number,
  to: { readonly x: number; readonly y: number },
  area: PinArea
): readonly P[] =>
  pins.map((pin, position) =>
    position === index ? clampPinTo({ ...pin, x: to.x, y: to.y }, area) : pin
  );

export const nudgePin = <P extends PinPoint>(
  pins: readonly P[],
  index: number,
  delta: { readonly x: number; readonly y: number },
  area: PinArea
): readonly P[] => {
  const pin = pins[index];

  return pin === undefined
    ? pins
    : movePin(pins, index, { x: pin.x + delta.x, y: pin.y + delta.y }, area);
};

/** A blank label is no label: the pin is stored as { x, y } again. */
export const labelPin = (
  pins: readonly PinPoint[],
  index: number,
  label: string
): readonly PinPoint[] =>
  pins.map((pin, position) => {
    if (position !== index) {
      return pin;
    }

    return label.trim() === ""
      ? { x: pin.x, y: pin.y }
      : { label, x: pin.x, y: pin.y };
  });

/** The selection after removing a pin: the one that took its number, else the one before, else none. */
export const selectionAfterRemove = (
  count: number,
  removed: number
): number | null => {
  const left = count - 1;

  if (left <= 0) {
    return null;
  }

  return Math.min(removed, left - 1);
};

/** The smallest box around every pin, or null without pins. */
export const pinBounds = (pins: readonly PinPoint[]): PinArea | null => {
  if (pins.length === 0) {
    return null;
  }

  const xs = pins.map((pin) => pin.x);
  const ys = pins.map((pin) => pin.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);

  return {
    height: Math.max(...ys) - top + 1,
    width: Math.max(...xs) - left + 1,
    x: left,
    y: top,
  };
};

/** The pin closest to the point within reach, preferring the later (topmost) one on a tie. */
export const pinAt = (
  pins: readonly { readonly x: number; readonly y: number }[],
  point: { readonly x: number; readonly y: number },
  reach: number
): number | null => {
  let best: number | null = null;
  let bestDistance = reach;

  for (const [index, pin] of pins.entries()) {
    const distance = Math.hypot(pin.x - point.x, pin.y - point.y);

    if (distance <= bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }

  return best;
};

/** "1 · label" lines, for the pins that have one. */
export const pinLabelLines = (pins: readonly PinPoint[]): readonly string[] =>
  pins.flatMap((pin, index) =>
    pin.label === undefined || pin.label.trim() === ""
      ? []
      : [`${index + 1} · ${pin.label.trim()}`]
  );

/** An image's pins and which one is selected. */
export interface PinEdit<P extends PinPoint> {
  readonly pins: readonly P[];
  readonly selected: number | null;
}

/**
 * What a pin key does to the pins, the same in the capture panel and the
 * library: ⇧P drops a pin at `dropAt` and selects it, 1–9 select, ⌫ removes
 * the selected pin and the later ones renumber, the arrows nudge it by image
 * pixels, and Escape lets it go. P (pin mode) is the editor's own.
 */
export const applyPinKey = <P extends PinPoint>(
  edit: PinEdit<P>,
  action: Exclude<PinKeyAction, { readonly kind: "toggleTool" }>,
  area: PinArea,
  dropAt: P
): PinEdit<P> => {
  const { pins, selected } = edit;

  switch (action.kind) {
    case "drop": {
      const next = addPin(pins, dropAt, area);

      return next === null ? edit : { pins: next, selected: next.length - 1 };
    }

    case "select": {
      return action.index < pins.length
        ? { pins, selected: action.index }
        : edit;
    }

    case "remove": {
      return selected === null
        ? edit
        : {
            pins: removePin(pins, selected),
            selected: selectionAfterRemove(pins.length, selected),
          };
    }

    case "nudge": {
      const step = action.far ? NUDGE_FAR_PX : NUDGE_PX;

      return selected === null
        ? edit
        : {
            pins: nudgePin(
              pins,
              selected,
              { x: action.dx * step, y: action.dy * step },
              area
            ),
            selected,
          };
    }

    case "deselect": {
      return { pins, selected: null };
    }

    default: {
      return edit;
    }
  }
};
