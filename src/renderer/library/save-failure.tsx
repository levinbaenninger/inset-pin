import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";

/**
 * A save that failed: the typing stays on screen until Retry saves it or
 * Discard changes drops it. Discard works at once, even while a retry is on
 * its way; Retry waits for that retry's answer, at most the save limit.
 */
export const SaveFailure = ({
  error,
  onDiscard,
  onRetry,
  retrying,
}: {
  readonly error: string;
  readonly onRetry: () => void;
  readonly onDiscard: () => void;
  readonly retrying: boolean;
}) => (
  <div
    className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
    data-testid="save-failure"
    role="alert"
  >
    <HugeiconsIcon
      className="text-destructive shrink-0"
      icon={Alert02Icon}
      size={14}
    />
    <p className="text-destructive mr-auto min-w-0">
      Couldn’t save your changes. {error}
    </p>
    <span className="flex gap-1">
      <Button disabled={retrying} onClick={onRetry} size="xs" variant="outline">
        Retry
      </Button>
      <Button onClick={onDiscard} size="xs" variant="destructive">
        Discard changes
      </Button>
    </span>
  </div>
);
