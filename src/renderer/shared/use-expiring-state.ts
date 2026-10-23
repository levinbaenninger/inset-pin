import { useEffect, useState } from "react";

const clearAfter = (lifetimeMs: number, clear: () => void): (() => void) => {
  const timer = setTimeout(clear, lifetimeMs);

  return () => {
    clearTimeout(timer);
  };
};

/** State that falls back to null a fixed time after each change. */
export const useExpiringState = <T>(lifetimeMs: number) => {
  const [value, setValue] = useState<T | null>(null);

  useEffect(
    () =>
      value === null
        ? undefined
        : clearAfter(lifetimeMs, () => {
            setValue(null);
          }),
    [lifetimeMs, value]
  );

  return [value, setValue] as const;
};
