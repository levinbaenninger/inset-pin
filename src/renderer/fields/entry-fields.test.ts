import { DueDateSchema } from "@shared/due";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EntryFields, useFieldsUi } from "./entry-fields";
import type { FieldsValue } from "./entry-fields";

const VALUE: FieldsValue = {
  description: "Delivery adds CHF 980",
  due: DueDateSchema.parse("2026-11-08"),
  steps: [
    { done: false, id: "a", text: "Ask Rieder" },
    { done: true, id: "b", text: "Tell Marco" },
  ],
  title: "Rieder’s quote",
};

const CONTROL = /<(?<tag>button|input|textarea)\b(?<attributes>[^>]*)>/gu;

/** Each control the panel's fields render, by its name, and whether it can be used. */
const controls = (disabled: boolean) => {
  const Panel = () =>
    createElement(EntryFields, {
      disabled,
      now: new Date(2026, 10, 7, 12),
      onChange: () => {
        throw new Error("a locked field changed");
      },
      titlePlaceholder: "Title",
      ui: useFieldsUi(),
      value: VALUE,
      variant: "panel",
    });

  return [...renderToStaticMarkup(createElement(Panel)).matchAll(CONTROL)].map(
    (match) => {
      const attributes = match.groups?.attributes ?? "";

      const name =
        /aria-label="(?<name>[^"]*)"/u.exec(attributes)?.groups?.name ??
        /data-testid="(?<name>[^"]*)"/u.exec(attributes)?.groups?.name ??
        match.groups?.tag;

      return `${name}${/ disabled=""/u.test(attributes) ? " (locked)" : ""}`;
    }
  );
};

describe(EntryFields, () => {
  it("locks every field while the panel saves, steps and Due included", () => {
    expect(controls(true)).toStrictEqual([
      "Title (locked)",
      "Description (locked)",
      "Done: next step 1 (locked)",
      // Radix's hidden checkbox, which a form would read.
      "input (locked)",
      "Next step 1 (locked)",
      "Remove next step 1 (locked)",
      "Done: next step 2 (locked)",
      "input (locked)",
      "Next step 2 (locked)",
      "Remove next step 2 (locked)",
      "button (locked)",
      "add-menu (locked)",
      // Node is no Mac, so the key reads as on Windows.
      "Due tomorrow. Change it (Ctrl+Shift+D) (locked)",
      "Clear Due (locked)",
    ]);
  });

  it("leaves them usable otherwise", () => {
    expect(controls(false)).toStrictEqual(
      controls(true).map((name) => name.replace(" (locked)", ""))
    );
  });
});
