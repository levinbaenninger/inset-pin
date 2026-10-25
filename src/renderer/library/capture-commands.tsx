import type { CaptureId } from "@shared/capture-record";
import { createContext, use, useEffect, useEffectEvent, useRef } from "react";
import type { ReactNode, RefObject } from "react";

import { isMac } from "@/shared/platform";

import { captureKeyAction } from "./capture-keys";

/** What the shown capture can do; the list's right-click menu calls these. */
export interface CaptureCommands {
  readonly id: CaptureId;
  readonly copyNote: () => void;
  readonly copyImage: () => void;
  readonly edit: () => void;
  readonly askDelete: () => void;
}

type CommandsRef = RefObject<CaptureCommands | null>;

const CaptureCommandsContext = createContext<CommandsRef | null>(null);

export const CaptureCommandsProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const commands = useRef<CaptureCommands | null>(null);

  return (
    <CaptureCommandsContext value={commands}>{children}</CaptureCommandsContext>
  );
};

export const useCaptureCommands = (): CommandsRef => {
  const commands = use(CaptureCommandsContext);

  if (commands === null) {
    throw new Error("useCaptureCommands needs a CaptureCommandsProvider");
  }

  return commands;
};

const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLElement && target.isContentEditable);

/** A dialog or an open menu handles its own keys. */
const inLayer = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]') !==
    null;

/** Enter keeps its meaning on buttons and on links to another capture. */
const enterActivates = (target: EventTarget | null, id: CaptureId): boolean =>
  target instanceof Element &&
  (target.closest("button") !== null ||
    target.closest(`a:not([data-capture-id="${id}"])`) !== null);

const hasTextSelection = (): boolean =>
  (window.getSelection()?.toString() ?? "") !== "";

/**
 * Publishes the shown capture's commands and gives them keys: Enter edits,
 * Backspace or Delete asks to delete, ⇧⌘C copies the image, and the copy
 * command (⌘C, Ctrl+C or Edit > Copy) copies the note when no text is selected.
 */
export const useCaptureShortcuts = (
  commands: CaptureCommands,
  active: boolean
): void => {
  const ref = useCaptureCommands();

  // Every render, so the menu always calls the current closures.
  useEffect(() => {
    ref.current = commands;
  });

  useEffect(
    () => () => {
      if (ref.current?.id === commands.id) {
        ref.current = null;
      }
    },
    [commands.id, ref]
  );

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      !active ||
      event.defaultPrevented ||
      event.isComposing ||
      isTextField(event.target) ||
      inLayer(event.target)
    ) {
      return;
    }

    const action = captureKeyAction(event, isMac);

    if (
      action === null ||
      (action === "edit" && enterActivates(event.target, commands.id))
    ) {
      return;
    }

    event.preventDefault();

    const run = {
      copyImage: commands.copyImage,
      delete: commands.askDelete,
      edit: commands.edit,
    }[action];

    run();
  });

  const onCopy = useEffectEvent((event: ClipboardEvent) => {
    if (
      !active ||
      hasTextSelection() ||
      isTextField(document.activeElement) ||
      inLayer(document.activeElement)
    ) {
      return;
    }

    event.preventDefault();
    commands.copyNote();
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

    return () => {
      window.removeEventListener("keydown", keyDown);
      document.removeEventListener("copy", copy);
    };
  }, []);
};
