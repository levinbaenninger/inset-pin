import type { CaptureId } from "@shared/capture-record";
import { useSyncExternalStore } from "react";

import { libraryBridge } from "@/shared/bridge";

import type { Draft } from "./draft-lifecycle";
import { DraftStore } from "./drafts";
import { createLeaveHold } from "./leave-hold";
import type { LeavePrompt } from "./leave-hold";

/** The library's one draft store: every capture's unsaved edits, whichever capture is open. */
export const drafts = new DraftStore(libraryBridge());

/** The close or quit the library holds while changes couldn't be saved. */
export const leaveHold = createLeaveHold({
  drafts,
  resume: () => {
    // The hold hears a completed save before the count reporter does.
    libraryBridge().unsavedCount(drafts.unsaved()?.count ?? 0);
    libraryBridge().resumeLeaving();
  },
  shown: () => {
    libraryBridge().leavePromptShown();
  },
});

/** This capture's draft, or undefined when it is clean. */
export const useDraft = (id: CaptureId): Draft | undefined =>
  useSyncExternalStore(drafts.subscribe, () => drafts.get(id));

/** Counts up each time this capture's changes are discarded, so its page shows what is saved again. */
export const useDiscards = (id: CaptureId): number =>
  useSyncExternalStore(drafts.subscribe, () => drafts.discards(id));

export const useLeavePrompt = (): LeavePrompt | null =>
  useSyncExternalStore(leaveHold.subscribe, leaveHold.get);
