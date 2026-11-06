import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  MoreHorizontalIcon,
  PictureInPictureOnIcon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { canSaveTitle } from "@shared/capture-record";
import type { EditableFields, SavedPin } from "@shared/capture-record";
import type { LibraryCommand, SavedCapture } from "@shared/contracts";
import {
  emptyHistory,
  endGesture,
  recordPins,
  redoPins,
  undoPins,
} from "@shared/pin-history";
import type { HistoryStep } from "@shared/pin-history";
import { applyPinKey } from "@shared/pins";
import { captureKeyAction, fieldKeyAction, keyLabels } from "@shared/shortcuts";
import type { PinKeyAction } from "@shared/shortcuts";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EntryFields, isFieldAction, useFieldsUi } from "@/fields/entry-fields";
import type { FieldsValue } from "@/fields/entry-fields";
import { libraryBridge } from "@/shared/bridge";
import { IconButton } from "@/shared/icon-button";
import { inLayer, isTextField } from "@/shared/key-targets";
import { isMac } from "@/shared/platform";
import { usePinKeys } from "@/shared/use-pin-keys";

import { MenuEntries, onMenuKey, useCaptureCommands } from "./capture-commands";
import { onCommand } from "./command-bus";
import { useCopyEntry } from "./copy-entry";
import { isWriting, writesNothing } from "./draft-lifecycle";
import { formatCaptureTime, readOnlyText, sourceText } from "./format";
import { ImageEditor } from "./image-editor";
import type { PinChange } from "./image-editor";
import { drafts, useDraft } from "./library-drafts";
import { useLibraryState } from "./library-state";
import { PaneHeader } from "./pane-header";
import { SaveFailure } from "./save-failure";

const api = libraryBridge();
const route = getRouteApi("/captures/$captureId");
const KEYS = keyLabels(isMac);

const fieldsOf = (capture: SavedCapture): EditableFields => ({
  description: capture.description,
  due: capture.due,
  pins: capture.pins,
  steps: capture.steps,
  title: capture.title,
});

/** Which pin edits undo together: one drag, one run of nudges to a pin, one label being typed. */
const gestureOf = (change: PinChange): string | null => {
  if (change.kind === "drag") {
    return `drag:${change.id}`;
  }

  return change.kind === "label" || change.kind === "nudge"
    ? `${change.kind}:${change.index}`
    : null;
};

/** Typing a label waits like any typing, and so does a drag until the pin is let go; the rest saves at once. */
const savesNow = (change: PinChange): boolean =>
  change.kind === "drag" ? change.done : change.kind !== "label";

/** Enter keeps its meaning on buttons, links and the image. */
const enterActivates = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest("button, a, [role='application']") !== null;

const Unavailable = ({
  description,
  title,
}: {
  readonly title: string;
  readonly description: string;
}) => (
  <>
    <PaneHeader />
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 pb-20 text-center">
      <span className="bg-muted text-muted-foreground grid size-10 place-items-center rounded-full">
        <HugeiconsIcon icon={Alert02Icon} size={18} />
      </span>
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="text-muted-foreground max-w-72 text-xs text-balance">
        {description}
      </p>
      <Button asChild size="sm" variant="outline">
        <Link to="/">Back to captures</Link>
      </Button>
    </main>
  </>
);

/**
 * The capture on screen, edited in place: every field saves itself through
 * the library's draft store, which keeps unsaved edits after the capture is
 * left. The fields show the draft when there is one, then what is typed.
 */
