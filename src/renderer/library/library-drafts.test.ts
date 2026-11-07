import { CaptureIdSchema } from "@shared/capture-record";
import type { EditableFields } from "@shared/capture-record";
import type { ActionResult } from "@shared/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLeaveGate } from "../../main/leave-gate";
import { openLibrary } from "./opening";

describe("the library's resume and count reporting together", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(["quit", "restart"] as const)(
    "saves fresh typing before %s when a completed save resumes before the count reporter runs",
    async (leaving) => {
      vi.useFakeTimers();
      vi.resetModules();

      const id = CaptureIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c");

      const stored: EditableFields = {
        description: "",
        due: null,
        pins: [],
        steps: [],
        title: "Saved title",
      };

      const calls: string[] = [];
      const saves: ((result: ActionResult) => void)[] = [];
      const writes: ((written: boolean) => void)[] = [];
      let unsaved = 0;

      const bridge = {
        discard: async (): Promise<ActionResult> =>
          await Promise.resolve({ ok: true }),
        leavePromptShown: (): void => undefined,
        resumeLeaving: (): void => undefined,
        unsavedCount: (count: number): void => {
          calls.push(`count:${String(count)}`);
          unsaved = count;
        },
        update: async () =>
          // oxlint-disable-next-line promise/avoid-new -- the test releases each save separately from the final disk wait.
          await new Promise<ActionResult>((resolve) => {
            saves.push(resolve);
          }),
      };

      vi.stubGlobal("window", { insetLibrary: bridge });
      const { drafts, leaveHold } = await import("./library-drafts");

      const gate = createLeaveGate({
        ask: async (requested) => {
          const answer = leaveHold.ask(requested);

          return await Promise.resolve(
            answer.ok ? { fields: null, ok: true } : answer
          );
        },
        confirm: async () => await Promise.resolve("cancel"),
        promptWithinMs: 1000,
        surface: () => {},
        unsaved: () => unsaved,
        written: async () =>
          // oxlint-disable-next-line promise/avoid-new -- keeps the library editable during main's final durable wait.
          await new Promise<boolean>((resolve) => {
            writes.push(resolve);
          }),
      });

      bridge.leavePromptShown = gate.shown;
      bridge.resumeLeaving = () => {
        calls.push("resume");
        gate.resume();
      };

      // Production creates the hold before opening installs its count reporter.
      const opening = openLibrary({
        drafts,
        owed: async () => await Promise.resolve([]),
        report: bridge.unsavedCount,
      });

      await opening.opened;
      drafts.edit(id, { ...stored, title: "First edit" }, stored);
      await gate.leave(leaving, () => {
        calls.push(leaving);
      });
      saves.shift()?.({ ok: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(writes).toHaveLength(1);

      drafts.edit(id, { ...stored, title: "Fresh edit" }, stored);
      writes.shift()?.(true);
      await vi.advanceTimersByTimeAsync(0);

      expect(calls).not.toContain(leaving);
      expect({
        title: drafts.get(id)?.values.title,
        pending: saves.length,
      }).toStrictEqual({ title: "Fresh edit", pending: 1 });

      saves.shift()?.({ ok: true });
      await vi.advanceTimersByTimeAsync(0);
      writes.shift()?.(true);
      await vi.advanceTimersByTimeAsync(0);

      expect({
        unsaved: drafts.unsaved(),
        exits: calls.filter((call) => call === leaving),
      }).toStrictEqual({ unsaved: null, exits: [leaving] });
    }
  );
});
