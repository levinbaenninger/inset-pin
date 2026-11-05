import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { STEP_MAX, STEPS_MAX } from "@shared/capture-record";
import type { Step } from "@shared/capture-record";
import { useRef } from "react";
import type { KeyboardEvent } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export const newStep = (): Step => ({
  done: false,
  id: crypto.randomUUID(),
  text: "",
});

/**
 * Next steps as a short checklist, typed like one in a notes app, as in
 * Window Links: Return starts the next step, Backspace in an empty one removes
 * it, the arrow keys move between them, and the circle checks one off.
 */
export const StepsEditor = ({
  focusId,
  onChange,
  onFocused,
  onLeave,
  steps,
}: {
  readonly steps: readonly Step[];
  readonly onChange: (steps: readonly Step[]) => void;
  /** A step to focus once its field mounts, such as one just added. */
  readonly focusId: string | null;
  readonly onFocused: () => void;
  /** Called when a step's field loses focus; Escape then leaves the field too. */
  readonly onLeave?: () => void;
}) => {
  const fields = useRef(new Map<string, HTMLInputElement>());
  const pending = useRef<string | null>(null);

  const focus = (id: string | undefined): void => {
    if (id !== undefined) {
      fields.current.get(id)?.focus();
    }
  };

  const insertAfter = (index: number): void => {
    if (steps.length >= STEPS_MAX) {
      return;
    }

    const step = newStep();

    pending.current = step.id;
    onChange([...steps.slice(0, index + 1), step, ...steps.slice(index + 1)]);
  };

  const remove = (index: number): void => {
    const neighbour = steps[index - 1] ?? steps[index + 1];

    onChange(steps.filter((_, position) => position !== index));
    focus(neighbour?.id);
  };

  /** What a key does in step `index`; null leaves it to the field. */
  const keyAction = (
    event: KeyboardEvent<HTMLInputElement>,
    index: number
  ): (() => void) | null => {
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;

    if (event.key === "Escape" && onLeave !== undefined) {
      return () => {
        event.currentTarget.blur();
      };
    }

    if (!plain) {
      return null;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      return () => {
        insertAfter(index);
      };
    }

    if (event.key === "Backspace" && steps[index]?.text === "") {
      return () => {
        remove(index);
      };
    }

    const neighbour =
      { ArrowDown: steps[index + 1], ArrowUp: steps[index - 1] }[event.key] ??
      null;

    return neighbour === null
      ? null
      : () => {
          focus(neighbour.id);
        };
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    index: number
  ): void => {
    // Return also ends an IME composition, which must not start a new step.
    if (event.nativeEvent.isComposing) {
      return;
    }

    const run = keyAction(event, index);

    if (run !== null) {
      event.preventDefault();
      run();
    }
  };

  const done = steps.filter((step) => step.done).length;

  return (
    <div className="flex flex-col" data-testid="steps-editor">
      {steps.length > 0 ? (
        <ul
          aria-label={`Next steps, ${done} of ${steps.length} done`}
          className="flex flex-col"
        >
          {steps.map((step, index) => (
            <li
              className="group hover:bg-foreground/5 focus-within:bg-foreground/5 flex items-center gap-2.5 rounded-md pr-0.5 pl-1.5"
              key={step.id}
            >
              <Checkbox
                aria-label={`Done: next step ${index + 1}`}
                checked={step.done}
                onCheckedChange={() => {
                  onChange(
                    steps.map((item) =>
                      item.id === step.id ? { ...item, done: !step.done } : item
                    )
                  );
                }}
              />
              <input
                aria-label={`Next step ${index + 1}`}
                className={cn(
                  "placeholder:text-muted-foreground h-8 min-w-0 flex-1 bg-transparent text-sm outline-none",
                  step.done && "text-muted-foreground line-through"
                )}
                maxLength={STEP_MAX}
                onBlur={onLeave}
                onChange={(event) => {
                  onChange(
                    steps.map((item) =>
                      item.id === step.id
                        ? { ...item, text: event.target.value }
                        : item
                    )
                  );
                }}
                onKeyDown={(event) => {
                  onKeyDown(event, index);
                }}
                placeholder="Next step"
                ref={(element) => {
                  if (element === null) {
                    fields.current.delete(step.id);

                    return;
                  }

                  fields.current.set(step.id, element);

                  if (pending.current === step.id || focusId === step.id) {
                    pending.current = null;
                    element.focus();
                    onFocused();
                  }
                }}
                value={step.text}
              />
              <button
                aria-label={`Remove next step ${index + 1}`}
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 grid size-6 shrink-0 place-items-center rounded-md opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                onClick={() => {
                  remove(index);
                }}
                tabIndex={-1}
                type="button"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {steps.length > 0 && steps.length < STEPS_MAX ? (
        <button
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex h-8 items-center gap-2.5 self-start rounded-md pr-2 pl-1.5 text-sm outline-none focus-visible:ring-3"
          onClick={() => {
            insertAfter(steps.length - 1);
          }}
          type="button"
        >
          <span className="grid size-4 place-items-center">
            <HugeiconsIcon icon={Add01Icon} size={14} />
          </span>
          Next step
        </button>
      ) : null}
    </div>
  );
};