const CaptureView = ({ capture }: { readonly capture: SavedCapture }) => {
  const { id } = capture;
  const { now } = useLibraryState();
  const { commands, dialog, entries } = useCaptureCommands(capture);
  const draft = useDraft(id);

  const [value, setValue] = useState(
    () => drafts.get(id)?.values ?? fieldsOf(capture)
  );

  const fieldsUi = useFieldsUi();
  const [selected, setSelected] = useState<number | null>(null);
  const [pinMode, setPinMode] = useState(false);
  const [history, setHistory] = useState(emptyHistory<SavedPin>);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const done = capture.status.kind === "done";

  const area = {
    height: capture.image.heightPx,
    width: capture.image.widthPx,
    x: 0,
    y: 0,
  };

  // A newer stored copy shows only while nothing here is unsaved, so it never overwrites typing.
  const [shownStored, setShownStored] = useState(capture);

  if (shownStored !== capture) {
    setShownStored(capture);

    if (draft === undefined && !writesNothing(value, fieldsOf(capture))) {
      setValue(fieldsOf(capture));
    }
  }

  // Leaving the capture saves what is left, and the draft outlives the page; closing the window runs no cleanup, so pagehide does.
  useEffect(() => {
    const flush = (): void => {
      drafts.flush(id);
    };

    window.addEventListener("pagehide", flush);

    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [id]);

  // The app menu names Mark as Done after the capture on screen.
  useEffect(() => {
    api.reportShown({ done });
  }, [done]);

  useEffect(
    () => () => {
      api.reportShown(null);
    },
    []
  );

  /** Typing saves after a pause; a ticked step, a moved pin or an undo saves at once. */
  const change = (next: EditableFields, immediately = false): void => {
    setValue(next);
    drafts.edit(id, next, fieldsOf(capture), { now: immediately });
  };

  const setFields = (next: FieldsValue, immediately = false): void => {
    change({ ...value, ...next }, immediately);
  };

  /** A title left blank goes back to the one on disk. */
  const restoreBlankTitle = (): void => {
    if (!canSaveTitle(value.title)) {
      change({
        ...value,
        title: drafts.get(id)?.confirmed.title ?? capture.title,
      });
    }
  };

  /** Every pin edit goes through here, so it can be undone with ⌘Z, a gesture at a time. */
  const editPins = (pins: readonly SavedPin[], pinChange: PinChange): void => {
    const before = value.pins;

    // Updaters, since an edit and the selection change after it land in the same render.
    setHistory((current) => recordPins(current, before, gestureOf(pinChange)));

    change({ ...value, pins: [...pins] }, savesNow(pinChange));
  };

  const restore = (step: HistoryStep<SavedPin> | null): void => {
    if (step !== null) {
      setHistory(step.history);
      setSelected(null);
      change({ ...value, pins: [...step.pins] }, true);
    }
  };

  /** The selection lives in the image: choosing a pin by key puts the focus there, and leaving it lets the pin go. */
  const select = (index: number | null): void => {
    if (index !== selected) {
      setHistory(endGesture);
    }

    setSelected(index);

    const editor = imageRef.current?.closest("[data-pin-area]");

    if (index !== null && editor?.contains(document.activeElement) !== true) {
      imageRef.current?.focus({ preventScroll: true });
      imageRef.current?.scrollIntoView({ block: "nearest" });
    }
  };

  const onPinKey = (action: PinKeyAction): void => {
    if (action.kind === "toggleTool") {
      setPinMode(!pinMode);

      return;
    }

    const next = applyPinKey(
      { pins: value.pins, selected },
      action,
      area,
      pointerRef.current ?? {
        x: Math.floor(area.width / 2),
        y: Math.floor(area.height / 2),
      }
    );

    if (next.pins !== value.pins) {
      editPins(
        next.pins,
        action.kind === "nudge"
          ? { index: selected ?? 0, kind: "nudge" }
          : { kind: action.kind === "drop" ? "add" : "remove" }
      );
    }

    select(next.selected);
  };

  usePinKeys({
    enabled: true,
    onAction: onPinKey,
    pinCount: value.pins.length,
    selected,
  });

  const focusTitle = (): void => {
    const field = fieldsUi.titleRef.current;

    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  };

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) {
      return;
    }

    const field = fieldKeyAction(event, isMac);

    if (field === "float") {
      event.preventDefault();
      commands.float();

      return;
    }

    if (field === "copyDetails") {
      event.preventDefault();
      commands.copyDetails();

      return;
    }

    if (field !== null && isFieldAction(field)) {
      event.preventDefault();
      fieldsUi.run(field, value, setFields);

      return;
    }

    if (isTextField(event.target) || inLayer(event.target)) {
      return;
    }

    const action = captureKeyAction(event, isMac);

    // Space marks done only on a focused sidebar row, as in every Inset list.
    if (
      action === null ||
      action === "done" ||
      (action === "edit" && enterActivates(event.target))
    ) {
      return;
    }

    if (action === "edit") {
      event.preventDefault();
      focusTitle();
    } else if (action === "delete") {
      event.preventDefault();
      commands.askDelete();
    } else if (action === "copyImage") {
      event.preventDefault();
      commands.copyImage();
    } else if (action === "undo") {
      event.preventDefault();
      restore(undoPins(history, value.pins));
    } else if (action === "redo") {
      event.preventDefault();
      restore(redoPins(history, value.pins));
    }
  });

  useCopyEntry(null, commands.copyText);

  const onMenuCommand = useEffectEvent((command: LibraryCommand) => {
    const run: Partial<Record<LibraryCommand, () => void>> = {
      copyDetails: commands.copyDetails,
      copyImage: commands.copyImage,
      copyText: commands.copyText,
      delete: commands.askDelete,
      description: () => {
        fieldsUi.run("description", value, setFields);
      },
      done: commands.toggleDone,
      due: () => {
        fieldsUi.run("due", value, setFields);
      },
      edit: focusTitle,
      float: commands.float,
      pinTool: () => {
        setPinMode(!pinMode);
      },
      steps: () => {
        fieldsUi.run("steps", value, setFields);
      },
    };

    run[command]?.();
  });

  useEffect(() => {
    const keyDown = (event: KeyboardEvent): void => {
      onKeyDown(event);
    };

    window.addEventListener("keydown", keyDown);

    const stop = onCommand((command) => {
      onMenuCommand(command);
    });

    return () => {
      window.removeEventListener("keydown", keyDown);
      stop();
    };
  }, []);

  const meta = [
    formatCaptureTime(capture.capturedAt, now),
    sourceText(capture.sourceLabel),
    ...(done ? ["Done"] : []),
  ].join(" · ");

  return (
    <>
      <PaneHeader>
        <p
          className="text-muted-foreground mr-auto min-w-0 truncate text-xs"
          title={meta}
        >
          {meta}
        </p>
        <IconButton
          data-testid="toggle-done"
          icon={done ? Undo02Icon : CheckmarkCircle02Icon}
          label={done ? "Mark as not done" : "Mark as done"}
          onClick={() => {
            commands.toggleDone();
          }}
        />
        <IconButton
          icon={PictureInPictureOnIcon}
          keys={KEYS.float}
          label="Float on Top"
          onClick={() => {
            commands.float();
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              data-testid="more"
              icon={MoreHorizontalIcon}
              label="More"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-56"
            onKeyDownCapture={onMenuKey}
          >
            <MenuEntries entries={entries} kind="dropdown" />
          </DropdownMenuContent>
        </DropdownMenu>
        {dialog}
      </PaneHeader>
      <main className="min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto">
        <article className="mx-auto flex max-w-3xl flex-col gap-6 px-8 pt-3 pb-16">
          <div className="flex flex-col gap-1">
            <EntryFields
              addable={!done}
              now={now}
              onChange={setFields}
              onLeave={() => {
                drafts.flush(id);
              }}
              onTitleBlur={restoreBlankTitle}
              titlePlaceholder="Title"
              ui={fieldsUi}
              value={value}
              variant="page"
            />
            {draft === undefined || draft.error === null ? null : (
              <SaveFailure
                error={draft.error}
                onDiscard={() => {
                  drafts.discard(id);
                  setValue(fieldsOf(capture));
                  focusTitle();
                }}
                onRetry={() => {
                  drafts.flush(id);
                  focusTitle();
                }}
                writing={isWriting(draft)}
              />
            )}
          </div>
          <ImageEditor
            image={capture.image}
            imageRef={imageRef}
            onChange={editPins}
            onCopy={() => {
              commands.copyImage();
            }}
            onDragOut={() => {
              // The drag can't wait for a save, so it carries the pins on screen.
              drafts.flush(id);
              api.startImageDrag({
                id,
                pins: value.pins,
                title: canSaveTitle(value.title) ? value.title : capture.title,
              });
            }}
            onLeaveLabel={() => {
              setHistory(endGesture);
              drafts.flush(id);
            }}
            onPinMode={setPinMode}
            onSelect={select}
            pinMode={pinMode}
            pins={value.pins}
            pointerRef={pointerRef}
            selected={selected}
          />
        </article>
      </main>
    </>
  );
};

export const CapturePage = () => {
  const detail = route.useLoaderData();

  if (detail === null) {
    return (
      <Unavailable
        description="It may have been deleted."
        title="This capture no longer exists"
      />
    );
  }

  if (detail.kind === "readOnly") {
    return (
      <Unavailable
        description={readOnlyText(detail.why)}
        title="This capture can’t be shown"
      />
    );
  }

  // Keyed by id: the fields start from the stored copy once, and a reload after a save doesn't reset typing.
  return <CaptureView capture={detail} key={detail.id} />;
};
