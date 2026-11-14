import type { CaptureView } from "@shared/contracts";
import type { TutorialAction, TutorialView } from "@shared/tutorial";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { captureBridge } from "@/shared/bridge";
import { PageHints } from "@/tutorial/hint-layer";

import { DraftEditor } from "./draft-editor";
import { ProblemPanel } from "./problem-panel";

const api = captureBridge();

/** The tutorial's one-time hints in the panel (src/renderer/tutorial/): placing pin 1, the title. */
const tutorialSource = {
  load: async () => await api.getTutorial(),
  subscribe: (listener: (view: TutorialView) => void) =>
    api.on("tutorial", listener),
};

const actTutorial = (action: TutorialAction): void => {
  api.tutorial(action);
};

const useCaptureView = (): CaptureView => {
  const [view, setView] = useState<CaptureView>({ kind: "none" });

  useEffect(() => {
    let pushed = false;

    const unsubscribe = api.on("view", (next) => {
      pushed = true;
      setView(next);
    });

    const load = async (): Promise<void> => {
      const initial = await api.getView();

      if (!pushed) {
        setView(initial);
      }
    };

    void load();

    return unsubscribe;
  }, []);

  return view;
};

const observeHeight = (
  element: HTMLElement,
  surfaceKey: string
): (() => void) => {
  const report = (): void => {
    const height = Math.ceil(element.getBoundingClientRect().height);

    if (height > 0) {
      api.reportHeight({ height, surfaceKey });
    }
  };

  report();

  const observer = new ResizeObserver(report);

  observer.observe(element);

  return () => {
    observer.disconnect();
  };
};

/** Main reveals the panel on the report for its surface key, so the panel opens at its final size. */
const useReportedHeight = (surfaceKey: string | null) => {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;

    return element === null || surfaceKey === null
      ? undefined
      : observeHeight(element, surfaceKey);
  }, [surfaceKey]);

  return ref;
};

export const CaptureApp = () => {
  const view = useCaptureView();
  const surfaceKey = view.kind === "none" ? null : view.surfaceKey;
  const ref = useReportedHeight(surfaceKey);

  // Keyed by surface key so every show mounts fresh from main's latest content.
  return (
    <>
      <main className="capture-surface bg-background text-foreground" ref={ref}>
        {view.kind === "draft" ? (
          <DraftEditor key={view.surfaceKey} view={view} />
        ) : null}
        {view.kind === "problem" ? (
          <ProblemPanel key={view.surfaceKey} problem={view.problem} />
        ) : null}
      </main>
      {/* Outside the measured page: a bubble never changes the panel's height. */}
      <PageHints act={actTutorial} source={tutorialSource} />
    </>
  );
};
