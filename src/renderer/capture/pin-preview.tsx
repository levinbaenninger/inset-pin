import { Location01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { DraftView } from "@shared/contracts";
import {
  fitView,
  imageToPreview,
  isTightest,
  isWidest,
  moveCrop,
  previewToImage,
  pt,
  resizeCrop,
  scaleCrop,
  size,
  WIDEN_STEP,
} from "@shared/geometry";
import type {
  CropHandle,
  PinGeometry,
  Point,
  PreviewView,
  Rect,
} from "@shared/geometry";
import { addPin, movePin, pinAt } from "@shared/pins";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { PointerEvent, ReactNode, RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isTextField } from "@/shared/key-targets";
import { PinMarker, pinHeadOffset } from "@/shared/pin-marker";

const HELP_ID = "pin-preview-help";

/** Panel content width: 380 − 2 × 12 padding. */
const MAX_BOX_WIDTH = 356;

/** The preview keeps one shape, so the panel's height never changes while the crop does. */
const BOX_ASPECT = 220 / 356;

/** A trackpad pinch arrives as ctrl+wheel; this much delta doubles or halves the crop's width. */
const PINCH_DOUBLING_DELTA = 120;

/** A press that moves less than this is a click, which places a pin. */
const CLICK_SLOP = 3;

/** How close to a corner, an edge or a pin's head a press must be to take it (preview pixels). */
const HANDLE_REACH = 10;
const PIN_REACH = 11;

/** The hint chip's height; it sits in the dimmed margin around the crop, off the frame and its handles. */
const HINT_HEIGHT = 20;

/** Where the hint goes: centred in the margin below the crop, else above it, else just inside the crop's bottom. */
const hintTop = (crop: Rect<"preview">, boxHeight: number): number => {
  const below = boxHeight - (crop.y + crop.height);

  if (below >= HINT_HEIGHT + 2) {
    return crop.y + crop.height + (below - HINT_HEIGHT) / 2;
  }

  return crop.y >= HINT_HEIGHT + 2
    ? (crop.y - HINT_HEIGHT) / 2
    : crop.y + crop.height - HINT_HEIGHT - HANDLE_REACH;
};

const CURSORS: Readonly<Record<CropHandle, string>> = {
  e: "cursor-ew-resize",
  n: "cursor-ns-resize",
  ne: "cursor-nesw-resize",
  nw: "cursor-nwse-resize",
  s: "cursor-ns-resize",
  se: "cursor-nwse-resize",
  sw: "cursor-nesw-resize",
  w: "cursor-ew-resize",
};

const observeWidth = (
  element: HTMLElement,
  onWidth: (width: number) => void
): (() => void) => {
  const observer = new ResizeObserver(() => {
    const width = Math.floor(element.getBoundingClientRect().width);

    if (width > 0) {
      onWidth(width);
    }
  });

  observer.observe(element);

  return () => {
    observer.disconnect();
  };
};

/**
 * Only shrinks within a mount: a classic scrollbar can appear because of the
 * preview's own height, and growing back could toggle it on and off.
 */
const useBoxWidth = (): [RefObject<HTMLDivElement | null>, number] => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(MAX_BOX_WIDTH);

  useLayoutEffect(() => {
    const element = ref.current;

    return element === null
      ? undefined
      : observeWidth(element, (available) => {
          setWidth((current) => Math.min(current, available));
        });
  }, []);

  return [ref, width];
};

/** Pinch on a trackpad (ctrl+wheel) scales the crop; plain scrolling is left alone. */
const usePinch = (
  ref: RefObject<HTMLElement | null>,
  onScale: (factor: number) => void
): void => {
  const scale = useEffectEvent(onScale);

  useEffect(() => {
    const element = ref.current;

    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();
      scale(2 ** (event.deltaY / PINCH_DOUBLING_DELTA));
    };

    element?.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      element?.removeEventListener("wheel", onWheel);
    };
  }, [ref]);
};

/** What a press at this point would take hold of. */
type Target =
  | { readonly kind: "pin"; readonly index: number }
  | { readonly kind: "handle"; readonly handle: CropHandle }
  | { readonly kind: "crop" }
  | { readonly kind: "outside" };

const OUTSIDE: Target = { kind: "outside" };

const near = (value: number, edge: number): boolean =>
  Math.abs(value - edge) <= HANDLE_REACH;

const between = (value: number, low: number, high: number): boolean =>
  value >= low - HANDLE_REACH && value <= high + HANDLE_REACH;

const HANDLES: ReadonlyMap<string, CropHandle> = new Map([
  ["e", "e"],
  ["n", "n"],
  ["ne", "ne"],
  ["nw", "nw"],
  ["s", "s"],
  ["se", "se"],
  ["sw", "sw"],
  ["w", "w"],
]);

