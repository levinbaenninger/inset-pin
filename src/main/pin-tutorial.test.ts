import { once } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { CaptureIdSchema, CaptureRecordSchema } from "@shared/capture-record";
import type {
  CaptureId,
  CaptureRecord,
  StoredEntry,
} from "@shared/capture-record";
import { shortcutLabel } from "@shared/shortcut";
import { libraryShortcuts, panelShortcuts } from "@shared/shortcuts";
import { describe, expect, it } from "vitest";

import {
  createPinExamples,
  EXAMPLE_SOURCE,
  exampleRecord,
  holdsOwnCapture,
} from "./pin-examples";
import {
  CAPTURE_PAGE,
  checklistDoneText,
  CHECKLIST_TITLE,
  EXAMPLE_IMAGE,
  HOME_PAGE,
  PIN_TASK_IDS,
  pinExamples,
  pinHints,
  pinSpotlight,
  pinTasks,
} from "./pin-tutorial";
import type { TutorialRecord } from "./tutorial/store";
import { createTutorial } from "./tutorial/tutorial";

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

/** A capture as the store lists it. */
const entry = (record: CaptureRecord): StoredEntry => ({
  id: record.id,
  kind: "ok",
  migratedFrom: null,
  record,
});

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
        has: (id) =>
          published.some((record) => record.id === id) && !removed.includes(id),
        publish: async (record) => {
          published.push(record);

          return await Promise.resolve({ ok: true });
        },
        remove: async (id) => {
          removed.push(id);

          return await Promise.resolve({ ok: true });
        },
      },
      warn: () => {},
    });

    const ids = examples.seed();

    // The examples are written after seed returns their ids.
    await delay(0);

    const reported = await examples.remove([ids[1] ?? "", "not-an-id"]);

    expect({
      exists: ids.map((id) => examples.exists(id)),
      ids,
      newestFirst: published.map((record) => record.capturedAt),
      removed,
      reported,
      task: PIN_TASK_IDS.capture,
    }).toStrictEqual({
      exists: [true, false],
      ids: [ID(1), ID(2)],
      newestFirst: ["2026-11-11T09:00:00.000Z", "2026-11-11T08:59:00.000Z"],
      removed: [ID(2)],
      reported: [ID(2)],
      task: "capture",
    });
  });

  it("gives the panel only the title tip: the preview says where to click, and a pin tip has no room beside it", () => {
    expect(
      pinHints(true)
        .filter((hint) => hint.page === CAPTURE_PAGE)
        .map((hint) => ({ id: hint.id, task: hint.task }))
    ).toStrictEqual([{ id: "title", task: PIN_TASK_IDS.save }]);
  });

  it("tells examples from the user's own captures by their record: while a deletion is queued, after one failed, and after a restart", () => {
    const at = new Date("2026-11-11T09:00:00.000Z");

    // What Remove Examples can leave in the library, whatever the tutorial remembers.
    const left = pinExamples(true).map((example, index) =>
      exampleRecord(example, ID(index + 1), at)
    );

    const own = CaptureRecordSchema.parse({
      ...left[0],
      id: ID(3),
      source: { kind: "display", label: "Studio Display" },
      title: "chairs over the cap",
    });

    expect({
      examplesLeft: holdsOwnCapture(left.map(entry)),
      withOwn: holdsOwnCapture([...left, own].map(entry)),
    }).toStrictEqual({ examplesLeft: false, withOwn: true });
  });

  it("warns when an example can't be deleted", async () => {
    const warned: string[] = [];

    const examples = createPinExamples({
      examples: pinExamples(true),
      newId: () => ID(1),
      now: () => new Date("2026-11-11T09:00:00.000Z"),
      readImage: async () => await Promise.resolve(new Uint8Array([1])),
      store: {
        has: () => true,
        publish: async () => await Promise.resolve({ ok: true }),
        remove: async (id) => {
          if (id === ID(2)) {
            throw new Error("EPERM: operation not permitted, unlink");
          }

          return await Promise.resolve({ ok: false });
        },
      },
      warn: (message) => {
        warned.push(message);
      },
    });

    const reported = await examples.remove([ID(1), ID(2)]);

    expect({ reported, warned: warned.toSorted() }).toStrictEqual({
      reported: [],
      warned: [
        `Example capture not removed: ${ID(1)}`,
        `Example capture not removed: ${ID(2)}`,
      ],
    });
  });
});

