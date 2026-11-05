import { PIN_HEAD_OFFSET_DIP, pinSprite } from "@shared/pin-sprite";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** Thumbnails show a smaller pin, pin lists an 18 px one as the Shelf's do; the panel, library and floating window the full one. */
const SIZE_FACTOR = { legend: 0.82, md: 1, sm: 0.6 } as const;

export type PinSize = keyof typeof SIZE_FACTOR;

/** Follows the window's scale, so a pin is sharp on every display and after moving the window. */
const useDevicePixelRatio = (): number => {
  const [ratio, setRatio] = useState(() => window.devicePixelRatio || 1);

  useEffect(() => {
    const media = window.matchMedia(`(resolution: ${ratio}dppx)`);

    const update = (): void => {
      setRatio(window.devicePixelRatio || 1);
    };

    media.addEventListener("change", update);

    return () => {
      media.removeEventListener("change", update);
    };
  }, [ratio]);

  return ratio;
};

export interface PinMarkerProps {
  /** 1-based; the number drawn in the head. */
  readonly number: number;
  /** Where the tip sits, as any CSS length (pixels or a percentage of the image). */
  readonly left: string;
  readonly top: string;
  readonly size?: PinSize;
  readonly selected?: boolean;
  /** A pin being dragged lifts slightly. */
  readonly lifted?: boolean;
}

/**
 * A numbered map pin whose tip sits on the point. It is drawn from the same
 * sprite as copied and dragged images (src/shared/pin-sprite.ts), so the
 * screen and every export show one mark.
 */
/** The numbered sprite on a canvas at the display's density. */
const useSprite = (number: number, factor: number) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ratio = useDevicePixelRatio();
  const sprite = pinSprite(number, ratio * factor);

  useEffect(() => {
    const context = canvas.current?.getContext("2d");

    context?.putImageData(
      new ImageData(new Uint8ClampedArray(sprite.data), sprite.width),
      0,
      0
    );
  }, [sprite]);

  return { canvas, ratio, sprite };
};

/** A pin on its own, in a list of pins: the same teardrop and number as on the image. */
export const PinBadge = ({ number }: { readonly number: number }) => {
  const { canvas, ratio, sprite } = useSprite(number, SIZE_FACTOR.legend);

  return (
    <canvas
      aria-hidden="true"
      className="block h-(--sprite-h) w-(--sprite-w) max-w-none shrink-0"
      height={sprite.height}
      ref={canvas}
      style={{
        "--sprite-h": `${sprite.height / ratio}px`,
        "--sprite-w": `${sprite.width / ratio}px`,
      }}
      width={sprite.width}
    />
  );
};

export const PinMarker = ({
  left,
  lifted = false,
  number,
  selected = false,
  size = "md",
  top,
}: PinMarkerProps) => {
  const factor = SIZE_FACTOR[size];
  const { canvas, ratio, sprite } = useSprite(number, factor);

  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute top-(--pin-y) left-(--pin-x) z-10"
      data-pin={number}
      style={{ "--pin-x": left, "--pin-y": top }}
    >
      {selected ? (
        <span
          className="pin-selection"
          style={{ "--pin-head": `${-PIN_HEAD_OFFSET_DIP * factor}px` }}
        />
      ) : null}
      <canvas
        className={cn(
          "absolute top-(--sprite-y) left-(--sprite-x) block h-(--sprite-h) w-(--sprite-w) max-w-none transition-transform duration-100",
          lifted && "-translate-y-0.5"
        )}
        height={sprite.height}
        ref={canvas}
        style={{
          "--sprite-h": `${sprite.height / ratio}px`,
          "--sprite-w": `${sprite.width / ratio}px`,
          "--sprite-x": `${-(sprite.tipX + 0.5) / ratio}px`,
          "--sprite-y": `${-(sprite.tipY + 0.5) / ratio}px`,
        }}
        width={sprite.width}
      />
    </span>
  );
};

/** Where a pin's head is drawn, above its tip, in CSS pixels; pointer hits aim there. */
export const pinHeadOffset = (size: PinSize = "md"): number =>
  PIN_HEAD_OFFSET_DIP * SIZE_FACTOR[size];
