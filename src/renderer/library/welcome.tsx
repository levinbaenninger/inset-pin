import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AppStatus } from "@shared/contracts";
import { saveShortcutLabel, shortcutLabel } from "@shared/shortcut";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Kbd } from "@/components/ui/kbd";
import { libraryBridge } from "@/shared/bridge";
import { PinMarker } from "@/shared/pin-marker";
import { isMac } from "@/shared/platform";

const api = libraryBridge();

const useStatus = (): AppStatus | null => {
  const [status, setStatus] = useState<AppStatus | null>(null);

  useEffect(() => {
    const load = async (): Promise<void> => {
      setStatus(await api.status());
    };

    void load();
  }, []);

  return status;
};

const Step = ({
  children,
  number,
}: {
  readonly children: ReactNode;
  readonly number: number;
}) => (
  <li className="flex gap-3">
    <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums">
      {number}
    </span>
    <span className="pt-0.5">{children}</span>
  </li>
);

/** Where the pin icon lives; Windows hides new icons behind the ^ arrow at first. */
const findTheApp = isMac
  ? "Open this window again from the pin in the menu bar."
  : "Open this window again from the pin in the notification area of the taskbar. If you can’t see it, click ^ next to the clock.";

/**
 * The library before the first capture. It opens at launch, so a new
 * participant sees how to capture and where the app lives, and the first
 * capture appears right here.
 */
export const Welcome = () => {
  const status = useStatus();
  const shortcut = shortcutLabel(isMac);

  return (
    <div className="flex min-h-full items-center justify-center px-8 py-10">
      <div className="flex max-w-md flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div
            aria-hidden="true"
            className="bg-muted relative mb-2 h-16 w-28 overflow-hidden rounded-lg"
          >
            <div className="bg-foreground/15 absolute top-4 left-3 h-1.5 w-16 rounded-full" />
            <div className="bg-foreground/15 absolute top-8 left-3 h-1.5 w-20 rounded-full" />
            <div className="bg-foreground/15 absolute top-12 left-3 h-1.5 w-10 rounded-full" />
            <PinMarker left="72%" top="58%" />
          </div>
          <h1 className="text-xl font-semibold text-balance">
            Inset Context Pin is running
          </h1>
          <p className="text-muted-foreground text-balance">
            Point at a detail on your screen and write down what matters about
            it. Inset keeps a cropped picture with a pin on that spot.
          </p>
        </div>
        {status?.shortcutRegistered === false ? (
          <Alert>
            <HugeiconsIcon icon={Alert02Icon} />
            <AlertTitle>{shortcut} is in use by another app</AlertTitle>
            <AlertDescription>
              Choose “New capture in 3 seconds” from the pin icon instead, then
              move the pointer over your detail.
            </AlertDescription>
          </Alert>
        ) : null}
        <ol className="flex flex-col gap-3 text-sm">
          <Step number={1}>Move the pointer over the detail, in any app.</Step>
          <Step number={2}>
            Press <Kbd>{shortcut}</Kbd>. A small panel opens beside the pointer.
          </Step>
          <Step number={3}>
            Type what matters and press <Kbd>{saveShortcutLabel(isMac)}</Kbd>.
          </Step>
        </ol>
        <p className="text-sm">
          Try it here: point at this sentence and press <Kbd>{shortcut}</Kbd>.
        </p>
        <p className="text-muted-foreground border-t pt-4 text-xs leading-relaxed">
          Your captures appear in this window. {findTheApp}
        </p>
      </div>
    </div>
  );
};