/** The library's captures, as main's store keeps them: a delete takes time on disk, can fail, or wait in its queue. */
const captureStore = () => {
  const items = new Map<CaptureId, CaptureRecord>();
  const failing = new Set<CaptureId>();
  let queue: Promise<unknown> = Promise.resolve();

  return {
    failing,
    hold: (until: Promise<unknown>) => {
      queue = until;
    },
    store: {
      has: (id: CaptureId) => items.has(id),
      publish: async (record: CaptureRecord) => {
        items.set(record.id, record);

        return await Promise.resolve({ ok: true });
      },
      remove: async (id: CaptureId) => {
        await Promise.all([queue, delay(1)]);

        if (failing.has(id)) {
          return { ok: false };
        }

        items.delete(id);

        return { ok: true };
      },
    },
  };
};

const memoryTutorialStore = () => {
  let saved: TutorialRecord | null = null;

  return {
    read: async () => await Promise.resolve(saved),
    write: async (next: TutorialRecord) => {
      saved = next;
      await Promise.resolve();
    },
  };
};

/** Pin's tutorial on a library and a saved record that outlive it, as across a restart. */
const startPin = async (
  captures: ReturnType<typeof captureStore>,
  saved: ReturnType<typeof memoryTutorialStore>
) => {
  let next = 0;

  const tutorial = createTutorial({
    doneText: checklistDoneText(true),
    examples: createPinExamples({
      examples: pinExamples(true),
      newId: () => {
        next += 1;

        return ID(next);
      },
      now: () => new Date("2026-11-11T09:00:00.000Z"),
      readImage: async () => await Promise.resolve(new Uint8Array([1])),
      store: captures.store,
      warn: () => {},
    }),
    firstRun: async () => await Promise.resolve(true),
    hints: pinHints(true),
    home: HOME_PAGE,
    onChange: () => {},
    pageVisible: () => true,
    spotlight: pinSpotlight(true),
    store: saved,
    tasks: pinTasks(true),
    title: CHECKLIST_TITLE,
  });

  await tutorial.load();
  // The examples are written after load returns their ids.
  await delay(0);

  const shown = () => ({
    examples: tutorial.view(HOME_PAGE).examples,
    offered: tutorial.view(HOME_PAGE).checklist?.examples,
  });

  return { shown, tutorial };
};

describe("Pin's Remove Examples", () => {
  it("keeps an example whose delete failed, offers to remove it again after a restart, and removes it then", async () => {
    const captures = captureStore();
    const saved = memoryTutorialStore();
    const first = await startPin(captures, saved);

    captures.failing.add(ID(2));
    first.tutorial.act(HOME_PAGE, { kind: "removeExamples" });
    await first.tutorial.settled();

    const afterFailure = first.shown();

    const again = await startPin(captures, saved);
    const afterRestart = again.shown();

    captures.failing.clear();
    again.tutorial.act(HOME_PAGE, { kind: "removeExamples" });
    await again.tutorial.settled();

    expect({
      afterFailure,
      afterRestart,
      afterRetry: again.shown(),
      before: { examples: [ID(1), ID(2)], offered: true },
    }).toStrictEqual({
      afterFailure: { examples: [ID(2)], offered: true },
      afterRestart: { examples: [ID(2)], offered: true },
      afterRetry: { examples: [], offered: false },
      before: { examples: [ID(1), ID(2)], offered: true },
    });
  });

  it("keeps the examples while their deletes wait in the store's queue, and settles once they are done", async () => {
    const captures = captureStore();
    const { shown, tutorial } = await startPin(captures, memoryTutorialStore());
    const queue = new EventTarget();

    let settled = false;

    captures.hold(once(queue, "done"));
    tutorial.act(HOME_PAGE, { kind: "removeExamples" });

    const settling = (async () => {
      await tutorial.settled();
      settled = true;
    })();

    await delay(5);

    const during = { ...shown(), settled };

    queue.dispatchEvent(new Event("done"));
    await settling;

    expect({ after: shown(), during }).toStrictEqual({
      after: { examples: [], offered: false },
      during: { examples: [ID(1), ID(2)], offered: true, settled: false },
    });
  });
});
