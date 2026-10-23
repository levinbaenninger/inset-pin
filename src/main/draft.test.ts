import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { CaptureIdSchema } from "@shared/capture-record";
import type { DraftContent } from "@shared/contracts";
import { pt, rect, scaleCrop, size } from "@shared/geometry";
import type { DisplaySnapshot } from "@shared/geometry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDraftController,
  IDLE,
  mayQuit,
  SAVE_FAILED_NOTICE,
  step,
  toRecord,
  viewOf,
} from "./draft";
import type {
  CapturedFrame,
  CaptureResult,
  Draft,
  DraftDeps,
  DraftEvent,
  DraftState,
  QuitState,
  Step,
} from "./draft";
import { failNextWrite, nodeStoreFs, openCaptureStore } from "./store";

const ID = CaptureIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c");
const STALE_ID = CaptureIdSchema.parse("11111111-2222-4333-8444-555555555555");
const PNG = new Uint8Array([137, 80, 78, 71]);
const AT = new Date("2026-10-21T18:40:12.345Z");
const SAVED_AT = new Date("2026-10-21T18:41:00.000Z");

const display: DisplaySnapshot = {
  bounds: rect(0, 0, 1440, 900),
  id: 1,
  label: "Built-in Retina Display",
  scaleFactor: 2,
  workArea: rect(0, 25, 1440, 875),
};

const frame: CapturedFrame = {
  pixels: { cropPng: () => PNG, previewJpeg: () => PNG },
  ppd: 2,
  size: size(2880, 1800),
};

const anchor = { display, point: pt<"screen">(720, 450) };

const point: DraftEvent = {
  invocation: { anchor, at: AT, kind: "point", via: "shortcut" },
  type: "invoked",
};

const initialContent: DraftContent = {
  crop: rect(960, 600, 960, 600),
  pin: pt(1440, 900),
  thought: "",
};

const typed = (thought: string): DraftContent => ({
  ...initialContent,
  thought,
});

const run = (state: DraftState, ...events: readonly DraftEvent[]): Step => {
  let last: Step = { effects: [], state };

  for (const event of events) {
    last = step(last.state, event);
  }

  return last;
};

const captured = run(IDLE, point, { frame, id: ID, type: "captured" }).state;

const withThought = (thought: string): DraftState =>
  run(captured, { content: typed(thought), id: ID, type: "edited" }).state;

const draftOf = (state: DraftState): Draft => {
  if (state.phase !== "draft") {
    throw new Error(`Expected a draft, got ${state.phase}`);
  }

  return state.draft;
};

const savingWhile = (quit: QuitState): DraftState => ({
  draft: draftOf(withThought("Keep me")),
  phase: "draft",
  quit,
  shownSeq: 1,
  surface: "shown",
  write: { kind: "saving" },
});

