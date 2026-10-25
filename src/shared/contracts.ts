import { z } from "zod";

import {
  CaptureIdSchema,
  SavedThoughtSchema,
  ThoughtSchema,
} from "./capture-record";
import type { CaptureId, PointVia } from "./capture-record";
import { pt, rect } from "./geometry";
import type { Size } from "./geometry";
import { defineContract, event, invoke, out, send } from "./ipc";
import { SettingsSchema } from "./settings";
import type { IconPlace, SettingsView } from "./settings";

const PIXEL_MAX = 100_000;
const Pixel = z.number().int().min(0).max(PIXEL_MAX);
const Extent = z.number().int().min(1).max(PIXEL_MAX);

const ImagePointSchema = z
  .object({ x: Pixel, y: Pixel })
  .transform((point) => pt<"image">(point.x, point.y));

const ImageRectSchema = z
  .object({ height: Extent, width: Extent, x: Pixel, y: Pixel })
  .transform((crop) => rect<"image">(crop.x, crop.y, crop.width, crop.height));

export const DraftContentSchema = z.object({
  crop: ImageRectSchema,
  pin: ImagePointSchema,
  thought: ThoughtSchema,
});

export type DraftContent = z.output<typeof DraftContentSchema>;

const DraftEditSchema = z.object({
  content: DraftContentSchema,
  id: CaptureIdSchema,
});

export const QuitChoiceSchema = z.enum(["save", "discard", "cancel"]);

export type QuitChoice = z.output<typeof QuitChoiceSchema>;

export type WriteStatus =
  | { readonly kind: "editing" }
  | { readonly kind: "saving" }
  | { readonly kind: "failed"; readonly message: string };

export type CaptureProblem =
  | {
      readonly kind: "screenPermission";
      readonly status:
        | "denied"
        | "restricted"
        | "not-determined"
        | "granted-but-empty";
    }
  | { readonly kind: "displayNotMatched" }
  | { readonly kind: "failed"; readonly message: string };

export interface DraftView {
  readonly kind: "draft";
  readonly draftId: CaptureId;
  readonly capturedAt: string;
  readonly sourceLabel: string | null;
  readonly frame: {
    readonly url: string;
    readonly size: Size<"image">;
    readonly ppd: number;
  };
  /** Read only when the editor mounts; afterwards the renderer owns the content. */
  readonly seed: DraftContent;
  readonly write: WriteStatus;
  /** The draft was set aside and shown again, so the shortcut did not capture a new point. */
  readonly reopened: boolean;
  /** Quit was requested; the panel asks whether to save this thought first. */
  readonly quitting: boolean;
  /** Changes every time the panel is shown; echoed with height reports. */
  readonly surfaceKey: string;
}

export type CaptureView =
  | { readonly kind: "none" }
  | {
      readonly kind: "problem";
      readonly problem: CaptureProblem;
      readonly surfaceKey: string;
    }
  | DraftView;

export interface SavedImage {
  readonly url: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly pixelsPerDip: number;
}

export type ReadOnlyWhy = "newerVersion" | "unreadable";

export type CaptureSummary =
  | {
      readonly kind: "ok";
      readonly id: CaptureId;
      readonly title: string;
      readonly thought: string;
      readonly capturedAt: string;
      readonly sourceLabel: string | null;
      readonly image: SavedImage;
      readonly pin: { readonly x: number; readonly y: number };
    }
  | {
      readonly kind: "readOnly";
      readonly id: CaptureId;
      readonly why: ReadOnlyWhy;
    };

export type CaptureDetail =
  | Extract<CaptureSummary, { kind: "readOnly" }>
  | {
      readonly kind: "ok";
      readonly id: CaptureId;
      readonly title: string;
      readonly thought: string;
      readonly capturedAt: string;
      readonly updatedAt: string;
      readonly invokedVia: PointVia;
      readonly sourceLabel: string | null;
      readonly image: SavedImage;
      readonly pin: { readonly x: number; readonly y: number };
    };

export interface AppStatus {
  /** False when another app holds the capture shortcut. */
  readonly shortcutRegistered: boolean;
  /** Where the app's icon shows, so the welcome can say where to find the window again. */
  readonly iconIn: IconPlace;
}

/** Commands for the shown capture, sent from the app menu. */
export type LibraryCommand =
  | "copyNote"
  | "copyImage"
  | "edit"
  | "delete"
  | "pin"
  | "find";

export type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export const captureContract = defineContract({
  events: { view: event<CaptureView>() },
  global: "insetCapture",
  methods: {
    answerQuit: send(QuitChoiceSchema),
    discard: send(CaptureIdSchema),
    dismiss: send(z.void()),
    edit: send(DraftEditSchema),
    getView: invoke(z.void(), out<CaptureView>()),
    openScreenSettings: send(z.void()),
    relaunch: send(z.void()),
    reportHeight: send(
      z.object({
        height: z.number().int().min(1).max(4000),
        surfaceKey: z.string().max(200),
      })
    ),
    save: send(DraftEditSchema),
  },
  name: "capture",
});

export const libraryContract = defineContract({
  events: {
    changed: event<null>(),
    command: event<LibraryCommand>(),
    /** Asked from the tray or the Dock menu to show one capture. */
    show: event<CaptureId>(),
  },
  global: "insetLibrary",
  methods: {
    copyImage: invoke(CaptureIdSchema, out<ActionResult>()),
    copyNote: invoke(CaptureIdSchema, out<ActionResult>()),
    get: invoke(CaptureIdSchema, out<CaptureDetail | null>()),
    list: invoke(z.void(), out<CaptureSummary[]>()),
    pinToScreen: send(CaptureIdSchema),
    remove: invoke(CaptureIdSchema, out<ActionResult>()),
    startImageDrag: send(CaptureIdSchema),
    status: invoke(z.void(), out<AppStatus>()),
    updateThought: invoke(
      z.object({ id: CaptureIdSchema, thought: SavedThoughtSchema }),
      out<ActionResult>()
    ),
  },
  name: "library",
});

/** A capture pinned to the screen. Each pin window acts only on its own capture, which main knows by the sender. */
export const pinContract = defineContract({
  events: { changed: event<null>() },
  global: "insetPin",
  methods: {
    close: send(z.void()),
    copyImage: invoke(z.void(), out<ActionResult>()),
    get: invoke(z.void(), out<CaptureDetail | null>()),
    openInLibrary: send(z.void()),
  },
  name: "pin",
});

export const settingsContract = defineContract({
  events: { view: event<SettingsView>() },
  global: "insetSettings",
  methods: {
    /** The page's height, so the window fits it without empty space. */
    fitHeight: send(z.number().int().min(120).max(1200)),
    getView: invoke(z.void(), out<SettingsView>()),
    setOpenAtLogin: send(z.boolean()),
    update: send(SettingsSchema.partial()),
  },
  name: "settings",
});

export type CaptureContract = typeof captureContract;

export type PinContract = typeof pinContract;

export type SettingsContract = typeof settingsContract;

export type LibraryContract = typeof libraryContract;
