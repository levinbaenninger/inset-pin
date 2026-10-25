import {
  ArrowExpand01Icon,
  ArrowShrink01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { DraftView } from "@shared/contracts";
import {
  clampPin,
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
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PinMarker } from "@/shared/pin-marker";

/** Panel content width: 380 − 2 × 12 padding. */
const MAX_BOX_WIDTH = 356;

/** The preview keeps one shape, so the panel's height never changes while the crop does. */
const BOX_ASPECT = 220 / 356;

const NUDGE_FAR = 10;

/** A trackpad pinch arrives as ctrl+wheel; this much delta doubles or halves the crop's width. */
const PINCH_DOUBLING_DELTA = 120;

/** A press that moves less than this is a click, which places the pin. */
const CLICK_SLOP = 3;

/** How close to a corner, an edge or the pin a press must be to take it (preview pixels). */
const HANDLE_REACH = 10;
const PIN_REACH = 12;

const ARROWS = new Map([
  ["ArrowDown", { x: 0, y: 1 }],
  ["ArrowLeft", { x: -1, y: 0 }],
  ["ArrowRight", { x: 1, y: 0 }],
  ["ArrowUp", { x: 0, y: -1 }],
]);

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

/** Pinch on a trackpad (ctrl+wheel) scales the crop about the pin; plain scrolling is left alone. */
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
type Target = CropHandle | "pin" | "crop" | "outside";

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
  marker: Point<"preview">
): Target => {
  if (Math.hypot(point.x - marker.x, point.y - marker.y) <= PIN_REACH) {
    return "pin";
  }

  const handle = handleAt(point, box);

  if (handle !== null) {
    return handle;
  }

  const inside =
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height;

  return inside ? "crop" : "outside";
};

const cursorFor = (target: Target, dragging: boolean): string => {
  if (target === "pin") {
    return dragging ? "cursor-grabbing" : "cursor-grab";
  }

  if (target === "crop") {
    return dragging ? "cursor-grabbing" : "cursor-move";
  }

  return target === "outside" ? "cursor-default" : CURSORS[target];
};

/** A drag in progress; the view stays still under it, so what is dragged follows the pointer. */
interface Gesture {
  readonly target: Target;
  readonly view: PreviewView;
  readonly from: Point<"preview">;
  readonly crop: Rect<"image">;
  readonly moved: boolean;
}

interface ZoomButtonProps {
  readonly label: string;
  readonly hint: string;
  readonly icon: typeof ArrowExpand01Icon;
  readonly disabled: boolean;
  readonly onClick: () => void;
}

const ZoomButton = ({
  disabled,
  hint,
  icon,
  label,
  onClick,
}: ZoomButtonProps) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <HugeiconsIcon icon={icon} />
      </Button>
    </TooltipTrigger>
    <TooltipContent side="bottom">{hint}</TooltipContent>
  </Tooltip>
);

export interface PinPreviewProps {
  readonly frame: DraftView["frame"];
  readonly geometry: PinGeometry;
  readonly disabled: boolean;
  readonly onChange: (geometry: PinGeometry) => void;
  /** Shown left of the context buttons, above the preview. */
  readonly caption: ReactNode;
}

const pointIn = (event: PointerEvent<HTMLElement>): Point<"preview"> => {
  const box = event.currentTarget.getBoundingClientRect();

  return pt(event.clientX - box.left, event.clientY - box.top);
};

/**
 * The capture around the pin. The frame is what gets saved: drag it to move
 * it, drag its corners and edges to crop, and pinch to show more or less. A
 * click or a drag on the pin moves the pin.
 */
