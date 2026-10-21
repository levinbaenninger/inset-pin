import type { CaptureView } from "@shared/contracts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { captureBridge } from "@/shared/bridge";

import { DraftEditor } from "./draft-editor";
import { ProblemPanel } from "./problem-panel";

const api = captureBridge();

/** Main pushes every view change; the first view is fetched once at load. */
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

/**
 * Reports the content height for each shown surface and on every resize.
 * Main reveals the panel on the report for the surface it is about to show,
 * so the panel opens at its final size.
 */
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

  // Keyed by surface key: every show mounts fresh from main's latest content and focuses the thought.
  return (
    <main className="bg-background text-foreground" ref={ref}>
      {view.kind === "draft" ? (
        <DraftEditor key={view.surfaceKey} view={view} />
      ) : null}
      {view.kind === "problem" ? (
        <ProblemPanel key={view.surfaceKey} problem={view.problem} />
      ) : null}
    </main>
  );
};