const handleAt = (
  point: Point<"preview">,
  box: Rect<"preview">
): CropHandle | null => {
  if (
    !between(point.x, box.x, box.x + box.width) ||
    !between(point.y, box.y, box.y + box.height)
  ) {
    return null;
  }

  const north = near(point.y, box.y) ? "n" : "";
  const south = near(point.y, box.y + box.height) ? "s" : "";
  const west = near(point.x, box.x) ? "w" : "";
  const east = near(point.x, box.x + box.width) ? "e" : "";

  return HANDLES.get(`${north || south}${west || east}`) ?? null;
};

const targetAt = (
  point: Point<"preview">,
  box: Rect<"preview">,
  heads: readonly Point<"preview">[]
): Target => {
  const pin = pinAt(heads, point, PIN_REACH);

  if (pin !== null) {
    return { index: pin, kind: "pin" };
  }

  const handle = handleAt(point, box);

  if (handle !== null) {
    return { handle, kind: "handle" };
  }

  const inside =
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height;

  return inside ? { kind: "crop" } : OUTSIDE;
};

const cursorFor = (
  target: Target,
  dragging: boolean,
  pinMode: boolean
): string => {
  switch (target.kind) {
    case "pin": {
      return dragging ? "cursor-grabbing" : "cursor-grab";
    }

    case "crop": {
      if (dragging) {
        return "cursor-grabbing";
      }

      return pinMode ? "cursor-crosshair" : "cursor-move";
    }

    case "handle": {
      return CURSORS[target.handle];
    }

    case "outside": {
      return dragging ? "cursor-grabbing" : "cursor-default";
    }

    default: {
      return "cursor-default";
    }
  }
};

/** A drag in progress; the view stays still under it, so what is dragged follows the pointer. */
interface Gesture {
  readonly target: Target;
  readonly view: PreviewView;
  readonly from: Point<"preview">;
  readonly crop: Rect<"image">;
  readonly moved: boolean;
  /** From the press to the held pin's tip, so the tip keeps that distance while dragged. */
  readonly grip: Point<"preview">;
}

interface ToolButtonProps {
  /** The button's name, short, as the e2e scripts and screen readers find it. */
  readonly label: string;
  /** What the tooltip says it does. */
  readonly hint: string;
  readonly keys: string;
  readonly disabled: boolean;
  readonly pressed?: boolean;
  readonly onClick: () => void;
  /** An icon (pin mode) or a word (Tighten, Widen). */
  readonly children: ReactNode;
  readonly face: "icon" | "word";
}

const ToolButton = ({
  children,
  disabled,
  hint,
  keys,
  label,
  onClick,
  pressed,
  face,
}: ToolButtonProps) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        size={face === "icon" ? "icon-xs" : "xs"}
        type="button"
        variant="tool"
      >
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent side="bottom">
      {hint}
      <Kbd>{keys}</Kbd>
    </TooltipContent>
  </Tooltip>
);

export interface PinPreviewProps {
  readonly frame: DraftView["frame"];
  readonly geometry: PinGeometry;
  readonly disabled: boolean;
  readonly onChange: (geometry: PinGeometry) => void;
  readonly selected: number | null;
  readonly onSelect: (index: number | null) => void;
  readonly pinMode: boolean;
  readonly onPinMode: (on: boolean) => void;
  /** Where the pointer is over the image, for ⇧P; null when it is elsewhere. */
  readonly pointerRef: RefObject<Point<"image"> | null>;
  /** The preview, which takes the focus while a pin is selected. */
  readonly previewRef: RefObject<HTMLDivElement | null>;
  readonly keys: { readonly tighten: string; readonly widen: string };
  /** Shown left of the tools, above the preview. */
  readonly caption: ReactNode;
}

const pointIn = (event: PointerEvent<HTMLElement>): Point<"preview"> => {
  const box = event.currentTarget.getBoundingClientRect();

  return pt(event.clientX - box.left, event.clientY - box.top);
};

/** Tighten or widen the crop, from the buttons, ⌘= and ⌘− or a pinch. */
export const rescaleCrop = (
  geometry: PinGeometry,
  frame: DraftView["frame"],
  factor: number
): PinGeometry => ({
  crop: scaleCrop(geometry.crop, geometry.pins, factor, frame.size, frame.ppd),
  pins: geometry.pins,
});

/**
 * The capture around the pointer. The frame is what gets saved: drag it to
 * move it, drag its corners and edges to crop, and pinch to show more or
 * less. With pin mode on, a click inside the frame places the next numbered
 * pin; a pin can be dragged, and a click selects it.
 */
