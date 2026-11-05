import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  Search01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { CaptureId } from "@shared/capture-record";
import { CaptureIdSchema } from "@shared/capture-record";
import { isEmptyQuery } from "@shared/search";
import {
  captureKeyAction,
  fieldKeyAction,
  keyLabels,
  libraryShortcuts,
} from "@shared/shortcuts";
import {
  getRouteApi,
  Outlet,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useEffect, useEffectEvent, useMemo } from "react";
import { flushSync } from "react-dom";

import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { libraryBridge } from "@/shared/bridge";
import { IconButton, SHORTCUTS_ICON } from "@/shared/icon-button";
import { inLayer, isTextField } from "@/shared/key-targets";
import { isMac } from "@/shared/platform";
import { ShortcutSheet } from "@/shared/shortcut-sheet";

import { onCommand } from "./command-bus";
import { useLibraryState } from "./library-state";
import type { ListKind } from "./list-model";
import {
  groupByDay,
  isShown,
  listOf,
  listOrder,
  stepSelection,
} from "./list-model";
import { Groups, SearchField } from "./recent-list";
import { ResizeHandle, SidebarToggle, useSidebar } from "./sidebar";

const api = libraryBridge();
const rootRoute = getRouteApi("__root__");
const KEYS = keyLabels(isMac);

const ROW =
  "hover:bg-foreground/5 focus-visible:ring-ring/50 flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:ring-3";

