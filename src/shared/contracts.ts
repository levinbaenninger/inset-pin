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

const PIXEL_MAX = 100_000;
const Pixel = z.number().int().min(0).max(PIXEL_MAX);
const Extent = z.number().int().min(1).max(PIXEL_MAX);

const ImagePointSchema = z
  .object({ x: Pixel, y: Pixel })
  .transform((point) => pt<"image">(point.x, point.y));

const ImageRectSchema = z
  .object({ height: Extent, width: Extent, x: Pixel, y: Pixel })
  .transform((crop) => rect<"image">(crop.x, crop.y, crop.width, crop.height));

/** Everything the renderer owns in a draft: PinGeometry plus the thought. */
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
  /** url = inset://draft/<id>, the in-memory full-display frame. */
  readonly frame: {
    readonly url: string;
    readonly size: Size<"image">;
    readonly ppd: number;
  };
  /** Read only when the editor mounts; afterwards the renderer owns content. */
  readonly seed: DraftContent;
  readonly write: WriteStatus;
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

export type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export const captureContract = defineContract({
  events: { view: event<CaptureView>() },
  global: "insetCapture",
  methods: {
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
  events: { changed: event<null>() },
  global: "insetLibrary",
  methods: {
    copyImage: invoke(CaptureIdSchema, out<ActionResult>()),
    copyNote: invoke(CaptureIdSchema, out<ActionResult>()),
    get: invoke(CaptureIdSchema, out<CaptureDetail | null>()),
    list: invoke(z.void(), out<CaptureSummary[]>()),
    remove: invoke(CaptureIdSchema, out<ActionResult>()),
    startImageDrag: send(CaptureIdSchema),
    updateThought: invoke(
      z.object({ id: CaptureIdSchema, thought: SavedThoughtSchema }),
      out<ActionResult>()
    ),
  },
  name: "library",
});

export type CaptureContract = typeof captureContract;

export type LibraryContract = typeof libraryContract;
