import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";

import type { DraftError } from "./draft-lifecycle";

/** What the error says, and what its two buttons are called (SPEC round 9 for a Discard). */
const SAID: Record<
  DraftError["during"],
  {
    readonly text: (message: string) => string;
    readonly retry: string;
    readonly discard: string;
  }
> = {
  discard: {
    discard: "Discard again",
    retry: "Keep changes",
    text: (message) => `Couldn’t discard your changes. ${message}`,
  },
  save: {
    discard: "Discard changes",
    retry: "Retry",
    text: (message) => `Couldn’t save your changes. ${message}`,
  },
};

/**
 * A save that failed, or a Discard main couldn't finish: the typing stays
 * on screen until Retry (Keep changes) saves it or Discard changes (Discard
 * again) drops it. Discard works at once, even while a retry is on its way;
 * Retry waits for that retry's answer, at most the save limit. After a
 * failed Discard, Return keeps the changes whichever button has the focus
 * (SPEC round 9), and Space still presses the focused one.
 */
export const SaveFailure = ({
  error,
  onDiscard,
  onRetry,
  retrying,
}: {
  readonly error: DraftError;
  readonly onRetry: () => void;
  readonly onDiscard: () => void;
  readonly retrying: boolean;
}) => (
  <div
    className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
    data-testid="save-failure"
    // Before the focused button sees it, so Return on Discard again still keeps.
    onKeyDownCapture={(event) => {
      if (
        error.during === "discard" &&
        event.key === "Enter" &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        event.stopPropagation();

        if (!retrying) {
          onRetry();
        }
      }
    }}
    role="alert"
  >
    <HugeiconsIcon
      className="text-destructive shrink-0"
      icon={Alert02Icon}
      size={14}
    />
    <p className="text-destructive mr-auto min-w-0">
      {SAID[error.during].text(error.message)}
    </p>
    <span className="flex gap-1">
      <Button disabled={retrying} onClick={onRetry} size="xs" variant="outline">
        {SAID[error.during].retry}
      </Button>
      <Button onClick={onDiscard} size="xs" variant="destructive">
        {SAID[error.during].discard}
      </Button>
    </span>
  </div>
);
