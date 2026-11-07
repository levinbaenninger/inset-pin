import type { DueDate } from "./due";
import { pinLabelLines } from "./pins";

export interface EntryText {
  readonly title: string;
  readonly description: string;
  readonly steps: readonly { readonly text: string; readonly done: boolean }[];
  readonly due: DueDate | null;
  readonly pins: readonly { readonly label?: string }[];
}

/** What Copy Text (⌘C) puts on the clipboard: the title, then the description when there is one. */
export const entryPlainText = (
  entry: Pick<EntryText, "title" | "description">
): string =>
  [entry.title.trim(), entry.description.trim()]
    .filter((part) => part !== "")
    .join("\n\n");

/**
 * What Copy with Details (⌥⌘C) and Copy after saving put on the clipboard:
 * the title, then each part that has something in it.
 */
export const entryText = (entry: EntryText): string => {
  const steps = entry.steps
    .filter((step) => step.text.trim() !== "")
    .map((step) => `- [${step.done ? "x" : " "}] ${step.text.trim()}`);

  const labels = pinLabelLines(
    entry.pins.map((pin) => ({ ...pin, x: 0, y: 0 }))
  );

  return [
    entry.title.trim(),
    entry.description.trim(),
    steps.join("\n"),
    entry.due === null ? "" : `Due: ${entry.due}`,
    labels.join("\n"),
  ]
    .filter((part) => part !== "")
    .join("\n\n");
};
