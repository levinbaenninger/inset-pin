import type {
  CaptureContract,
  LibraryContract,
  OnboardingContract,
  PinContract,
  SettingsContract,
} from "@shared/contracts";
import type { Client } from "@shared/ipc";

declare global {
  // Each window's preload exposes exactly one of these (see src/preload/expose.ts).
  interface Window {
    readonly insetCapture?: Client<CaptureContract>;
    readonly insetLibrary?: Client<LibraryContract>;
    readonly insetOnboarding?: Client<OnboardingContract>;
    readonly insetPin?: Client<PinContract>;
    readonly insetSettings?: Client<SettingsContract>;
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

export const pinBridge = (): Client<PinContract> => {
  const api = window.insetPin;

  if (api === undefined) {
    throw new Error(
      "The floating bridge is only available in a floating capture."
    );
  }

  return api;
};

export const settingsBridge = (): Client<SettingsContract> => {
  const api = window.insetSettings;

  if (api === undefined) {
    throw new Error(
      "The settings bridge is only available in the settings window."
    );
  }

  return api;
};

export const onboardingBridge = (): Client<OnboardingContract> => {
  const api = window.insetOnboarding;

  if (api === undefined) {
    throw new Error(
      "The onboarding bridge is only available in the onboarding window."
    );
  }

  return api;
};
