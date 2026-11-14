import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AppStatus } from "@shared/contracts";
import { keyLabels } from "@shared/shortcuts";
import { getRouteApi, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { libraryBridge } from "@/shared/bridge";
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

/** Where the window can be found again; Windows hides new icons behind the ^ arrow at first. */
const FIND_THE_APP =
  "Reopen this window from the pin in the taskbar’s notification area, behind ^ if you can’t see it.";

const ShortcutTaken = ({ status }: { readonly status: AppStatus | null }) =>
  status?.shortcutRegistered === false ? (
    <Alert className="max-w-80 text-left">
      <HugeiconsIcon icon={Alert02Icon} />
      <AlertTitle>{KEYS.capture} is in use by another app</AlertTitle>
      <AlertDescription>
        Use “New capture in 3 seconds” instead.
      </AlertDescription>
    </Alert>
  ) : null;

/**
 * The pane when no capture is open. The app explains itself in one place,
 * Getting started at the top of the list (src/renderer/tutorial/), so this
 * only says how to start.
 */
export const Welcome = ({ hasCaptures }: { readonly hasCaptures: boolean }) => {
  const status = useStatus();

  return (
    <>
      <PaneHeader />
      <main
        className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto p-8 pb-20 text-center"
        data-testid="welcome"
      >
        <div className="flex max-w-80 flex-col gap-1.5">
          <h1 className="text-lg font-semibold text-balance">
            {hasCaptures ? "No capture open" : "No captures yet"}
          </h1>
          <p className="text-muted-foreground text-sm text-balance">
            Point at anything on screen and{" "}
            <span className="whitespace-nowrap">
              press <Kbd>{KEYS.capture}</Kbd>.
            </span>
          </p>
        </div>
        <Button
          onClick={() => {
            api.captureSoon();
          }}
          size="sm"
        >
          New capture in 3 seconds
        </Button>
        <ShortcutTaken status={status} />
        {isMac ? null : (
          <p className="text-muted-foreground/80 absolute bottom-6 max-w-80 text-xs text-balance">
            {FIND_THE_APP}
          </p>
        )}
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
    <Welcome hasCaptures={captures.length > 0} />
  ) : (
    <Navigate
      params={{ captureId: newest.id }}
      replace
      to="/captures/$captureId"
    />
  );
};