export const PinPreview = ({
  caption,
  disabled,
  frame,
  geometry,
  onChange,
}: PinPreviewProps) => {
  const { crop, pin } = geometry;
  const [boxRef, boxWidth] = useBoxWidth();
  const previewRef = useRef<HTMLButtonElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [hover, setHover] = useState<Target>("outside");
  const box = size<"preview">(boxWidth, Math.round(boxWidth * BOX_ASPECT));
  const view = gesture?.view ?? fitView(crop, frame.size, box);
  const corner = imageToPreview(pt(crop.x, crop.y), view);

  const cropBox: Rect<"preview"> = {
    height: crop.height * view.scale,
    width: crop.width * view.scale,
    x: corner.x,
    y: corner.y,
  };

  const marker = imageToPreview(pin, view);
  const widest = isWidest(crop, frame.size);
  const tightest = isTightest(crop, frame.size, frame.ppd);

  const rescale = (factor: number): void => {
    onChange({
      crop: scaleCrop(crop, pin, factor, frame.size, frame.ppd),
      pin,
    });
  };

  const placePin = (point: Point<"preview">, within: PreviewView): void => {
    onChange({ crop, pin: clampPin(previewToImage(point, within), crop) });
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    if (disabled || event.button !== 0) {
      return;
    }

    const point = pointIn(event);
    const target = targetAt(point, cropBox, marker);

    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({ crop, from: point, moved: false, target, view });

    if (target === "pin") {
      placePin(point, view);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    const point = pointIn(event);

    if (gesture === null) {
      setHover(disabled ? "outside" : targetAt(point, cropBox, marker));

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

    if (target === "pin") {
      placePin(point, gesture.view);
    } else if (target === "crop" || target === "outside") {
      const { scale } = gesture.view;

      onChange({
        crop: moveCrop(
          gesture.crop,
          pt(
            (point.x - gesture.from.x) / scale,
            (point.y - gesture.from.y) / scale
          ),
          pin,
          frame.size
        ),
        pin,
      });
    } else {
      onChange({
        crop: resizeCrop(
          gesture.crop,
          target,
          previewToImage(point, gesture.view),
          pin,
          frame.size,
          frame.ppd
        ),
        pin,
      });
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>): void => {
    // A click inside the frame places the pin there.
    if (gesture !== null && !gesture.moved && gesture.target === "crop") {
      placePin(pointIn(event), gesture.view);
    }

    setGesture(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const direction = ARROWS.get(event.key);

    if (disabled || direction === undefined) {
      return;
    }

    event.preventDefault();

    const step = frame.ppd * (event.shiftKey ? NUDGE_FAR : 1);

    onChange({
      crop,
      pin: clampPin(
        pt(pin.x + direction.x * step, pin.y + direction.y * step),
        crop
      ),
    });
  };

  usePinch(previewRef, (factor) => {
    if (!disabled) {
      rescale(factor);
    }
  });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <div className="min-w-0 text-xs">{caption}</div>
        <div className="flex shrink-0 items-center">
          <ZoomButton
            disabled={disabled || tightest}
            hint="Tighten: show less around the pin"
            icon={ArrowShrink01Icon}
            label="Tighten"
            onClick={() => {
              rescale(1 / WIDEN_STEP);
            }}
          />
          <ZoomButton
            disabled={disabled || widest}
            hint="Widen context: show more around the pin"
            icon={ArrowExpand01Icon}
            label="Widen context"
            onClick={() => {
              rescale(WIDEN_STEP);
            }}
          />
        </div>
      </div>
      <div className="flex justify-center" ref={boxRef}>
        <button
          aria-label="Pin and crop. Click or drag to move the pin, drag the frame or its edges to crop, pinch to show more or less. Arrow keys move the pin; Shift moves it further."
          aria-roledescription="pin preview"
          className={cn(
            "bg-muted focus-visible:ring-ring/50 relative h-(--box-h) w-(--box-w) touch-none overflow-hidden rounded-lg outline-none focus-visible:ring-3 disabled:cursor-default",
            cursorFor(gesture?.target ?? hover, gesture !== null)
          )}
          disabled={disabled}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerLeave={() => {
            setHover("outside");
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            setGesture(null);
          }}
          ref={previewRef}
          style={{
            "--box-h": `${box.height}px`,
            "--box-w": `${box.width}px`,
          }}
          type="button"
        >
          {/* Settles on the new crop after a drag; follows the pointer exactly during one. */}
          <div
            className={cn(
              "absolute inset-0",
              gesture === null && "crop-settle"
            )}
          >
            <img
              alt="Captured screen around the pin"
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
            <PinMarker left={`${marker.x}px`} top={`${marker.y}px`} />
          </div>
        </button>
      </div>
    </div>
  );
};
