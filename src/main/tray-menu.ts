import type { CaptureId } from "@shared/capture-record";
import { shortcutLabel } from "@shared/shortcut";

import type { TrayState } from "./draft";

export type TrayAction =
  | "showDraft"
  | "captureAfterDelay"
  | "openLibrary"
  | "openSettings"
  | "toggleLibraryOnTop"
  | "quit";

export interface RecentCapture {
  readonly id: CaptureId;
  readonly title: string;
}

/** How many captures the menus list by name. */
export const RECENT_IN_MENU = 5;

/** Menu items stay one short line. */
const TITLE_MAX = 40;

export type TrayItem =
  | { readonly kind: "separator" }
  | {
      readonly kind: "item";
      readonly label: string;
      readonly enabled: boolean;
      readonly action: TrayAction | null;
      /** A checkbox item, ticked or not. */
      readonly checked?: boolean;
    }
  /** Opens the library on this capture. */
  | {
      readonly kind: "capture";
      readonly label: string;
      readonly id: CaptureId;
    };

export interface TrayModel {
  readonly draft: TrayState;
  readonly shortcutRegistered: boolean;
  readonly countdownPending: boolean;
  readonly isMac: boolean;
  readonly libraryOpen: boolean;
  readonly libraryOnTop: boolean;
  /** Newest first; only the first RECENT_IN_MENU are listed. */
  readonly recent: readonly RecentCapture[];
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

const captureLabel = (model: TrayModel): string => {
  if (model.countdownPending) {
    return "Capturing in 3 seconds…";
  }

  return model.draft === "none"
    ? "New capture in 3 seconds"
    : "New capture: save or discard the draft first";
};

const shortTitle = (title: string): string =>
  title.length > TITLE_MAX
    ? `${title.slice(0, TITLE_MAX - 1).trimEnd()}…`
    : title;

/** Menus on both systems read a single & as the mark of an access key and drop it; && shows one. */
const literalLabel = (text: string): string => text.replaceAll("&", "&&");

const recentItems = (recent: readonly RecentCapture[]): readonly TrayItem[] =>
  recent.slice(0, RECENT_IN_MENU).map((capture) => ({
    id: capture.id,
    kind: "capture",
    label: literalLabel(shortTitle(capture.title)),
  }));

const captureItem = (model: TrayModel): TrayItem => ({
  action: "captureAfterDelay",
  enabled: model.draft === "none" && !model.countdownPending,
  kind: "item",
  label: captureLabel(model),
});

/** The Dock icon's menu on macOS, which adds its own window and Quit items below. */
export const dockMenu = (model: TrayModel): readonly TrayItem[] => {
  const recent = recentItems(model.recent);

  return [
    ...draftItems(model.draft),
    captureItem(model),
    ...(recent.length > 0 ? [SEPARATOR, ...recent] : []),
  ];
};

export const trayTooltip = (model: Pick<TrayModel, "isMac">): string =>
  `Inset Context Pin: point at a detail and press ${shortcutLabel(model.isMac)}`;

export const trayMenu = (model: TrayModel): readonly TrayItem[] => {
  const shortcut = shortcutLabel(model.isMac);

  return [
    ...draftItems(model.draft),
    captureItem(model),
    {
      action: null,
      enabled: false,
      kind: "item",
      label: model.shortcutRegistered
        ? `Capture under pointer: ${shortcut}`
        : `${shortcut} is in use by another app`,
    },
    SEPARATOR,
    ...recentItems(model.recent),
    {
      action: "openLibrary",
      enabled: true,
      kind: "item",
      label: "Recent captures…",
    },
    // macOS has it in the View menu; Windows has no app menu.
    ...(model.isMac
      ? []
      : [
          {
            action: "toggleLibraryOnTop",
            checked: model.libraryOnTop,
            enabled: model.libraryOpen,
            kind: "item",
            label: "Keep library on top",
          } as const,
        ]),
    SEPARATOR,
    {
      action: "openSettings",
      enabled: true,
      kind: "item",
      label: "Settings…",
    },
    {
      action: "quit",
      enabled: true,
      kind: "item",
      label: "Quit Inset Context Pin",
    },
  ];
};
