import "@/shared/zod-jitless";
import "@/styles.css";
import type { OnboardingView } from "@shared/onboarding";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { onboardingBridge } from "@/shared/bridge";
import { markPlatform } from "@/shared/platform";
import { followSystemTheme } from "@/shared/theme";
import { usePushedView } from "@/shared/use-pushed-view";

import { OnboardingFlow } from "./onboarding-flow";
import type { OnboardingActions } from "./onboarding-flow";

followSystemTheme();

markPlatform();

const api = onboardingBridge();

/** Inset Context Pin's contract as the flow's plain actions. */
const actions: OnboardingActions = {
  allow: (id) => {
    api.allow(id);
  },
  back: () => {
    api.back();
  },
  finish: (how) => {
    api.finish(how);
  },
  fitHeight: (height) => {
    api.fitHeight(height);
  },
  next: () => {
    api.next();
  },
  reopen: () => {
    api.reopen();
  },
  skip: () => {
    api.skip();
  },
  startDrag: () => {
    api.startDrag();
  },
};

const load = async (): Promise<OnboardingView> => await api.getView();

const subscribe = (listener: (view: OnboardingView | null) => void) =>
  api.on("view", listener);

const App = () => {
  const view = usePushedView<OnboardingView | null>(load, subscribe, null);

  // data-material: on macOS the window's translucent material shows through, as in Settings.
  return view === null ? null : (
    <div className="contents" data-material>
      <OnboardingFlow
        actions={actions}
        title="Inset Context Pin Setup"
        view={view}
      />
    </div>
  );
};

const root = document.querySelector("#root");

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
