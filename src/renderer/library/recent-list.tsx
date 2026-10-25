import {
  Alert02Icon,
  Cancel01Icon,
  Copy01Icon,
  Delete02Icon,
  Image01Icon,
  PencilEdit02Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { CaptureIdSchema } from "@shared/capture-record";
import type { CaptureId } from "@shared/capture-record";
import type { CaptureSummary } from "@shared/contracts";
import {
  getRouteApi,
  Link,
  useNavigate,
  useParams,
  useRouter,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { isMac } from "@/shared/platform";

import { useCaptureCommands } from "./capture-commands";
import type { CaptureCommands } from "./capture-commands";
import { captureKeyLabels } from "./capture-keys";
import { dayLabel, readOnlyText, timeOfDay } from "./format";
import {
  groupByDay,
  matchesQuery,
  stepSelection,
  visibleIds,
} from "./list-model";
import type { CaptureGroup } from "./list-model";
import { useListQuery } from "./list-query";
import { SavedImage } from "./saved-image";

const rootRoute = getRouteApi("__root__");

const ROW =
  "flex gap-3 rounded-lg px-2 py-2 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-muted";

/** Where a right-click opened the menu, and on which capture. */
interface RowMenuAt {
  readonly id: CaptureId;
  readonly x: number;
  readonly y: number;
}

type OpenRowMenu = (at: RowMenuAt) => void;

const CaptureRow = ({
  capture,
  onMenu,
}: {
  readonly capture: CaptureSummary;
  readonly onMenu: OpenRowMenu;
}) => (
  <Link
    className={ROW}
    data-capture-id={capture.id}
    onContextMenu={(event) => {
      // A read-only entry has nothing to copy, edit or delete.
      if (capture.kind === "ok") {
        event.preventDefault();
        onMenu({ id: capture.id, x: event.clientX, y: event.clientY });
      }
    }}
    params={{ captureId: capture.id }}
    to="/captures/$captureId"
  >
    {capture.kind === "ok" ? (
      <>
        <SavedImage
          alt=""
          image={capture.image}
          pin={capture.pin}
          size="thumbnail"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="line-clamp-2 text-sm leading-snug wrap-break-word">
            {capture.thought}
          </p>
          <p className="text-muted-foreground text-xs tabular-nums">
            {timeOfDay(capture.capturedAt)}
          </p>
        </div>
      </>
    ) : (
      <>
        <div className="bg-muted text-muted-foreground flex aspect-[8/5] w-20 shrink-0 items-center justify-center rounded-md">
          <HugeiconsIcon icon={Alert02Icon} size={16} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-sm leading-snug">Can’t be shown</p>
          <p className="text-muted-foreground line-clamp-2 text-xs">
            {readOnlyText(capture.why)}
          </p>
        </div>
      </>
    )}
  </Link>
);

const groupLabel = (group: CaptureGroup): string =>
  group.kind === "readOnly" ? "Read-only" : dayLabel(group.day, group.relative);

const Groups = ({
  groups,
  onMenu,
}: {
  readonly groups: readonly CaptureGroup[];
  readonly onMenu: OpenRowMenu;
}) => (
  <div className="flex flex-col gap-4">
    {groups.map((group) => (
      <section
        aria-label={groupLabel(group)}
        className="flex flex-col gap-0.5"
        key={group.kind === "day" ? group.day.getTime() : "readOnly"}
      >
        <h2 className="text-muted-foreground px-2 pb-1 text-xs font-medium">
          {groupLabel(group)}
        </h2>
        {group.captures.map((capture) => (
          <CaptureRow capture={capture} key={capture.id} onMenu={onMenu} />
        ))}
      </section>
    ))}
  </div>
);

/**
 * A right-click selects the capture, like Finder, and its menu acts on the
 * capture shown beside the list. Not modal, so the delete question it opens
 * never leaves the page unclickable.
 */
const RowMenu = ({
  menu,
  onClose,
}: {
  readonly menu: RowMenuAt | null;
  readonly onClose: () => void;
}) => {
  const commands = useCaptureCommands();
  const keys = captureKeyLabels(isMac);

  const run = (pick: (shown: CaptureCommands) => () => void) => () => {
    const shown = commands.current;

    if (menu !== null && shown?.id === menu.id) {
      pick(shown)();
    }
  };

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={menu !== null}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed top-(--y) left-(--x) size-0"
          style={{ "--x": `${menu?.x ?? 0}px`, "--y": `${menu?.y ?? 0}px` }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        // Focus stays where the command put it, such as in the thought editor.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
        sideOffset={2}
      >
        <DropdownMenuItem onSelect={run((shown) => shown.copyNote)}>
          <HugeiconsIcon icon={Copy01Icon} />
          Copy note
          <DropdownMenuShortcut>{keys.copyNote}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={run((shown) => shown.copyImage)}>
          <HugeiconsIcon icon={Image01Icon} />
          Copy image
          <DropdownMenuShortcut>{keys.copyImage}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={run((shown) => shown.edit)}>
          <HugeiconsIcon icon={PencilEdit02Icon} />
          Edit thought
          <DropdownMenuShortcut>{keys.edit}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={run((shown) => shown.askDelete)}
          variant="destructive"
        >
          <HugeiconsIcon icon={Delete02Icon} />
          Delete
          <DropdownMenuShortcut>{keys.delete}</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const ARROW_OFFSETS = new Map<string, 1 | -1>([
  ["ArrowDown", 1],
  ["ArrowUp", -1],
]);

/** The thought editor and dialogs keep their arrow keys, so moving through the list never drops an edit. */
const ownsArrowKeys = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.closest('form, [role="alertdialog"], [role="dialog"]') !== null);

/** ↑ and ↓ move through the visible captures from anywhere but a text area; ⌘F or Ctrl+F searches. */
const useListKeys = (
  ids: readonly CaptureId[],
  selected: CaptureId | null,
  search: () => void
): void => {
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || ownsArrowKeys(event.target)) {
        return;
      }

      if (
        event.key.toLowerCase() === "f" &&
        (isMac ? event.metaKey : event.ctrlKey)
      ) {
        event.preventDefault();
        search();

        return;
      }

      const offset = ARROW_OFFSETS.get(event.key);

      if (offset === undefined) {
        return;
      }

      const next = stepSelection(ids, selected, offset);

      if (next !== null) {
        event.preventDefault();
        void navigate({
          params: { captureId: next },
          to: "/captures/$captureId",
        });

        const row = document.querySelector<HTMLElement>(
          `[data-capture-id="${next}"]`
        );

        // Focus follows a row that had it, so Enter acts on the capture now shown.
        if (
          document.activeElement instanceof HTMLElement &&
          document.activeElement.dataset.captureId !== undefined
        ) {
          row?.focus({ preventScroll: true });
        }

        row?.scrollIntoView({ block: "nearest" });
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [ids, navigate, search, selected]);
};

export const RecentList = () => {
  const captures = rootRoute.useLoaderData();
  const params = useParams({ strict: false });
  const { query, setQuery } = useListQuery();
  const [today, setToday] = useState(() => new Date());

  // Coming back to the window after midnight moves "Today" and "Yesterday" along.
  useEffect(() => {
    const refresh = (): void => {
      setToday(new Date());
    };

    window.addEventListener("focus", refresh);

    return () => {
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const router = useRouter();
  const [menu, setMenu] = useState<RowMenuAt | null>(null);
  const parsed = CaptureIdSchema.safeParse(params.captureId);
  const selected = parsed.success ? parsed.data : null;

  const visible = useMemo(
    () => captures.filter((capture) => matchesQuery(capture, query)),
    [captures, query]
  );

  const groups = useMemo(() => groupByDay(visible, today), [today, visible]);

  const ids = useMemo(() => visibleIds(captures, query), [captures, query]);

  const focusSearch = useCallback((): void => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, []);

  useListKeys(ids, selected, focusSearch);

  const openMenu = useCallback(
    async (at: RowMenuAt): Promise<void> => {
      if (at.id !== selected) {
        await navigate({
          params: { captureId: at.id },
          to: "/captures/$captureId",
        });
      }

      // An unsaved edit can keep the old capture; then there is nothing to open.
      if (router.state.location.pathname === `/captures/${at.id}`) {
        setMenu(at);
      }
    },
    [navigate, router, selected]
  );

  const showMenu = useCallback(
    (at: RowMenuAt): void => {
      void openMenu(at);
    },
    [openMenu]
  );

  const closeMenu = useCallback((): void => {
    setMenu(null);
  }, []);

  return (
    <div className="flex min-h-0 w-full flex-col">
      <header className="app-drag flex flex-col gap-3 px-4 pt-5 pb-3">
        <div className="flex items-baseline justify-between gap-2 px-1 max-md:pr-(--titlebar-inset-right)">
          <h1 className="text-base font-semibold">Recent captures</h1>
          {/* Only a search makes the count worth reading. */}
          {query === "" ? null : (
            <span className="text-muted-foreground text-xs tabular-nums">
              {visible.length} of {captures.length}
            </span>
          )}
        </div>
        <InputGroup className="app-no-drag">
          <InputGroupAddon>
            <HugeiconsIcon icon={Search01Icon} />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search captures"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query !== "") {
                event.preventDefault();
                setQuery("");
              }
            }}
            placeholder="Search thoughts"
            ref={searchRef}
            // The clear button below replaces WebKit's own, which ignores the theme.
            className="[&::-webkit-search-cancel-button]:appearance-none"
            type="search"
            value={query}
          />
          {query === "" ? null : (
            <InputGroupAddon align="inline-end">
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
            </InputGroupAddon>
          )}
        </InputGroup>
      </header>
      <nav
        aria-label="Captures"
        // Room for the scrollbar stays, so rows keep their width when a search shortens the list.
        className="min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto px-2 pb-4"
      >
        {visible.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-sm">
            No captures match “{query.trim()}”.
          </p>
        ) : null}
        <Groups groups={groups} onMenu={showMenu} />
      </nav>
      <RowMenu menu={menu} onClose={closeMenu} />
    </div>
  );
};
