import { pinKeyAction } from "@shared/shortcuts";
import type { PinKeyAction } from "@shared/shortcuts";
import { useEffect, useEffectEvent } from "react";

import { inLayer, isTextField, layerOpen } from "./key-targets";

/**
 * P, ⇧P, 1–9, and with a pin selected ⌫, the arrows and Escape, while the
 * focus is outside text fields and no menu or dialog is open. A handled key
 * is marked, so the window's other keys skip it.
 */
export const usePinKeys = ({
  enabled,
  onAction,
  pinCount,
  selected,
}: {
  readonly enabled: boolean;
  readonly pinCount: number;
  readonly selected: number | null;
  readonly onAction: (action: PinKeyAction) => void;
}): void => {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      !enabled ||
      event.defaultPrevented ||
      event.isComposing ||
      isTextField(event.target) ||
      inLayer(event.target) ||
      layerOpen()
    ) {
      return;
    }

    const action = pinKeyAction(event, { pinCount, selected });

    if (action !== null) {
      event.preventDefault();
      onAction(action);
    }
  });

  useEffect(() => {
    const handle = (event: KeyboardEvent): void => {
      onKeyDown(event);
    };

    // Capture phase, so a pin's ⌫ and arrows win over the list's and the capture's.
    window.addEventListener("keydown", handle, { capture: true });

    return () => {
      window.removeEventListener("keydown", handle, { capture: true });
    };
  }, []);
};
