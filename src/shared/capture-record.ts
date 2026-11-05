import { z } from "zod";

import { DueDateSchema } from "./due";

const LOWER_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const LINE_BREAK = /\r?\n/u;
const LINE_BREAKS = /\r?\n/gu;
const WHITESPACE_RUN = /\s+/gu;

/** Lowercase only: the app generates every id, so anything else is foreign. */
export const CaptureIdSchema = z
  .string()
  .regex(LOWER_UUID)
  .brand<"CaptureId">();

export type CaptureId = z.output<typeof CaptureIdSchema>;

export const THOUGHT_MAX = 10_000;
export const DESCRIPTION_MAX = THOUGHT_MAX;

/** A title is one line; a v1 thought's first line keeps up to this much. */
export const TITLE_MAX = 300;

/** Where a title is shown as a menu item or a file name. */
export const SHORT_TITLE_MAX = 80;
export const STEP_MAX = 500;
export const STEPS_MAX = 50;
export const PIN_LABEL_MAX = 80;
export const PINS_MAX = 30;
export const UNTITLED = "Untitled capture";

/** The one savability rule, shared by the Save button, reducer, quit gate and library edit. */
export const canSaveTitle = (title: string): boolean => title.trim().length > 0;

export const TitleSchema = z
  .string()
  .max(TITLE_MAX)
  .transform((title) => title.replaceAll(LINE_BREAKS, " "));

export const SavedTitleSchema = TitleSchema.refine(
  canSaveTitle,
  "Title is empty"
);

export const DescriptionSchema = z.string().max(DESCRIPTION_MAX);

export const StepSchema = z.object({
  done: z.boolean(),
  id: z.string().min(1).max(64),
  text: z.string().max(STEP_MAX),
});

export type Step = z.output<typeof StepSchema>;

export const StepsSchema = z.array(StepSchema).max(STEPS_MAX).readonly();

export const PointViaSchema = z.enum(["shortcut", "trayDelayed"]);

export type PointVia = z.output<typeof PointViaSchema>;

const IsoUtc = z.iso.datetime();

const Coordinate = z.number().int().nonnegative();

/** Crop pixels, top-left origin. The order gives the numbers. */
export const SavedPinSchema = z.object({
  label: z.string().max(PIN_LABEL_MAX).optional(),
  x: Coordinate,
  y: Coordinate,
});

export type SavedPin = z.output<typeof SavedPinSchema>;

export const SavedPinsSchema = z.array(SavedPinSchema).max(PINS_MAX).readonly();

export const StatusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("active") }),
  z.object({ at: IsoUtc, kind: z.literal("done") }),
]);

export type CaptureStatus = z.output<typeof StatusSchema>;

export const ACTIVE: CaptureStatus = { kind: "active" };

const ImageSchema = z.object({
  file: z.literal("crop.png"),
  heightPx: z.number().int().positive(),
  pixelsPerDip: z.number().positive(),
  widthPx: z.number().int().positive(),
});

/** Factual only: no path, URL or application identity. */
const SourceSchema = z.object({
  kind: z.literal("display"),
  label: z.string().nullable(),
});

const pinsInside = (
  pins: readonly SavedPin[],
  image: z.output<typeof ImageSchema>
): boolean =>
  pins.every((pin) => pin.x < image.widthPx && pin.y < image.heightPx);

/** Loose: unknown v1 keys survive. Read only; every write is v2. */
export const CaptureRecordV1Schema = z
  .looseObject({
    capturedAt: IsoUtc,
    id: CaptureIdSchema,
    image: ImageSchema,
    invokedVia: PointViaSchema,
    pin: z.object({ x: Coordinate, y: Coordinate }),
    schemaVersion: z.literal(1),
    source: SourceSchema,
    thought: z
      .string()
      .max(THOUGHT_MAX)
      .refine((thought) => thought.trim().length > 0, "Thought is empty"),
    updatedAt: IsoUtc,
  })
  .refine(
    (record) => pinsInside([record.pin], record.image),
    "pin outside crop"
  );

export type CaptureRecordV1 = z.output<typeof CaptureRecordV1Schema>;

export const SCHEMA_VERSION = 2;

/** Loose: unknown keys survive an edit. */
export const CaptureRecordSchema = z
  .looseObject({
    capturedAt: IsoUtc,
    description: DescriptionSchema,
    due: DueDateSchema.nullable(),
    id: CaptureIdSchema,
    image: ImageSchema,
    invokedVia: PointViaSchema,
    pins: SavedPinsSchema,
    schemaVersion: z.literal(SCHEMA_VERSION),
    source: SourceSchema,
    status: StatusSchema,
    steps: StepsSchema,
    title: SavedTitleSchema,
    updatedAt: IsoUtc,
  })
  .refine(
    (record) => pinsInside(record.pins, record.image),
    "pin outside crop"
  );

export type CaptureRecord = z.output<typeof CaptureRecordSchema>;

/** What the library edits in place. */
export const EditableFieldsSchema = z.object({
  description: DescriptionSchema,
  due: DueDateSchema.nullable(),
  pins: SavedPinsSchema,
  steps: StepsSchema,
  title: SavedTitleSchema,
});