describe(step, () => {
  it("captures on the first invocation, with the panel hidden", () => {
    expect(step(IDLE, point)).toStrictEqual({
      effects: [{ display, type: "capture" }],
      state: { invocation: point.invocation, phase: "capturing" },
    });
  });

  it("opens the draft with the sampled point as pin and the default crop", () => {
    expect(captured).toMatchObject({
      draft: {
        capturedAt: AT,
        content: initialContent,
        id: ID,
        via: "shortcut",
      },
      phase: "draft",
      shownSeq: 1,
      surface: "shown",
      write: { kind: "editing" },
    });
  });

  it("ignores an invocation while capturing", () => {
    const capturing = step(IDLE, point).state;

    expect(step(capturing, point)).toStrictEqual({
      effects: [],
      state: capturing,
    });
  });

  it("focuses the shown draft instead of capturing again", () => {
    expect(step(captured, point)).toStrictEqual({
      effects: [{ type: "focus" }],
      state: captured,
    });
  });

  it("restores a dismissed draft with its id, time, pin and thought", () => {
    const moved: DraftContent = {
      ...typed("Discount row"),
      pin: pt(1500, 950),
    };

    const dismissed = run(
      captured,
      { content: moved, id: ID, type: "edited" },
      { type: "dismissed" }
    ).state;

    const reopened = step(dismissed, point);

    expect(dismissed).toMatchObject({ surface: "hidden" });
    expect(reopened.effects).toStrictEqual([]);
    expect(reopened.state).toMatchObject({
      draft: { capturedAt: AT, content: moved, id: ID },
      shownSeq: 2,
      surface: "shown",
    });
  });

  it("reopens from the tray without capturing", () => {
    const dismissed = step(captured, { type: "dismissed" }).state;

    expect(
      step(dismissed, { invocation: { kind: "reopen" }, type: "invoked" })
    ).toMatchObject({
      effects: [],
      state: { shownSeq: 2, surface: "shown" },
    });
  });

  it("marks the view reopened only once a set-aside draft is shown again", () => {
    const refocused = step(captured, point).state;
    const reopened = step(step(captured, { type: "dismissed" }).state, point);

    expect(viewOf(captured)).toMatchObject({ reopened: false });
    expect(viewOf(refocused)).toMatchObject({ reopened: false });
    expect(viewOf(reopened.state)).toMatchObject({ reopened: true });
  });

  it("ignores edits for a stale draft id", () => {
    expect(
      step(captured, { content: typed("x"), id: STALE_ID, type: "edited" })
        .state
    ).toBe(captured);
  });

  it("repairs untrusted geometry from the renderer", () => {
    const outside: DraftContent = {
      crop: rect(2800, 0, 960, 600),
      pin: pt(0, 0),
      thought: "x",
    };

    expect(
      draftOf(
        step(captured, { content: outside, id: ID, type: "edited" }).state
      ).content
    ).toStrictEqual({
      crop: { height: 600, width: 960, x: 1920, y: 0 },
      pin: { x: 1920, y: 0 },
      thought: "x",
    });
  });

  it("refuses to save a blank thought", () => {
    expect(
      step(captured, { content: typed("  \n"), id: ID, type: "saveRequested" })
    ).toStrictEqual({
      effects: [],
      state: captured,
    });
  });

  it("keeps the draft after a failed write and retries with the same id", () => {
    const content = typed("Check the total");
    const saving = step(captured, { content, id: ID, type: "saveRequested" });

    const failed = step(saving.state, {
      id: ID,
      message: "EIO",
      type: "publishFailed",
    });

    const retry = step(failed.state, {
      content,
      id: ID,
      type: "saveRequested",
    });

    expect(saving.state).toMatchObject({ write: { kind: "saving" } });
    expect(failed).toMatchObject({
      effects: [],
      state: {
        draft: { content, id: ID },
        write: { kind: "failed", message: "EIO" },
      },
    });
    expect(retry.effects).toStrictEqual([
      { draft: draftOf(retry.state), type: "publish" },
    ]);
    expect(draftOf(retry.state).id).toBe(ID);
  });

  it("notifies when a save fails while the panel is hidden", () => {
    expect(
      run(
        captured,
        { content: typed("x"), id: ID, type: "saveRequested" },
        { type: "dismissed" },
        { id: ID, message: "EIO", type: "publishFailed" }
      )
    ).toMatchObject({
      effects: [{ message: SAVE_FAILED_NOTICE, type: "notify" }],
      state: { surface: "hidden", write: { kind: "failed" } },
    });
  });

  it("asks once on quit, then saves and quits", () => {
    const asking = step(withThought("Keep me"), { type: "quitHeld" });
    const again = step(asking.state, { type: "quitHeld" });
    const saving = step(asking.state, { choice: "save", type: "quitChoice" });
    const done = step(saving.state, { id: ID, type: "published" });

    expect(asking).toMatchObject({
      effects: [{ type: "focus" }],
      state: { quit: "asking" },
    });
    expect(again).toStrictEqual({ effects: [], state: asking.state });
    expect(saving).toMatchObject({
      effects: [{ type: "publish" }],
      state: { write: { kind: "saving" } },
    });
    expect(done).toStrictEqual({ effects: [{ type: "quit" }], state: IDLE });
    expect(mayQuit(done.state)).toBeTruthy();
  });

  it("tells the panel to ask only until the question is answered", () => {
    const asking = step(withThought("Keep me"), { type: "quitHeld" }).state;
    const saving = step(asking, { choice: "save", type: "quitChoice" }).state;
    const cancelled = step(asking, { choice: "cancel", type: "quitChoice" });

    expect(
      [asking, saving, cancelled.state].map((state) => viewOf(state))
    ).toMatchObject([
      { quitting: true },
      { quitting: false },
      { quitting: false },
    ]);
  });

  it("shows a hidden draft when quit asks about it", () => {
    const hidden = step(withThought("Keep me"), { type: "dismissed" }).state;

    expect(step(hidden, { type: "quitHeld" }).state).toMatchObject({
      quit: "asking",
      surface: "shown",
    });
  });

  it("discards or cancels from the quit question", () => {
    const asking = step(withThought("Keep me"), { type: "quitHeld" }).state;

    expect(
      step(asking, { choice: "discard", type: "quitChoice" })
    ).toStrictEqual({
      effects: [{ type: "quit" }],
      state: IDLE,
    });
    expect(
      step(asking, { choice: "cancel", type: "quitChoice" })
    ).toMatchObject({
      effects: [{ type: "focus" }],
      state: { quit: "none", surface: "shown" },
    });
  });

  it("clears the draft on explicit discard but not while saving", () => {
    const saving = step(withThought("x"), {
      content: typed("x"),
      id: ID,
      type: "saveRequested",
    }).state;

    expect(step(captured, { id: ID, type: "discarded" }).state).toBe(IDLE);
    expect(step(saving, { id: ID, type: "discarded" }).state).toBe(saving);
  });

  it("quits once a save that was running when quit was held completes", () => {
    const saving = step(withThought("Keep me"), {
      content: typed("Keep me"),
      id: ID,
      type: "saveRequested",
    }).state;

    const held = step(saving, { type: "quitHeld" });
    const done = step(held.state, { id: ID, type: "published" });

    expect(held).toMatchObject({
      effects: [],
      state: { quit: "afterSave", write: { kind: "saving" } },
    });
    expect(done).toStrictEqual({ effects: [{ type: "quit" }], state: IDLE });
  });

  it("shows the draft and stays running when the save before quitting fails", () => {
    expect(
      run(
        captured,
        { content: typed("Keep me"), id: ID, type: "saveRequested" },
        { type: "dismissed" },
        { type: "quitHeld" },
        { id: ID, message: "EIO", type: "publishFailed" }
      )
    ).toMatchObject({
      effects: [],
      state: {
        draft: { content: typed("Keep me"), id: ID },
        quit: "none",
        surface: "shown",
        write: { kind: "failed", message: "EIO" },
      },
    });
  });

  it("ignores the panel's save, discard and edits while it asks about quitting", () => {
    const asking = step(withThought("Keep me"), { type: "quitHeld" }).state;

    expect(
      [
        step(asking, {
          content: typed("Keep me"),
          id: ID,
          type: "saveRequested",
        }),
        step(asking, { id: ID, type: "discarded" }),
        step(asking, { content: typed("Changed"), id: ID, type: "edited" }),
      ].map((next) => next.state)
    ).toStrictEqual([asking, asking, asking]);
    expect(
      run(
        asking,
        { id: ID, type: "discarded" },
        { choice: "save", type: "quitChoice" }
      ).effects
    ).toMatchObject([
      { draft: { content: typed("Keep me") }, type: "publish" },
    ]);
  });

  // Not reachable through events any more; guards the question against a save that started first.
  it.each(["save", "discard"] as const)(
    "waits for a running save when the quit question is answered %s",
    (choice) => {
      expect(
        step(savingWhile("asking"), { choice, type: "quitChoice" })
      ).toStrictEqual({
        effects: [],
        state: savingWhile("afterSave"),
      });
    }
  );

  it("closes the problem panel on dismiss without keeping a draft", () => {
    const problem = run(IDLE, point, {
      problem: { kind: "displayNotMatched" },
      type: "captureFailed",
    }).state;

    expect(problem).toStrictEqual({
      anchor,
      phase: "problem",
      problem: { kind: "displayNotMatched" },
    });
    expect(step(problem, { type: "dismissed" })).toStrictEqual({
      effects: [],
      state: IDLE,
    });
  });
});

