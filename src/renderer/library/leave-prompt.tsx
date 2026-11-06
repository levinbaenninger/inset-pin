import type { Leaving } from "@shared/contracts";
import { useRef, useState } from "react";

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

const buttonsOf = ({
  leaving,
  undiscarded,
}: Prompt): { readonly retry: string; readonly discard: string } =>
  undiscarded
    ? { discard: "Discard again", retry: "Keep changes" }
    : { discard: DISCARD[leaving], retry: "Retry" };

const titleOf = ({ count, undiscarded }: Prompt): string => {
  const failed = undiscarded ? "discarded" : "saved";

  return count === 1
    ? `1 change couldn’t be ${failed}`
    : `${String(count)} changes couldn’t be ${failed}`;
};

/**
 * Asked in the library before it closes, or before the app quits, while
 * changes couldn't be saved, or couldn't be discarded (Keep changes and
 * Discard again, SPEC round 9). Return retries (keeps) whichever button has
 * the focus, Escape cancels, and Space presses the focused button, so
 * Discard stays a deliberate choice.
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

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          leaveHold.cancel();
        }
      }}
      open={prompt !== null}
    >
      {shown === null ? null : (
        <AlertDialogContent
          data-testid="leave-prompt"
          // No trigger opened it, so on Cancel the focus goes back to where it was, such as the title being typed.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnRef.current?.focus();
          }}
          // Before the focused button sees it, so Return on Discard or Cancel still retries.
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
            <AlertDialogTitle>{titleOf(shown)}</AlertDialogTitle>
            <AlertDialogDescription>{shown.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              onClick={() => {
                leaveHold.discard();
              }}
              variant="destructive"
            >
              {buttonsOf(shown).discard}
            </Button>
            <Button
              data-default-action=""
              onClick={() => {
                leaveHold.retry();
              }}
              ref={retryRef}
            >
              {buttonsOf(shown).retry}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
};
