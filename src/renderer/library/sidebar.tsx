import { SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { keyLabels } from "@shared/shortcuts";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { z } from "zod";

import { cn } from "@/lib/utils";
import { IconButton } from "@/shared/icon-button";
import { isMac } from "@/shared/platform";

import { onCommand } from "./command-bus";

export const SIDEBAR = { default: 300, max: 440, min: 220 } as const;

/** Dragging the edge this far left of the narrowest width folds the sidebar away. */
const COLLAPSE_BELOW = SIDEBAR.min - 60;
const KEY_STEP = 16;
const STORAGE_KEY = "inset.sidebar";

const SidebarStateSchema = z.object({
  collapsed: z.boolean(),
  width: z.number().min(SIDEBAR.min).max(SIDEBAR.max),
});

export type SidebarState = z.infer<typeof SidebarStateSchema>;

const initial: SidebarState = { collapsed: false, width: SIDEBAR.default };

const clampWidth = (width: number): number =>
  Math.round(Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, width)));

/** The width and fold the window had last time; anything unreadable starts from the default. */
const load = (): SidebarState => {
  try {
    const parsed = SidebarStateSchema.safeParse(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")
    );

    return parsed.success ? parsed.data : initial;
  } catch {
    return initial;
  }
};

interface SidebarControl {
  readonly state: SidebarState;
  readonly toggle: () => void;
  /** Brings a hidden sidebar back at its kept width. */
  readonly show: () => void;
  /** `kept` is the width the sidebar comes back at if this width folds it away. */
  readonly resize: (width: number, kept?: number) => void;
}

const SidebarContext = createContext<SidebarControl | null>(null);

export const useSidebar = (): SidebarControl => {
  const control = use(SidebarContext);

  if (control === null) {
    throw new Error("useSidebar needs a SidebarProvider above it");
  }

  return control;
};

/** ⌃⌘S on macOS, as in Finder and Mail; Ctrl+B on Windows, as in Window Links. */
const isToggleKey = (event: globalThis.KeyboardEvent): boolean =>
  isMac
    ? event.ctrlKey &&
      event.metaKey &&
      !event.altKey &&
      event.key.toLowerCase() === "s"
    : event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "b";

export const SidebarProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const [state, setState] = useState(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // A blocked storage only loses the width for next time.
    }
  }, [state]);

  const toggle = useCallback(() => {
    setState((current) => ({ ...current, collapsed: !current.collapsed }));
  }, []);

  const show = useCallback(() => {
    setState((current) => ({ ...current, collapsed: false }));
  }, []);

  const resize = useCallback((width: number, kept?: number) => {
    setState((current) =>
      width < COLLAPSE_BELOW
        ? { collapsed: true, width: kept ?? current.width }
        : { collapsed: false, width: clampWidth(width) }
    );
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isToggleKey(event)) {
        event.preventDefault();
        toggle();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    const stop = onCommand((command) => {
      if (command === "toggleSidebar") {
        toggle();
      }
    });

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      stop();
    };
  }, [toggle]);

  const control = useMemo(
    () => ({ resize, show, state, toggle }),
    [resize, show, state, toggle]
  );

  return <SidebarContext value={control}>{children}</SidebarContext>;
};

export const SidebarToggle = () => {
  const { state, toggle } = useSidebar();

  return (
    <IconButton
      icon={SidebarLeftIcon}
      keys={keyLabels(isMac).sidebar}
      label={state.collapsed ? "Show sidebar" : "Hide sidebar"}
      onClick={toggle}
    />
  );
};

/**
 * The sidebar's right edge: drag to resize, double-click for the default
 * width, or focus it and use the arrow keys. Dragging far enough left folds
 * the sidebar away.
 */
export const ResizeHandle = () => {
  const { resize, state } = useSidebar();
  /** The width when the drag began: a drag that folds the sidebar away brings it back at this. */
  const [drag, setDrag] = useState<{ readonly from: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ from: state.width });
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag !== null) {
      resize(event.clientX, drag.from);
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      resize(Math.max(SIDEBAR.min, state.width - KEY_STEP));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      resize(state.width + KEY_STEP);
    }
  };

  return (
    <button
      aria-label={`Resize sidebar, ${state.width} pixels wide`}
      className={cn(
        "app-no-drag hover:bg-pin/60 focus-visible:bg-pin absolute inset-y-0 -right-1 z-10 m-0 h-full w-2 cursor-col-resize border-0 bg-transparent bg-clip-content px-0.75 transition-colors outline-none",
        drag !== null && "bg-pin"
      )}
      onDoubleClick={() => {
        resize(SIDEBAR.default);
      }}
      onKeyDown={onKeyDown}
      onPointerCancel={onPointerUp}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title="Drag to resize, double-click for the default width"
      type="button"
    />
  );
};
