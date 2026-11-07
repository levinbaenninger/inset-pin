import {
  Calendar03Icon,
  CalendarRemove01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { longDate, monthTitle, shortDate } from "@shared/dates";
import {
  dueChipText,
  dueLongLabel,
  duePresets,
  dueSentence,
  dueState,
  fromDueDate,
  toDueDate,
  weekStartDay,
} from "@shared/due";
import type { DueDate, DueState } from "@shared/due";
import { useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { Calendar } from "@/components/ui/calendar";
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
 * The small due chip in a list row: a calendar icon and the day, "Overdue ·
 * Nov 3" once it has passed. It is never cut and never loses the icon; a row
 * too narrow for it moves the chip to a line of its own.
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
      "inline-flex h-4.5 shrink-0 items-center gap-1 rounded-md px-1 text-xs font-medium whitespace-nowrap tabular-nums",
      STATE_CLASS[dueState(due, now)]
    )}
    data-due-state={dueState(due, now)}
    title={dueSentence(due, now)}
  >
    <HugeiconsIcon className="shrink-0" icon={Calendar03Icon} size={11} />
    {dueChipText(due, now)}
  </span>
);

const WEEK_START = weekStartDay();

/**
 * A month to pick a day from: shadcn's Calendar, as in the Shelf, so the
 * three Inset apps look alike. It focuses the Due day, else today; the arrow
 * keys move, Return picks. The week starts on the system's first day.
 */
const DueCalendar = ({
  due,
  now,
  onPick,
}: {
  readonly due: DueDate | null;
  readonly now: Date;
  readonly onPick: (due: DueDate) => void;
}) => {
  const day = due === null ? undefined : fromDueDate(due);

  return (
    <Calendar
      autoFocus
      data-testid="due-calendar"
      defaultMonth={day ?? now}
      formatters={{
        formatCaption: (month) => monthTitle(month),
        formatWeekdayName: (weekday) =>
          weekday.toLocaleDateString(undefined, { weekday: "narrow" }),
      }}
      labels={{
        labelDayButton: (date, modifiers) =>
          [
            longDate(date),
            modifiers.today === true ? "today" : "",
            modifiers.selected === true ? "selected" : "",
          ]
            .filter((part) => part !== "")
            .join(", "),
        labelGrid: (month) => monthTitle(month),
      }}
      mode="single"
      // A second click on the Due day picks it again rather than leaving none.
      onSelect={(picked) => {
        const value = picked === undefined ? due : toDueDate(picked);

        if (value !== null) {
          onPick(value);
        }
      }}
      selected={day}
      today={now}
      weekStartsOn={WEEK_START}
    />
  );
};

/** The chip's day button: where focus goes once a day is picked. */
const CHIP_CONTROL = "[data-due-control]";

/** Where Due lives without a day: the panel's Add button, or the library's Due chip to add it. */
const DUE_HOME = "[data-due-home]";

const focusable = (selector: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(selector);

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
  disabled = false,
  due,
  now,
  onChange: report,
  onOpenChange,
  open,
  shortcut,
}: {
  /** While the panel saves, main takes no edits: the picker stays shut and picks nothing. */
  readonly disabled?: boolean;
  readonly due: DueDate | null;
  readonly now: Date;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onChange: (due: DueDate | null) => void;
  /** What the picker opens beside: the chip, or the Add button. */
  readonly anchor: ReactNode;
  /** The key that opens it, shown in its header. */
  readonly shortcut: string;
}) => {
  const [calendar, setCalendar] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  // Where the focus was when the picker opened, to go back to after Esc.
  const returnTo = useRef<HTMLElement | null>(null);
  const picked = useRef(false);
  const outside = useRef(false);

  const onChange = (value: DueDate | null): void => {
    if (!disabled) {
      report(value);
    }
  };

  const pick = (value: DueDate | null): void => {
    picked.current = value !== null;
    onChange(value);
    onOpenChange(false);
  };

  /**
   * After a pick the focus goes to the chip, which may be a new one: Add
   * becomes the chip once there is a day. After Esc it goes back where it
   * was, and a click elsewhere keeps it there.
   */
  const returnFocus = (): void => {
    const chosen = picked.current;
    const before = returnTo.current;

    picked.current = false;

    if (outside.current) {
      return;
    }

    const target = chosen ? focusable(CHIP_CONTROL) : before;

    if (target?.isConnected === true) {
      target.focus();
    } else {
      (focusable(CHIP_CONTROL) ?? focusable(DUE_HOME))?.focus();
    }
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
      open={open && !disabled}
    >
      <PopoverAnchor asChild>{anchor}</PopoverAnchor>
      <PopoverContent
        aria-label={calendar ? "Pick a Due date" : "Due"}
        className={calendar ? undefined : "w-52"}
        collisionPadding={8}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
        // Escape closes only the picker, not the panel or the editor behind it.
        onEscapeKeyDown={(event) => {
          event.stopPropagation();
        }}
        onInteractOutside={() => {
          outside.current = true;
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          returnTo.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
          outside.current = false;
          list.current?.querySelector<HTMLButtonElement>("button")?.focus();
        }}
        size={calendar ? "fit" : "default"}
      >
        {calendar ? (
          <DueCalendar due={due} now={now} onPick={pick} />
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
  disabled = false,
  due,
  now,
  onChange,
  onOpenChange,
  open,
  shortcut,
}: {
  readonly disabled?: boolean;
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
          STATE_CLASS[dueState(due, now)],
          disabled && "opacity-60"
        )}
        data-due-state={dueState(due, now)}
        data-testid="due-chip"
      >
        <button
          aria-label={`${dueSentence(due, now)}. Change it (${shortcut})`}
          data-due-control=""
          className="focus-visible:ring-ring/50 flex h-full items-center gap-1 rounded-md pr-0.5 pl-1.5 outline-none hover:brightness-95 focus-visible:ring-3 disabled:pointer-events-none dark:hover:brightness-125"
          disabled={disabled}
          onClick={() => {
            onOpenChange(!open);
          }}
          // Backspace on the chip clears the day, rather than asking to delete the capture.
          onKeyDown={(event) => {
            if (
              !disabled &&
              (event.key === "Backspace" || event.key === "Delete")
            ) {
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
          className="focus-visible:ring-ring/50 grid h-full w-6 place-items-center rounded-md opacity-70 outline-none hover:opacity-100 focus-visible:ring-3 disabled:pointer-events-none"
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              onChange(null);
            }
          }}
          title="Clear Due"
          type="button"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={11} />
        </button>
      </span>
    }
    disabled={disabled}
    due={due}
    now={now}
    onChange={onChange}
    onOpenChange={onOpenChange}
    open={open}
    shortcut={shortcut}
  />
);
