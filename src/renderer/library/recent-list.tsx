import {
  Alert02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  FilterHorizontalIcon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { CaptureSummary, SavedCapture } from "@shared/contracts";
import { DUE_FILTERS } from "@shared/due";
import {
  DUE_FILTER_LABELS,
  dueSuggestions,
  highlightParts,
  withDueFilter,
} from "@shared/search";
import { keyLabels, rowKeyAction } from "@shared/shortcuts";
import type { RowKeyAction } from "@shared/shortcuts";
import { Link } from "@tanstack/react-router";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { DueChip } from "@/fields/due";
import { cn } from "@/lib/utils";
import { isMac } from "@/shared/platform";

import { MenuEntries, onMenuKey, useCaptureCommands } from "./capture-commands";
import type { RowFocus } from "./capture-commands";
import { useCopyEntry } from "./copy-entry";
import { dayLabel, readOnlyText, timeOfDay } from "./format";
import { useDraft } from "./library-drafts";
import { useLibraryState } from "./library-state";
import type { CaptureGroup, ListKind } from "./list-model";
import { matchSnippet, stepProgress } from "./list-model";
import { Thumbnail } from "./saved-image";
import { useSidebar } from "./sidebar";

/** Text with the search's words marked, as cheap as a split. */
const Highlighted = ({
  terms,
  text,
}: {
  readonly text: string;
  readonly terms: readonly string[];
}) =>
  highlightParts(text, terms).map((part, index) =>
    part.match ? (
      <mark
        className="bg-pin-soft text-foreground rounded-xs"
        // Parts have no identity beyond their place.
        // oxlint-disable-next-line react/no-array-index-key
        key={index}
      >
        {part.text}
      </mark>
    ) : (
      // oxlint-disable-next-line react/no-array-index-key
      <Fragment key={index}>{part.text}</Fragment>
    )
  );

/**
 * The time and step progress, with the Due chip right-aligned, as every Inset
 * list shows it. The items run right to left and wrap out of sight below, so
 * a narrow row drops the time first, then the progress.
 */
const RowMeta = ({
  capture,
  chip,
  unsaved,
}: {
  readonly capture: SavedCapture;
  readonly chip: ReactNode;
  readonly unsaved: boolean;
}) => {
  const progress = stepProgress(capture.steps);

  return (
    <span className="text-muted-foreground flex h-4.5 min-w-0 flex-row-reverse flex-wrap items-center justify-end gap-x-2 overflow-hidden text-xs tabular-nums">
      {chip}
      {unsaved ? (
        <span
          className="text-destructive flex shrink-0 items-center gap-1"
          data-meta="unsaved"
          title="Its last changes couldn’t be saved. Open it to retry or discard them."
        >
          <HugeiconsIcon icon={Alert02Icon} size={12} />
          Not saved
        </span>
      ) : null}
      {progress === null ? null : (
        <span
          aria-label={`${progress.done} of ${progress.total} next steps done`}
          className="flex shrink-0 items-center gap-1"
          data-meta="progress"
        >
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} />
          {progress.done}/{progress.total}
        </span>
      )}
      <span className="shrink-0" data-meta="time">
        {timeOfDay(capture.capturedAt)}
      </span>
    </span>
  );
};

/**
 * Whether the Due chip fits the row's text column. The chip never shrinks or
 * drops its icon, so where it doesn't fit (the narrowest sidebar, a long
 * overdue date) the row shows it on a line of its own under the title.
 */
const useChipFits = () => {
  const columnRef = useRef<HTMLSpanElement>(null);
  const chipRef = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(true);

  // After every render: moving the chip mounts it anew, and the new one needs observing.
  useLayoutEffect(() => {
    const measure = (): void => {
      if (columnRef.current !== null && chipRef.current !== null) {
        setFits(chipRef.current.offsetWidth <= columnRef.current.clientWidth);
      }
    };

    const observer = new ResizeObserver(measure);

    for (const part of [columnRef.current, chipRef.current]) {
      if (part !== null) {
        observer.observe(part);
      }
    }

    measure();

    return () => {
      observer.disconnect();
    };
  });

  return { chipRef, columnRef, fits };
};

const ROW_SELECTOR = "[data-testid='capture-row']";

const neighbourOf = (row: HTMLElement | null): HTMLElement | null => {
  const rows = [...document.querySelectorAll<HTMLElement>(ROW_SELECTOR)];
  const at = row === null ? -1 : rows.indexOf(row);

  return at === -1 ? null : (rows[at + 1] ?? rows[at - 1] ?? null);
};

