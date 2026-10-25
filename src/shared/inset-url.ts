import { CaptureIdSchema } from "./capture-record";
import type { CaptureId } from "./capture-record";

export const INSET_SCHEME = "inset";
export const APP_ORIGIN = "inset://app";

export type PageName = "capture" | "library" | "pin" | "settings";

export type InsetRequest =
  | { readonly kind: "app"; readonly path: string }
  | { readonly kind: "draftImage"; readonly id: CaptureId }
  | { readonly kind: "captureImage"; readonly id: CaptureId };

// Checked on the raw string: URL parsing would resolve dot segments (including %2e) first.
const UNSAFE_RAW = /\.\.|%2e|%2f|%5c|\\|\?|#/iu;
const FILE_SEGMENT = /^[\w-][\w.-]*$/u;

export const insetUrl = {
  captureImage: (id: CaptureId): string => `${INSET_SCHEME}://capture/${id}`,
  draftImage: (id: CaptureId): string => `${INSET_SCHEME}://draft/${id}`,
  page: (name: PageName): string => `${APP_ORIGIN}/${name}.html`,
};

const parseImageId = (segments: readonly string[]): CaptureId | null => {
  const [only, ...rest] = segments;
  const id = CaptureIdSchema.safeParse(only);

  return rest.length === 0 && id.success ? id.data : null;
};

export const parseInsetUrl = (raw: string): InsetRequest | null => {
  if (UNSAFE_RAW.test(raw)) {
    return null;
  }

  const url = URL.parse(raw);

  if (
    url === null ||
    url.protocol !== `${INSET_SCHEME}:` ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    return null;
  }

  const segments = url.pathname.split("/").slice(1);

  if (url.host === "app") {
    return segments.length > 0 &&
      segments.every((segment) => FILE_SEGMENT.test(segment))
      ? { kind: "app", path: segments.join("/") }
      : null;
  }

  const id = parseImageId(segments);

  if (id === null) {
    return null;
  }

  if (url.host === "draft") {
    return { id, kind: "draftImage" };
  }

  return url.host === "capture" ? { id, kind: "captureImage" } : null;
};

/** Built by hand because the WHATWG origin of a custom scheme is "null". */
export const originOf = (raw: string): string | null => {
  const url = URL.parse(raw);

  return url === null ? null : `${url.protocol}//${url.host}`;
};
