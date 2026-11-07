import type { SavedPin } from "@shared/capture-record";
import type { SavedImage as SavedImageData } from "@shared/contracts";

import { cn } from "@/lib/utils";
import { PinMarker } from "@/shared/pin-marker";

/** Every thumbnail takes the same 8:5 box, like a row that can't be shown. */
const THUMBNAIL_ASPECT = 8 / 5;

export const percent = (value: number, total: number): string =>
  `${((value + 0.5) / total) * 100}%`;

/** A wide or tall crop sits whole in the box, and the pins go with the image instead of the box. */
export const Thumbnail = ({
  image,
  pins,
}: {
  readonly image: SavedImageData;
  readonly pins: readonly SavedPin[];
}) => (
  <div className="bg-muted after:ring-foreground/10 relative flex aspect-[8/5] w-16 shrink-0 items-center justify-center self-start overflow-hidden rounded-md after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:ring-1 after:ring-inset">
    <div
      className={cn(
        "relative aspect-(--image-aspect)",
        image.widthPx / image.heightPx >= THUMBNAIL_ASPECT ? "w-full" : "h-full"
      )}
      style={{ "--image-aspect": `${image.widthPx} / ${image.heightPx}` }}
    >
      <img
        alt=""
        className="block size-full"
        draggable={false}
        height={image.heightPx}
        loading="lazy"
        src={image.url}
        width={image.widthPx}
      />
      {pins.map((pin, index) => (
        <PinMarker
          // Pins have no identity beyond their number.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          left={percent(pin.x, image.widthPx)}
          number={index + 1}
          size="sm"
          top={percent(pin.y, image.heightPx)}
        />
      ))}
    </div>
  </div>
);
