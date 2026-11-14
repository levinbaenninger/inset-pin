import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { CaptureIdSchema, CaptureRecordSchema } from "@shared/capture-record";
import type { CaptureId, CaptureRecord } from "@shared/capture-record";
import { shortcutLabel } from "@shared/shortcut";
import { libraryShortcuts, panelShortcuts } from "@shared/shortcuts";
import { describe, expect, it } from "vitest";

import {
  createPinExamples,
  EXAMPLE_SOURCE,
  exampleRecord,
} from "./pin-examples";
import {
  CHECKLIST_TITLE,
  EXAMPLE_IMAGE,
  HOME_PAGE,
  PIN_TASK_IDS,
  pinExamples,
  pinHints,
  pinSpotlight,
  pinTasks,
} from "./pin-tutorial";
import { freshRecord } from "./tutorial/store";
import type { TutorialRecord } from "./tutorial/store";
import { createTutorial } from "./tutorial/tutorial";
import type { Tutorial } from "./tutorial/tutorial";

/** Every key the app answers, as its Keyboard Shortcuts sheets write them for the system. */
const realKeys = (mac: boolean): ReadonlySet<string> =>
  new Set<string>([
    ...[...libraryShortcuts(mac), ...panelShortcuts(mac)].flatMap((group) =>
      group.rows.map((row) => row.keys)
    ),
    shortcutLabel(mac),
  ]);

const RENDERER = path.resolve(import.meta.dirname, "../renderer");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return sources(full);
    }

    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
      ? [readFileSync(full, "utf-8")]
      : [];
  });

/** The anchors the renderer marks: coach("id"), and the checklist's own task rows. */
const markedAnchors = (): ReadonlySet<string> =>
  new Set([
    ...sources(RENDERER).flatMap((text) =>
      [...text.matchAll(/coach\(\s*"(?<id>[a-z][a-z0-9-]*)"\s*\)/gu)].flatMap(
        (match) => (match.groups?.id === undefined ? [] : [match.groups.id])
      )
    ),
    ...pinTasks(true).map((task) => `task-${task.id}`),
  ]);

const ID = (n: number): CaptureId =>
  CaptureIdSchema.parse(`00000000-0000-4000-8000-00000000000${n}`);

const taskKeys = (mac: boolean): string[] =>
  pinTasks(mac).flatMap((task) => (task.keys === null ? [] : [task.keys]));

const exampleText = (mac: boolean): string =>
  pinExamples(mac)
    .map((example) => `${example.title} ${example.description}`)
    .join(" ");