const CaptureRow = ({
  active,
  capture,
}: {
  readonly capture: SavedCapture;
  readonly active: boolean;
}) => {
  const { now, parsed } = useLibraryState();
  const rowRef = useRef<HTMLAnchorElement>(null);
  const landing = useRef<HTMLElement | null>(null);

  // The row's menu and delete dialog hand the focus back to the row, or to its neighbour once the row leaves the list.
  const focus: RowFocus = {
    land: () => {
      (landing.current ?? rowRef.current)?.focus();
      landing.current = null;
    },
    leaving: () => {
      landing.current = neighbourOf(rowRef.current);
    },
  };

  const { commands, dialog, entries } = useCaptureCommands(capture, focus);
  const unsaved = (useDraft(capture.id)?.error ?? null) !== null;

  const snippet = matchSnippet(capture, parsed.terms);
  const { chipRef, columnRef, fits } = useChipFits();

  const chip =
    capture.due === null ? null : (
      <span className="ml-auto flex shrink-0" ref={chipRef}>
        <DueChip due={capture.due} now={now} />
      </span>
    );

  // The keys its right-click menu lists act on the row in focus, which need not be the capture shown.
  const run: Record<RowKeyAction, () => void> = {
    copyDetails: commands.copyDetails,
    copyImage: commands.copyImage,
    delete: commands.askDelete,
    done: commands.toggleDone,
    float: commands.float,
  };

  useCopyEntry(capture.id, commands.copyText);

  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring/50 data-[state=open]:bg-foreground/5 block rounded-md px-2 py-2 outline-none focus-visible:ring-3",
              active
                ? "bg-foreground/10"
                : "hover:bg-foreground/5 focus:bg-foreground/5"
            )}
            data-capture-id={capture.id}
            data-testid="capture-row"
            // The menu's keys then act on this row once it closes.
            onContextMenu={(event) => {
              event.currentTarget.focus();
            }}
            onKeyDown={(event) => {
              const action = event.nativeEvent.isComposing
                ? null
                : rowKeyAction(event, isMac);

              if (action !== null) {
                event.preventDefault();

                if (event.repeat) {
                  return;
                }

                run[action]();

                // The row leaves the list, so the focus moves on and Space again does the next one.
                if (action === "done") {
                  focus.land();
                }
              }
            }}
            params={{ captureId: capture.id }}
            ref={rowRef}
            to="/captures/$captureId"
          >
            <span className="flex items-start gap-2.5">
              <Thumbnail image={capture.image} pins={capture.pins} />
              <span
                className="flex min-w-0 flex-1 flex-col gap-0.5"
                ref={columnRef}
              >
                <span
                  className={cn(
                    "line-clamp-2 text-sm leading-snug font-medium wrap-break-word",
                    capture.status.kind === "done" && "text-muted-foreground"
                  )}
                >
                  <Highlighted terms={parsed.terms} text={capture.title} />
                </span>
                {snippet === null ? null : (
                  <span className="text-muted-foreground line-clamp-1 text-xs">
                    <Highlighted terms={parsed.terms} text={snippet} />
                  </span>
                )}
                <RowMeta
                  capture={capture}
                  chip={fits ? chip : null}
                  unsaved={unsaved}
                />
              </span>
            </span>
            {fits ? null : <span className="mt-1 flex">{chip}</span>}
          </Link>
        </ContextMenuTrigger>
        <ContextMenuContent
          className="min-w-52"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focus.land();
          }}
          onKeyDownCapture={onMenuKey}
        >
          <MenuEntries entries={entries} kind="context" />
        </ContextMenuContent>
      </ContextMenu>
      {dialog}
    </li>
  );
};

const ReadOnlyRow = ({
  capture,
}: {
  readonly capture: Extract<CaptureSummary, { kind: "readOnly" }>;
}) => (
  <li className="text-muted-foreground border-foreground/15 flex items-start gap-2 rounded-lg border border-dashed px-2.5 py-2 text-xs">
    <HugeiconsIcon className="mt-px shrink-0" icon={Alert02Icon} size={13} />
    {readOnlyText(capture.why)}
  </li>
);

const groupLabel = (group: CaptureGroup, list: ListKind, now: Date): string => {
  if (group.kind === "readOnly") {
    return "Read-only";
  }

  const day = dayLabel(group.day, now);

  return list === "done"
    ? `Done ${day === "Today" || day === "Yesterday" ? day.toLowerCase() : day}`
    : day;
};

