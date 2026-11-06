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

import { leaveHold, useLeavePrompt } from "./library-drafts";

const DISCARD: Record<Leaving, string> = {
  close: "Discard and close",
  quit: "Discard and quit",
  restart: "Discard and quit",
};

const titleOf = (count: number): string =>
  count === 1
    ? "1 change couldn’t be saved"
    : `${String(count)} changes couldn’t be saved`;

/**
 * Asked in the library before it closes, or before the app quits, while
 * changes couldn't be saved. Return retries and Escape cancels.
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
            <AlertDialogTitle>{titleOf(shown.count)}</AlertDialogTitle>
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
              {DISCARD[shown.leaving]}
            </Button>
            <Button
              onClick={() => {
                leaveHold.retry();
              }}
              ref={retryRef}
            >
              Retry
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
};
