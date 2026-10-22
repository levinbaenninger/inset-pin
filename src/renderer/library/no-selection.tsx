import { shortcutLabel } from "@shared/shortcut";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { Kbd } from "@/components/ui/kbd";
import { isMac } from "@/shared/platform";

const rootRoute = getRouteApi("__root__");

const TWO_PANES = "(min-width: 48rem)";

/** With two panes, the library opens on the newest capture: it is usually the one to hand off. */
const useOpenNewest = (newest: string | undefined): void => {
  const navigate = useNavigate();

  useEffect(() => {
    if (newest !== undefined && window.matchMedia(TWO_PANES).matches) {
      void navigate({
        params: { captureId: newest },
        replace: true,
        to: "/captures/$captureId",
      });
    }
  }, [navigate, newest]);
};

/** The right pane before a capture is chosen; hidden in the one-pane layout. */
export const NoSelection = () => {
  const captures = rootRoute.useLoaderData();

  useOpenNewest(captures[0]?.id);

  return (
    <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-sm">
      <p className="max-w-xs text-center text-balance">
        {captures.length === 0 ? (
          <>
            Press <Kbd>{shortcutLabel(isMac)}</Kbd> over a detail in any app to
            make your first capture.
          </>
        ) : (
          "Choose a capture to read it, copy it, or drag its image into another app."
        )}
      </p>
    </div>
  );
};
