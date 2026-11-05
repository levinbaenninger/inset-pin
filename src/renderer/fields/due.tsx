import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  dueLabel,
  duePresets,
  dueState,
  fromDueDate,
  toDueDate,
} from "@shared/due";
import type { DueDate, DueState } from "@shared/due";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** The chip's colours: overdue in the destructive colour, today in the accent, else quiet. */
const STATE_CLASS: Record<DueState, string> = {
  later: "bg-foreground/5 text-muted-foreground",
  overdue: "bg-destructive/10 text-destructive",
  soon: "bg-foreground/5 text-foreground/80",
  today: "bg-pin/12 text-pin dark:bg-pin/20 dark:text-sky-300",
};

const STATE_WORD: Record<DueState, string> = {
  later: "",
  overdue: ", overdue",
  soon: "",
  today: "",
};

/** "Due Fri 13 Nov" for screen readers and tooltips. */
export const dueDescription = (due: DueDate, now: Date): string =>
  `Due ${dueLabel(due, now)}${STATE_WORD[dueState(due, now)]}`;

/** The small due chip: a calendar icon and the day, coloured by how near it is. */
export const DueChip = ({
  due,
  now,
  size = "md",
}: {
  readonly due: DueDate;
  readonly now: Date;
  readonly size?: "sm" | "md";
}) => (
  <span
    aria-label={dueDescription(due, now)}
    className={cn(
      "inline-flex shrink-0 items-center gap-1 rounded-md font-medium whitespace-nowrap tabular-nums",
      size === "sm" ? "h-4.5 px-1 text-xs" : "h-6 px-1.5 text-xs",
      STATE_CLASS[dueState(due, now)]
    )}
    title={dueDescription(due, now)}
  >
    <HugeiconsIcon icon={Calendar03Icon} size={size === "sm" ? 11 : 12} />
    {dueLabel(due, now)}
  </span>
);

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const monthTitle = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
});

const fullDay = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  weekday: "long",
  year: "numeric",
});

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
          {monthTitle.format(month)}
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
                      aria-label={fullDay.format(day)}
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

const presetHint = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  weekday: "short",
});

const ITEM =
  "hover:bg-accent focus-visible:bg-accent flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none";

/**
 * Due's quick picker: Today, Tomorrow, This weekend, Next week, Pick a date…
 * and Clear. The arrow keys move through it. It opens beside its anchor.
 */
export const DuePicker = ({
  anchor,
  due,
  now,
  onChange,
  onOpenChange,
  open,
}: {
  readonly due: DueDate | null;
  readonly now: Date;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onChange: (due: DueDate | null) => void;
  /** What the picker opens beside: the chip, or the Add… button. */
  readonly anchor: ReactNode;
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
        aria-label="Due date"
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
            <p className="text-muted-foreground px-2 pt-1 pb-1.5 text-xs font-medium">
              Due
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
                <span className="text-muted-foreground text-xs">
                  {presetHint.format(fromDueDate(preset.date))}
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
                className={cn(ITEM, "text-destructive")}
                onClick={() => {
                  pick(null);
                }}
                onKeyDown={onKeyDown}
                type="button"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={14} />
                Clear
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

/** The chip as a button that opens the picker; the picker's Clear, or Backspace on the chip, removes the date. */
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
      <button
        aria-label={`${dueDescription(due, now)}. Change it (${shortcut}), or press Backspace to clear it`}
        className="focus-visible:ring-ring/50 rounded-md outline-none focus-visible:ring-3"
        data-testid="due-chip"
        onClick={() => {
          onOpenChange(!open);
        }}
        // Backspace on the chip clears the date, rather than asking to delete the capture.
        onKeyDown={(event) => {
          if (event.key === "Backspace" || event.key === "Delete") {
            event.preventDefault();
            onChange(null);
          }
        }}
        title={`Change the due date (${shortcut})`}
        type="button"
      >
        <DueChip due={due} now={now} />
      </button>
    }
    due={due}
    now={now}
    onChange={onChange}
    onOpenChange={onOpenChange}
    open={open}
  />
);