export const PinPreview = ({
  caption,
  disabled,
  frame,
  geometry,
  keys,
  onChange,
  onPinMode,
  onSelect,
  pinMode,
  pointerRef,
  previewRef,
  selected,
}: PinPreviewProps) => {
  const { crop, pins } = geometry;
  const [boxRef, boxWidth] = useBoxWidth();
  const [gesture, setGesture] = useState<Gesture | null>(null);
  /** A click in the frame while the title has the focus leaves it there, so typing goes on. */
  const keepTyping = useRef(false);
  const [hover, setHover] = useState<Target>(OUTSIDE);
  const box = size<"preview">(boxWidth, Math.round(boxWidth * BOX_ASPECT));
  const view = gesture?.view ?? fitView(crop, frame.size, box);
  const corner = imageToPreview(pt(crop.x, crop.y), view);

  const cropBox: Rect<"preview"> = {
    height: crop.height * view.scale,
    width: crop.width * view.scale,
    x: corner.x,
    y: corner.y,
  };

  const markers = pins.map((pin) => imageToPreview(pin, view));

  const heads = markers.map((tip) =>
    pt<"preview">(tip.x, tip.y - pinHeadOffset())
  );

  const widest = isWidest(crop, frame.size);
  const tightest = isTightest(crop, frame.size, frame.ppd);

  const rescale = (factor: number): void => {
    onChange(rescaleCrop(geometry, frame, factor));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (disabled || event.button !== 0) {
      return;
    }

    const point = pointIn(event);
    const target = targetAt(point, cropBox, heads);

    event.currentTarget.setPointerCapture(event.pointerId);
    keepTyping.current =
      target.kind !== "pin" && isTextField(document.activeElement);

    if (!keepTyping.current) {
      event.currentTarget.focus({ preventScroll: true });
    }

    const tip = target.kind === "pin" ? markers[target.index] : undefined;

    setGesture({
      crop,
      from: point,
      grip: pt((tip?.x ?? point.x) - point.x, (tip?.y ?? point.y) - point.y),
      moved: false,
      target,
      view,
    });

    if (target.kind === "pin") {
      onSelect(target.index);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const point = pointIn(event);

    pointerRef.current = previewToImage(point, gesture?.view ?? view);

    if (gesture === null) {
      setHover(disabled ? OUTSIDE : targetAt(point, cropBox, heads));

      return;
    }

    const travelled = Math.hypot(
      point.x - gesture.from.x,
      point.y - gesture.from.y
    );

    const moved = gesture.moved || travelled > CLICK_SLOP;

    if (moved !== gesture.moved) {
      setGesture({ ...gesture, moved });
    }

    if (!moved) {
      return;
    }

    const { target } = gesture;

    if (target.kind === "pin") {
      // The press took the head, which sits above the tip: the tip keeps that distance.
      const grip = pt<"preview">(
        point.x + gesture.grip.x,
        point.y + gesture.grip.y
      );

      onChange({
        crop,
        pins: movePin(
          pins,
          target.index,
          previewToImage(grip, gesture.view),
          crop
        ),
      });
    } else if (target.kind === "crop" || target.kind === "outside") {
      const { scale } = gesture.view;

      onChange({
        crop: moveCrop(
          gesture.crop,
          pt(
            (point.x - gesture.from.x) / scale,
            (point.y - gesture.from.y) / scale
          ),
          pins,
          frame.size
        ),
        pins,
      });
    } else {
      onChange({
        crop: resizeCrop(
          gesture.crop,
          target.handle,
          previewToImage(point, gesture.view),
          pins,
          frame.size,
          frame.ppd
        ),
        pins,
      });
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (gesture !== null && !gesture.moved) {
      const { target } = gesture;

      // A click inside the frame places the next pin; elsewhere it lets the selection go.
      if (target.kind === "crop" && pinMode) {
        const next = addPin(
          pins,
          previewToImage(pointIn(event), gesture.view),
          crop
        );

        if (next !== null) {
          onChange({ crop, pins: [...next] });
          // Selected only where its keys work: with the focus kept in the title, typing goes on instead.
          onSelect(keepTyping.current ? null : next.length - 1);
        }
      } else if (target.kind !== "pin") {
        onSelect(null);
      }
    }

    setGesture(null);
  };

  usePinch(previewRef, (factor) => {
    if (!disabled) {
      rescale(factor);
    }
  });

  const offHint = pinMode
    ? "Click to place pin 1"
    : "Pin mode is off · press P";

  const hint = pins.length === 0 ? offHint : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <div className="min-w-0 text-xs">{caption}</div>
        {/* One small group: pin mode, then the crop's two steps, named in words. */}
        <fieldset
          className="border-foreground/10 m-0 flex min-w-0 shrink-0 items-center gap-px rounded-lg border p-px"
          data-testid="preview-tools"
        >
          <legend className="sr-only">Preview tools</legend>
          <ToolButton
            disabled={disabled}
            hint={
              pinMode ? "Pin mode: a click places a pin" : "Pin mode is off"
            }
            keys="P"
            label="Pin mode"
            onClick={() => {
              onPinMode(!pinMode);
            }}
            pressed={pinMode}
            face="icon"
          >
            <HugeiconsIcon className="size-3.5" icon={Location01Icon} />
          </ToolButton>
          <span
            aria-hidden="true"
            className="bg-foreground/10 mx-0.5 h-4 w-px"
          />
          <ToolButton
            disabled={disabled || tightest}
            hint="Show less around the pins"
            keys={keys.tighten}
            label="Tighten"
            onClick={() => {
              rescale(1 / WIDEN_STEP);
            }}
            face="word"
          >
            Tighten
          </ToolButton>
          <ToolButton
            disabled={disabled || widest}
            hint="Show more around the pins"
            keys={keys.widen}
            label="Widen"
            onClick={() => {
              rescale(WIDEN_STEP);
            }}
            face="word"
          >
            Widen
          </ToolButton>
        </fieldset>
      </div>
      <p className="sr-only" id={HELP_ID}>
        Drag the frame or its edges to crop, pinch to show more or less. With
        pin mode on, click to place a numbered pin; drag a pin to move it. Keys:
        P pin mode, Shift+P drop a pin, 1 to 9 select a pin, arrows nudge it,
        Backspace removes it.
      </p>
      <div className="flex justify-center" ref={boxRef}>
        {/* The preview is a canvas for the crop and its pins: it takes the pointer and, through usePinKeys, the keys. */}
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          aria-describedby={HELP_ID}
          aria-disabled={disabled}
          aria-label={`Screenshot with ${pins.length === 1 ? "1 pin" : `${pins.length} pins`}`}
          className={cn(
            "bg-muted focus-visible:ring-ring/50 relative h-(--box-h) w-(--box-w) touch-none overflow-hidden rounded-lg outline-none select-none focus-visible:ring-3",
            disabled
              ? "cursor-default"
              : cursorFor(gesture?.target ?? hover, gesture !== null, pinMode)
          )}
          data-testid="pin-preview"
          // The selection lives here: once the focus leaves the preview, digits and ⌫ elsewhere leave pins alone.
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              onSelect(null);
            }
          }}
          onMouseDown={(event) => {
            if (keepTyping.current) {
              event.preventDefault();
            }
          }}
          onPointerCancel={() => {
            setGesture(null);
          }}
          onPointerDown={onPointerDown}
          onPointerLeave={() => {
            setHover(OUTSIDE);
            pointerRef.current = null;
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          ref={previewRef}
          role="application"
          style={{
            "--box-h": `${box.height}px`,
            "--box-w": `${box.width}px`,
          }}
          tabIndex={disabled ? -1 : 0}
        >
          {/* Settles on the new crop after a drag; follows the pointer exactly during one. */}
          <div
            className={cn(
              "absolute inset-0",
              gesture === null && "crop-settle"
            )}
          >
            <img
              alt=""
              className="absolute top-(--img-y) left-(--img-x) h-(--img-h) w-(--img-w) max-w-none select-none"
              draggable={false}
              src={frame.url}
              style={{
                "--img-h": `${frame.size.height * view.scale}px`,
                "--img-w": `${frame.size.width * view.scale}px`,
                "--img-x": `${-view.origin.x * view.scale}px`,
                "--img-y": `${-view.origin.y * view.scale}px`,
              }}
            />
            {/* What is saved: the rest of the screen dims around it. */}
            <div
              aria-hidden="true"
              className="crop-frame absolute top-(--crop-y) left-(--crop-x) h-(--crop-h) w-(--crop-w)"
              style={{
                "--crop-h": `${cropBox.height}px`,
                "--crop-w": `${cropBox.width}px`,
                "--crop-x": `${cropBox.x}px`,
                "--crop-y": `${cropBox.y}px`,
              }}
            />
            {markers.map((marker, index) => (
              <PinMarker
                // Pins have no identity beyond their number.
                // oxlint-disable-next-line react/no-array-index-key
                key={index}
                left={`${marker.x}px`}
                lifted={
                  gesture?.moved === true &&
                  gesture.target.kind === "pin" &&
                  gesture.target.index === index
                }
                number={index + 1}
                selected={selected === index}
                top={`${marker.y}px`}
              />
            ))}
          </div>
          {hint === null || disabled ? null : (
            <p
              aria-live="polite"
              className="pointer-events-none absolute inset-x-0 top-(--hint-y) z-20 flex justify-center"
              data-testid="pin-hint"
              style={{ "--hint-y": `${hintTop(cropBox, box.height)}px` }}
            >
              <span className="flex h-5 items-center gap-1 rounded-full bg-black/75 px-2 text-xs leading-none font-medium text-white shadow-sm backdrop-blur-sm">
                <HugeiconsIcon icon={Location01Icon} size={11} />
                {hint}
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
