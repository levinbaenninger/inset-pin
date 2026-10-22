import { Alert02Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { CaptureIdSchema } from "@shared/capture-record";
import type { CaptureId } from "@shared/capture-record";
import type { CaptureSummary } from "@shared/contracts";
import { shortcutLabel } from "@shared/shortcut";
import {
  getRouteApi,
  Link,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { isMac } from "@/shared/platform";

import { dayLabel, readOnlyText, timeOfDay } from "./format";
import { groupByDay, matchesQuery, stepSelection } from "./list-model";
import type { CaptureGroup } from "./list-model";
import { SavedImage } from "./saved-image";

const rootRoute = getRouteApi("__root__");

const ROW =
  "flex gap-3 rounded-lg px-2 py-2 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-muted";

const CaptureRow = ({ capture }: { readonly capture: CaptureSummary }) => (
  <Link
    className={ROW}
    data-capture-id={capture.id}
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
          <p className="line-clamp-2 text-sm leading-snug">{capture.thought}</p>
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

const Groups = ({ groups }: { readonly groups: readonly CaptureGroup[] }) => (
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
          <CaptureRow capture={capture} key={capture.id} />
        ))}
      </section>
    ))}
  </div>
);

// With two panes, the empty right pane carries the hint instead.
const NoCaptures = () => (
  <div className="text-muted-foreground flex flex-col gap-2 px-2 py-6 text-sm">
    <p className="text-foreground font-medium">No captures yet</p>
    <p className="md:hidden">
      Point at a detail in any app and press <Kbd>{shortcutLabel(isMac)}</Kbd>.
      Saved captures appear here.
    </p>
  </div>
);

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

      if (event.key === "f" && (isMac ? event.metaKey : event.ctrlKey)) {
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
        document
          .querySelector(`[data-capture-id="${next}"]`)
          ?.scrollIntoView({ block: "nearest" });
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
  const [query, setQuery] = useState("");
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
  const parsed = CaptureIdSchema.safeParse(params.captureId);
  const selected = parsed.success ? parsed.data : null;

  const visible = useMemo(
    () => captures.filter((capture) => matchesQuery(capture, query)),
    [captures, query]
  );

  const groups = useMemo(() => groupByDay(visible, today), [today, visible]);

  const ids = useMemo(
    () =>
      groups.flatMap((group) => group.captures.map((capture) => capture.id)),
    [groups]
  );

  const focusSearch = useCallback((): void => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, []);

  useListKeys(ids, selected, focusSearch);

  return (
    <div className="flex min-h-0 w-full flex-col">
      <header className="flex flex-col gap-3 px-4 pt-5 pb-3">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <h1 className="text-base font-semibold">Recent captures</h1>
          {captures.length > 0 ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              {query === ""
                ? captures.length
                : `${visible.length} of ${captures.length}`}
            </span>
          ) : null}
        </div>
        {captures.length > 0 ? (
          <InputGroup>
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
              type="search"
              value={query}
            />
          </InputGroup>
        ) : null}
      </header>
      <nav
        aria-label="Captures"
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-4"
      >
        {captures.length === 0 ? <NoCaptures /> : null}
        {captures.length > 0 && visible.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-sm">
            No captures match “{query.trim()}”.
          </p>
        ) : null}
        <Groups groups={groups} />
      </nav>
    </div>
  );
};
