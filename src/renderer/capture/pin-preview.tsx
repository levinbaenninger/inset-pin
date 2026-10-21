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
import { useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, RefObject } from "react";

import { Button } from "@/components/ui/button";
import { PinMarker } from "@/shared/pin-marker";

/** Panel content width (380 − 2 × 12 padding) and a compact height. */
const MAX_BOX_WIDTH = 356;
const MAX_BOX_HEIGHT = 220;
const NUDGE_FAR = 10;

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
 * The width the preview may use, which a classic scrollbar (Windows, or a
 * panel cut to the work area) can make narrower than the panel's. It only
 * shrinks within a mount: the scrollbar can appear because of the preview's
 * own height, and growing back could toggle it on and off. Every show
 * remounts, so the next one measures afresh.
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

export interface PinPreviewProps {
  readonly frame: DraftView["frame"];
  readonly geometry: PinGeometry;
  readonly disabled: boolean;
  readonly onChange: (geometry: PinGeometry) => void;
}

/**
 * The captured display, clipped to the crop, with the pin on top. Click or
 * drag places the pin; arrow keys nudge it by one DIP (Shift: ten). Widen and
 * Tighten rescale the crop around the pin, which never moves.
 */
export const PinPreview = ({
  disabled,
  frame,
  geometry,
  onChange,
}: PinPreviewProps) => {
  const { crop, pin } = geometry;
  const [boxRef, boxWidth] = useBoxWidth();
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

  return (
    <div className="flex flex-col gap-2">
      <div className="bg-muted flex justify-center rounded-lg" ref={boxRef}>
        <button
          aria-label="Pin position. Click to move the pin, or use the arrow keys (Shift moves further)."
          aria-roledescription="pin preview"
          className="focus-visible:ring-ring/50 relative h-(--box-h) w-(--box-w) cursor-crosshair touch-none overflow-hidden rounded-lg outline-none focus-visible:ring-3 disabled:cursor-default"
          disabled={disabled}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
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
      <div className="flex gap-1">
        <Button
          disabled={disabled || isWidest(crop, frame.size)}
          onClick={() => {
            rescale(WIDEN_STEP);
          }}
          size="xs"
          type="button"
          variant="outline"
        >
          <HugeiconsIcon data-icon="inline-start" icon={ArrowExpand01Icon} />
          Widen context
        </Button>
        <Button
          disabled={disabled || isTightest(crop, frame.size, frame.ppd)}
          onClick={() => {
            rescale(1 / WIDEN_STEP);
          }}
          size="xs"
          type="button"
          variant="outline"
        >
          <HugeiconsIcon data-icon="inline-start" icon={ArrowShrink01Icon} />
          Tighten
        </Button>
      </div>
    </div>
  );
};
