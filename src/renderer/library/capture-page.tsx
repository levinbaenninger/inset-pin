import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  MoreHorizontalIcon,
  PictureInPictureOnIcon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { EditableFields, SavedPin } from "@shared/capture-record";
import type { LibraryCommand, SavedCapture } from "@shared/contracts";
import {
  nudgePin,
  removePin,
  selectionAfterRemove,
  addPin,
} from "@shared/pins";
import { captureKeyAction, fieldKeyAction, keyLabels } from "@shared/shortcuts";
import type { PinKeyAction } from "@shared/shortcuts";
import { getRouteApi, Link } from "@tanstack/react-router";
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

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

import { MenuEntries, useCaptureCommands } from "./capture-commands";
import { onCommand } from "./command-bus";
import { formatCaptureTime, readOnlyText, sourceText } from "./format";
import { ImageEditor } from "./image-editor";
import { InlineSaver } from "./inline-saver";
import { useLibraryState } from "./library-state";
import { PaneHeader } from "./pane-header";

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

const hasTextSelection = (): boolean =>
  (window.getSelection()?.toString() ?? "") !== "";

/** Enter keeps its meaning on buttons, links and the image. */
const enterActivates = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest("button, a, [role='application']") !== null;

/** Space keeps its meaning on buttons, switches and the like. */
const spaceActivates = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest("button, [role='checkbox'], [role='switch']") !== null;

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

/** The capture on screen, edited in place: every field saves itself. */
const CaptureView = ({ capture }: { readonly capture: SavedCapture }) => {
  const { now } = useLibraryState();
  const { commands, dialog, entries } = useCaptureCommands(capture);
  const saver = useMemo(() => new InlineSaver(capture.id, api), [capture.id]);

  const { failure, fields } = useSyncExternalStore(
    saver.subscribe,
    saver.state
  );

  const value = fields ?? fieldsOf(capture);
  const fieldsUi = useFieldsUi();
  const [selected, setSelected] = useState<number | null>(null);
  const [pinMode, setPinMode] = useState(false);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const done = capture.status.kind === "done";

  const area = {
    height: capture.image.heightPx,
    width: capture.image.widthPx,
    x: 0,
    y: 0,
  };

  // The first copy is taken once; later ones only when they cannot overwrite typing.
  useEffect(() => {
    saver.adopt(fieldsOf(capture));
  }, [saver, capture]);

  // Leaving the capture saves what is left; closing the window runs no cleanup, so pagehide does.
  useEffect(() => {
    const flush = (): void => {
      saver.flush({ leaving: true });
    };

    window.addEventListener("pagehide", flush);

    return () => {
      window.removeEventListener("pagehide", flush);
      saver.flush();
    };
  }, [saver]);

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

  const setFields = (next: FieldsValue): void => {
    saver.edit({ ...value, ...next });
  };

  const setPins = (pins: readonly SavedPin[], immediately: boolean): void => {
    const next = { ...value, pins: [...pins] };

    if (immediately) {
      saver.editNow(next);
    } else {
      saver.edit(next);
    }
  };

  const onPinKey = (action: PinKeyAction): void => {
    const { pins } = value;

    switch (action.kind) {
      case "toggleTool": {
        setPinMode(!pinMode);
        break;
      }

      case "drop": {
        const next = addPin(
          pins,
          pointerRef.current ?? {
            x: Math.floor(area.width / 2),
            y: Math.floor(area.height / 2),
          },
          area
        );

        if (next !== null) {
          setPins(next, true);
          setSelected(next.length - 1);
        }

        break;
      }

      case "select": {
        setSelected(action.index);
        break;
      }

      case "remove": {
        if (selected !== null) {
          setPins(removePin(pins, selected), true);
          setSelected(selectionAfterRemove(pins.length, selected));
        }

        break;
      }

      case "nudge": {
        if (selected !== null) {
          const step = capture.image.pixelsPerDip * (action.far ? 10 : 1);

          setPins(
            nudgePin(
              pins,
              selected,
              { x: action.dx * step, y: action.dy * step },
              area
            ),
            true
          );
        }

        break;
      }

      case "deselect": {
        setSelected(null);
        break;
      }

      default: {
        break;
      }
    }
  };

  // A press anywhere but the image and its pin list lets the pin go, so ⌫ then asks to delete the capture.
  useEffect(() => {
    const release = (event: PointerEvent): void => {
      if (
        !(event.target instanceof Element) ||
        event.target.closest("[data-pin-area]") === null
      ) {
        setSelected(null);
      }
    };

    window.addEventListener("pointerdown", release, { capture: true });

    return () => {
      window.removeEventListener("pointerdown", release, { capture: true });
    };
  }, []);

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

    if (field !== null && isFieldAction(field)) {
      event.preventDefault();
      fieldsUi.run(field, value, setFields);

      return;
    }

    if (isTextField(event.target) || inLayer(event.target)) {
      return;
    }

    const action = captureKeyAction(event, isMac);

    if (
      action === null ||
      (action === "edit" && enterActivates(event.target)) ||
      (action === "done" && spaceActivates(event.target))
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
    } else if (action === "done") {
      event.preventDefault();
      commands.toggleDone();
    }
  });

  // The copy command (⌘C, Ctrl+C or Edit > Copy) copies the capture as text when no text is selected.
  const onCopy = useEffectEvent((event: ClipboardEvent) => {
    if (
      hasTextSelection() ||
      isTextField(document.activeElement) ||
      inLayer(document.activeElement)
    ) {
      return;
    }

    event.preventDefault();
    commands.copyText();
  });

  const onMenuCommand = useEffectEvent((command: LibraryCommand) => {
    const run: Partial<Record<LibraryCommand, () => void>> = {
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

    const copy = (event: ClipboardEvent): void => {
      onCopy(event);
    };

    window.addEventListener("keydown", keyDown);
    document.addEventListener("copy", copy);

    const stop = onCommand((command) => {
      onMenuCommand(command);
    });

    return () => {
      window.removeEventListener("keydown", keyDown);
      document.removeEventListener("copy", copy);
      stop();
    };
  }, []);

  const meta = [
    formatCaptureTime(capture.capturedAt),
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
          keys={KEYS.done}
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
          <DropdownMenuContent align="end" className="min-w-56">
            <MenuEntries entries={entries} kind="dropdown" />
          </DropdownMenuContent>
        </DropdownMenu>
        {dialog}
      </PaneHeader>
      <main className="min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto">
        <article className="mx-auto flex max-w-3xl flex-col gap-6 px-8 pt-3 pb-16">
          <div className="flex flex-col gap-1">
            <EntryFields
              now={now}
              onChange={setFields}
              onLeave={() => {
                saver.flush();
              }}
              onTitleBlur={() => {
                saver.restoreBlankTitle();
              }}
              titlePlaceholder="Title"
              ui={fieldsUi}
              value={value}
              variant="page"
            />
            {failure === null ? null : (
              <p className="text-destructive text-xs" role="alert">
                Couldn’t save. {failure}
              </p>
            )}
          </div>
          <ImageEditor
            image={capture.image}
            onChange={setPins}
            onCopy={() => {
              commands.copyImage();
            }}
            onDragOut={() => {
              api.startImageDrag(capture.id);
            }}
            onLeaveLabel={() => {
              saver.flush();
            }}
            onPinMode={setPinMode}
            onSelect={setSelected}
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