describe(mayQuit, () => {
  it("holds quit only for a savable or saving draft", () => {
    const saving = step(withThought("x"), {
      content: typed("x"),
      id: ID,
      type: "saveRequested",
    }).state;

    expect(
      [IDLE, withThought(""), withThought("x"), saving].map(mayQuit)
    ).toStrictEqual([true, true, false, false]);
  });
});

describe(toRecord, () => {
  it("stores the pin relative to the approved crop", () => {
    const widened = scaleCrop(
      rect(960, 600, 960, 600),
      pt(1200, 700),
      2,
      frame.size,
      2
    );

    const draft: Draft = {
      ...draftOf(captured),
      content: { crop: widened, pin: pt(1200, 700), thought: "Here" },
    };

    expect(toRecord(draft, SAVED_AT)).toStrictEqual({
      capturedAt: "2026-10-21T18:40:12.345Z",
      id: ID,
      image: {
        file: "crop.png",
        heightPx: 1200,
        pixelsPerDip: 2,
        widthPx: 1920,
      },
      invokedVia: "shortcut",
      pin: { x: 480, y: 200 },
      schemaVersion: 1,
      source: { kind: "display", label: "Built-in Retina Display" },
      thought: "Here",
      updatedAt: "2026-10-21T18:41:00.000Z",
    });
  });
});

