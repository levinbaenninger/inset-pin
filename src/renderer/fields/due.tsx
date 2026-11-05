import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  CalendarRemove01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { longDate, monthTitle, shortDate, weekdayNames } from "@shared/dates";
import {
  dueChipText,
  dueLongLabel,
  duePresets,
  dueSentence,
  dueState,
  fromDueDate,
  toDueDate,
} from "@shared/due";
import type { DueDate, DueState } from "@shared/due";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** The chip's colours: overdue in the destructive colour, today in the accent, else quiet. One design in all three Inset apps. */
const STATE_CLASS: Record<DueState, string> = {
  later: "bg-foreground/5 text-muted-foreground",
  overdue: "bg-destructive/10 text-destructive dark:bg-destructive/20",
  soon: "bg-foreground/5 text-foreground/80",
  today: "bg-pin/12 text-pin-ink dark:bg-pin/20",
};

/**
 * The small due chip in a list row: a calendar icon and the day. Once the day
 * has passed it says "Overdue", as Window Links' rows do; the date is in its
 * tooltip and accessible name.
 */
export const DueChip = ({
  due,
  now,
}: {
  readonly due: DueDate;
  readonly now: Date;
}) => (
  <span
    aria-label={dueSentence(due, now)}
    className={cn(
      "inline-flex h-4.5 max-w-full min-w-0 items-center gap-1 rounded-md px-1 text-xs font-medium whitespace-nowrap tabular-nums",
      STATE_CLASS[dueState(due, now)]
    )}
    data-due-state={dueState(due, now)}
    title={dueSentence(due, now)}
  >
    <HugeiconsIcon className="shrink-0" icon={Calendar03Icon} size={11} />
    <span className="truncate">
      {dueState(due, now) === "overdue" ? "Overdue" : dueChipText(due, now)}
    </span>
  </span>
);

const WEEKDAYS = weekdayNames();

const addDays = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/** Seven days to a row. */
const weeksOf = (days: readonly Date[]): readonly (readonly Date[])[] =>
  Array.from({ length: Math.ceil(days.length / 7) }, (_, week) =>
    days.slice(week * 7, week * 7 + 7)
  );

/** The six weeks shown for a month, starting on a Monday. */
const monthDays = (month: Date): readonly Date[] => {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const back = (first.getDay() + 6) % 7;
  const start = addDays(first, -back);

  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
};

const KEY_DAYS = new Map([
  ["ArrowDown", 7],
  ["ArrowLeft", -1],
  ["ArrowRight", 1],
  ["ArrowUp", -7],
]);

