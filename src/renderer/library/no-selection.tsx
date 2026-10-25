import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { visibleIds } from "./list-model";
import { useListQuery } from "./list-query";

const rootRoute = getRouteApi("__root__");

const TWO_PANES = "(min-width: 48rem)";

/** With two panes, the library opens on the newest capture the list shows: it is usually the one to hand off. */
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

/** The right pane before a capture is chosen; hidden in the one-pane layout. Without captures the welcome shows instead. */
export const NoSelection = () => {
  const captures = rootRoute.useLoaderData();
  const { query } = useListQuery();

  useOpenNewest(visibleIds(captures, query)[0]);

  return (
    <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-sm">
      <p className="max-w-xs text-center text-balance">No capture selected</p>
    </div>
  );
};
