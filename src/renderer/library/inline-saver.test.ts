import { CaptureIdSchema } from "@shared/capture-record";
import type { EditableFields } from "@shared/capture-record";
import type { ActionResult } from "@shared/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InlineSaver, SAVE_AFTER_MS, storedFields } from "./inline-saver";

const ID = CaptureIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c");

const stored: EditableFields = {
  description: "Check with finance",
  due: null,
  pins: [{ x: 10, y: 20 }],
  steps: [{ done: false, id: "s1", text: "Ask" }],
  title: "Total is off",
};

const setup = (
  result: () => Promise<ActionResult> = async () =>
    await Promise.resolve({ ok: true })
) => {
  const update =
    vi.fn<
      (input: {
        id: typeof ID;
        fields: EditableFields;
      }) => Promise<ActionResult>
    >(result);

  const saver = new InlineSaver(ID, { update });

  saver.adopt(stored);

  return { saver, update };
};

describe(InlineSaver, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves a while after the last edit, once", async () => {
    const { saver, update } = setup();

    saver.edit({ ...stored, title: "Total is" });
    saver.edit({ ...stored, title: "Total is wrong" });
    await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS);

    expect(update).toHaveBeenCalledExactlyOnceWith({
      fields: { ...stored, title: "Total is wrong" },
      id: ID,
    });
  });

  it("saves a moved pin at once", async () => {
    const { saver, update } = setup();

    saver.editNow({ ...stored, pins: [{ x: 11, y: 20 }] });
    await vi.runAllTimersAsync();

    expect(update).toHaveBeenCalledOnce();
  });

  it("sends nothing when nothing changed or only spaces were added", async () => {
    const { saver, update } = setup();

    saver.edit({ ...stored, title: "Total is off " });
    saver.flush();
    await vi.runAllTimersAsync();

    expect(update).not.toHaveBeenCalled();
  });

  it("never saves a blank title and puts the saved one back", async () => {
    const { saver, update } = setup();

    saver.edit({ ...stored, title: "  " });
    saver.flush();
    saver.restoreBlankTitle();
    await vi.runAllTimersAsync();

    expect(update).not.toHaveBeenCalled();
    expect(saver.state().fields?.title).toBe("Total is off");
  });

  it("reports a failed save and sends it again on the next flush", async () => {
    let fail = true;

    const { saver, update } = setup(
      async () =>
        await Promise.resolve<ActionResult>(
          fail ? { message: "disk full", ok: false } : { ok: true }
        )
    );

    saver.edit({ ...stored, title: "New" });
    saver.flush();
    await vi.runAllTimersAsync();

    expect(saver.state().failure).toBe("disk full");

    fail = false;
    saver.flush();
    await vi.runAllTimersAsync();

    expect(update).toHaveBeenCalledTimes(2);
    expect(saver.state().failure).toBeNull();
  });

  it("does not let a stale stored copy overwrite unsaved typing", () => {
    const { saver } = setup();

    saver.edit({ ...stored, title: "Typing" });
    saver.adopt(stored);

    expect(saver.state().fields?.title).toBe("Typing");
  });

  it("takes a newer stored copy when nothing is unsaved", () => {
    const { saver } = setup();

    saver.adopt({ ...stored, title: "Changed elsewhere" });

    expect(saver.state().fields?.title).toBe("Changed elsewhere");
  });

  it("sends the latest copy straight away when the page goes away", () => {
    const { saver, update } = setup();

    saver.edit({ ...stored, description: "Last words" });
    saver.flush({ leaving: true });

    expect(update).toHaveBeenCalledExactlyOnceWith({
      fields: { ...stored, description: "Last words" },
      id: ID,
    });
  });
});

describe("settling before a copy", () => {
  it("resolves once main has the typed text, and reports a failed save", async () => {
    const { saver, update } = setup();

    saver.edit({ ...stored, description: "New words" });

    await expect(saver.settle()).resolves.toStrictEqual({ ok: true });
    expect(update).toHaveBeenLastCalledWith({
      fields: { ...stored, description: "New words" },
      id: ID,
    });

    const failing = setup(
      async () => await Promise.resolve({ message: "Disk full", ok: false })
    );

    failing.saver.edit({ ...stored, title: "Other" });

    await expect(failing.saver.settle()).resolves.toStrictEqual({
      message: "Disk full",
      ok: false,
    });
  });
});

describe(storedFields, () => {
  it("trims the title, steps and labels, drops blank ones, and keeps the description as typed", () => {
    expect(
      storedFields({
        description: " a\n ",
        due: null,
        pins: [
          { label: "  ", x: 1, y: 2 },
          { label: " Total ", x: 3, y: 4 },
        ],
        steps: [
          { done: false, id: "a", text: " x " },
          { done: false, id: "b", text: " " },
        ],
        title: " T ",
      })
    ).toStrictEqual({
      description: " a\n ",
      due: null,
      pins: [
        { x: 1, y: 2 },
        { label: "Total", x: 3, y: 4 },
      ],
      steps: [{ done: false, id: "a", text: "x" }],
      title: "T",
    });
  });
});
