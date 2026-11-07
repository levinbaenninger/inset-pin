import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { isMac } from "@/shared/platform";

import { SidebarToggle, useSidebar } from "./sidebar";

/**
 * The top strip of the right pane: it moves the window, and on Windows keeps
 * clear of the caption buttons drawn over its right end. With the sidebar
 * folded away it also makes room for the traffic lights and holds the button
 * that brings the sidebar back.
 */
export const PaneHeader = ({ children }: { readonly children?: ReactNode }) => {
  const { state } = useSidebar();

  return (
    <header
      className={cn(
        "app-drag caption-clear [&_button]:app-no-drag flex h-11 shrink-0 items-center gap-0.5 pl-4",
        state.collapsed && (isMac ? "pl-20" : "pl-2")
      )}
    >
      {state.collapsed ? (
        <span className="mr-2">
          <SidebarToggle />
        </span>
      ) : null}
      {children}
    </header>
  );
};
