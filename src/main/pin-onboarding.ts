import type { HandOff } from "@shared/onboarding";
import { shortcutLabel } from "@shared/shortcut";

import type { PermissionEntry } from "./permissions/onboarding";

/**
 * Inset Context Pin's words for the permission onboarding
 * (src/main/permissions/): what it is, what it asks for and why, and how
 * Done hands over. Another app passes its own. The setup runs on macOS
 * only, so the key is a Mac's.
 */
const capture = shortcutLabel(true);

export const PIN_TAGLINE = "Point at a place instead of describing it.";

export const PIN_HANDOFF: HandOff = {
  later: `Without screen access ${capture} can’t capture anything. Set Up Permissions… in the Inset Context Pin menu or the pin icon’s menu asks again.`,
  ready:
    "Inset Context Pin is ready. A short Getting started list in the library shows the rest.",
  showAround: "Show Me Around",
  start: "Start Using",
};

/** What Inset Context Pin asks for, why, and what it turns on. */
export const PIN_PERMISSIONS: readonly PermissionEntry[] = [
  {
    features: [capture],
    id: "screen",
    purpose: `Lets ${capture} capture the spot you point at. Only the crop you save is kept.`,
  },
];

/** The macOS major version, for list names macOS 27 changed. */
export const osMajor = (version: string): number => {
  const major = Math.trunc(Number(version.split(".")[0] ?? ""));

  return Number.isFinite(major) ? major : 0;
};
