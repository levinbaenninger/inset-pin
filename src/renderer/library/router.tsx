import { CaptureIdSchema } from "@shared/capture-record";
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  getRouteApi,
  Outlet,
  useMatchRoute,
} from "@tanstack/react-router";

import { cn } from "@/lib/utils";
import { libraryBridge } from "@/shared/bridge";

import { CapturePage } from "./capture-page";
import { NoSelection } from "./no-selection";
import { RecentList } from "./recent-list";
import { Welcome } from "./welcome";

const api = libraryBridge();

const rootApi = getRouteApi("__root__");

/** Holds Windows' caption buttons and moves the window; no height on macOS. */
const TitleBarStrip = () => (
  <div aria-hidden className="app-drag h-(--titlebar-height) shrink-0" />
);

/** Two panes when the window is wide; below md, the list and a capture each take the whole window. */
const RootLayout = () => {
  const matchRoute = useMatchRoute();
  const showingCapture = matchRoute({ to: "/captures/$captureId" }) !== false;
  const captures = rootApi.useLoaderData();

  if (captures.length === 0) {
    return (
      <div className="bg-background text-foreground flex h-svh flex-col">
        <TitleBarStrip />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Welcome />
        </main>
      </div>
    );
  }

  return (
    <div className="bg-background text-foreground grid h-svh md:grid-cols-[minmax(17rem,22rem)_1fr]">
      <aside
        className={cn(
          "min-h-0 md:flex md:border-r",
          showingCapture ? "hidden" : "flex"
        )}
      >
        <RecentList />
      </aside>
      <main
        className={cn(
          "min-h-0 overflow-y-auto md:block",
          showingCapture ? "block" : "hidden"
        )}
      >
        <Outlet />
      </main>
    </div>
  );
};

const rootRoute = createRootRoute({
  component: RootLayout,
  loader: async () => await api.list(),
});

const indexRoute = createRoute({
  component: NoSelection,
  getParentRoute: () => rootRoute,
  path: "/",
});

const captureRoute = createRoute({
  component: CapturePage,
  getParentRoute: () => rootRoute,
  loader: async ({ params }) => {
    const id = CaptureIdSchema.safeParse(params.captureId);

    return id.success ? await api.get(id.data) : null;
  },
  path: "/captures/$captureId",
});

export const router = createRouter({
  history: createHashHistory(),
  routeTree: rootRoute.addChildren([indexRoute, captureRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
