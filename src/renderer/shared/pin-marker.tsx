import { cn } from "@/lib/utils";

export interface PinMarkerProps {
  /** Position inside the positioned parent, as CSS lengths. */
  readonly left: string;
  readonly top: string;
  readonly size?: "sm" | "md";
}

/** The pin drawn over a crop: the spatial half of the thought. */
export const PinMarker = ({ left, size = "md", top }: PinMarkerProps) => (
  <span
    aria-hidden="true"
    className={cn(
      "bg-primary pointer-events-none absolute top-(--pin-y) left-(--pin-x) -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md ring-1 ring-black/50",
      size === "md" ? "size-4" : "size-2.5"
    )}
    style={{ "--pin-x": left, "--pin-y": top }}
  />
);
