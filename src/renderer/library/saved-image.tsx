import type { SavedImage as SavedImageData } from "@shared/contracts";

import { cn } from "@/lib/utils";
import { PinMarker } from "@/shared/pin-marker";

export interface SavedImageProps {
  readonly image: SavedImageData;
  readonly pin: { readonly x: number; readonly y: number };
  readonly alt: string;
  readonly size: "thumbnail" | "full";
}

const percent = (value: number, total: number): string =>
  `${(value / total) * 100}%`;

export const SavedImage = ({ alt, image, pin, size }: SavedImageProps) => (
  <div
    className={cn(
      "bg-muted after:ring-foreground/10 relative overflow-hidden rounded-lg after:pointer-events-none after:absolute after:inset-0 after:ring-1 after:ring-inset",
      size === "thumbnail"
        ? "w-20 shrink-0 rounded-md after:rounded-md"
        : "w-fit max-w-full after:rounded-lg"
    )}
  >
    <img
      alt={alt}
      className={cn(
        "block h-auto",
        size === "thumbnail" ? "w-full" : "w-(--natural-w) max-w-full"
      )}
      draggable={false}
      height={image.heightPx}
      src={image.url}
      style={{ "--natural-w": `${image.widthPx / image.pixelsPerDip}px` }}
      width={image.widthPx}
    />
    <PinMarker
      left={percent(pin.x, image.widthPx)}
      size={size === "thumbnail" ? "sm" : "md"}
      top={percent(pin.y, image.heightPx)}
    />
  </div>
);
