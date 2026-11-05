import type { CaptureId, EditableFields } from "@shared/capture-record";
import type { ActionResult } from "@shared/contracts";

import type { InlineSaver } from "./inline-saver";

const OK: ActionResult = { ok: true };

/** The saver of the capture open in the detail pane, so a command from anywhere can save its typing first. */
const savers = new Map<CaptureId, InlineSaver>();

/** While the capture is open, commands on it wait for its edits. */
export const trackEdits = (id: CaptureId, saver: InlineSaver): (() => void) => {
  savers.set(id, saver);

  return () => {
    if (savers.get(id) === saver) {
      savers.delete(id);
    }
  };
};

/** Saves what is typed into this capture and waits for main to have it; ok when it is not open. */
export const settleEdits = async (id: CaptureId): Promise<ActionResult> =>
  (await savers.get(id)?.settle()) ?? OK;

/** Every open capture's edits, before the window closes or the app quits. */
export const settleAllEdits = async (): Promise<void> => {
  await Promise.all(
    [...savers.values()].map(async (saver) => await saver.settle())
  );
};

/** The fields on screen, which a drag carries since it can't wait for a save. */
export const shownFields = (id: CaptureId): EditableFields | null =>
  savers.get(id)?.state().fields ?? null;
