import { appendFileSync } from "node:fs";

import { BrowserWindow } from "electron";
import type { Rectangle } from "electron";

export type E2eEvent =
  | "launch"
  | "capture"
  | "panelShown"
  | "panelHidden"
  | "saved"
  | "saveFailed"
  | "discarded"
  | "libraryOpened";

export interface E2eDetails {
  readonly bounds?: Rectangle;
  readonly draftId?: string;
}

const logFile = process.env.INSET_E2E_LOG;

/** Test hook: with INSET_E2E_LOG set, appends one JSON line per lifecycle event. */
export const e2eLog = (event: E2eEvent, details: E2eDetails = {}): void => {
  if (logFile === undefined || logFile === "") {
    return;
  }

  const windows = BrowserWindow.getAllWindows().filter((window) =>
    window.isVisible()
  ).length;

  appendFileSync(
    logFile,
    `${JSON.stringify({ event, t: Date.now(), ...details, windows })}\n`
  );
};
