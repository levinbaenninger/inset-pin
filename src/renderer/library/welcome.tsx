import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AppStatus } from "@shared/contracts";
import type { IconPlace } from "@shared/settings";
import { shortcutLabel } from "@shared/shortcut";
import { useEffect, useState } from "react";

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

const MAC_PLACES: Record<IconPlace, string> = {
  dock: "the Dock",
  dockAndMenuBar: "the Dock or the pin in the menu bar",
  menuBar: "the pin in the menu bar",
};

/** Where the window can be found again; Windows hides new icons behind the ^ arrow at first. */
const findTheApp = (iconIn: IconPlace): string =>
  isMac
    ? `Reopen this window from ${MAC_PLACES[iconIn]}.`
    : "Reopen this window from the pin in the taskbar’s notification area, behind ^ if you can’t see it.";

/**
 * The library before the first capture. It opens at launch, so a new
 * participant sees how to capture and where the app lives; the first
 * capture replaces it.
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
            Point at anything on your screen, press <Kbd>{shortcut}</Kbd> and
            note what matters. Try it on this line.
          </p>
        </div>
        {status?.shortcutRegistered === false ? (
          <Alert>
            <HugeiconsIcon icon={Alert02Icon} />
            <AlertTitle>{shortcut} is in use by another app</AlertTitle>
            <AlertDescription>
              Use “New capture in 3 seconds” from the pin icon instead.
            </AlertDescription>
          </Alert>
        ) : null}
        <p className="text-muted-foreground border-t pt-4 text-xs leading-relaxed">
          Captures appear here. {findTheApp(status?.iconIn ?? "dockAndMenuBar")}
        </p>
      </div>
    </div>
  );
};
