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
        "macOS reports permission, but the image came back empty. Turn the setting off and on again.",
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

const PermissionSteps = ({
  primaryRef,
}: {
  readonly primaryRef: RefObject<HTMLButtonElement | null>;
}) => (
  <ol className="marker:text-muted-foreground flex list-decimal flex-col gap-1.5 pl-8 text-sm">
    <li>
      <div className="flex items-center justify-between gap-3">
        <span>Open the privacy setting.</span>
        <Button
          className="shrink-0"
          onClick={() => {
            api.openScreenSettings();
          }}
          ref={primaryRef}
          size="sm"
          variant="outline"
        >
          Open System Settings
        </Button>
      </div>
    </li>
    <li className="py-1">Turn on Inset Context Pin.</li>
    <li>
      <div className="flex items-center justify-between gap-3">
        <span>Reopen Inset.</span>
        <Button
          className="shrink-0"
          onClick={() => {
            api.relaunch();
          }}
          size="sm"
        >
          Quit and Reopen
        </Button>
      </div>
    </li>
  </ol>
);

/** No "Try again" here: it would sample the pointer over this panel. */
export const ProblemPanel = ({ problem }: ProblemPanelProps) => {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const { detail, title } = describe(problem);
  const needsSettings = isMac && problem.kind === "screenPermission";

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
      {needsSettings ? <PermissionSteps primaryRef={primaryRef} /> : null}
      <div className="flex justify-end">
        <Button
          onClick={dismiss}
          ref={needsSettings ? undefined : primaryRef}
          size="sm"
          variant="ghost"
        >
          Close
        </Button>
      </div>
    </div>
  );
};