/** A month to pick a day from; the arrow keys move the focus, Return picks. */
const Calendar = ({
  initial,
  now,
  onPick,
}: {
  readonly initial: DueDate | null;
  readonly now: Date;
  readonly onPick: (due: DueDate) => void;
}) => {
  const [focused, setFocused] = useState(() =>
    initial === null ? now : fromDueDate(initial)
  );

  const grid = useRef<HTMLTableSectionElement>(null);
  const month = new Date(focused.getFullYear(), focused.getMonth(), 1);
  const today = toDueDate(now);
  const focusedKey = toDueDate(focused);

  useEffect(() => {
    grid.current
      ?.querySelector<HTMLButtonElement>(`[data-day="${focusedKey}"]`)
      ?.focus();
  }, [focusedKey]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const days = KEY_DAYS.get(event.key);

    if (days !== undefined) {
      event.preventDefault();
      setFocused(addDays(focused, days));
    }
  };

  const shiftMonth = (by: number): void => {
    setFocused(
      new Date(
        focused.getFullYear(),
        focused.getMonth() + by,
        Math.min(focused.getDate(), 28)
      )
    );
  };

  return (
    <div className="flex w-60 flex-col gap-1 p-1">
      <div className="flex items-center justify-between">
        <button
          aria-label="Previous month"
          className="hover:bg-muted focus-visible:ring-ring/50 grid size-7 place-items-center rounded-md outline-none focus-visible:ring-3"
          onClick={() => {
            shiftMonth(-1);
          }}
          type="button"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
        </button>
        <p aria-live="polite" className="text-sm font-medium">
          {monthTitle(month)}
        </p>
        <button
          aria-label="Next month"
          className="hover:bg-muted focus-visible:ring-ring/50 grid size-7 place-items-center rounded-md outline-none focus-visible:ring-3"
          onClick={() => {
            shiftMonth(1);
          }}
          type="button"
        >
          <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
        </button>
      </div>
      <table className="w-full border-separate border-spacing-0.5 text-center">
        <thead>
          <tr>
            {WEEKDAYS.map((day) => (
              <th
                className="text-muted-foreground py-1 text-xs font-medium"
                key={day}
                scope="col"
              >
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={grid}>
          {weeksOf(monthDays(month)).map((week) => (
            <tr key={toDueDate(week[0] ?? month)}>
              {week.map((day) => {
                const key = toDueDate(day);
                const outside = day.getMonth() !== month.getMonth();

                return (
                  <td className="p-0" key={key}>
                    <button
                      aria-label={longDate(day)}
                      aria-pressed={key === initial}
                      className={cn(
                        "focus-visible:ring-ring/50 grid h-7 w-full place-items-center rounded-md text-xs tabular-nums outline-none focus-visible:ring-3",
                        outside
                          ? "text-muted-foreground/60"
                          : "text-foreground",
                        key === today && "text-pin-ink font-semibold",
                        key === initial
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted"
                      )}
                      data-day={key}
                      onClick={() => {
                        onPick(key);
                      }}
                      onKeyDown={onKeyDown}
                      tabIndex={key === focusedKey ? 0 : -1}
                      type="button"
                    >
                      {day.getDate()}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ITEM =
  "hover:bg-accent focus-visible:bg-accent flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none";

/**
 * Due's quick picker, laid out as in every Inset app: a "Due" header with its
 * key, Today, Tomorrow, This weekend and Next week with their days, then Pick
 * a date… and, once a day is set, Clear. The arrow keys move through it. It
 * opens beside its anchor.
 */
export const DuePicker = ({
  anchor,
  due,
  now,
  onChange,
  onOpenChange,
  open,
  shortcut,
}: {
  readonly due: DueDate | null;
  readonly now: Date;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onChange: (due: DueDate | null) => void;
  /** What the picker opens beside: the chip, or the Add… button. */
  readonly anchor: ReactNode;
  /** The key that opens it, shown in its header. */
  readonly shortcut: string;
}) => {
  const [calendar, setCalendar] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  const pick = (value: DueDate | null): void => {
    onChange(value);
    onOpenChange(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    event.preventDefault();

    const items = [
      ...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? []),
    ];

    const index = items.indexOf(event.currentTarget);
    const next = event.key === "ArrowDown" ? index + 1 : index - 1;

    items.at(next % items.length)?.focus();
  };

  return (
    <Popover
      onOpenChange={(next) => {
        onOpenChange(next);

        if (!next) {
          setCalendar(false);
        }
      }}
      open={open}
    >
      <PopoverAnchor asChild>{anchor}</PopoverAnchor>
      <PopoverContent
        aria-label="Due"
        className={calendar ? undefined : "w-52"}
        collisionPadding={8}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          list.current?.querySelector<HTMLButtonElement>("button")?.focus();
        }}
        // Escape closes only the picker, not the panel or the editor behind it.
        onEscapeKeyDown={(event) => {
          event.stopPropagation();
        }}
      >
        {calendar ? (
          <Calendar initial={due} now={now} onPick={pick} />
        ) : (
          <div className="flex flex-col" data-testid="due-picker" ref={list}>
            <p className="text-muted-foreground flex items-center justify-between px-2 pt-1 pb-1.5 text-xs font-medium">
              Due
              <Kbd>{shortcut}</Kbd>
            </p>
            {duePresets(now).map((preset) => (
              <button
                className={ITEM}
                key={preset.id}
                onClick={() => {
                  pick(preset.date);
                }}
                onKeyDown={onKeyDown}
                type="button"
              >
                <span className="flex-1">{preset.label}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {shortDate(fromDueDate(preset.date), now, { weekday: true })}
                </span>
              </button>
            ))}
            <div className="bg-border -mx-1 my-1 h-px" />
            <button
              className={ITEM}
              onClick={() => {
                setCalendar(true);
              }}
              onKeyDown={onKeyDown}
              type="button"
            >
              <HugeiconsIcon
                className="text-muted-foreground"
                icon={Calendar03Icon}
                size={14}
              />
              Pick a date…
            </button>
            {due === null ? null : (
              <button
                className={ITEM}
                onClick={() => {
                  pick(null);
                }}
                onKeyDown={onKeyDown}
                type="button"
              >
                <HugeiconsIcon
                  className="text-muted-foreground"
                  icon={CalendarRemove01Icon}
                  size={14}
                />
                Clear
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

/** The chip in an editor: it opens the picker, and its × clears the day, as in Window Links. */
export const DueField = ({
  due,
  now,
  onChange,
  onOpenChange,
  open,
  shortcut,
}: {
  readonly due: DueDate;
  readonly now: Date;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onChange: (due: DueDate | null) => void;
  readonly shortcut: string;
}) => (
  <DuePicker
    anchor={
      <span
        className={cn(
          "inline-flex h-6 shrink-0 items-center rounded-md text-xs font-medium whitespace-nowrap tabular-nums",
          STATE_CLASS[dueState(due, now)]
        )}
        data-due-state={dueState(due, now)}
        data-testid="due-chip"
      >
        <button
          aria-label={`${dueSentence(due, now)}. Change it (${shortcut})`}
          className="focus-visible:ring-ring/50 flex h-full items-center gap-1 rounded-md pr-0.5 pl-1.5 outline-none hover:brightness-95 focus-visible:ring-3 dark:hover:brightness-125"
          onClick={() => {
            onOpenChange(!open);
          }}
          // Backspace on the chip clears the day, rather than asking to delete the capture.
          onKeyDown={(event) => {
            if (event.key === "Backspace" || event.key === "Delete") {
              event.preventDefault();
              onChange(null);
            }
          }}
          title={`Due ${dueLongLabel(due)} (${shortcut})`}
          type="button"
        >
          <HugeiconsIcon icon={Calendar03Icon} size={12} />
          {dueChipText(due, now)}
        </button>
        <button
          aria-label="Clear Due"
          className="focus-visible:ring-ring/50 grid h-full w-6 place-items-center rounded-md opacity-70 outline-none hover:opacity-100 focus-visible:ring-3"
          onClick={() => {
            onChange(null);
          }}
          title="Clear Due"
          type="button"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={11} />
        </button>
      </span>
    }
    due={due}
    now={now}
    onChange={onChange}
    onOpenChange={onOpenChange}
    open={open}
    shortcut={shortcut}
  />
);
