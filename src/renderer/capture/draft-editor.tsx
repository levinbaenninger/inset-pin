import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { canSaveTitle } from "@shared/capture-record";
import type {
  DraftContent,
  DraftView,
  QuitChoice,
  WriteStatus,
} from "@shared/contracts";
import { pt, WIDEN_STEP } from "@shared/geometry";
import type { PinGeometry, Point } from "@shared/geometry";
import {
  addPin,
  nudgePin,
  removePin,
  selectionAfterRemove,
} from "@shared/pins";
import {
  fieldKeyAction,
  keyLabels,
  panelShortcuts,
  zoomKeyAction,
} from "@shared/shortcuts";
import type { PinKeyAction } from "@shared/shortcuts";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { EntryFields, isFieldAction, useFieldsUi } from "@/fields/entry-fields";
import type { FieldsValue } from "@/fields/entry-fields";
import { captureBridge } from "@/shared/bridge";
import { IconButton, SHORTCUTS_ICON } from "@/shared/icon-button";
import { useLocalKeys } from "@/shared/keys";
import { isMac } from "@/shared/platform";
import { ShortcutList } from "@/shared/shortcut-sheet";
import { useExpiringState } from "@/shared/use-expiring-state";
import { usePinKeys } from "@/shared/use-pin-keys";

import { PinPreview, rescaleCrop } from "./pin-preview";

const api = captureBridge();

const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

/** How long a first click on Discard waits for the second. */
const DISCARD_ARM_MS = 4000;

const KEYS = keyLabels(isMac);

/** Anything the user would lose by discarding: words, a step, a due date or a pin. */
const hasContent = (content: DraftContent): boolean =>
  content.title.trim() !== "" ||
  content.description.trim() !== "" ||
  content.steps.some((step) => step.text.trim() !== "") ||
  content.due !== null ||
  content.pins.length > 0;

/** Discard asks for a second click once there is something to lose. */
const useArmedDiscard = (needsConfirm: boolean, discard: () => void) => {
  const [armedAt, setArmedAt] = useExpiringState<true>(DISCARD_ARM_MS);
  const armed = armedAt !== null;

  const disarm = useCallback((): void => {
    setArmedAt(null);
  }, [setArmedAt]);

  const press = (): void => {
    if (armed || !needsConfirm) {
      discard();
    } else {
      setArmedAt(true);
    }
  };

  return { armed, disarm, press };
};

/** A set-aside draft says so, because the shortcut brought it back instead of capturing the new point. */
const DraftCaption = ({ view }: { readonly view: DraftView }) => {
  const time = timeFormat.format(new Date(view.capturedAt));

  if (view.reopened) {
    return (
      <p className="leading-snug">
        <span className="text-foreground font-medium">
          Unsaved draft from {time}
        </span>
        <span className="text-muted-foreground block">
          Save or discard it to capture something new.
        </span>
      </p>
    );
  }

  return (
    <p className="text-muted-foreground truncate">
      {[view.sourceLabel, time].filter((part) => part !== null).join(" · ")}
    </p>
  );
};

const QUIT_TITLE_ID = "quit-title";
const QUIT_DETAIL_ID = "quit-detail";

/** Asked in the panel, next to the capture it is about, instead of in a separate system dialog. */
const QuitQuestion = ({
  answer,
  savable,
}: {
  readonly answer: (choice: QuitChoice) => void;
  readonly savable: boolean;
}) => {
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  return (
    <div
      aria-describedby={QUIT_DETAIL_ID}
      aria-labelledby={QUIT_TITLE_ID}
      className="bg-muted flex items-center gap-2 rounded-lg py-1.5 pr-1.5 pl-3"
      role="alertdialog"
    >
      <div className="flex min-w-0 flex-1 flex-col text-xs">
        <p className="font-medium" id={QUIT_TITLE_ID}>
          Save before quitting?
        </p>
        <p className="text-muted-foreground" id={QUIT_DETAIL_ID}>
          {savable
            ? "This capture isn’t saved yet."
            : "Add a title to save it."}
        </p>
      </div>
      <Button
        onClick={() => {
          answer("cancel");
        }}
        ref={savable ? undefined : firstRef}
        size="sm"
        type="button"
        variant="ghost"
      >
        Cancel
      </Button>
      <Button
        onClick={() => {
          answer("discard");
        }}
        size="sm"
        type="button"
        variant="destructive"
      >
        Discard
      </Button>
      <Button
        disabled={!savable}
        onClick={() => {
          answer("save");
        }}
        ref={savable ? firstRef : undefined}
        size="sm"
        title={`Save and quit (${KEYS.save})`}
        type="button"
      >
        Save
      </Button>
    </div>
  );
};

