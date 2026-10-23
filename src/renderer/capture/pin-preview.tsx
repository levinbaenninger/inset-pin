import {
  ArrowExpand01Icon,
  ArrowShrink01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { DraftView } from "@shared/contracts";
import {
  clampPin,
  fitPreview,
  imageToPreview,
  isTightest,
  isWidest,
  previewToImage,
  pt,
  scaleCrop,
  size,
  WIDEN_STEP,
} from "@shared/geometry";
import type { PinGeometry } from "@shared/geometry";
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
import { PinMarker } from "@/shared/pin-marker";

/** Panel content width: 380 − 2 × 12 padding. */
const MAX_BOX_WIDTH = 356;
const MAX_BOX_HEIGHT = 220;
const NUDGE_FAR = 10;

/** Trackpad pinch arrives as ctrl+wheel; this much delta is one widen or tighten step. */
const PINCH_STEP_DELTA = 40;

const ARROWS = new Map([
  ["ArrowDown", { x: 0, y: 1 }],
  ["ArrowLeft", { x: -1, y: 0 }],
  ["ArrowRight", { x: 1, y: 0 }],
  ["ArrowUp", { x: 0, y: -1 }],
]);

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

/** Pinch on a trackpad (ctrl+wheel) widens or tightens; plain scrolling is left alone. */
const usePinch = (
  ref: RefObject<HTMLElement | null>,
  onStep: (direction: "widen" | "tighten") => void
): void => {
  const step = useEffectEvent(onStep);

  useEffect(() => {
    const element = ref.current;
    let pending = 0;

    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();
      pending += event.deltaY;

      if (Math.abs(pending) >= PINCH_STEP_DELTA) {
        step(pending > 0 ? "widen" : "tighten");
        pending = 0;
      }
    };

    element?.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      element?.removeEventListener("wheel", onWheel);
    };
  }, [ref]);
};

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
  const widest = isWidest(crop, frame.size);
  const tightest = isTightest(crop, frame.size, frame.ppd);
  const fit = fitPreview(crop, size(boxWidth, MAX_BOX_HEIGHT));
  const marker = imageToPreview(pin, crop, fit);

  const placeAt = (event: PointerEvent<HTMLButtonElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();

    const point = pt<"preview">(
      event.clientX - box.left,
      event.clientY - box.top
    );

    onChange({ crop, pin: clampPin(previewToImage(point, crop, fit), crop) });
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    if (disabled || event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    placeAt(event);
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId)) {
      placeAt(event);
    }
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

  const rescale = (factor: number): void => {
    onChange({
      crop: scaleCrop(crop, pin, factor, frame.size, frame.ppd),
      pin,
    });
  };

  usePinch(previewRef, (direction) => {
    if (disabled) {
      return;
    }

    if (direction === "widen" && !widest) {
      rescale(WIDEN_STEP);
    } else if (direction === "tighten" && !tightest) {
      rescale(1 / WIDEN_STEP);
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
      <div className="bg-muted flex justify-center rounded-lg" ref={boxRef}>
        <button
          aria-label="Pin position. Click or drag to move the pin, or use the arrow keys (Shift moves further). Pinch to widen or tighten."
          aria-roledescription="pin preview"
          className="focus-visible:ring-ring/50 relative h-(--box-h) w-(--box-w) cursor-crosshair touch-none overflow-hidden rounded-lg outline-none focus-visible:ring-3 disabled:cursor-default"
          disabled={disabled}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          ref={previewRef}
          style={{
            "--box-h": `${fit.box.height}px`,
            "--box-w": `${fit.box.width}px`,
          }}
          type="button"
        >
          <img
            alt="Captured screen around the pin"
            className="absolute top-(--img-y) left-(--img-x) h-(--img-h) w-(--img-w) max-w-none select-none"
            draggable={false}
            src={frame.url}
            style={{
              "--img-h": `${frame.size.height * fit.scale}px`,
              "--img-w": `${frame.size.width * fit.scale}px`,
              "--img-x": `${-crop.x * fit.scale}px`,
              "--img-y": `${-crop.y * fit.scale}px`,
            }}
          />
          <PinMarker left={`${marker.x}px`} top={`${marker.y}px`} />
        </button>
      </div>
    </div>
  );
};
