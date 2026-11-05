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
import {
  DUE_FILTER_LABELS,
  highlightParts,
  withDueFilter,
} from "@shared/search";
import { keyLabels } from "@shared/shortcuts";
import { Link } from "@tanstack/react-router";
import { Fragment } from "react";

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

import { MenuEntries, useCaptureCommands } from "./capture-commands";
import { dayLabel, readOnlyText, timeOfDay } from "./format";
import { useLibraryState } from "./library-state";
import type { CaptureGroup, ListKind } from "./list-model";
import { matchSnippet, stepProgress } from "./list-model";
import { Thumbnail } from "./saved-image";

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

/** Time, then at most three badges, as the shelf lists them: due, steps, pins. */
const RowMeta = ({
  capture,
  now,
}: {
  readonly capture: SavedCapture;
  readonly now: Date;
}) => {
  const progress = stepProgress(capture.steps);

  return (
    <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs tabular-nums">
      <span className="shrink-0">{timeOfDay(capture.capturedAt)}</span>
      {capture.due === null ? null : (
        <DueChip due={capture.due} now={now} size="sm" />
      )}
      {progress === null ? null : (
        <span
          aria-label={`${progress.done} of ${progress.total} next steps done`}
          className="flex shrink-0 items-center gap-1"
        >
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} />
          {progress.done}/{progress.total}
        </span>
      )}
    </span>
  );
};

const CaptureRow = ({
  active,
  capture,
}: {
  readonly capture: SavedCapture;
  readonly active: boolean;
}) => {
  const { now, parsed } = useLibraryState();
  const { dialog, entries } = useCaptureCommands(capture);
  const snippet = matchSnippet(capture, parsed.terms);

  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring/50 data-[state=open]:bg-foreground/5 flex items-start gap-2.5 rounded-md px-2 py-2 outline-none focus-visible:ring-3",
              active ? "bg-foreground/10" : "hover:bg-foreground/5"
            )}
            data-capture-id={capture.id}
            data-testid="capture-row"
            params={{ captureId: capture.id }}
            to="/captures/$captureId"
          >
            <Thumbnail image={capture.image} pins={capture.pins} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
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
              <RowMeta capture={capture} now={now} />
            </span>
          </Link>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-52">
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

const groupLabel = (group: CaptureGroup, list: ListKind): string => {
  if (group.kind === "readOnly") {
    return "Read-only";
  }

  const day = dayLabel(group.day, group.relative);

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
  const { list } = useLibraryState();

  return groups.map((group) => (
    <section
      aria-label={groupLabel(group, list)}
      className="flex flex-col gap-0.5"
      key={group.kind === "day" ? group.day.getTime() : "readOnly"}
    >
      <h2 className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-medium">
        {groupLabel(group, list)}
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
          aria-label="Filter by due date"
          size="icon-xs"
          title="Filter by due date"
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
        {DUE_FILTER_LABELS.map(({ filter, label }) => (
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
            {label}
            <span className="text-muted-foreground ml-auto font-mono text-xs">
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
              Any due date
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const SearchField = () => {
  const { query, searchRef, setQuery } = useLibraryState();

  return (
    <InputGroup className="app-no-drag">
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
        }}
        placeholder="Search or due:today"
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
  );
};
