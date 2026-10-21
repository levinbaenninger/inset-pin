import { readFile } from "node:fs/promises";
import path from "node:path";

import type { CaptureId } from "@shared/capture-record";
import { INSET_SCHEME, parseInsetUrl } from "@shared/inset-url";
import { protocol } from "electron";

import { APP_CSP } from "./window-security";

/** Must run before app ready. */
export const registerInsetScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      privileges: {
        codeCache: true,
        secure: true,
        standard: true,
        supportFetchAPI: true,
      },
      scheme: INSET_SCHEME,
    },
  ]);
};

export interface ProtocolSources {
  readonly rendererRoot: string;
  /** JPEG of the current draft's frame; null for any other id. */
  readonly draftPreview: (id: CaptureId) => Uint8Array | null;
  readonly captureImageFile: (id: CaptureId) => string | null;
}

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const notFound = (): Response => new Response(null, { status: 404 });

const image = (bytes: Uint8Array, type: string): Response =>
  new Response(Buffer.from(bytes), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
    },
  });

const serveAppFile = async (
  root: string,
  relative: string
): Promise<Response> => {
  const file = path.resolve(root, relative);
  const type = CONTENT_TYPES.get(path.extname(file));

  if (type === undefined || !file.startsWith(`${root}${path.sep}`)) {
    return notFound();
  }

  try {
    return new Response(await readFile(file), {
      headers: {
        "Content-Security-Policy": APP_CSP,
        "Content-Type": type,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
};

/**
 * inset://app serves the renderer bundle; inset://draft and inset://capture
 * serve images by validated id only. Image bytes are read into memory so no
 * file handle stays open (Windows renames fail while one is).
 */
export const handleInsetProtocol = (sources: ProtocolSources): void => {
  const root = path.resolve(sources.rendererRoot);

  protocol.handle(INSET_SCHEME, async (request) => {
    const parsed = request.method === "GET" ? parseInsetUrl(request.url) : null;

    if (parsed === null) {
      return notFound();
    }

    if (parsed.kind === "app") {
      return await serveAppFile(root, parsed.path);
    }

    if (parsed.kind === "draftImage") {
      const preview = sources.draftPreview(parsed.id);

      return preview === null ? notFound() : image(preview, "image/jpeg");
    }

    const file = sources.captureImageFile(parsed.id);

    if (file === null) {
      return notFound();
    }

    try {
      return image(await readFile(file), "image/png");
    } catch {
      return notFound();
    }
  });
};