const settle = async (): Promise<void> => {
  await delay(0);
};

const createFakes = (overrides: Partial<DraftDeps> = {}) => {
  const calls: string[] = [];

  const deps: DraftDeps = {
    capture: async (): Promise<CaptureResult> => {
      calls.push("capture");

      return await Promise.resolve({
        problem: { kind: "displayNotMatched" },
        ok: false,
      });
    },
    newId: () => ID,
    notify: (message) => {
      calls.push(`notify ${message}`);
    },
    now: () => SAVED_AT,
    publish: async () => {
      calls.push("publish");

      return await Promise.resolve({ ok: true });
    },
    quit: () => {
      calls.push("quit");
    },
    surface: {
      focus: () => {
        calls.push("focus");
      },
      hide: () => {
        calls.push("hide");
      },
      show: () => {
        calls.push("show");
      },
      whenHidden: async () => {
        calls.push("whenHidden");
        await Promise.resolve();
      },
    },
    ...overrides,
  };

  return { calls, controller: createDraftController(deps) };
};

const capturing = async (): Promise<CaptureResult> =>
  await Promise.resolve({ frame, ok: true });

describe(createDraftController, () => {
  it("hides a problem panel before capturing again", async () => {
    const { calls, controller } = createFakes();

    controller.invoke(point.invocation);
    await settle();
    calls.length = 0;
    controller.invoke(point.invocation);
    await settle();

    expect(calls).toStrictEqual(["hide", "whenHidden", "capture", "show"]);
  });

  it("never captures again while a dismissed draft exists", async () => {
    const { calls, controller } = createFakes({ capture: capturing });

    controller.invoke(point.invocation);
    await settle();
    controller.dismiss();
    calls.length = 0;
    controller.invoke(point.invocation);
    await settle();

    expect(calls).toStrictEqual(["show"]);
    expect(controller.view()).toMatchObject({
      draftId: ID,
      kind: "draft",
      surfaceKey: `${ID}:2`,
    });
  });

  it("serves the frame for the current draft id only", async () => {
    const { controller } = createFakes({ capture: capturing });

    controller.invoke(point.invocation);
    await settle();

    expect(controller.frame(ID)).toBe(frame);
    expect(controller.frame(STALE_ID)).toBeNull();
  });

  it("holds quit for a savable draft and asks in the panel", async () => {
    const { calls, controller } = createFakes({ capture: capturing });

    controller.invoke(point.invocation);
    await settle();
    controller.edit(ID, typed("Keep me"));

    expect(controller.holdQuitIfNeeded()).toBe("hold");
    expect(controller.view()).toMatchObject({ quitting: true });
    expect(calls).toContain("focus");
    expect(controller.tray()).toBe("shown");

    controller.answerQuit("discard");

    expect(calls.at(-1)).toBe("quit");
  });

  it("pushes a fresh view when the quit question ends, so an ignored Save stops waiting", async () => {
    const { calls, controller } = createFakes({ capture: capturing });

    controller.invoke(point.invocation);
    await settle();
    controller.edit(ID, typed("Keep me"));
    controller.subscribe(() => {
      calls.push("view pushed");
    });
    calls.length = 0;

    controller.holdQuitIfNeeded();
    controller.save(ID, typed("Keep me"));
    calls.push("save sent");
    controller.answerQuit("cancel");

    expect(calls).toStrictEqual([
      "view pushed",
      "focus",
      "save sent",
      "view pushed",
      "focus",
    ]);
    expect(controller.view()).toMatchObject({
      quitting: false,
      write: { kind: "editing" },
    });
  });
});

