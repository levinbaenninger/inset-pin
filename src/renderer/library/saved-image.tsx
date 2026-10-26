import type { SavedImage as SavedImageData } from "@shared/contracts";

import { cn } from "@/lib/utils";
import { PinMarker } from "@/shared/pin-marker";

export interface SavedImageProps {
  readonly image: SavedImageData;
  readonly pin: { readonly x: number; readonly y: number };
  readonly alt: string;
  readonly size: "thumbnail" | "full";
}

/** Every thumbnail takes the same 8:5 box, like a row that can't be shown. */
const THUMBNAIL_ASPECT = 8 / 5;

const percent = (value: number, total: number): string =>
  `${(value / total) * 100}%`;

/** A wide or tall crop sits whole in the box, and the pin goes with the image instead of the box. */
const Thumbnail = ({ alt, image, pin }: Omit<SavedImageProps, "size">) => (
  <div className="bg-muted after:ring-foreground/10 relative flex aspect-[8/5] w-20 shrink-0 items-center justify-center self-start overflow-hidden rounded-md after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:ring-1 after:ring-inset">
    <div
      className={cn(
        "relative aspect-(--image-aspect)",
        image.widthPx / image.heightPx >= THUMBNAIL_ASPECT ? "w-full" : "h-full"
      )}
      style={{ "--image-aspect": `${image.widthPx} / ${image.heightPx}` }}
    >
      <img
        alt={alt}
        className="block size-full"
        draggable={false}
        height={image.heightPx}
        src={image.url}
        width={image.widthPx}
      />
      <PinMarker
        left={percent(pin.x, image.widthPx)}
        size="sm"
        top={percent(pin.y, image.heightPx)}
      />
    </div>
  </div>
);

export const SavedImage = ({ alt, image, pin, size }: SavedImageProps) =>
  size === "thumbnail" ? (
    <Thumbnail alt={alt} image={image} pin={pin} />
  ) : (
    <div className="bg-muted after:ring-foreground/10 relative w-fit max-w-full overflow-hidden rounded-lg after:pointer-events-none after:absolute after:inset-0 after:rounded-lg after:ring-1 after:ring-inset">
      <img
        alt={alt}
        className="block h-auto w-(--natural-w) max-w-full"
        draggable={false}
        height={image.heightPx}
        src={image.url}
        style={{ "--natural-w": `${image.widthPx / image.pixelsPerDip}px` }}
        width={image.widthPx}
      />
      <PinMarker
        left={percent(pin.x, image.widthPx)}
        top={percent(pin.y, image.heightPx)}
      />
    </div>
  );