export type EditableFields = z.output<typeof EditableFieldsSchema>;

const BLANK_LINES_AT_ENDS = /^(?:[ \t]*\r?\n)+|(?:\r?\n[ \t]*)+$/gu;

/**
 * A v1 thought as a title and a description: the first non-blank line, and
 * every line after it. Joining them gives the thought back, without blank
 * lines around it, so nothing the user wrote is lost. A first line longer than
 * a title can hold stays whole in the description.
 */
/** A v1 thought split for v2. */
export interface SplitThought {
  readonly title: string;
  readonly description: string;
}

export const splitThought = (thought: string): SplitThought => {
  const lines = thought.split(LINE_BREAK);
  const first = lines.findIndex((line) => line.trim().length > 0);

  if (first === -1) {
    return { description: "", title: UNTITLED };
  }

  const title = (lines[first] ?? "").trim();

  const rest = lines
    .slice(first + 1)
    .join("\n")
    .replaceAll(BLANK_LINES_AT_ENDS, "");

  if (title.length > TITLE_MAX) {
    return {
      description: thought.replaceAll(BLANK_LINES_AT_ENDS, ""),
      title: `${title.slice(0, TITLE_MAX - 1).trimEnd()}…`,
    };
  }

  return { description: rest, title };
};

/** The title and description as one text, as a v1 thought held them. */
export const joinThought = (title: string, description: string): string =>
  description.trim() === "" ? title : `${title}\n${description}`;

/** v1 → v2 in memory. The file on disk is rewritten only when the capture is edited. */
export const migrateV1 = (record: CaptureRecordV1): CaptureRecord => {
  const { pin, thought, ...rest } = record;
  const { description, title } = splitThought(thought);

  return {
    ...rest,
    description,
    due: null,
    pins: [{ x: pin.x, y: pin.y }],
    schemaVersion: SCHEMA_VERSION,
    status: ACTIVE,
    steps: [],
    title,
  };
};

const VersionProbeSchema = z.looseObject({ schemaVersion: z.number() });

export type StoredEntry =
  | {
      readonly kind: "ok";
      readonly id: CaptureId;
      readonly record: CaptureRecord;
      /** Read from a v1 file, which stays unchanged until the first edit. */
      readonly migratedFrom: 1 | null;
    }
  /** Written by a newer version: read-only, never rewritten or removed. */
  | {
      readonly kind: "foreign";
      readonly id: CaptureId;
      readonly schemaVersion: number;
    }
  /** Read-only. */
  | {
      readonly kind: "unreadable";
      readonly id: CaptureId;
      readonly reason: string;
    };

export const JsonTextSchema = z
  .string()
  .transform((text, ctx): z.core.util.JSONType => {
    try {
      return z.json().parse(JSON.parse(text));
    } catch {
      ctx.addIssue({ code: "custom", message: "not valid JSON" });

      return z.NEVER;
    }
  });

type Known =
  | { readonly ok: true; readonly record: CaptureRecord }
  | { readonly ok: false; readonly reason: string };

/** Parses JSON already read from capture.json as the version it says it is. */
const parseKnown = (version: number, json: z.core.util.JSONType): Known => {
  if (version === 1) {
    const v1 = CaptureRecordV1Schema.safeParse(json);

    return v1.success
      ? { ok: true, record: migrateV1(v1.data) }
      : { ok: false, reason: z.prettifyError(v1.error) };
  }

  const v2 = CaptureRecordSchema.safeParse(json);

  return v2.success
    ? { ok: true, record: v2.data }
    : { ok: false, reason: z.prettifyError(v2.error) };
};

/** The version is probed first, so a newer record is never reported as damaged. */
export const parseStoredEntry = (
  dirName: string,
  json: string
): StoredEntry | null => {
  const id = CaptureIdSchema.safeParse(dirName);

  if (!id.success) {
    return null;
  }

  const parsed = JsonTextSchema.safeParse(json);

  if (!parsed.success) {
    return {
      id: id.data,
      kind: "unreadable",
      reason: "capture.json is not valid JSON",
    };
  }

  const probe = VersionProbeSchema.safeParse(parsed.data);
  const version = probe.success ? probe.data.schemaVersion : 1;

  if (version !== 1 && version !== SCHEMA_VERSION) {
    return { id: id.data, kind: "foreign", schemaVersion: version };
  }

  const known = parseKnown(version, parsed.data);

  if (!known.ok) {
    return { id: id.data, kind: "unreadable", reason: known.reason };
  }

  if (known.record.id !== id.data) {
    return {
      id: id.data,
      kind: "unreadable",
      reason: "id does not match its directory",
    };
  }

  return {
    id: id.data,
    kind: "ok",
    migratedFrom: version === 1 ? 1 : null,
    record: known.record,
  };
};

/** A title in one short line, for menus and file names. Never stored. */
export const shortTitle = (title: string, max = SHORT_TITLE_MAX): string => {
  const line = title
    .split(LINE_BREAK)
    .map((text) => text.replaceAll(WHITESPACE_RUN, " ").trim())
    .find((text) => text.length > 0);

  if (line === undefined) {
    return UNTITLED;
  }

  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};
