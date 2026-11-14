import { shortcutLabel } from "@shared/shortcut";
import { keyLabels } from "@shared/shortcuts";
import type {
  SpotlightStep,
  TutorialHint,
  TutorialTask,
} from "@shared/tutorial";

/**
 * Inset Context Pin's part of the in-app tutorial kit (src/main/tutorial/):
 * its checklist, one-time hints, walkthrough and example captures, as plain
 * data. Keys come from the same tables as the menus and the Keyboard
 * Shortcuts sheet, written for the system: ⇧⌘C on a Mac, Ctrl+Shift+C on
 * Windows.
 */

/** The library window, which holds the checklist and runs the walkthrough. */
export const HOME_PAGE = "library";

/** The capture panel, where the first hints show. */
export const CAPTURE_PAGE = "capture";

export const CHECKLIST_TITLE = "Getting started";

/** What the checklist says once every task is done: where it comes back from, on this system. */
export const checklistDoneText = (mac: boolean): string =>
  mac
    ? "That’s the whole loop. Help › Getting Started, or the pin icon’s menu, brings this back."
    : "That’s the whole loop. Getting Started in the pin icon’s menu brings this back.";

export const PIN_TASK_IDS = {
  capture: "capture",
  copy: "copy",
  library: "library",
  pin: "pin",
  save: "save",
} as const;

const keysFor = (mac: boolean) => {
  const labels = keyLabels(mac);

  return {
    capture: shortcutLabel(mac),
    copyDetails: labels.copyDetails,
    copyImage: labels.copyImage,
    find: labels.find,
    save: labels.save,
    shortcuts: labels.shortcuts,
  };
};

export const pinTasks = (mac: boolean): readonly TutorialTask[] => {
  const keys = keysFor(mac);

  return [
    {
      anchor: null,
      how: `Hover over the detail you mean, in any app, and press ${keys.capture}. A panel opens beside the pointer with a crop around that spot.`,
      id: PIN_TASK_IDS.capture,
      keys: keys.capture,
      title: `Capture with ${keys.capture}`,
    },
    {
      anchor: null,
      how: "In the capture panel, click the spot that matters to place pin 1. Each click adds the next number.",
      id: PIN_TASK_IDS.pin,
      keys: null,
      title: "Place a pin",
    },
    {
      anchor: null,
      how: `Type a title in the panel and press ${keys.save}. Saving needs a title; Esc sets the draft aside.`,
      id: PIN_TASK_IDS.save,
      keys: keys.save,
      title: "Give it a title and save",
    },
    {
      anchor: "capture-list",
      how: mac
        ? "Every capture you save lands here, newest first. Open this window from the Dock icon or Recent captures… in the pin icon’s menu."
        : "Every capture you save lands here, newest first. Open this window from Recent captures… in the pin icon’s menu.",
      id: PIN_TASK_IDS.library,
      keys: null,
      title: "Find it in the library",
    },
    {
      anchor: "copy-image",
      how: `${keys.copyImage} copies the image with its pins, ${keys.copyDetails} the text with its details. Paste it into a chat, a doc or a ticket.`,
      id: PIN_TASK_IDS.copy,
      keys: keys.copyImage,
      title: "Copy it out",
    },
  ];
};

export const pinHints = (mac: boolean): readonly TutorialHint[] => {
  const keys = keysFor(mac);

  return [
    {
      anchor: "pin-preview",
      id: "place-pin",
      page: CAPTURE_PAGE,
      placement: "below",
      task: PIN_TASK_IDS.pin,
      // Short: the panel is only as tall as its page, and a longer tip has no room below the preview but over it.
      text: "Click the spot that matters to place pin 1.",
      title: "Pin what matters",
    },
    {
      anchor: "title-field",
      id: "title",
      page: CAPTURE_PAGE,
      // Above, over the preview: below the title the panel ends.
      placement: "above",
      task: PIN_TASK_IDS.save,
      text: `Say what the pins are about. ${keys.save} saves it to the library; Esc sets the draft aside.`,
      title: "Give it a title",
    },
    {
      anchor: "capture-list",
      id: "library",
      page: HOME_PAGE,
      placement: "inside",
      task: null,
      text: `Your captures, newest first. ${keys.find} searches titles, notes and pin labels.`,
      title: "Your library",
    },
    {
      // The library's chips for the fields a capture doesn't have yet; the panel's Add menu isn't in the library.
      anchor: "add-fields",
      id: "add-fields",
      page: HOME_PAGE,
      placement: "below",
      task: null,
      text: "Add a description, next steps or a due date here. None of it is needed when you capture.",
      title: null,
    },
  ];
};

export const pinSpotlight = (mac: boolean): readonly SpotlightStep[] => {
  const keys = keysFor(mac);

  return [
    {
      anchor: "capture-list",
      id: "list",
      text: "Every capture lands here, by day, newest first. Drag the sidebar’s edge to resize it.",
      title: "Your captures",
    },
    {
      anchor: "search",
      id: "search",
      text: `${keys.find} searches titles, descriptions, steps and pin labels. Type due: to filter by Due.`,
      title: "Search",
    },
    {
      anchor: "capture-image",
      id: "image",
      text: "The spot you captured, with its numbered pins. P places more; drag a pin to move it.",
      title: "The crop and its pins",
    },
    {
      anchor: "title-field",
      id: "fields",
      text: "Title, description, next steps and Due save as you type.",
      title: "Edit in place",
    },
    {
      anchor: "copy-image",
      id: "copy",
      text: `${keys.copyImage} copies the image with its pins, ${keys.copyDetails} the text with its details. Drag the image into another app to drop it as a file.`,
      title: "Copy it out",
    },
    {
      anchor: "sidebar-foot",
      id: "settings",
      text: `Settings and every keyboard shortcut (${keys.shortcuts}) are here.`,
      title: "Settings and keys",
    },
  ];
};

/** A pin on the example image, in its pixels. */
export interface ExamplePin {
  readonly x: number;
  readonly y: number;
  readonly label: string;
}

export interface ExampleCapture {
  readonly title: string;
  readonly description: string;
  readonly steps: readonly string[];
  readonly pins: readonly ExamplePin[];
}

/**
 * The example image (resources/example-capture.png, made by
 * scripts/generate-icons.ts): a budget table at 2 pixels per point.
 */
export const EXAMPLE_IMAGE = {
  file: "example-capture.png",
  heightPx: 600,
  pixelsPerDip: 2,
  widthPx: 960,
} as const;

/** The first run's example captures, newest first: each one is itself a thing to try. */
export const pinExamples = (mac: boolean): readonly ExampleCapture[] => {
  const keys = keysFor(mac);

  return [
    {
      description: `A panel opens with a crop around the spot you point at. Click to place pin 1, give it a title and press ${keys.save}. Your capture lands here, like this one.`,
      pins: [
        { label: "Pin 1 marks the spot", x: 800, y: 254 },
        { label: "Each click adds the next number", x: 800, y: 390 },
      ],
      steps: [
        "Capture something of your own",
        "Remove the examples from Getting started’s ⋯ menu",
      ],
      title: `Try it: point at a detail and press ${keys.capture}`,
    },
    {
      description: `${keys.copyImage} copies the image with its pins. ${keys.copyDetails} copies the title, notes and pin labels as text. Drag the image into another app to drop it as a file.`,
      pins: [{ label: "Copied images keep their pins", x: 440, y: 462 }],
      steps: [],
      title: `Copy a capture out with ${keys.copyImage}`,
    },
  ];
};