describe("draft and store together", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "inset-draft-"));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("saves a draft that reads back after reopening the store", async () => {
    const store = await openCaptureStore(root);

    const { controller } = createFakes({
      capture: capturing,
      publish: store.publish,
    });

    controller.invoke(point.invocation);
    await settle();
    controller.save(ID, typed("This total ignores the discount row"));
    await vi.waitFor(() => {
      expect(controller.view()).toStrictEqual({ kind: "none" });
    });

    const reopened = await openCaptureStore(root);

    expect(reopened.list()).toMatchObject([
      {
        id: ID,
        kind: "ok",
        record: {
          pin: { x: 480, y: 300 },
          thought: "This total ignores the discount row",
        },
      },
    ]);
  });

  it("leaves no saved capture after an explicit discard", async () => {
    const store = await openCaptureStore(root);

    const { calls, controller } = createFakes({
      capture: capturing,
      publish: store.publish,
    });

    controller.invoke(point.invocation);
    await settle();
    controller.edit(ID, typed("Never mind"));
    controller.discard(ID);
    await settle();

    expect(controller.view()).toStrictEqual({ kind: "none" });
    expect(calls).not.toContain("publish");

    const reopened = await openCaptureStore(root);

    expect(reopened.list()).toStrictEqual([]);
  });

  it("keeps the draft when the write fails and saves it under the same id on retry", async () => {
    const store = await openCaptureStore(root, {
      fs: failNextWrite(nodeStoreFs),
    });

    const { controller } = createFakes({
      capture: capturing,
      publish: store.publish,
    });

    const reopenedList = async () => {
      const reopened = await openCaptureStore(root);

      return reopened.list();
    };

    controller.invoke(point.invocation);
    await settle();
    controller.save(ID, typed("Retry me"));
    await vi.waitFor(() => {
      expect(controller.view()).toMatchObject({ write: { kind: "failed" } });
    });

    expect(controller.view()).toMatchObject({
      draftId: ID,
      seed: { thought: "Retry me" },
      write: {
        kind: "failed",
        message: "Simulated write failure (INSET_FAIL_NEXT_WRITE)",
      },
    });
    await expect(reopenedList()).resolves.toStrictEqual([]);

    controller.save(ID, typed("Retry me"));
    await vi.waitFor(() => {
      expect(controller.view()).toStrictEqual({ kind: "none" });
    });

    await expect(reopenedList()).resolves.toMatchObject([
      { id: ID, kind: "ok", record: { thought: "Retry me" } },
    ]);
  });
});
