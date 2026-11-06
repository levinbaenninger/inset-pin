import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..");

/** The only file allowed to write to the clipboard: every copy goes through its gate. */
const GATE = "main/copy-gate.ts";

/** Every way this code base could put something on a clipboard: Electron's, the web's, and a copy event's own data. */
const WRITERS: readonly RegExp[] = [
  /\bclipboard\s*\.\s*write\w*/gu,
  /\bwrite(?:Text|Image|HTML|RTF|Buffer|Bookmark|FindText)\s*\(/gu,
  /import\s*\{[^}]*\bclipboard\b[^}]*\}\s*from\s*["']electron["']/gu,
  /navigator\s*\.\s*clipboard/gu,
  /clipboardData\s*\.\s*setData/gu,
  /execCommand\s*\(\s*["'`](?:copy|cut)/gu,
];

const writesIn = (code: string): string[] =>
  WRITERS.flatMap((pattern) => [...code.matchAll(pattern)].map(([hit]) => hit));

const sourceFiles = (): string[] =>
  readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.(?:ts|tsx)$/u.test(entry.name) &&
        !/\.test\.tsx?$/u.test(entry.name)
    )
    .map((entry) =>
      path
        .relative(SRC, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/")
    );

describe("the clipboard", () => {
  it("is written only by the copy gate", () => {
    const writers = sourceFiles().filter(
      (file) => writesIn(readFileSync(path.join(SRC, file), "utf-8")).length > 0
    );

    expect(writers).toStrictEqual([GATE]);
  });

  it("would catch each kind of clipboard write", () => {
    expect(
      [
        "await clipboard.writeText(text)",
        "clipboard.write([new ClipboardItem({})])",
        "electron.clipboard.writeImage(image)",
        "const { writeText } = board; writeText(text)",
        'import { clipboard as board } from "electron";',
        "await navigator.clipboard.writeText(text)",
        "event.clipboardData.setData('text/plain', text)",
        'document.execCommand("copy")',
      ].map((code) => writesIn(code).length > 0)
    ).toStrictEqual([true, true, true, true, true, true, true, true]);
  });

  it("leaves reading and copy events alone", () => {
    expect(
      writesIn(
        'clipboard.readText(); document.addEventListener("copy", handle); event.preventDefault();'
      )
    ).toStrictEqual([]);
  });
});
