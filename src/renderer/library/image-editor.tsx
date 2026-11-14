import {
  Cancel01Icon,
  Copy01Icon,
  Location01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { PIN_LABEL_MAX } from "@shared/capture-record";
import type { SavedPin } from "@shared/capture-record";
import type { SavedImage } from "@shared/contracts";
import {
  addPin,
  labelPin,
  movePin,
  pinAt,
  removePin,
  selectionAfterRemove,
} from "@shared/pins";
import { keyLabels } from "@shared/shortcuts";
import { useRef, useState } from "react";
import type { PointerEvent, RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PinBadge, PinMarker, pinHeadOffset } from "@/shared/pin-marker";
import { isMac } from "@/shared/platform";
import { coach } from "@/tutorial/anchors";

import { percent } from "./saved-image";

const CLICK_SLOP = 3;
const PIN_REACH = 11;
const KEYS = keyLabels(isMac);

/** The tallest the image gets, so the fields above it stay in view. */
const MAX_HEIGHT = "60vh";

/** What changed the pins, so the page can undo a gesture at a time and save typing later. */
export type PinChange =
  | { readonly kind: "add" }
  | { readonly kind: "remove" }
  | { readonly kind: "drag"; readonly id: number; readonly done: boolean }
  | { readonly kind: "nudge"; readonly index: number }
  | { readonly kind: "label"; readonly index: number };

interface PinGesture {
  readonly id: number;
  readonly index: number;
  /** From the press to the pin's tip, in image pixels, so the tip keeps its distance. */
  readonly grip: { readonly x: number; readonly y: number };
  readonly from: { readonly x: number; readonly y: number };
  readonly moved: boolean;
}

export interface ImageEditorProps {
  readonly image: SavedImage;
  readonly pins: readonly SavedPin[];
  readonly onChange: (pins: readonly SavedPin[], change: PinChange) => void;
  readonly selected: number | null;
  readonly onSelect: (index: number | null) => void;
  readonly pinMode: boolean;
  readonly onPinMode: (on: boolean) => void;
  readonly onDragOut: () => void;
  readonly onCopy: () => void;
  readonly onLeaveLabel: () => void;
  /** Esc in a label: what was typed since it took the focus goes. */
  readonly onCancelLabel: (index: number) => void;
  readonly pointerRef: RefObject<{
    readonly x: number;
    readonly y: number;
  } | null>;
  /** The image, which takes the focus while a pin is selected. */
  readonly imageRef: RefObject<HTMLDivElement | null>;
}

/** The pins as a numbered list under the image, each with an optional label: "1 · label". */
const PinList = ({
  onCancelLabel,
  onChange,
  onLeaveLabel,
  onSelect,
  pins,
  selected,
}: Pick<
  ImageEditorProps,
  | "pins"
  | "selected"
  | "onSelect"
  | "onChange"
  | "onLeaveLabel"
  | "onCancelLabel"
>) => (
  <ol aria-label="Pins" className="flex flex-col" data-testid="pin-list">
    {pins.map((pin, index) => (
      <li
        className={cn(
          "group flex items-center gap-2 rounded-md pr-0.5 pl-1",
          selected === index
            ? "bg-pin/8 dark:bg-pin/15"
            : "hover:bg-foreground/5"
        )}
        // Pins have no identity beyond their number.
        // oxlint-disable-next-line react/no-array-index-key
        key={index}
      >
        <span className="grid w-5 shrink-0 place-items-center">
          <PinBadge number={index + 1} />
        </span>
        <input
          aria-label={`Label for pin ${index + 1}`}
          className="placeholder:text-muted-foreground/70 h-8 min-w-0 flex-1 bg-transparent text-sm outline-none"
          maxLength={PIN_LABEL_MAX}
          onBlur={onLeaveLabel}
          onChange={(event) => {
            onChange(labelPin(pins, index, event.target.value), {
              index,
              kind: "label",
            });
          }}
          onFocus={() => {
            onSelect(index);
          }}
          // Return keeps the label and Esc takes the typing back; either way the label reads as text again.
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return;
            }

            if (event.key === "Escape" || event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();

              if (event.key === "Escape") {
                onCancelLabel(index);
              }

              event.currentTarget.blur();
            }
          }}
          placeholder="Add a label"
          value={pin.label ?? ""}
        />
        <button
          aria-label={`Remove pin ${index + 1}`}
          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 grid size-6 shrink-0 place-items-center rounded-md opacity-0 outline-none group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => {
            onChange(removePin(pins, index), { kind: "remove" });
            onSelect(selectionAfterRemove(pins.length, index));
          }}
          title={`Remove pin ${index + 1} (${KEYS.delete})`}
          type="button"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} />
        </button>
      </li>
    ))}
  </ol>
);

