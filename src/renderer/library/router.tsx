import { CaptureIdSchema } from "@shared/capture-record";
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";

import { libraryBridge } from "@/shared/bridge";

import { CapturePage } from "./capture-page";
import { RecentList } from "./recent-list";

const api = libraryBridge();

const RootLayout = () => (
  <div className="bg-background text-foreground min-h-svh">
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
      <h1 className="font-heading text-2xl font-semibold">Recent captures</h1>
      <Outlet />
    </main>
  </div>
);

const rootRoute = createRootRoute({ component: RootLayout });

const recentRoute = createRoute({
  component: RecentList,
  getParentRoute: () => rootRoute,
  loader: async () => await api.list(),
  path: "/",
});

const captureRoute = createRoute({
  component: CapturePage,
  getParentRoute: () => rootRoute,
  // The URL carries only the id; anything that is not a capture id is a missing record.
  loader: async ({ params }) => {
    const id = CaptureIdSchema.safeParse(params.captureId);

    return id.success ? await api.get(id.data) : null;
  },
  path: "/captures/$captureId",
});

export const router = createRouter({
  history: createHashHistory(),
  routeTree: rootRoute.addChildren([recentRoute, captureRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
