import type { Leaving } from "@shared/contracts";
import { useEffect, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

import type { LeavePrompt as Prompt } from "./leave-hold";
import { leaveHold, useLeavePrompt } from "./library-drafts";

const DISCARD: Record<Leaving, string> = {
  close: "Discard and close",
  quit: "Discard and quit",
  restart: "Discard and quit",
};

const ANYWAY: Record<Leaving, string> = {
  close: "Close anyway",
  quit: "Quit anyway",
  restart: "Quit anyway",
};

/** The title and the two answers: the default one (Return) and the other. */
const wordsOf = ({ asks, count, leaving }: Prompt) => {
  const changes = count === 1 ? "1 change" : `${String(count)} changes`;

  if (asks === "keep") {
    return {
      discard: "Discard again",
      retry: "Keep changes",
      title: `${changes} couldn’t be discarded`,
    };
  }

  if (asks === "wait") {
    return {
      discard: ANYWAY[leaving],
      retry: "Wait",
      title: `${changes} ${count === 1 ? "isn’t" : "aren’t"} discarded yet`,
    };
  }

  return {
    discard: DISCARD[leaving],
    retry: "Retry",
    title: `${changes} couldn’t be saved`,
  };
};

/**
 * Asked in the library before it closes, or before the app quits, while
 * changes couldn't be saved, couldn't be discarded (Keep changes and Discard
 * again, SPEC round 9), or main hasn't answered their Discard in time (Wait
 * and Close or Quit anyway, SPEC round 10). Return takes the default answer
 * (Retry, Keep changes or Wait) whichever button has the focus, Escape
 * cancels, and Space presses the focused button, so the other answer stays a
 * deliberate choice.
 */
export const LeavePrompt = () => {
  const prompt = useLeavePrompt();
  const retryRef = useRef<HTMLButtonElement>(null);
  const returnRef = useRef<HTMLElement | null>(null);
  // The last prompt stays on screen while the dialog fades out after Cancel.
  const [shown, setShown] = useState(prompt);

  if (prompt !== null && prompt !== shown) {
    setShown(prompt);
  }

  const asks = prompt?.asks;

  // A prompt that turns into another while open, such as a Discard again main doesn't answer in time, puts the focus back on its default answer.
  useEffect(() => {
    if (asks !== undefined) {
      retryRef.current?.focus();
    }
  }, [asks]);

  const words =
    shown === null ? null : { ...wordsOf(shown), message: shown.message };

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          leaveHold.cancel();
        }
      }}
      open={prompt !== null}
    >
      {words === null ? null : (
        <AlertDialogContent
          data-testid="leave-prompt"
          // No trigger opened it, so on Cancel the focus goes back to where it was, such as the title being typed.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnRef.current?.focus();
          }}
          // Before the focused button sees it, so Return on the other answer or Cancel still takes the default one.
          onKeyDownCapture={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              leaveHold.retry();
            }
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            returnRef.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            retryRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{words.title}</AlertDialogTitle>
            <AlertDialogDescription>{words.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              onClick={() => {
                leaveHold.discard();
              }}
              variant="destructive"
            >
              {words.discard}
            </Button>
            <Button
              data-default-action=""
              onClick={() => {
                leaveHold.retry();
              }}
              ref={retryRef}
            >
              {words.retry}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
};
