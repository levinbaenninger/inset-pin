import "react";

declare module "react" {
  // Dynamic values reach Tailwind classes through CSS custom properties, e.g. left-(--pin-x).
  interface CSSProperties {
    readonly [variable: `--${string}`]: string | number | undefined;
  }
}
