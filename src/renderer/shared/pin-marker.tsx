export interface PinMarkerProps {
  readonly left: string;
  readonly top: string;
  readonly size?: "sm" | "md";
}

/** A hollow ring, so the detail under the pin stays readable; drawn the same way into copied images. */
export const PinMarker = ({ left, size = "md", top }: PinMarkerProps) => (
  <span
    aria-hidden="true"
    className="pin-marker"
    data-size={size}
    style={{ "--pin-x": left, "--pin-y": top }}
  />
);