/**
 * The saved crop, large, with its numbered pins. In pin mode (P) a click adds
 * the next pin; a pin can always be dragged or selected, and out of pin mode
 * the image drags into other apps with every pin drawn on it.
 */
export const ImageEditor = ({
  image,
  imageRef,
  onCancelLabel,
  onChange,
  onCopy,
  onDragOut,
  onLeaveLabel,
  onPinMode,
  onSelect,
  pinMode,
  pins,
  pointerRef,
  selected,
}: ImageEditorProps) => {
  const [gesture, setGesture] = useState<PinGesture | null>(null);
  const drags = useRef(0);
  const [pressed, setPressed] = useState<{ x: number; y: number } | null>(null);
  const area = { height: image.heightPx, width: image.widthPx, x: 0, y: 0 };

  /** The pointer in image pixels, and the scale of the image on screen. */
  const locate = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = rect.width / image.widthPx;

    return {
      point: {
        x: (event.clientX - rect.left) / scale,
        y: (event.clientY - rect.top) / scale,
      },
      scale,
    };
  };

  const hit = (point: { x: number; y: number }, scale: number): number | null =>
    pinAt(
      pins.map((pin) => ({
        x: pin.x * scale,
        y: pin.y * scale - pinHeadOffset(),
      })),
      { x: point.x * scale, y: point.y * scale },
      PIN_REACH
    );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }

    const { point, scale } = locate(event);
    const index = hit(point, scale);

    event.currentTarget.focus({ preventScroll: true });

    if (index !== null) {
      const pin = pins[index];

      // No drag into other apps while a pin is held.
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      onSelect(index);
      drags.current += 1;
      setGesture({
        from: point,
        grip: { x: (pin?.x ?? 0) - point.x, y: (pin?.y ?? 0) - point.y },
        id: drags.current,
        index,
        moved: false,
      });

      return;
    }

    setPressed(point);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const { point, scale } = locate(event);

    pointerRef.current = point;

    if (gesture === null) {
      return;
    }

    const moved =
      gesture.moved ||
      Math.hypot(point.x - gesture.from.x, point.y - gesture.from.y) * scale >
        CLICK_SLOP;

    if (!moved) {
      return;
    }

    if (!gesture.moved) {
      setGesture({ ...gesture, moved: true });
    }

    onChange(
      movePin(
        pins,
        gesture.index,
        { x: point.x + gesture.grip.x, y: point.y + gesture.grip.y },
        area
      ),
      { done: false, id: gesture.id, kind: "drag" }
    );
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (gesture !== null) {
      if (gesture.moved) {
        onChange(pins, { done: true, id: gesture.id, kind: "drag" });
      }

      setGesture(null);

      return;
    }

    if (pressed !== null) {
      const { point, scale } = locate(event);

      const click =
        Math.hypot(point.x - pressed.x, point.y - pressed.y) * scale <=
        CLICK_SLOP;

      if (click && pinMode) {
        const next = addPin(pins, point, area);

        if (next !== null) {
          onChange(next, { kind: "add" });
          onSelect(next.length - 1);
        }
      } else if (click) {
        onSelect(null);
      }
    }

    setPressed(null);
  };

  const aspect = image.widthPx / image.heightPx;
  const naturalWidth = image.widthPx / image.pixelsPerDip;

  return (
    // Focus leaving the section only lets the pin go; the section takes no input itself.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      aria-label="Image"
      className="flex flex-col gap-2"
      data-pin-area=""
      // The selection lives here: once the focus leaves the image and its pin list, digits and ⌫ elsewhere leave pins alone.
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onSelect(null);
        }
      }}
    >
      <div className="flex min-h-7 items-center gap-1">
        <h2 className="text-muted-foreground mr-auto text-xs font-medium">
          {pins.length === 0
            ? "Image"
            : `Image · ${pins.length === 1 ? "1 pin" : `${pins.length} pins`}`}
        </h2>
        <p className="text-muted-foreground mr-1 hidden text-xs sm:block">
          {pinMode
            ? "Click the image to add a pin"
            : "Drag the image into any app"}
        </p>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Pin mode"
              aria-pressed={pinMode}
              data-testid="pin-tool"
              onClick={() => {
                onPinMode(!pinMode);
              }}
              size="sm"
              variant="tool"
            >
              <HugeiconsIcon data-icon="inline-start" icon={Location01Icon} />
              {pinMode ? "Adding pins" : "Add pins"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Pin mode: a click adds the next pin
            <Kbd>P</Kbd>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Copy image with pins"
              onClick={onCopy}
              {...coach("copy-image")}
              size="icon-sm"
              variant="ghost"
            >
              <HugeiconsIcon icon={Copy01Icon} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Copy image with pins
            <Kbd>{KEYS.copyImage}</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>
      {/* The image is a canvas for pins: it takes the pointer and, through usePinKeys, the keys. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        aria-label={`Saved screenshot with ${pins.length === 1 ? "1 pin" : `${pins.length} pins`}`}
        className={cn(
          "bg-muted focus-visible:ring-ring/50 relative w-(--image-w) max-w-full touch-none overflow-visible rounded-lg outline-none select-none focus-visible:ring-3",
          pinMode ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"
        )}
        data-testid="image-editor"
        {...coach("capture-image")}
        draggable={!pinMode && gesture === null}
        onDragStart={(event) => {
          event.preventDefault();

          if (gesture === null) {
            onDragOut();
          }
        }}
        onPointerCancel={() => {
          setGesture(null);
          setPressed(null);
        }}
        onPointerDown={onPointerDown}
        onPointerLeave={() => {
          pointerRef.current = null;
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        ref={imageRef}
        role="application"
        style={{
          "--image-w": `min(${naturalWidth}px, ${MAX_HEIGHT} * ${aspect})`,
        }}
        // It takes the focus so its keys reach the pins.
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        title={pinMode ? undefined : "Drag into another app"}
      >
        <img
          alt=""
          className="after:ring-foreground/10 block h-auto w-full rounded-lg"
          draggable={false}
          height={image.heightPx}
          src={image.url}
          width={image.widthPx}
        />
        <span
          aria-hidden="true"
          className="ring-foreground/10 pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset"
        />
        {pins.map((pin, index) => (
          <PinMarker
            // Pins have no identity beyond their number.
            // oxlint-disable-next-line react/no-array-index-key
            key={index}
            left={percent(pin.x, image.widthPx)}
            lifted={gesture?.moved === true && gesture.index === index}
            number={index + 1}
            selected={selected === index}
            top={percent(pin.y, image.heightPx)}
          />
        ))}
        {pinMode && pins.length === 0 ? (
          <p className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
            <span className="flex items-center gap-1.5 rounded-full bg-black/75 px-2.5 py-1 text-xs font-medium text-white shadow-sm">
              <HugeiconsIcon icon={Location01Icon} size={12} />
              Click to place pin 1
            </span>
          </p>
        ) : null}
      </div>
      {pins.length > 0 ? (
        <PinList
          onCancelLabel={onCancelLabel}
          onChange={onChange}
          onLeaveLabel={onLeaveLabel}
          onSelect={onSelect}
          pins={pins}
          selected={selected}
        />
      ) : null}
    </section>
  );
};