/** What the sidebar shows when its list is empty, or the search finds nothing. */
const EmptyList = ({
  elsewhere,
  list,
  total,
}: {
  readonly list: ListKind;
  readonly total: number;
  /** Matches the search finds in the other list. */
  readonly elsewhere: number;
}) => {
  const { query, searchRef, setList, setQuery } = useLibraryState();

  if (query.trim() !== "") {
    return (
      <div
        className="flex flex-col items-center gap-2 px-3 py-8 text-center"
        data-testid="search-empty"
      >
        <span className="bg-muted text-muted-foreground grid size-9 place-items-center rounded-full">
          <HugeiconsIcon icon={Search01Icon} size={16} />
        </span>
        <p className="text-sm font-medium">No matches</p>
        <p className="text-muted-foreground text-xs text-balance">
          Nothing {list === "done" ? "in Done " : ""}matches “{query.trim()}”.
          Search looks in titles, descriptions, steps and pin labels.
        </p>
        <div className="flex flex-col items-center gap-1 pt-1">
          <Button
            onClick={() => {
              setQuery("");
              searchRef.current?.focus();
            }}
            size="sm"
            variant="outline"
          >
            Clear search
          </Button>
          {elsewhere > 0 ? (
            <Button
              onClick={() => {
                setList(list === "done" ? "active" : "done");
              }}
              size="sm"
              variant="link"
            >
              {elsewhere} {list === "done" ? "in the list" : "in Done"}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const activeText =
    total > 0
      ? "All done. Every capture is in Done."
      : `No captures yet. Point at something and press ${KEYS.capture}.`;

  const text =
    list === "done"
      ? "Nothing done yet. Mark a capture as done to keep it here, out of the list."
      : activeText;

  return (
    <p
      className="text-muted-foreground px-3 py-8 text-center text-xs text-balance"
      data-testid="list-empty"
    >
      {text}
    </p>
  );
};

/** ↑ and ↓ move through the list, ⌘F searches, ⌘/ lists every key; from anywhere but a field. */
const useLibraryKeys = (
  ids: readonly CaptureId[],
  selected: CaptureId | null
): void => {
  const navigate = useNavigate();
  const { searchRef, setSheetOpen, sheetOpen } = useLibraryState();
  const { show } = useSidebar();

  const focusSearch = useEffectEvent(() => {
    // A field in a hidden sidebar can't take focus, so the sidebar shows first.
    flushSync(show);
    searchRef.current?.focus();
    searchRef.current?.select();
  });

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) {
      return;
    }

    const field = fieldKeyAction(event, isMac);

    if (field === "find") {
      event.preventDefault();
      focusSearch();

      return;
    }

    if (field === "shortcuts") {
      event.preventDefault();
      setSheetOpen(!sheetOpen);

      return;
    }

    if (isTextField(event.target) || inLayer(event.target)) {
      return;
    }

    const action = captureKeyAction(event, isMac);

    if (action !== "next" && action !== "previous") {
      return;
    }

    const next = stepSelection(ids, selected, action === "next" ? 1 : -1);

    if (next !== null) {
      event.preventDefault();
      void navigate({
        params: { captureId: next },
        to: "/captures/$captureId",
      });

      const row = document.querySelector<HTMLElement>(
        `[data-capture-id="${next}"]`
      );

      // Focus follows a row that had it, so Return acts on the capture now shown.
      if (
        document.activeElement instanceof HTMLElement &&
        document.activeElement.dataset.captureId !== undefined
      ) {
        row?.focus({ preventScroll: true });
      }

      row?.scrollIntoView({ block: "nearest" });
    }
  });

  useEffect(() => {
    const handle = (event: KeyboardEvent): void => {
      onKeyDown(event);
    };

    window.addEventListener("keydown", handle);

    const stop = onCommand((command) => {
      if (command === "find") {
        focusSearch();
      } else if (command === "shortcuts") {
        setSheetOpen(true);
      }
    });

    return () => {
      window.removeEventListener("keydown", handle);
      stop();
    };
  }, [setSheetOpen]);
};

/**
 * A Mac app's two panes, as in Window Links' Recent Captures: captures in a
 * sidebar on the window's material, grouped by day, the open capture beside
 * it. The sidebar can be resized by its edge, or folded away.
 */
export const Shell = () => {
  const captures = rootRoute.useLoaderData();
  const { captureId } = useParams({ strict: false });
  const sidebar = useSidebar();

  const { list, now, parsed, query, setList, setSheetOpen, sheetOpen } =
    useLibraryState();

  const searching = !isEmptyQuery(parsed) || query.trim() !== "";
  const ordered = useMemo(() => listOrder(captures), [captures]);

  const shown = useMemo(
    () =>
      ordered.filter((capture) =>
        isShown(capture, list, parsed, searching, now)
      ),
    [list, now, ordered, parsed, searching]
  );

  const elsewhere = useMemo(
    () =>
      searching
        ? ordered.filter((capture) =>
            isShown(
              capture,
              list === "done" ? "active" : "done",
              parsed,
              true,
              now
            )
          ).length
        : 0,
    [list, now, ordered, parsed, searching]
  );

  const inList = ordered.filter((capture) => listOf(capture) === list).length;

  const doneCount = ordered.filter(
    (capture) => listOf(capture) === "done"
  ).length;

  const groups = useMemo(() => groupByDay(shown, now), [now, shown]);
  const parsedId = CaptureIdSchema.safeParse(captureId);
  const selected = parsedId.success ? parsedId.data : null;

  useLibraryKeys(
    shown.map((capture) => capture.id),
    selected
  );

  useEffect(
    () =>
      onCommand((command) => {
        if (command === "showDone") {
          setList("done");
        }
      }),
    [setList]
  );

  return (
    <TooltipProvider delayDuration={500}>
      <div className="text-foreground flex h-svh in-data-[platform=mac]:bg-transparent">
        <aside
          aria-label="Captures"
          className="in-data-[platform=windows]:bg-muted/50 relative flex w-(--sidebar-width) shrink-0 flex-col data-[collapsed=true]:hidden"
          data-collapsed={sidebar.state.collapsed}
          data-material=""
          style={{ "--sidebar-width": `${sidebar.state.width}px` }}
        >
          <header className="app-drag [&_button]:app-no-drag flex h-11 shrink-0 items-center gap-0.5 px-2 in-data-[platform=mac]:pl-20">
            <h1 className="sr-only">Captures</h1>
            <SidebarToggle />
            <span className="flex-1" />
            <IconButton
              icon={Add01Icon}
              label="New capture in 3 seconds"
              onClick={() => {
                api.captureSoon();
              }}
            />
          </header>
          <div className="px-2.5 pb-2">
            <SearchField />
          </div>
          {searching && shown.length > 0 ? (
            <p className="text-muted-foreground px-4 pb-1 text-xs tabular-nums">
              {shown.length} of {inList} {list === "done" ? "done" : ""}
            </p>
          ) : null}
          <nav
            aria-label={list === "done" ? "Done" : "Captures"}
            className="min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto px-2 pb-3"
          >
            {list === "done" ? (
              <button
                className={cn(ROW, "mb-1")}
                data-testid="back-to-list"
                onClick={() => {
                  setList("active");
                }}
                type="button"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
                <span className="font-medium">Done</span>
                <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                  {doneCount}
                </span>
              </button>
            ) : null}
            {shown.length === 0 ? (
              <EmptyList
                elsewhere={elsewhere}
                list={list}
                total={captures.length}
              />
            ) : (
              <Groups activeId={captureId} groups={groups} />
            )}
          </nav>
          <footer className="border-foreground/5 flex shrink-0 flex-col gap-1 border-t px-2 pt-1.5 pb-2">
            {list === "active" && doneCount > 0 ? (
              <button
                className={ROW}
                data-testid="open-done"
                onClick={() => {
                  setList("done");
                }}
                type="button"
              >
                <HugeiconsIcon
                  className="text-muted-foreground"
                  icon={CheckmarkCircle02Icon}
                  size={14}
                />
                <span className="flex-1 text-left">Done</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {doneCount}
                </span>
                <HugeiconsIcon
                  className="text-muted-foreground"
                  icon={ArrowRight01Icon}
                  size={14}
                />
              </button>
            ) : null}
            <div className="flex items-center gap-0.5">
              <IconButton
                icon={Settings01Icon}
                keys={KEYS.settings}
                label="Settings"
                onClick={() => {
                  api.openSettings();
                }}
                side="top"
              />
              <IconButton
                icon={SHORTCUTS_ICON}
                keys={KEYS.shortcuts}
                label="Keyboard shortcuts"
                onClick={() => {
                  setSheetOpen(true);
                }}
                side="top"
              />
            </div>
          </footer>
          <ResizeHandle />
        </aside>
        <div
          className="bg-background border-foreground/10 in-data-[platform=mac]:dark:bg-card flex min-w-0 flex-1 flex-col border-l data-[collapsed=true]:border-l-0"
          data-collapsed={sidebar.state.collapsed}
        >
          <Outlet />
        </div>
      </div>
      <ShortcutSheet
        groups={libraryShortcuts(isMac)}
        onOpenChange={setSheetOpen}
        open={sheetOpen}
        shortcut={KEYS.shortcuts}
      />
    </TooltipProvider>
  );
};
