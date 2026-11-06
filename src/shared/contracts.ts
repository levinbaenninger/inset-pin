import { z } from "zod";

import {
  CaptureIdSchema,
  DescriptionSchema,
  EditableFieldsSchema,
  PINS_MAX,
  SavedPinsSchema,
  StepsSchema,
  TitleSchema,
} from "./capture-record";
import type {
  CaptureId,
  CaptureStatus,
  PointVia,
  SavedPin,
  Step,
} from "./capture-record";
import { DueDateSchema } from "./due";
import type { DueDate } from "./due";
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

/** Pins are in screen-image pixels while drafting; saving makes them crop pixels. */
export const DraftContentSchema = z.object({
  crop: ImageRectSchema,
  description: DescriptionSchema,
  due: DueDateSchema.nullable(),
  pins: z.array(ImagePointSchema).max(PINS_MAX).readonly(),
  steps: StepsSchema,
  title: TitleSchema,
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
  /** Quit was requested; the panel asks whether to save this capture first. */
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

/** What the list shows and searches. */
export interface SavedCapture {
  readonly kind: "ok";
  readonly id: CaptureId;
  readonly title: string;
  readonly description: string;
  readonly steps: readonly Step[];
  readonly due: DueDate | null;
  readonly pins: readonly SavedPin[];
  readonly status: CaptureStatus;
  readonly capturedAt: string;
  readonly updatedAt: string;
  readonly invokedVia: PointVia;
  readonly sourceLabel: string | null;
  readonly image: SavedImage;
}

export type CaptureSummary =
  | SavedCapture
  | {
      readonly kind: "readOnly";
      readonly id: CaptureId;
      readonly why: ReadOnlyWhy;
    };

export type CaptureDetail = CaptureSummary;

export interface AppStatus {
  /** False when another app holds the capture shortcut. */
  readonly shortcutRegistered: boolean;
  /** Where the app's icon shows, so the welcome can say where to find the window again. */
  readonly iconIn: IconPlace;
}

/** Commands for the library and the shown capture, sent from the app menu and the tray. */
export type LibraryCommand =
  | "copyText"
  | "copyDetails"
  | "copyImage"
  | "edit"
  | "delete"
  | "float"
  | "done"
  | "description"
  | "due"
  | "steps"
  | "pinTool"
  | "find"
  | "shortcuts"
  | "toggleSidebar"
  | "showDone";

export type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

const ActionResultSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ message: z.string().max(2000), ok: z.literal(false) }),
]);

/** Main asks the library to save what is typed: into one capture before copying it, or into every one (null) before the window closes. */
export interface FlushRequest {
  readonly token: string;
  readonly id: CaptureId | null;
}

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
    /** Asked before a copy, a close or a quit: save what is typed, then answer `flushed` with the same token and how the save went. */
    flush: event<FlushRequest>(),
    /** Asked from the tray or the Dock menu to show one capture. */
    show: event<CaptureId>(),
  },
  global: "insetLibrary",
  methods: {
    /** New capture in 3 seconds, as from the tray, so the pointer can go back to the work. */
    captureSoon: send(z.void()),
    copyDetails: invoke(CaptureIdSchema, out<ActionResult>()),
    copyImage: invoke(CaptureIdSchema, out<ActionResult>()),
    copyText: invoke(CaptureIdSchema, out<ActionResult>()),
    /** The answer to a `flush` event: the edits reached the disk, or why not. */
    flushed: send(
      z.object({ result: ActionResultSchema, token: z.string().max(100) })
    ),
    /** Keeps the capture in a small window above every other app. */
    floatOnTop: send(CaptureIdSchema),
    get: invoke(CaptureIdSchema, out<CaptureDetail | null>()),
    list: invoke(z.void(), out<CaptureSummary[]>()),
    /** Ctrl+, on Windows, where no app menu offers Settings. */
    openSettings: send(z.void()),
    remove: invoke(CaptureIdSchema, out<ActionResult>()),
    /** Whether the capture on screen is done, so the menu can name Mark as Done; null for none. */
    reportShown: send(z.object({ done: z.boolean() }).nullable()),
    setDone: invoke(
      z.object({ done: z.boolean(), id: CaptureIdSchema }),
      out<ActionResult>()
    ),
    /**
     * The drag starts at once, so it carries the pins and title on screen
     * rather than waiting for them to be saved.
     */
    startImageDrag: send(
      z.object({
        id: CaptureIdSchema,
        pins: SavedPinsSchema,
        title: TitleSchema,
      })
    ),
    status: invoke(z.void(), out<AppStatus>()),
    update: invoke(
      z.object({ fields: EditableFieldsSchema, id: CaptureIdSchema }),
      out<ActionResult>()
    ),
  },
  name: "library",
});

/** A capture floating on top of other apps. Each window acts only on its own capture, which main knows by the sender. */
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
