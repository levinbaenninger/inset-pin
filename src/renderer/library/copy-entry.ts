import { useEffect, useEffectEvent } from "react";

import { inLayer, isTextField } from "@/shared/key-targets";

/** The capture whose sidebar row has the focus, if one has. */
const focusedRowId = (): string | null =>
  document.activeElement?.closest<HTMLElement>("[data-capture-id]")?.dataset
    .captureId ?? null;

const copiesEntry = (): boolean =>
  (window.getSelection()?.toString() ?? "") === "" &&
  !isTextField(document.activeElement) &&
  !inLayer(document.activeElement);

/**
 * ⌘C, Ctrl+C or Edit > Copy with no text selected copies a capture as text:
 * the one whose sidebar row has the focus, else the open one. A row passes
 * its id; the open capture passes null and copies only while no row has the
 * focus, so exactly one handler copies. Chromium runs Copy with nothing
 * selected only when beforecopy is cancelled.
 */
export const useCopyEntry = (rowId: string | null, copy: () => void): void => {
  const owns = (): boolean => copiesEntry() && focusedRowId() === rowId;

  const onBeforeCopy = useEffectEvent((event: Event) => {
    if (owns()) {
      event.preventDefault();
    }
  });

  const onCopy = useEffectEvent((event: ClipboardEvent) => {
    if (owns()) {
      event.preventDefault();
      copy();
    }
  });

  useEffect(() => {
    const before = (event: Event): void => {
      onBeforeCopy(event);
    };

    const handle = (event: ClipboardEvent): void => {
      onCopy(event);
    };

    document.addEventListener("beforecopy", before);
    document.addEventListener("copy", handle);

    return () => {
      document.removeEventListener("beforecopy", before);
      document.removeEventListener("copy", handle);
    };
  }, []);
};
