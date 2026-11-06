/** Where typed keys belong to a field, not to the window's shortcuts. */
export const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

/** A dialog, an open menu or a picker handles its own keys. */
export const inLayer = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest(
    '[role="dialog"], [role="alertdialog"], [role="menu"], [data-slot="popover-content"]'
  ) !== null;

/** A layer is open somewhere in the window, even when the focus is not in it. */
export const layerOpen = (): boolean =>
  document.querySelector(
    '[role="dialog"], [role="alertdialog"], [role="menu"], [data-slot="popover-content"]'
  ) !== null;

/** A prompt (an alert dialog) is open: it owns the keys, so no field opens or changes under it (SPEC round 8). */
export const promptOpen = (): boolean =>
  document.querySelector('[role="alertdialog"]') !== null;
