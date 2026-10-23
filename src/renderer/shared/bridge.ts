import type { CaptureContract, LibraryContract } from "@shared/contracts";
import type { Client } from "@shared/ipc";

declare global {
  // Each window's preload exposes exactly one of these (see src/preload/expose.ts).
  interface Window {
    readonly insetCapture?: Client<CaptureContract>;
    readonly insetLibrary?: Client<LibraryContract>;
  }
}

export const captureBridge = (): Client<CaptureContract> => {
  const api = window.insetCapture;

  if (api === undefined) {
    throw new Error(
      "The capture bridge is only available in the capture panel."
    );
  }

  return api;
};

export const libraryBridge = (): Client<LibraryContract> => {
  const api = window.insetLibrary;

  if (api === undefined) {
    throw new Error(
      "The library bridge is only available in the library window."
    );
  }

  return api;
};