describe("Inset Context Pin's tutorial", () => {
  it("shows only keys the app really answers to, on macOS and Windows", () => {
    for (const mac of [true, false]) {
      const keys = realKeys(mac);

      expect(
        pinTasks(mac)
          .flatMap((task) => (task.keys === null ? [] : [task.keys]))
          .filter((shown) => !keys.has(shown))
      ).toStrictEqual([]);
    }
  });

  it("writes keys for the system: a Mac's on macOS, Ctrl on Windows", () => {
    expect({ mac: taskKeys(true), windows: taskKeys(false) }).toStrictEqual({
      mac: ["⌥⌘P", "⌘↩", "⇧⌘C"],
      windows: ["Ctrl+Alt+P", "Ctrl+Enter", "Ctrl+Shift+C"],
    });
  });

  it("points only at controls the pages mark", () => {
    const anchors = markedAnchors();

    const pointedAt = [
      ...pinTasks(true).flatMap((task) =>
        task.anchor === null ? [] : [task.anchor]
      ),
      ...pinHints(true).map((hint) => hint.anchor),
      ...pinSpotlight(true).map((step) => step.anchor),
    ];

    expect(pointedAt.filter((anchor) => !anchors.has(anchor))).toStrictEqual(
      []
    );
  });

  it("has the five tasks, ties hints to tasks it has, and has between four and six walkthrough stops", () => {
    const tasks = new Set(pinTasks(true).map((task) => task.id));

    expect({
      hints: pinHints(true).flatMap((hint) =>
        hint.task === null || tasks.has(hint.task) ? [] : [hint.task]
      ),
      steps: pinSpotlight(true).length,
      tasks: [...tasks],
    }).toStrictEqual({
      hints: [],
      steps: 6,
      tasks: ["capture", "pin", "save", "library", "copy"],
    });
  });

  it("makes example captures whose pins sit inside the image and that say they are examples", () => {
    const at = new Date("2026-11-11T09:00:00.000Z");

    const records = pinExamples(true).map((example, index) =>
      exampleRecord(example, ID(index + 1), at)
    );

    expect(
      records.map((record) => ({
        parsed: CaptureRecordSchema.safeParse(record).success,
        size: [record.image.widthPx, record.image.heightPx],
        source: record.source.label,
      }))
    ).toStrictEqual(
      records.map(() => ({
        parsed: true,
        size: [EXAMPLE_IMAGE.widthPx, EXAMPLE_IMAGE.heightPx],
        source: EXAMPLE_SOURCE,
      }))
    );
  });

  it("writes the examples' keys for the system", () => {
    expect({
      mac: ["⌥⌘P", "⇧⌘C", "⌘↩"].filter((key) =>
        exampleText(true).includes(key)
      ),
      windows: ["Ctrl+Alt+P", "Ctrl+Shift+C", "Ctrl+Enter"].filter((key) =>
        exampleText(false).includes(key)
      ),
    }).toStrictEqual({
      mac: ["⌥⌘P", "⇧⌘C", "⌘↩"],
      windows: ["Ctrl+Alt+P", "Ctrl+Shift+C", "Ctrl+Enter"],
    });
  });

  it.each([false, true])(
    "keeps queued and failed removals tagged without completing the library task (failure: %s)",
    async (fail) => {
      const ids = [ID(1), ID(2)];
      const items = new Set(ids);

      const pending: {
        readonly id: CaptureId;
        readonly finish: (removed: boolean) => void;
      }[] = [];

      let saved: TutorialRecord = {
        ...freshRecord(),
        examples: ids,
        examplesSeeded: true,
      };

      let tutorial: Tutorial;

      // As the library's store subscription: only a non-example ticks this task.
      const findInLibrary = (): void => {
        if (
          [...items].some(
            (id) => !tutorial.view(HOME_PAGE).examples.includes(id)
          )
        ) {
          tutorial.complete(PIN_TASK_IDS.library);
        }
      };

      const examples = createPinExamples({
        examples: pinExamples(true),
        newId: () => ID(3),
        now: () => new Date(),
        readImage: async () => await Promise.resolve(new Uint8Array()),
        store: {
          has: (id) => items.has(id),
          publish: async () => await Promise.resolve({ ok: true }),
          remove: async (id) => {
            // oxlint-disable-next-line promise/avoid-new -- the test finishes each queued deletion through this callback.
            await new Promise<void>((resolve) => {
              pending.push({
                finish: (removed) => {
                  if (removed) {
                    items.delete(id);
                    findInLibrary();
                  }

                  resolve();
                },
                id,
              });
            });
          },
        },
        warn: () => {},
      });

      const deps = {
        doneText: "All done.",
        examples,
        firstRun: async () => await Promise.resolve(false),
        hints: pinHints(true),
        home: HOME_PAGE,
        onChange: () => {},
        pageVisible: () => true,
        spotlight: pinSpotlight(true),
        store: {
          read: async () => await Promise.resolve(saved),
          write: async (next: typeof saved) => {
            saved = next;
            await Promise.resolve();
          },
        },
        tasks: pinTasks(true),
        title: CHECKLIST_TITLE,
      };

      tutorial = createTutorial(deps);

      const state = () => ({
        examples: tutorial.view(HOME_PAGE).examples,
        libraryDone: tutorial
          .view(HOME_PAGE)
          .checklist?.tasks.find((task) => task.id === PIN_TASK_IDS.library)
          ?.done,
        retry: tutorial.view(HOME_PAGE).checklist?.examples,
      });

      await tutorial.load();
      tutorial.act(HOME_PAGE, { kind: "removeExamples" });

      expect(state()).toStrictEqual({
        examples: ids,
        libraryDone: false,
        retry: true,
      });

      pending[0]?.finish(true);

      expect(state()).toStrictEqual({
        examples: [ID(2)],
        libraryDone: false,
        retry: true,
      });

      pending[1]?.finish(!fail);
      await tutorial.settled();

      // A failed deletion keeps its tag and retry action even after a restart.
      tutorial = createTutorial(deps);
      await tutorial.load();

      expect(state()).toStrictEqual({
        examples: fail ? [ID(2)] : [],
        libraryDone: false,
        retry: fail,
      });

      if (fail) {
        tutorial.act(HOME_PAGE, { kind: "removeExamples" });

        pending[2]?.finish(true);
      }

      expect({
        ...state(),
        removed: pending.map((item) => item.id),
      }).toStrictEqual({
        examples: [],
        libraryDone: false,
        retry: false,
        removed: fail ? [...ids, ID(2)] : ids,
      });

      items.add(ID(3));
      findInLibrary();

      expect(state()).toStrictEqual({
        examples: [],
        libraryDone: true,
        retry: false,
      });
      await tutorial.settled();
    }
  );

  it("saves the examples through the store, newest first, and removes them by id", async () => {
    const published: CaptureRecord[] = [];
    const removed: string[] = [];
    let next = 0;

    const examples = createPinExamples({
      examples: pinExamples(true),
      newId: () => {
        next += 1;

        return ID(next);
      },
      now: () => new Date("2026-11-11T09:00:00.000Z"),
      readImage: async () => await Promise.resolve(new Uint8Array([1])),
      store: {
        has: (id) => published.some((record) => record.id === id),
        publish: async (record) => {
          published.push(record);

          return await Promise.resolve({ ok: true });
        },
        remove: async (id) => {
          removed.push(id);
          await Promise.resolve();
        },
      },
      warn: () => {},
    });

    const ids = examples.seed();

    // The examples are written after seed returns their ids.
    await delay(0);

    examples.remove([ids[1] ?? "", "not-an-id"]);

    expect({
      exists: ids.map((id) => examples.exists(id)),
      ids,
      newestFirst: published.map((record) => record.capturedAt),
      removed,
      task: PIN_TASK_IDS.capture,
    }).toStrictEqual({
      exists: [true, true],
      ids: [ID(1), ID(2)],
      newestFirst: ["2026-11-11T09:00:00.000Z", "2026-11-11T08:59:00.000Z"],
      removed: [ID(2)],
      task: "capture",
    });
  });
});