export const Groups = ({
  activeId,
  groups,
}: {
  readonly groups: readonly CaptureGroup[];
  readonly activeId: string | undefined;
}) => {
  const { list, now } = useLibraryState();

  return groups.map((group) => (
    <section
      aria-label={groupLabel(group, list, now)}
      className="flex flex-col gap-0.5"
      key={group.kind === "day" ? group.day.getTime() : "readOnly"}
    >
      <h2 className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-medium">
        {groupLabel(group, list, now)}
      </h2>
      <ul className="flex flex-col gap-0.5">
        {group.kind === "day"
          ? group.captures.map((capture) => (
              <CaptureRow
                active={capture.id === activeId}
                capture={capture}
                key={capture.id}
              />
            ))
          : group.captures.map((capture) => (
              <ReadOnlyRow capture={capture} key={capture.id} />
            ))}
      </ul>
    </section>
  ));
};

/** The due filters, from a small menu at the end of the search field. */
const FilterMenu = () => {
  const { parsed, query, searchRef, setQuery } = useLibraryState();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <InputGroupButton
          aria-label="Due filters"
          size="icon-xs"
          title="Due filters"
        >
          <HugeiconsIcon
            className={parsed.due === null ? undefined : "text-pin-ink"}
            icon={FilterHorizontalIcon}
          />
        </InputGroupButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-52"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <DropdownMenuLabel>Show captures</DropdownMenuLabel>
        {DUE_FILTERS.map((filter) => (
          <DropdownMenuItem
            key={filter}
            onSelect={() => {
              setQuery(withDueFilter(query, filter));
            }}
          >
            <HugeiconsIcon
              className={parsed.due === filter ? undefined : "invisible"}
              icon={Tick02Icon}
            />
            {DUE_FILTER_LABELS[filter]}
            <span className="text-muted-foreground ml-auto text-xs">
              due:{filter}
            </span>
          </DropdownMenuItem>
        ))}
        {parsed.due === null ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                setQuery(withDueFilter(query, null));
              }}
            >
              Clear the filter
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** While a `due:` word is typed, the filters it can become, as in every Inset search; a click or Return (the first) finishes it. */
const DueSuggestions = () => {
  const { parsed, query, searchRef, setQuery } = useLibraryState();
  const suggestions = dueSuggestions(parsed);

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <fieldset className="mt-1 flex flex-col" data-testid="due-suggestions">
      <legend className="sr-only">Due filters</legend>
      {suggestions.map((filter, index) => (
        <Button
          aria-label={`${DUE_FILTER_LABELS[filter]} (due:${filter})`}
          className="justify-between"
          key={filter}
          onClick={() => {
            setQuery(withDueFilter(query, filter));
            searchRef.current?.focus();
          }}
          size="xs"
          title={index === 0 ? "Return picks this one" : undefined}
          type="button"
          variant={index === 0 ? "secondary" : "ghost"}
        >
          due:{filter}
          <span className="text-muted-foreground truncate font-normal">
            {DUE_FILTER_LABELS[filter]}
          </span>
        </Button>
      ))}
    </fieldset>
  );
};

/** Below this sidebar width the field has no room to name the `due:` filters; the filter menu still does. */
const ROOM_FOR_HINT = 240;

export const SearchField = () => {
  const { parsed, query, searchRef, setQuery } = useLibraryState();
  const { state } = useSidebar();

  return (
    <div className="flex flex-col">
      <InputGroup brand className="app-no-drag">
        <InputGroupAddon>
          <HugeiconsIcon icon={Search01Icon} />
        </InputGroupAddon>
        <InputGroupInput
          aria-label={`Search captures (${keyLabels(isMac).find})`}
          className="[&::-webkit-search-cancel-button]:appearance-none"
          data-testid="search"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query !== "") {
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
            }

            const [first] = dueSuggestions(parsed);

            if (event.key === "Enter" && first !== undefined) {
              event.preventDefault();
              setQuery(withDueFilter(query, first));
            }
          }}
          placeholder={
            state.width < ROOM_FOR_HINT ? "Search" : "Search or due:today"
          }
          ref={searchRef}
          type="search"
          value={query}
        />
        <InputGroupAddon align="inline-end">
          {query === "" ? null : (
            <InputGroupButton
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              size="icon-xs"
            >
              <HugeiconsIcon icon={Cancel01Icon} />
            </InputGroupButton>
          )}
          <FilterMenu />
        </InputGroupAddon>
      </InputGroup>
      <DueSuggestions />
    </div>
  );
};
