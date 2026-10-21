import { z } from "zod";

const LOWER_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const LINE_BREAK = /\r?\n/u;
const WHITESPACE_RUN = /\s+/gu;

/** Lowercase only: the app generates every id, so anything else is foreign. */
export const CaptureIdSchema = z
  .string()
  .regex(LOWER_UUID)
  .brand<"CaptureId">();

export type CaptureId = z.output<typeof CaptureIdSchema>;

export const THOUGHT_MAX = 10_000;
export const TITLE_MAX = 80;
export const UNTITLED = "Untitled capture";

/** The single savability rule: Save button, reducer, quit gate and library edit. */
export const canSaveThought = (thought: string): boolean =>
  thought.trim().length > 0;

export const ThoughtSchema = z.string().max(THOUGHT_MAX);

export const SavedThoughtSchema = ThoughtSchema.refine(
  canSaveThought,
  "Thought is empty"
);

export const PointViaSchema = z.enum(["shortcut", "trayDelayed"]);

export type PointVia = z.output<typeof PointViaSchema>;

const IsoUtc = z.iso.datetime();

/** Loose: unknown v1 keys survive a thought edit rewrite. */
export const CaptureRecordV1Schema = z
  .looseObject({
    capturedAt: IsoUtc,
    id: CaptureIdSchema,
    image: z.object({
      file: z.literal("crop.png"),
      heightPx: z.number().int().positive(),
      pixelsPerDip: z.number().positive(),
      widthPx: z.number().int().positive(),
    }),
    invokedVia: PointViaSchema,
    /** Crop pixels, top-left origin. */
    pin: z.object({
      x: z.number().int().nonnegative(),
      y: z.number().int().nonnegative(),
    }),
    schemaVersion: z.literal(1),
    /** Factual only: no path, URL or application identity. */
    source: z.object({
      kind: z.literal("display"),
      label: z.string().nullable(),
    }),
    thought: SavedThoughtSchema,
    updatedAt: IsoUtc,
  })
  .refine(
    (record) =>
      record.pin.x < record.image.widthPx &&
      record.pin.y < record.image.heightPx,
    "pin outside crop"
  );

export type CaptureRecordV1 = z.output<typeof CaptureRecordV1Schema>;

const VersionProbeSchema = z.looseObject({ schemaVersion: z.number() });

export type StoredEntry =
  | {
      readonly kind: "ok";
      readonly id: CaptureId;
      readonly record: CaptureRecordV1;
    }
  /** Written by another version: read-only, never rewritten or removed. */
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

/**
 * Classifies one capture directory. A name that is not a lowercase UUID is
 * not an entry. The version is probed before the v1 parse, so a newer record
 * is never reported as damaged.
 */
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

  if (probe.success && probe.data.schemaVersion !== 1) {
    return {
      id: id.data,
      kind: "foreign",
      schemaVersion: probe.data.schemaVersion,
    };
  }

  const record = CaptureRecordV1Schema.safeParse(parsed.data);

  if (!record.success) {
    return {
      id: id.data,
      kind: "unreadable",
      reason: z.prettifyError(record.error),
    };
  }

  if (record.data.id !== id.data) {
    return {
      id: id.data,
      kind: "unreadable",
      reason: "id does not match its directory",
    };
  }

  return { id: id.data, kind: "ok", record: record.data };
};

/** First non-blank line, whitespace collapsed, at most TITLE_MAX characters. Never stored. */
export const deriveTitle = (thought: string): string => {
  const line = thought
    .split(LINE_BREAK)
    .map((text) => text.replaceAll(WHITESPACE_RUN, " ").trim())
    .find((text) => text.length > 0);

  if (line === undefined) {
    return UNTITLED;
  }

  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
};
