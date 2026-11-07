import { CaptureIdSchema } from "@shared/capture-record";
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { libraryBridge } from "@/shared/bridge";

import { CapturePage } from "./capture-page";
import { LeavePrompt } from "./leave-prompt";
import { LibraryStateProvider } from "./library-state";
import { NoticeProvider } from "./notice";
import { Shell } from "./shell";
import { SidebarProvider } from "./sidebar";
import { Newest } from "./welcome";

const api = libraryBridge();

const RootLayout = () => (
  <LibraryStateProvider>
    <SidebarProvider>
      <NoticeProvider>
        <Shell />
        <LeavePrompt />
      </NoticeProvider>
    </SidebarProvider>
  </LibraryStateProvider>
);

const rootRoute = createRootRoute({
  component: RootLayout,
  loader: async () => await api.list(),
});

const indexRoute = createRoute({
  component: Newest,
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
  // invalidate() resolves only once the lists are fresh, so after an edit or a delete nothing stale shows.
  defaultStaleReloadMode: "blocking",
  history: createHashHistory(),
  routeTree: rootRoute.addChildren([indexRoute, captureRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
