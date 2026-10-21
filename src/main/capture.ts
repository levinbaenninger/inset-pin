import type { CaptureProblem } from "@shared/contracts";
import { pixelsPerDip, pt, size } from "@shared/geometry";
import type { DisplaySnapshot } from "@shared/geometry";
import { desktopCapturer, screen, systemPreferences } from "electron";
import type { NativeImage } from "electron";

import {
  matchSource,
  snapshotDisplay,
  thumbnailSizeFor,
} from "./display-source";
import type { Anchor, CaptureResult, FramePixels } from "./draft";

const PREVIEW_JPEG_QUALITY = 85;

/** Call synchronously in the shortcut callback, before any Inset UI exists. */
export const sampleAnchor = (): Anchor => {
  const cursor = screen.getCursorScreenPoint();

  return {
    display: snapshotDisplay(screen.getDisplayNearestPoint(cursor)),
    point: pt(cursor.x, cursor.y),
  };
};

const createPixels = (image: NativeImage): FramePixels => {
  let preview: Uint8Array | null = null;

  return {
    cropPng: (crop) =>
      image
        .crop({ height: crop.height, width: crop.width, x: crop.x, y: crop.y })
        .toPNG(),
    previewJpeg: () => {
      preview ??= image.toJPEG(PREVIEW_JPEG_QUALITY);

      return preview;
    },
  };
};

const macScreenStatus = (): ReturnType<
  typeof systemPreferences.getMediaAccessStatus
> | null =>
  process.platform === "darwin"
    ? systemPreferences.getMediaAccessStatus("screen")
    : null;

/**
 * Without permission macOS still returns an image showing only the wallpaper,
 * and a reported grant can still deliver an empty image.
 */
const permissionProblem = (imageEmpty: boolean): CaptureProblem | null => {
  const status = macScreenStatus();

  if (
    status === "denied" ||
    status === "restricted" ||
    status === "not-determined"
  ) {
    return { kind: "screenPermission", status };
  }

  if (!imageEmpty) {
    return null;
  }

  return status === "granted"
    ? { kind: "screenPermission", status: "granted-but-empty" }
    : { kind: "failed", message: "The screen image was empty." };
};

/** The size is read from the delivered image, never assumed from bounds × scaleFactor. */
export const captureDisplay = async (
  display: DisplaySnapshot
): Promise<CaptureResult> => {
  const before = macScreenStatus();

  if (before === "denied" || before === "restricted") {
    return { ok: false, problem: { kind: "screenPermission", status: before } };
  }

  const sources = await desktopCapturer.getSources({
    fetchWindowIcons: false,
    thumbnailSize: thumbnailSizeFor(display),
    types: ["screen"],
  });

  const index = matchSource(
    sources,
    display.id,
    screen.getAllDisplays().length
  );

  const image = index === null ? undefined : sources[index]?.thumbnail;

  if (image === undefined) {
    return { ok: false, problem: { kind: "displayNotMatched" } };
  }

  const problem = permissionProblem(image.isEmpty());

  if (problem !== null) {
    return { ok: false, problem };
  }

  const imageSize = image.getSize();

  return {
    frame: {
      pixels: createPixels(image),
      ppd: pixelsPerDip(display.bounds, imageSize),
      size: size(imageSize.width, imageSize.height),
    },
    ok: true,
  };
};
