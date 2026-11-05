import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AppStatus } from "@shared/contracts";
import type { IconPlace } from "@shared/settings";
import { keyLabels } from "@shared/shortcuts";
import { getRouteApi, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { libraryBridge } from "@/shared/bridge";
import { PinMarker } from "@/shared/pin-marker";
import { isMac } from "@/shared/platform";

import { useLibraryState } from "./library-state";
import { isShown, listOrder } from "./list-model";
import { PaneHeader } from "./pane-header";

const api = libraryBridge();
const rootRoute = getRouteApi("__root__");
const KEYS = keyLabels(isMac);

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

/** A screen with a detail and two numbered pins, as a capture would show it. */
const Illustration = () => (
  <div
    aria-hidden="true"
    className="bg-muted ring-foreground/10 relative h-24 w-44 rounded-xl ring-1 ring-inset"
  >
    <div className="bg-foreground/12 absolute top-5 left-4 h-1.5 w-20 rounded-full" />
    <div className="bg-foreground/12 absolute top-9 left-4 h-1.5 w-28 rounded-full" />
    <div className="bg-foreground/12 absolute top-13 left-4 h-1.5 w-16 rounded-full" />
    <div className="bg-foreground/12 absolute top-17 left-4 h-1.5 w-24 rounded-full" />
    <PinMarker left="70%" number={1} top="44%" />
    <PinMarker left="38%" number={2} top="78%" />
  </div>
);

/**
 * The guide, for the first run and whenever no capture is open: what to
 * press, nothing more. The keys sit on the right, as in the other Inset apps.
 */
export const Welcome = () => {
  const status = useStatus();
  const { setSheetOpen } = useLibraryState();

  const steps = [
    { keys: KEYS.capture, text: "Capture what is under the pointer" },
    { keys: "Click", text: "Place numbered pins" },
    { keys: KEYS.description, text: "Add a description" },
    { keys: KEYS.save, text: "Save" },
  ];

  return (
    <>
      <PaneHeader />
      <main
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-8 pb-20 text-center"
        data-testid="welcome"
      >
        <Illustration />
        <div className="flex max-w-80 flex-col gap-1.5">
          <h1 className="text-lg font-semibold text-balance">
            Point at it, pin it, say why
          </h1>
          <p className="text-muted-foreground text-sm text-balance">
            Move the pointer over anything on screen and press{" "}
            <Kbd>{KEYS.capture}</Kbd>. Try it on this window.
          </p>
        </div>
        <ul className="flex w-full max-w-72 flex-col gap-2.5 text-left text-sm">
          {steps.map((step) => (
            <li
              className="flex items-center justify-between gap-3"
              key={step.text}
            >
              <span className="text-muted-foreground">{step.text}</span>
              <Kbd>{step.keys}</Kbd>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              api.captureSoon();
            }}
            size="sm"
          >
            New capture in 3 seconds
          </Button>
          <Button
            onClick={() => {
              setSheetOpen(true);
            }}
            size="sm"
            variant="outline"
          >
            All shortcuts
            <Kbd>{KEYS.shortcuts}</Kbd>
          </Button>
        </div>
        {status?.shortcutRegistered === false ? (
          <Alert className="max-w-80 text-left">
            <HugeiconsIcon icon={Alert02Icon} />
            <AlertTitle>{KEYS.capture} is in use by another app</AlertTitle>
            <AlertDescription>
              Use “New capture in 3 seconds” instead.
            </AlertDescription>
          </Alert>
        ) : null}
        <p className="text-muted-foreground max-w-80 text-xs text-balance">
          {findTheApp(status?.iconIn ?? "dockAndMenuBar")}
        </p>
      </main>
    </>
  );
};

/** The library opens on the newest capture the list shows, so there is no empty pane to pick from. */
export const Newest = () => {
  const captures = rootRoute.useLoaderData();
  const { list, now, parsed, query } = useLibraryState();

  const newest = listOrder(captures).find(
    (capture) =>
      capture.kind === "ok" &&
      isShown(capture, list, parsed, query.trim() !== "", now)
  );

  return newest === undefined ? (
    <Welcome />
  ) : (
    <Navigate
      params={{ captureId: newest.id }}
      replace
      to="/captures/$captureId"
    />
  );
};