/** The panel's keys, in place of the form until Done or Escape. */
const PanelShortcuts = ({ onClose }: { readonly onClose: () => void }) => (
  <section
    aria-label="Keyboard shortcuts"
    className="flex flex-col gap-2 p-3"
    data-testid="shortcut-sheet"
  >
    <header className="flex min-h-7 items-center gap-2">
      <h2 className="mr-auto text-sm font-semibold">Keyboard Shortcuts</h2>
      <Button
        autoFocus
        onClick={onClose}
        size="sm"
        type="button"
        variant="ghost"
      >
        Done
        <Kbd>Esc</Kbd>
      </Button>
    </header>
    <ShortcutList compact groups={panelShortcuts(isMac)} />
  </section>
);

const answerQuit = (choice: QuitChoice): void => {
  api.answerQuit(choice);
};

const fieldsOf = (content: DraftContent): FieldsValue => ({
  description: content.description,
  due: content.due,
  steps: content.steps,
  title: content.title,
});

/** The middle of the crop, where ⇧P drops a pin when the pointer is not over the image. */
const cropCentre = (geometry: PinGeometry): Point<"image"> =>
  pt(
    geometry.crop.x + Math.floor(geometry.crop.width / 2),
    geometry.crop.y + Math.floor(geometry.crop.height / 2)
  );

export interface DraftEditorProps {
  readonly view: DraftView;
}

