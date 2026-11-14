import {
  ACTIVE,
  CaptureIdSchema,
  CaptureRecordSchema,
  SCHEMA_VERSION,
} from "@shared/capture-record";
import type { CaptureId, CaptureRecord } from "@shared/capture-record";

import { EXAMPLE_IMAGE } from "./pin-tutorial";
import type { ExampleCapture } from "./pin-tutorial";
import type { TutorialExamples } from "./tutorial/tutorial";

/** The source line an example shows: never a display, so it can't be taken for a real capture. */
export const EXAMPLE_SOURCE = "Example";

/** The examples come in a minute apart, so the first is the newest and opens first. */
const MINUTE_MS = 60_000;

/** One example as a saved capture, with its image and pins. */
export const exampleRecord = (
  example: ExampleCapture,
  id: CaptureId,
  at: Date
): CaptureRecord =>
  CaptureRecordSchema.parse({
    capturedAt: at.toISOString(),
    description: example.description,
    due: null,
    id,
    image: {
      file: "crop.png",
      heightPx: EXAMPLE_IMAGE.heightPx,
      pixelsPerDip: EXAMPLE_IMAGE.pixelsPerDip,
      widthPx: EXAMPLE_IMAGE.widthPx,
    },
    invokedVia: "shortcut",
    pins: example.pins.map((pin) => ({
      label: pin.label,
      x: pin.x,
      y: pin.y,
    })),
    schemaVersion: SCHEMA_VERSION,
    source: { kind: "display", label: EXAMPLE_SOURCE },
    status: ACTIVE,
    steps: example.steps.map((text, index) => ({
      done: false,
      id: `example-${index + 1}`,
      text,
    })),
    title: example.title,
    updatedAt: at.toISOString(),
  });

export interface ExampleStore {
  readonly publish: (
    record: CaptureRecord,
    png: Uint8Array
  ) => Promise<{ readonly ok: boolean }>;
  readonly remove: (id: CaptureId) => Promise<void>;
  readonly has: (id: CaptureId) => boolean;
}

const parse = (id: string): CaptureId | null => {
  const parsed = CaptureIdSchema.safeParse(id);

  return parsed.success ? parsed.data : null;
};

/**
 * The tutorial's example captures (src/main/tutorial/): saved like any
 * capture, through the store, on the very first run only. The ids come back
 * at once; the captures show once their files are written.
 */
export const createPinExamples = (deps: {
  readonly examples: readonly ExampleCapture[];
  readonly store: ExampleStore;
  readonly readImage: () => Promise<Uint8Array>;
  readonly newId: () => CaptureId;
  readonly now: () => Date;
  readonly warn: (message: string) => void;
}): TutorialExamples => ({
  exists: (id) => {
    const parsed = parse(id);

    return parsed !== null && deps.store.has(parsed);
  },
  remove: (ids) => {
    for (const id of ids) {
      const parsed = parse(id);

      if (parsed !== null) {
        void deps.store.remove(parsed);
      }
    }
  },
  seed: () => {
    const start = deps.now().getTime();

    const records = deps.examples.map((example, index) =>
      exampleRecord(example, deps.newId(), new Date(start - index * MINUTE_MS))
    );

    const write = async (): Promise<void> => {
      try {
        const png = await deps.readImage();

        for (const record of records) {
          // One at a time, as the store queues its writes anyway.
          // oxlint-disable-next-line no-await-in-loop
          const result = await deps.store.publish(record, png);

          if (!result.ok) {
            deps.warn(`Example capture not saved: ${record.title}`);
          }
        }
      } catch (error) {
        deps.warn(
          `Example captures not saved: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    };

    void write();

    return records.map((record) => record.id);
  },
});
