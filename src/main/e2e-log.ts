import { appendFileSync } from "node:fs";

import type { Point, Rect, Size } from "@shared/geometry";
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
  | "libraryOpened"
  | "libraryClosed";

/** What the scripts need to click the panel's preview where the pointer was, so pin 1 lands on the marker. */
export interface E2ePreview {
  readonly crop: Rect<"image">;
  readonly frame: Size<"image">;
  readonly pointer: Point<"image">;
}

export interface E2eDetails {
  readonly bounds?: Rectangle;
  readonly draftId?: string;
  readonly preview?: E2ePreview;
}

const logFile = process.env.INSET_E2E_LOG;

export const e2eLog = (event: E2eEvent, details: E2eDetails = {}): void => {
  if (logFile === undefined || logFile === "") {
    return;
  }

  const windows = BrowserWindow.getAllWindows().filter((window) =>
    window.isVisible()
  ).length;

  appendFileSync(
    logFile,
    `${JSON.stringify({ event, pid: process.pid, t: Date.now(), ...details, windows })}\n`
  );
};