/** Every change goes to main at once, so main has the latest copy on blur, quit or a crash. */
export const DraftEditor = ({ view }: DraftEditorProps) => {
  const [content, setContent] = useState<DraftContent>(view.seed);
  const [selected, setSelected] = useState<number | null>(null);
  const [pinMode, setPinMode] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const pointerRef = useRef<Point<"image"> | null>(null);
  const fieldsUi = useFieldsUi();
  const [now, setNow] = useState(() => new Date());

  // A panel left open past midnight names due days from the new day.
  useEffect(() => {
    const refresh = (): void => {
      setNow(new Date());
    };

    window.addEventListener("focus", refresh);

    return () => {
      window.removeEventListener("focus", refresh);
    };
  }, []);

  // Disables Save from the click until main reports a newer write status.
  const [submittedWhile, setSubmittedWhile] = useState<WriteStatus | null>(
    null
  );

  const busy = view.write.kind === "saving" || submittedWhile === view.write;
  // Main ignores edits while it asks about quitting, so the fields lock too.
  const locked = busy || view.quitting;
  const savable = canSaveTitle(content.title);
  const { draftId, frame, write } = view;

  const discard = useArmedDiscard(hasContent(content), () => {
    api.discard(draftId);
  });

  const { armed, disarm } = discard;

  const change = useCallback(
    (next: DraftContent): void => {
      disarm();
      setContent(next);
      api.edit({ content: next, id: draftId });
    },
    [disarm, draftId]
  );

  const changeGeometry = (geometry: PinGeometry): void => {
    change({ ...content, crop: geometry.crop, pins: [...geometry.pins] });
  };

  const { titleRef } = fieldsUi;

  const save = useCallback((): void => {
    if (busy) {
      return;
    }

    if (!savable) {
      titleRef.current?.focus();

      return;
    }

    setSubmittedWhile(write);
    api.save({ content, id: draftId });
  }, [busy, content, draftId, titleRef, savable, write]);

  // While Discard waits for its second click, Escape only takes the question back.
  const dismiss = useCallback((): void => {
    if (armed) {
      disarm();
    } else {
      api.dismiss();
    }
  }, [armed, disarm]);

  const cancelQuit = useCallback((): void => {
    answerQuit("cancel");
  }, []);

  const saveAndQuit = useCallback((): void => {
    if (savable) {
      answerQuit("save");
    }
  }, [savable]);

  const closeSheet = useCallback((): void => {
    setSheetOpen(false);
  }, []);

  useLocalKeys(
    view.quitting
      ? { onEscape: cancelQuit, onSave: saveAndQuit }
      : { onEscape: sheetOpen ? closeSheet : dismiss, onSave: save }
  );

  const onPinKey = (action: PinKeyAction): void => {
    if (locked) {
      return;
    }

    const { crop, pins } = content;

    switch (action.kind) {
      case "toggleTool": {
        setPinMode(!pinMode);
        break;
      }

      case "drop": {
        const next = addPin(
          pins,
          pointerRef.current ?? cropCentre(content),
          crop
        );

        if (next !== null) {
          changeGeometry({ crop, pins: next });
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
          changeGeometry({ crop, pins: removePin(pins, selected) });
          setSelected(selectionAfterRemove(pins.length, selected));
        }

        break;
      }

      case "nudge": {
        if (selected !== null) {
          const step = frame.ppd * (action.far ? 10 : 1);

          changeGeometry({
            crop,
            pins: nudgePin(
              pins,
              selected,
              { x: action.dx * step, y: action.dy * step },
              crop
            ),
          });
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

  usePinKeys({
    enabled: !locked,
    onAction: onPinKey,
    pinCount: content.pins.length,
    selected,
  });

  // ⌘D, ⇧⌘D and ⇧⌘S reach the fields from anywhere; ⌘/ lists every key; ⌘= and ⌘− crop.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || locked) {
        return;
      }

      const field = fieldKeyAction(event, isMac);

      if (field === "shortcuts") {
        event.preventDefault();
        setSheetOpen((open) => !open);
      } else if (field !== null && isFieldAction(field)) {
        event.preventDefault();
        fieldsUi.run(field, fieldsOf(content), (value) => {
          change({ ...content, ...value });
        });
      }

      const zoom = zoomKeyAction(event, isMac);

      if (zoom !== null) {
        event.preventDefault();
        changeGeometry(
          rescaleCrop(
            content,
            frame,
            zoom === "widen" ? WIDEN_STEP : 1 / WIDEN_STEP
          )
        );
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  });

  useEffect(() => {
    const field = fieldsUi.titleRef.current;

    if (field !== null) {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }
  }, [fieldsUi.titleRef]);

  // The panel's window is as tall as its content, so the list replaces the form and the panel grows to fit it.
  if (sheetOpen) {
    return (
      <PanelShortcuts
        onClose={() => {
          setSheetOpen(false);
          titleRef.current?.focus();
        }}
      />
    );
  }

  return (
    <form
      className="flex flex-col gap-2.5 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <PinPreview
        caption={<DraftCaption view={view} />}
        disabled={locked}
        frame={frame}
        geometry={content}
        keys={{ tighten: KEYS.tighten, widen: KEYS.widen }}
        onChange={changeGeometry}
        onPinMode={setPinMode}
        onSelect={setSelected}
        pinMode={pinMode}
        pointerRef={pointerRef}
        selected={selected}
      />
      <div className="bg-background border-foreground/10 rounded-lg border">
        <EntryFields
          disabled={locked}
          now={now}
          onChange={(value) => {
            change({ ...content, ...value });
          }}
          titlePlaceholder="Title"
          ui={fieldsUi}
          value={fieldsOf(content)}
          variant="panel"
        />
      </div>
      {view.write.kind === "failed" ? (
        <Alert variant="destructive">
          <HugeiconsIcon icon={Alert02Icon} />
          <AlertTitle>Not saved. Your draft is kept.</AlertTitle>
          <AlertDescription>{view.write.message}</AlertDescription>
        </Alert>
      ) : null}
      {view.quitting ? (
        <QuitQuestion answer={answerQuit} savable={savable} />
      ) : (
        <div className="flex items-center gap-1">
          <Button
            disabled={busy}
            onClick={() => {
              discard.press();
            }}
            size="sm"
            type="button"
            variant={armed ? "destructive" : "ghost-destructive"}
          >
            {armed ? "Click again to discard" : "Discard"}
          </Button>
          <p aria-live="polite" className="sr-only">
            {armed ? "Esc keeps it" : ""}
          </p>
          <span className="flex-1" />
          {!savable && hasContent(content) ? (
            <p className="text-muted-foreground mr-1 text-xs">
              Add a title to save
            </p>
          ) : null}
          <IconButton
            icon={SHORTCUTS_ICON}
            keys={KEYS.shortcuts}
            label="Keyboard shortcuts"
            onClick={() => {
              setSheetOpen(true);
            }}
            side="top"
            type="button"
          />
          <Button
            disabled={busy || !savable}
            size="sm"
            title={savable ? `Save (${KEYS.save})` : "Add a title to save"}
            type="submit"
          >
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {view.write.kind === "failed" ? "Retry" : "Save"}
            <Kbd>{KEYS.save}</Kbd>
          </Button>
        </div>
      )}
    </form>
  );
};
