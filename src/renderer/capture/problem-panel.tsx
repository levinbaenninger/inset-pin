import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { CaptureProblem } from "@shared/contracts";
import { shortcutLabel } from "@shared/shortcut";
import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { captureBridge } from "@/shared/bridge";
import { useLocalKeys } from "@/shared/keys";
import { isMac } from "@/shared/platform";

const api = captureBridge();

interface ProblemText {
  readonly title: string;
  readonly detail: string;
}

const describe = (problem: CaptureProblem): ProblemText => {
  const retry = `Point at your work and press ${shortcutLabel(isMac)} again.`;

  if (problem.kind === "displayNotMatched") {
    return {
      detail: retry,
      title: "Couldn't tell which screen is under the pointer",
    };
  }

  if (problem.kind === "failed") {
    return {
      detail: `${problem.message} ${retry}`,
      title: "The screen couldn't be captured",
    };
  }

  if (problem.status === "granted-but-empty") {
    return {
      detail:
        "macOS reports permission, but the image came back empty. Turn the setting off and on again, then reopen Inset.",
      title: "The screen image was empty",
    };
  }

  return {
    detail:
      "Inset only reads the screen when you press the shortcut, and keeps only the crop you save.",
    title: "Allow Inset to capture your screen",
  };
};

export interface ProblemPanelProps {
  readonly problem: CaptureProblem;
}

/** Screen Recording is off: the onboarding takes over at that step, in place of this panel. */
const SetUpScreen = ({
  primaryRef,
}: {
  readonly primaryRef: RefObject<HTMLButtonElement | null>;
}) => (
  <Button
    onClick={() => {
      api.setUpScreenRecording();
    }}
    ref={primaryRef}
    size="sm"
  >
    Set Up Screen Recording…
  </Button>
);

/** macOS reports the grant but sends an empty image: turning the setting off and on, then reopening, fixes it. */
const ToggleAndReopen = ({
  primaryRef,
}: {
  readonly primaryRef: RefObject<HTMLButtonElement | null>;
}) => (
  <>
    <Button
      onClick={() => {
        api.openScreenSettings();
      }}
      ref={primaryRef}
      size="sm"
      variant="outline"
    >
      Open System Settings
    </Button>
    <Button
      onClick={() => {
        api.relaunch();
      }}
      size="sm"
    >
      Quit and Reopen
    </Button>
  </>
);

/** No "Try again" here: it would sample the pointer over this panel. */
export const ProblemPanel = ({ problem }: ProblemPanelProps) => {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const { detail, title } = describe(problem);

  const permission =
    isMac && problem.kind === "screenPermission" ? problem.status : null;

  const dismiss = useCallback((): void => {
    api.dismiss();
  }, []);

  useLocalKeys({ onEscape: dismiss });

  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-3 p-3">
      <Alert>
        <HugeiconsIcon icon={AlertCircleIcon} />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{detail}</AlertDescription>
      </Alert>
      <div className="flex justify-end gap-2">
        <Button
          onClick={dismiss}
          ref={permission === null ? primaryRef : undefined}
          size="sm"
          variant="ghost"
        >
          Close
        </Button>
        {permission === "granted-but-empty" ? (
          <ToggleAndReopen primaryRef={primaryRef} />
        ) : null}
        {permission !== null && permission !== "granted-but-empty" ? (
          <SetUpScreen primaryRef={primaryRef} />
        ) : null}
      </div>
    </div>
  );
};
