import { shortcutLabel } from "@shared/shortcut";

import type { TrayState } from "./draft";

export type TrayAction =
  | "showDraft"
  | "captureAfterDelay"
  | "openLibrary"
  | "quit";

export type TrayItem =
  | { readonly kind: "separator" }
  | {
      readonly kind: "item";
      readonly label: string;
      readonly enabled: boolean;
      readonly action: TrayAction | null;
    };

export interface TrayModel {
  readonly draft: TrayState;
  readonly shortcutRegistered: boolean;
  readonly countdownPending: boolean;
  readonly isMac: boolean;
}

const SEPARATOR: TrayItem = { kind: "separator" };

const draftItems = (draft: TrayState): readonly TrayItem[] => {
  if (draft === "hidden" || draft === "shown") {
    return [
      {
        action: "showDraft",
        enabled: true,
        kind: "item",
        label: "Show unsaved draft",
      },
    ];
  }

  if (draft === "saveFailed") {
    return [
      {
        action: "showDraft",
        enabled: true,
        kind: "item",
        label: "Show unsaved draft (save failed)",
      },
    ];
  }

  return [];
};

export const trayMenu = (model: TrayModel): readonly TrayItem[] => {
  const shortcut = shortcutLabel(model.isMac);
  const canCapture = model.draft === "none" && !model.countdownPending;

  return [
    ...draftItems(model.draft),
    {
      action: "captureAfterDelay",
      enabled: canCapture,
      kind: "item",
      label: model.countdownPending
        ? "Capturing in 3 seconds…"
        : "New capture in 3 seconds",
    },
    {
      action: null,
      enabled: false,
      kind: "item",
      label: model.shortcutRegistered
        ? `Capture under pointer: ${shortcut}`
        : `${shortcut} is in use by another app`,
    },
    SEPARATOR,
    {
      action: "openLibrary",
      enabled: true,
      kind: "item",
      label: "Recent captures…",
    },
    SEPARATOR,
    {
      action: "quit",
      enabled: true,
      kind: "item",
      label: "Quit Inset Context Pin",
    },
  ];
};
