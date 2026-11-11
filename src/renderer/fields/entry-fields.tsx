import {
  Add01Icon,
  Calendar03Icon,
  CheckListIcon,
  TextAlignLeftIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { DESCRIPTION_MAX, TITLE_MAX } from "@shared/capture-record";
import type { Step } from "@shared/capture-record";
import type { DueDate } from "@shared/due";
import { fieldKeyAction, keyLabels } from "@shared/shortcuts";
import type { FieldKeyAction } from "@shared/shortcuts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { afterMenusClose, pickShownItem } from "@/shared/menu-keys";
import { isMac } from "@/shared/platform";
import { coach } from "@/tutorial/anchors";

import { DueField, DuePicker } from "./due";
import { ADD_ROW, newStep, StepsEditor } from "./steps-editor";

export interface FieldsValue {
  readonly title: string;
  readonly description: string;
  readonly steps: readonly Step[];
  readonly due: DueDate | null;
}

type Field = "description" | "steps" | "due";

/** `now` is true for a change that is no typing, such as a ticked step or a due day, which saves at once. */
export type FieldsChange = (value: FieldsValue, now?: boolean) => void;

/** Which optional fields take space: those with something in them, or just added. */
const shownFields = (
  value: FieldsValue,
  revealed: ReadonlySet<Field>
): Readonly<Record<Field, boolean>> => ({
  description: value.description !== "" || revealed.has("description"),
  due: value.due !== null,
  steps: value.steps.length > 0,
});

export interface FieldsUi {
  readonly titleRef: RefObject<HTMLTextAreaElement | null>;
  readonly descriptionRef: RefObject<HTMLTextAreaElement | null>;
  readonly revealed: ReadonlySet<Field>;
  readonly dueOpen: boolean;
  readonly setDueOpen: (open: boolean) => void;
  readonly focusStep: string | null;
  readonly clearFocusStep: () => void;
  /** ⌘D, ⇧⌘D and ⇧⌘S, and the Add menu: show the field and put the focus in it. */
  readonly run: (
    action: Field,
    value: FieldsValue,
    onChange: FieldsChange
  ) => void;
  /** Hides an emptied description once the focus leaves it. */
  readonly settle: (value: FieldsValue) => void;
}

/** The fields' focus and disclosure state, so a window's keys can reach them. */
export const useFieldsUi = (): FieldsUi => {
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [revealed, setRevealed] = useState<ReadonlySet<Field>>(new Set());
  const [dueOpen, setDueOpen] = useState(false);
  const [focusStep, setFocusStep] = useState<string | null>(null);
  const [focusDescription, setFocusDescription] = useState(0);

  useEffect(() => {
    if (focusDescription > 0) {
      const field = descriptionRef.current;

      field?.focus();
      field?.setSelectionRange(field.value.length, field.value.length);
    }
  }, [focusDescription]);

  const run = useCallback(
    (action: Field, value: FieldsValue, onChange: FieldsChange): void => {
      if (action === "description") {
        setRevealed((current) => new Set([...current, "description"]));
        setFocusDescription((count) => count + 1);
      } else if (action === "steps") {
        const last = value.steps.at(-1);

        if (last === undefined || last.text !== "") {
          const step = newStep();

          onChange({ ...value, steps: [...value.steps, step] });
          setFocusStep(step.id);
        } else {
          setFocusStep(last.id);
        }
      } else {
        setDueOpen(true);
      }
    },
    []
  );

  const settle = useCallback((value: FieldsValue): void => {
    if (value.description.trim() === "") {
      setRevealed((current) => {
        const next = new Set(current);

        next.delete("description");

        return next;
      });
    }
  }, []);

  const clearFocusStep = useCallback((): void => {
    setFocusStep(null);
  }, []);

  return useMemo(
    () => ({
      clearFocusStep,
      descriptionRef,
      dueOpen,
      focusStep,
      revealed,
      run,
      setDueOpen,
      settle,
      titleRef,
    }),
    [clearFocusStep, dueOpen, focusStep, revealed, run, settle]
  );
};

/** Maps a window's field key to the fields; other keys are the window's own. */
export const isFieldAction = (action: FieldKeyAction): action is Field =>
  action === "description" || action === "due" || action === "steps";

const ADD_ITEMS: readonly {
  readonly field: Field;
  readonly label: string;
  readonly chip: string;
  readonly icon: typeof Add01Icon;
}[] = [
  {
    chip: "Description",
    field: "description",
    icon: TextAlignLeftIcon,
    label: "Description",
  },
  {
    chip: "Next steps",
    field: "steps",
    icon: CheckListIcon,
    label: "Next steps",
  },
  { chip: "Due", field: "due", icon: Calendar03Icon, label: "Due" },
];

const keyOf = (field: Field): string => keyLabels(isMac)[field];

/** ⌘D, ⇧⌘S and ⇧⌘D in the open Add menu pick the field they show beside. */
const onAddKey = pickShownItem((event) => {
  const field = fieldKeyAction(event, isMac);

  return field !== null && isFieldAction(field) ? field : null;
});

/** The narrow editors' one Add button; a field already shown is focused instead. */
const AddMenu = ({
  disabled,
  onAdd,
}: {
  readonly disabled: boolean;
  readonly onAdd: (field: Field) => void;
}) => {
  // A chosen field takes the focus, which must not go back to this button.
  const chose = useRef(false);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          className={ADD_ROW}
          data-due-home=""
          data-testid="add-menu"
          {...coach("add-menu")}
          disabled={disabled}
          type="button"
        >
          <span className="grid size-4 place-items-center">
            <HugeiconsIcon icon={Add01Icon} size={14} />
          </span>
          Add
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-48"
        onCloseAutoFocus={(event) => {
          if (chose.current) {
            chose.current = false;
            event.preventDefault();
          }
        }}
        onKeyDownCapture={onAddKey}
      >
        {ADD_ITEMS.map((item) => (
          <DropdownMenuItem
            data-key-action={item.field}
            key={item.field}
            // Once the menu has gone: while it fades out under the pointer, a move over it takes the focus back, which hid the new description and shut the Due picker.
            onSelect={() => {
              chose.current = true;
              afterMenusClose(() => {
                onAdd(item.field);
              });
            }}
          >
            <HugeiconsIcon icon={item.icon} />
            {item.label}
            <DropdownMenuShortcut>{keyOf(item.field)}</DropdownMenuShortcut>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** The wide editor's quiet row of chips, one for each field not shown yet. */
const AddChips = ({
  fields,
  onAdd,
}: {
  readonly fields: readonly Field[];
  readonly onAdd: (field: Field) => void;
}) =>
  fields.map((field) => {
    const item = ADD_ITEMS.find((entry) => entry.field === field);

    return item === undefined ? null : (
      <button
        className="text-muted-foreground hover:text-foreground hover:bg-foreground/5 focus-visible:ring-ring/50 inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs font-medium outline-none focus-visible:ring-3"
        data-due-home={field === "due" ? "" : undefined}
        data-testid={`add-${field}`}
        key={field}
        onClick={() => {
          onAdd(field);
        }}
        title={`Add ${item.chip.toLowerCase()} (${keyOf(field)})`}
        type="button"
      >
        <HugeiconsIcon icon={Add01Icon} size={12} />
        {item.chip}
      </button>
    );
  });

/** The library's fields read as text; a quiet tint on hover and focus shows they can be edited. */
const PAGE_FIELD =
  "-mx-2 rounded-md px-2 py-1 hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] transition-colors";

const VARIANT = {
  page: {
    description: `text-sm leading-relaxed min-h-[1lh] text-foreground/90 ${PAGE_FIELD}`,
    title: `text-xl leading-snug font-semibold text-pretty ${PAGE_FIELD}`,
  },
  panel: {
    description: "text-sm leading-snug max-h-[calc(6lh)]",
    title: "text-sm leading-6 font-semibold max-h-[calc(4lh)]",
  },
} as const;

/** Escape leaves a field in the library, which saves it; in the panel it sets the draft aside. */
const leaveOnEscape = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
  if (event.key === "Escape" && !event.nativeEvent.isComposing) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.blur();
  }
};

export interface EntryFieldsProps {
  readonly value: FieldsValue;
  readonly onChange: FieldsChange;
  /** False on a done capture: its empty fields offer no add chips. */
  readonly addable?: boolean;
  readonly ui: FieldsUi;
  readonly variant: "panel" | "page";
  readonly now: Date;
  readonly disabled?: boolean;
  readonly titlePlaceholder: string;
  /** A field lost the focus: the library saves then. */
  readonly onLeave?: () => void;
  /** The title was left blank: the library puts the saved one back. */
  readonly onTitleBlur?: () => void;
  readonly autoFocusTitle?: boolean;
}

/**
 * Title, then Description, Next steps and Due, each taking space only once it
 * has something in it. The panel adds them from one Add button, the library
 * from a row of chips; both answer the same keys.
 */
export const EntryFields = ({
  addable = true,
  autoFocusTitle = false,
  disabled = false,
  now,
  onChange,
  onLeave,
  onTitleBlur,
  titlePlaceholder,
  ui,
  value,
  variant,
}: EntryFieldsProps) => {
  const shown = shownFields(value, ui.revealed);
  const styles = VARIANT[variant];
  const page = variant === "page";
  const { descriptionRef, setDueOpen, titleRef } = ui;

  // A save shuts an open Due picker, so it doesn't spring back once the save is over.
  useEffect(() => {
    if (disabled) {
      setDueOpen(false);
    }
  }, [disabled, setDueOpen]);

  const add = (field: Field): void => {
    ui.run(field, value, onChange);
  };

  const missing = ADD_ITEMS.flatMap((item) =>
    shown[item.field] ? [] : [item.field]
  );

  const dueRow =
    value.due === null ? null : (
      <DueField
        disabled={disabled}
        due={value.due}
        now={now}
        onChange={(due) => {
          onChange({ ...value, due }, true);
        }}
        onOpenChange={(open) => {
          ui.setDueOpen(open);
        }}
        open={ui.dueOpen}
        shortcut={keyOf("due")}
      />
    );

  // Without a due date, the picker opens beside the Add button or the chips.
  const pickerAnchor = (child: ReactNode): ReactNode =>
    value.due === null ? (
      <DuePicker
        anchor={<span className="inline-flex">{child}</span>}
        disabled={disabled}
        due={null}
        now={now}
        onChange={(due) => {
          onChange({ ...value, due }, true);
        }}
        onOpenChange={(open) => {
          ui.setDueOpen(open);
        }}
        open={ui.dueOpen}
        shortcut={keyOf("due")}
      />
    ) : (
      child
    );

  // The library's row of Due and add chips; a done capture with nothing to show leaves no gap until ⇧⌘D opens the picker there.
  const pageRow =
    dueRow === null &&
    !ui.dueOpen &&
    (!addable || missing.length === 0) ? null : (
      <div className="-mx-1.5 mt-1.5 flex min-h-6 flex-wrap items-center gap-1.5">
        {dueRow}
        {pickerAnchor(
          <span className="inline-flex flex-wrap items-center gap-0.5">
            <AddChips fields={addable ? missing : []} onAdd={add} />
          </span>
        )}
      </div>
    );

  return (
    <div className={cn("flex flex-col", page ? "gap-1" : "gap-0")}>
      <textarea
        aria-label="Title"
        autoFocus={autoFocusTitle}
        className={cn(
          "placeholder:text-muted-foreground field-sizing-content resize-none bg-transparent outline-none disabled:opacity-60",
          styles.title,
          !page && "px-3 pt-2.5"
        )}
        data-testid="title-field"
        {...coach("title-field")}
        disabled={disabled}
        maxLength={TITLE_MAX}
        onBlur={() => {
          onTitleBlur?.();
          onLeave?.();
        }}
        onChange={(event) => {
          onChange({
            ...value,
            title: event.target.value.replaceAll("\n", " "),
          });
        }}
        onKeyDown={(event) => {
          if (page) {
            leaveOnEscape(event);
          }

          const plain =
            !event.shiftKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey;

          // A title is one line: Return goes on to the description when there is one.
          if (
            event.key === "Enter" &&
            plain &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();

            if (shown.description) {
              descriptionRef.current?.focus();
            }
          }
        }}
        placeholder={titlePlaceholder}
        ref={titleRef}
        rows={1}
        value={value.title}
      />
      {shown.description ? (
        <textarea
          aria-label="Description"
          className={cn(
            "placeholder:text-muted-foreground field-sizing-content resize-none bg-transparent outline-none disabled:opacity-60",
            styles.description,
            !page && "px-3 pt-0.5 pb-1"
          )}
          data-testid="description-field"
          disabled={disabled}
          maxLength={DESCRIPTION_MAX}
          onBlur={() => {
            ui.settle(value);
            onLeave?.();
          }}
          onChange={(event) => {
            onChange({ ...value, description: event.target.value });
          }}
          onKeyDown={page ? leaveOnEscape : undefined}
          placeholder="Description"
          ref={descriptionRef}
          rows={1}
          value={value.description}
        />
      ) : null}
      {shown.steps ? (
        <div className={page ? "-mx-1.5 mt-1" : "px-1.5 pb-1"}>
          <StepsEditor
            disabled={disabled}
            focusId={ui.focusStep}
            onChange={(steps, immediately) => {
              onChange({ ...value, steps }, immediately);
            }}
            onFocused={() => {
              ui.clearFocusStep();
            }}
            onLeave={onLeave}
            steps={value.steps}
          />
        </div>
      ) : null}
      {page ? (
        pageRow
      ) : (
        <div className="flex items-center gap-1.5 px-1.5 pb-1">
          {pickerAnchor(<AddMenu disabled={disabled} onAdd={add} />)}
          {dueRow}
        </div>
      )}
    </div>
  );
};
