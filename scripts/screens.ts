/**
 * Screenshots every window of the built renderer in its main states, light
 * and dark, as macOS and Windows show them, without screen access or a real
 * capture. Each page runs in Playwright's Chromium with a fake preload bridge
 * (scripts/fixtures/screens-bridge.ts) that answers from the sample data
 * below, so a before and an after run show the same captures.
 *
 * Before the shots it runs checks that press keys in the real renderer and
 * read back what the bridge was asked to do; a failed check fails the run.
 *
 *   pnpm screens            # builds, then writes release/screens/*.png
 *   node scripts/screens.ts [output folder]   # after pnpm build
 *   SCREENS_ONLY=checks node scripts/screens.ts /tmp/out   # the checks alone
 *   SCREENS_CHECK="due calendar" SCREENS_SCENE=calendar pnpm screens   # one check, some scenes
 */
import { once } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import { chromium } from "playwright";
import type { Browser, Locator, Page } from "playwright";
import { z } from "zod";

import { dayAndTime } from "../src/shared/dates.ts";
import { drawPins, pinSprite } from "../src/shared/pin-sprite.ts";
import { installBridge } from "./fixtures/screens-bridge.ts";
import type { BridgeInput, OwedFixture } from "./fixtures/screens-bridge.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const RENDERER = path.join(ROOT, "out", "renderer");

const OUT = path.resolve(
  process.argv[2] ?? path.join(ROOT, "release", "screens")
);

const FIXTURES = path.join(OUT, ".fixtures");

type Platform = "macos" | "windows";

type Theme = "light" | "dark";

const USER_AGENT: Record<Platform, string> = {
  macos:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
};

const PPD = 2;

/* ---------- Sample screens, rendered once into .fixtures ---------- */

const BASE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif; color: #1d1d1f; background: #fff; }
  .bar { height: 34px; background: #f1f1f3; display: flex; align-items: center; gap: 7px; padding: 0 12px; border-bottom: 1px solid #dedee2; }
  .bar i { width: 11px; height: 11px; border-radius: 50%; background: #ff5f57; display: inline-block; }
  .bar i:nth-child(2) { background: #febc2e; } .bar i:nth-child(3) { background: #28c840; }
  .bar b { margin-left: 10px; font-weight: 600; font-size: 12px; color: #555; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; font-size: 14px; }
  th, td { border-bottom: 1px solid #e6e6ea; padding: 9px 12px; text-align: left; }
  th { color: #6e6e73; font-weight: 600; font-size: 12px; background: #fafafb; }
  td.num, th.num { text-align: right; }
  .over { color: #c4271b; font-weight: 600; }
  tr.total td { font-weight: 700; background: #fff4f2; border-bottom: 0; }
`;

/** Each sample marks the details its pins point at with data-target. */
const SAMPLES = {
  budget: {
    body: `<div class="bar"><i></i><i></i><i></i><b>Office move budget.numbers</b></div>
      <div style="padding:14px 16px">
      <table>
        <tr><th>Item</th><th class="num">Quote</th><th class="num">Cap</th><th class="num">Diff</th></tr>
        <tr><td>Desks (12)</td><td class="num">9,840</td><td class="num">10,000</td><td class="num">−160</td></tr>
        <tr><td>Chairs (12)</td><td class="num">5,280</td><td class="num">5,000</td><td class="num over"><span data-target="chairs">+280</span></td></tr>
        <tr><td>Shelving</td><td class="num">2,160</td><td class="num">3,000</td><td class="num">−840</td></tr>
        <tr><td>Delivery</td><td class="num"><span data-target="delivery">980</span></td><td class="num">0</td><td class="num over">+980</td></tr>
        <tr class="total"><td>Total</td><td class="num"><span data-target="total">18,260</span></td><td class="num">18,000</td><td class="num over">+260</td></tr>
      </table></div>`,
  },
  calendar: {
    body: `<div class="bar"><i></i><i></i><i></i><b>Calendar — November</b></div>
      <div style="padding:16px 18px;display:grid;grid-template-columns:repeat(5,1fr);gap:8px;font-size:13px">
      ${["Mon 17", "Tue 18", "Wed 19", "Thu 20", "Fri 21"].map((day) => `<div style="color:#6e6e73;font-weight:600">${day}</div>`).join("")}
      <div style="background:#e8f1ff;border-left:3px solid #2f6fdf;padding:8px;border-radius:6px;height:90px">Movers book the lift</div>
      <div></div><div></div>
      <div style="background:#fff1db;border-left:3px solid #e08a00;padding:8px;border-radius:6px;height:60px" data-target="keys">Keys for level 3</div>
      <div style="background:#e7f6ea;border-left:3px solid #2e9447;padding:8px;border-radius:6px;height:120px">Team moves in</div>
      </div>`,
  },
  code: {
    body: `<div class="bar" style="background:#252526;border-color:#333"><i></i><i></i><i></i><b style="color:#bbb">sync/retry.ts</b></div>
      <pre style="margin:0;padding:14px 18px;background:#1e1e1e;color:#d4d4d4;font:13px/1.65 ui-monospace,Menlo,monospace;height:266px">
<span style="color:#c586c0">export async function</span> <span style="color:#dcdcaa">withRetry</span>(task, tries = <span style="color:#b5cea8">5</span>) {
  <span style="color:#c586c0">for</span> (<span style="color:#569cd6">let</span> i = <span style="color:#b5cea8">0</span>; i &lt; tries; i++) {
    <span style="color:#c586c0">try</span> {
      <span style="color:#c586c0">return await</span> task();
    } <span style="color:#c586c0">catch</span> (error) {
      <span style="background:#5a1d1d" data-target="sleep">await sleep(<span style="color:#b5cea8">100</span>);</span>  <span style="color:#6a9955">// same delay every time</span>
    }
  }
}</pre>`,
  },
  design: {
    body: `<div class="bar"><i></i><i></i><i></i><b>Settings dialog — Figma</b></div>
      <div style="background:#e9e9ee;height:266px;display:grid;place-items:center">
        <div style="width:340px;background:#fff;border-radius:12px;box-shadow:0 8px 30px #0002;padding:18px">
          <div style="font-weight:600;margin-bottom:6px">Delete project?</div>
          <div style="color:#6e6e73;font-size:13px;margin-bottom:18px">All files in “Office move” are removed.</div>
          <div style="display:flex;justify-content:flex-end;gap:8px;align-items:flex-start">
            <span style="padding:6px 12px;border:1px solid #d0d0d6;border-radius:8px;font-size:13px" data-target="cancel">Cancel</span>
            <span style="padding:6px 12px;background:#d93025;color:#fff;border-radius:8px;font-size:13px;margin-top:4px" data-target="delete">Delete</span>
          </div>
        </div>
      </div>`,
  },
  mail: {
    body: `<div class="bar"><i></i><i></i><i></i><b>Mail — Quote 2026-114</b></div>
      <div style="padding:16px 22px;font-size:14px">
        <div style="font-weight:600;font-size:16px">Quote 2026-114: office furniture</div>
        <div style="color:#6e6e73;font-size:12px;margin:2px 0 12px">Rieder Möbel AG · 2 Nov</div>
        <p style="margin:0 0 8px">Thank you for your enquiry. Please find our quote for 12 desks, 12 chairs and shelving attached.</p>
        <p style="margin:0"><mark style="background:#fff3a3" data-target="date">Delivery is possible from 24 November</mark> at the earliest.</p>
      </div>`,
  },
  signups: {
    body: `<div class="bar"><i></i><i></i><i></i><b>Analytics — Sign-ups</b></div>
      <div style="padding:16px 18px">
        <div style="font-weight:600;margin-bottom:8px">Daily sign-ups</div>
        <div style="display:flex;align-items:flex-end;gap:10px;height:190px;border-bottom:1px solid #ddd">
        ${[120, 135, 128, 140, 132, 96, 48, 125, 138, 131, 144, 137, 92, 51]
          .map(
            (value, index) =>
              `<div ${index === 13 ? 'data-target="dip"' : ""} style="flex:1;height:${value}px;background:${index === 6 || index === 13 ? "#e8590c" : "#4c6ef5"};border-radius:3px 3px 0 0"></div>`
          )
          .join("")}
        </div>
      </div>`,
  },
} as const;

type SampleName = keyof typeof SAMPLES;

/** The capture panel's screen: a desktop with the budget open, 1440×900 points at 2×. */
const DESKTOP = `
  <div style="position:fixed;inset:0;background:linear-gradient(135deg,#7b9acc,#c9a9d6 55%,#f1c7a8)"></div>
  <div style="position:absolute;left:180px;top:70px;width:1000px;height:700px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 20px 60px #0004">
    <div class="bar"><i></i><i></i><i></i><b>Office move budget.numbers</b></div>
    <div style="display:flex;height:666px">
      <div style="width:190px;background:#f6f6f8;border-right:1px solid #e3e3e8;padding:14px;font-size:13px;color:#555;line-height:2">Sheets<br><b style="color:#111">Budget</b><br>Quotes<br>Timeline</div>
      <div style="flex:1;padding:110px 40px 0 80px">
        <div data-target="sheet" style="width:430px">
        <div style="font-size:20px;font-weight:700;margin-bottom:10px">Furniture</div>
        <table>
          <tr><th>Item</th><th class="num">Quote</th><th class="num">Cap</th><th class="num">Diff</th></tr>
          <tr><td>Desks (12)</td><td class="num">9,840</td><td class="num">10,000</td><td class="num">−160</td></tr>
          <tr><td>Chairs (12)</td><td class="num">5,280</td><td class="num">5,000</td><td class="num over"><span data-target="chairs">+280</span></td></tr>
          <tr><td>Shelving</td><td class="num">2,160</td><td class="num">3,000</td><td class="num">−840</td></tr>
          <tr><td><span data-target="delivery">Delivery</span></td><td class="num">980</td><td class="num">0</td><td class="num over">+980</td></tr>
          <tr class="total"><td>Total</td><td class="num"><span data-target="total">18,260</span></td><td class="num">18,000</td><td class="num over">+260</td></tr>
        </table>
        </div>
      </div>
    </div>
  </div>`;

type Targets = Record<string, { x: number; y: number }>;

/** Renders a page at 2× and returns where each data-target's centre is, in image pixels. */
const renderFixture = async (
  browser: Browser,
  name: string,
  html: string,
  viewport: { width: number; height: number }
): Promise<Targets> => {
  const page = await browser.newPage({ deviceScaleFactor: PPD, viewport });

  await page.setContent(`<style>${BASE_CSS}</style>${html}`);

  const targets = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>("[data-target]")].map(
        (element) => {
          const box = element.getBoundingClientRect();

          return [
            element.dataset.target ?? "",
            { x: box.left + box.width / 2, y: box.top + box.height / 2 },
          ];
        }
      )
    )
  );

  await page.screenshot({ path: path.join(FIXTURES, `${name}.png`) });
  await page.close();

  return Object.fromEntries(
    Object.entries(targets).map(([key, point]) => [
      key,
      { x: Math.round(point.x * PPD), y: Math.round(point.y * PPD) },
    ])
  );
};

/* ---------- Sample data ---------- */

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const NOW = new Date();

const ago = (days: number, hours: number, minutes = 0) => {
  const date = new Date(NOW);

  date.setDate(date.getDate() - days);
  date.setHours(hours, minutes, 0, 0);

  return date.toISOString();
};

const dueIn = (days: number) => {
  const date = new Date(
    NOW.getFullYear(),
    NOW.getMonth(),
    NOW.getDate() + days
  );

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const CROP = { height: 300, width: 480 };

const image = (name: SampleName) => ({
  heightPx: CROP.height * PPD,
  pixelsPerDip: PPD,
  url: `/.fixtures/${name}.png`,
  widthPx: CROP.width * PPD,
});

const step = (n: number, text: string, done = false) => ({
  done,
  id: `s${n}`,
  text,
});

/** One sample capture, in the shape the library lists. */
const capture = (
  n: number,
  sample: SampleName,
  fields: {
    title: string;
    description?: string;
    steps?: { done: boolean; id: string; text: string }[];
    due?: string | null;
    pins: { x: number; y: number; label?: string }[];
    capturedAt: string;
    done?: string;
    source?: string;
  }
) => ({
  capturedAt: fields.capturedAt,
  description: fields.description ?? "",
  due: fields.due ?? null,
  id: uuid(n),
  image: image(sample),
  invokedVia: "shortcut",
  kind: "ok" as const,
  pins: fields.pins,
  sourceLabel: fields.source ?? "Studio Display",
  status:
    fields.done === undefined
      ? { kind: "active" }
      : { at: fields.done, kind: "done" },
  steps: fields.steps ?? [],
  title: fields.title,
  updatedAt: fields.capturedAt,
});

type Capture = ReturnType<typeof makeCaptures>[number];

const makeCaptures = (targets: (name: SampleName) => Targets) => {
  const at = (sample: SampleName, key: string, label?: string) => {
    const point = targets(sample)[key] ?? { x: 100, y: 100 };

    return label === undefined ? point : { ...point, label };
  };

  return [
    capture(1, "budget", {
      capturedAt: ago(0, 10, 42),
      description:
        "Chairs are CHF 280 over and delivery adds CHF 980 we never planned for. Marco signs off on anything above the cap.",
      due: dueIn(0),
      pins: [
        at("budget", "chairs", "Chairs over by CHF 280"),
        at("budget", "delivery", "Delivery was never budgeted"),
        at("budget", "total"),
      ],
      steps: [
        step(1, "Ask Rieder for a chair discount", true),
        step(2, "Get a second quote for delivery"),
        step(3, "Tell Marco the cap needs CHF 260 more"),
      ],
      title: "Rieder’s quote breaks the furniture cap",
    }),
    capture(2, "design", {
      capturedAt: ago(0, 9, 5),
      due: dueIn(1),
      pins: [at("design", "cancel"), at("design", "delete")],
      title: "Delete sits 4 px lower than Cancel",
    }),
    capture(3, "mail", {
      capturedAt: ago(1, 16, 20),
      description: "Three days after the team moves in.",
      due: dueIn(-2),
      pins: [at("mail", "date", "Earliest delivery")],
      steps: [step(4, "Ask whether 21 November works")],
      title: "Rieder can only deliver from the 24th",
    }),
    capture(4, "code", {
      capturedAt: ago(3, 11, 0),
      pins: [],
      source: "Built-in Retina Display",
      steps: [step(5, "Add exponential backoff"), step(6, "Cap at 5 s")],
      title: "Retry loop never backs off",
    }),
    capture(5, "calendar", {
      capturedAt: ago(2, 14, 10),
      done: ago(0, 8, 30),
      pins: [at("calendar", "keys")],
      title: "Keys arrive Thursday, movers come Monday",
    }),
    capture(6, "signups", {
      capturedAt: ago(5, 9, 30),
      description:
        "Same dip two Sundays in a row. Check whether the email job skips weekends.",
      due: dueIn(6),
      pins: [at("signups", "dip")],
      title: "Sign-ups drop every Sunday",
    }),
    capture(7, "budget", {
      capturedAt: ago(6, 15, 0),
      done: ago(3, 17, 0),
      pins: [at("budget", "total")],
      title: "Cleaning quote fits the budget line",
    }),
  ];
};

const READ_ONLY = { id: uuid(9), kind: "readOnly", why: "newerVersion" };

/** The app icon the onboarding's drag tile shows, as main reads it from the bundle. */
const APP_ICON_PNG = await readFile(path.join(ROOT, "build", "icon.png"));

const APP_ICON = `data:image/png;base64,${APP_ICON_PNG.toString("base64")}`;

type RowState = "allow" | "waiting" | "reopen" | "reopening" | "allowed";

type SetupPage = "welcome" | "access" | "done";

/** Setup's view as main builds it for Inset Context Pin (src/main/pin-onboarding.ts). */
const onboardingView = (
  current: SetupPage,
  state: RowState,
  steps: readonly SetupPage[] = ["welcome", "access", "done"]
) => ({
  appName: "Inset Context Pin",
  focus: "screen",
  handOff: {
    later:
      "Without screen access ⌥⌘P can’t capture anything. Set Up Permissions… in the Inset Context Pin menu or the pin icon’s menu asks again.",
    ready:
      "Inset Context Pin is ready. A short Getting started list in the library shows the rest.",
    showAround: "Show Me Around",
    start: "Start Using",
  },
  permissions: [
    {
      features: ["⌥⌘P"],
      id: "screen",
      listName: "Screen & System Audio Recording",
      purpose:
        "Lets ⌥⌘P capture the spot you point at. Only the crop you save is kept.",
      state,
      title: "Screen Recording",
    },
  ],
  step: { kind: current },
  steps: steps.map((kind) => ({ kind })),
  tagline: "Point at a place instead of describing it.",
  tile: { icon: APP_ICON, name: "Inset Context Pin" },
});

/** The tutorial's checklist tasks, as src/main/pin-tutorial.ts writes them for the system. */
const tutorialTasks = (mac: boolean) => {
  const keys = mac
    ? { capture: "⌥⌘P", copy: "⇧⌘C", details: "⌥⌘C", save: "⌘↩" }
    : {
        capture: "Ctrl+Alt+P",
        copy: "Ctrl+Shift+C",
        details: "Ctrl+Alt+C",
        save: "Ctrl+Enter",
      };

  return [
    {
      anchor: null,
      how: `Hover over the detail you mean, in any app, and press ${keys.capture}. A panel opens beside the pointer with a crop around that spot.`,
      id: "capture",
      keys: keys.capture,
      title: `Capture with ${keys.capture}`,
    },
    {
      anchor: null,
      how: "In the capture panel, click the spot that matters to place pin 1. Each click adds the next number.",
      id: "pin",
      keys: null,
      title: "Place a pin",
    },
    {
      anchor: null,
      how: `Type a title in the panel and press ${keys.save}. Saving needs a title; Esc sets the draft aside.`,
      id: "save",
      keys: keys.save,
      title: "Give it a title and save",
    },
    {
      anchor: "capture-list",
      how: "Every capture you save lands here, newest first.",
      id: "library",
      keys: null,
      title: "Find it in the library",
    },
    {
      anchor: "copy-image",
      how: `${keys.copy} copies the image with its pins, ${keys.details} the text with its details. Paste it into a chat, a doc or a ticket.`,
      id: "copy",
      keys: keys.copy,
      title: "Copy it out",
    },
  ];
};

const SPOTLIGHT_STEPS = [
  {
    anchor: "capture-list",
    id: "list",
    text: "Every capture lands here, by day, newest first. Drag the sidebar’s edge to resize it.",
    title: "Your captures",
  },
  {
    anchor: "search",
    id: "search",
    text: "⌘F searches titles, descriptions, steps and pin labels. Type due: to filter by Due.",
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
    text: "⇧⌘C copies the image with its pins, ⌥⌘C the text with its details. Drag the image into another app to drop it as a file.",
    title: "Copy it out",
  },
  {
    anchor: "sidebar-foot",
    id: "settings",
    text: "Settings and every keyboard shortcut (⌘/) are here.",
    title: "Settings and keys",
  },
];

/** A one-time tip, granted by main to the page it shows on. */
const shownHint = (
  id: string,
  anchor: string,
  title: string | null,
  text: string,
  placement: "below" | "above" | "inside" = "below"
) => ({ anchor, id, kind: "hint", placement, text, title });

const PLACE_PIN_HINT = shownHint(
  "place-pin",
  "pin-preview",
  "Pin what matters",
  "Click the spot that matters to place pin 1."
);

const TITLE_HINT = shownHint(
  "title",
  "title-field",
  "Give it a title",
  "Say what the pins are about. ⌘↩ saves it to the library; Esc sets the draft aside.",
  "above"
);

const LIBRARY_HINT = shownHint(
  "library",
  "capture-list",
  "Your library",
  "Your captures, newest first. ⌘F searches titles, notes and pin labels.",
  "inside"
);

/** The first run's example captures (src/main/pin-tutorial.ts), on their bundled image. */
const EXAMPLE_IDS = [uuid(51), uuid(52)];

const exampleImage = {
  heightPx: 600,
  pixelsPerDip: 2,
  url: "/.fixtures/example-capture.png",
  widthPx: 960,
};

const exampleCapture = (
  n: 0 | 1,
  fields: {
    title: string;
    description: string;
    steps: string[];
    pins: { x: number; y: number; label: string }[];
  }
) => ({
  capturedAt: ago(0, 9, 1 - n),
  description: fields.description,
  due: null,
  id: EXAMPLE_IDS[n] ?? uuid(51),
  image: exampleImage,
  invokedVia: "shortcut",
  kind: "ok" as const,
  pins: fields.pins,
  sourceLabel: "Example",
  status: { kind: "active" },
  steps: fields.steps.map((text, index) => step(index + 1, text)),
  title: fields.title,
  updatedAt: ago(0, 9, 1 - n),
});

const EXAMPLE_CAPTURES = [
  exampleCapture(0, {
    description:
      "A panel opens with a crop around the spot you point at. Click to place pin 1, give it a title and press ⌘↩. Your capture lands here, like this one.",
    pins: [
      { label: "Pin 1 marks the spot", x: 800, y: 254 },
      { label: "Each click adds the next number", x: 800, y: 390 },
    ],
    steps: [
      "Capture something of your own",
      "Remove the examples from Getting started’s ⋯ menu",
    ],
    title: "Try it: point at a detail and press ⌥⌘P",
  }),
  exampleCapture(1, {
    description:
      "⇧⌘C copies the image with its pins. ⌥⌘C copies the title, notes and pin labels as text. Drag the image into another app to drop it as a file.",
    pins: [{ label: "Copied images keep their pins", x: 440, y: 462 }],
    steps: [],
    title: "Copy a capture out with ⇧⌘C",
  }),
];

/** The tutorial's view for one page, as main builds it (src/main/tutorial/tutorial.ts). */
const tutorialView = (options: {
  readonly mac?: boolean;
  readonly done?: number;
  readonly complete?: boolean;
  readonly examples?: boolean;
  readonly checklist?: boolean;
  readonly active?: object | null;
  readonly spotlight?: number | null;
}) => {
  const done = options.done ?? 0;
  const tasks = tutorialTasks(options.mac ?? true);

  return {
    active: options.active ?? null,
    busy: false,
    checklist:
      options.checklist === false
        ? null
        : {
            collapsed: false,
            complete: options.complete ?? false,
            doneText:
              "That’s the whole loop. Help › Getting Started, or the pin icon’s menu, brings this back.",
            done,
            examples: options.examples ?? false,
            tasks: tasks.map((task, index) => ({
              ...task,
              done: index < done,
            })),
            title: "Getting started",
            total: tasks.length,
          },
    examples: options.examples === true ? EXAMPLE_IDS : [],
    hints: [],
    spotlight:
      options.spotlight === undefined || options.spotlight === null
        ? null
        : { seq: options.spotlight, steps: SPOTLIGHT_STEPS },
  };
};

const problemView = (status: string) => ({
  kind: "problem",
  problem: { kind: "screenPermission", status },
  surfaceKey: "problem",
});

const SETTINGS_VIEW = {
  openAtLogin: true,
  settings: { copyAfterSave: true, iconIn: "dockAndMenuBar" },
  tips: true,
  version: "0.2.0",
};

/** The capture panel's draft: the crop centred on the pointer over the budget's chairs row. */
const draftView = (
  targets: Targets,
  fields: {
    pins?: { x: number; y: number }[];
    title?: string;
    description?: string;
    steps?: { done: boolean; id: string; text: string }[];
    due?: string | null;
  } = {}
) => {
  // The middle of the sheet, as if the pointer were over it.
  const center = targets.sheet ?? { x: 1440, y: 900 };
  const width = CROP.width * PPD;
  const height = CROP.height * PPD;

  return {
    capturedAt: NOW.toISOString(),
    draftId: uuid(50),
    frame: {
      ppd: PPD,
      size: { height: 1800, width: 2880 },
      url: "/.fixtures/desktop.png",
    },
    kind: "draft",
    quitting: false,
    reopened: false,
    seed: {
      crop: {
        height,
        width,
        x: Math.round(center.x - width / 2),
        y: Math.round(center.y - height / 2),
      },
      description: fields.description ?? "",
      due: fields.due ?? null,
      pins: fields.pins ?? [],
      steps: fields.steps ?? [],
      title: fields.title ?? "",
    },
    sourceLabel: "Studio Display",
    surfaceKey: `${uuid(50)}:1`,
    write: { kind: "editing" },
  };
};

/* ---------- Scenes ---------- */

interface SceneData {
  view?: object;
  captures?: BridgeInput["captures"];
  capture?: object;
  commands?: readonly string[];
  owedFails?: BridgeInput["owedFails"];
  /** The in-app tutorial's view for the page; without it the page shows none. */
  tutorial?: object;
}

interface Scene {
  name: string;
  page: "capture" | "library" | "onboarding" | "settings" | "pin";
  hash?: string;
  data: SceneData;
  platforms?: readonly Platform[];
  act?: (page: Page, platform: Platform) => Promise<void>;
  /** Fit the window to the page's reported height first, as the panel and Settings do. */
  fit?: boolean;
  /** localStorage the page finds when it loads, such as the sidebar's width. */
  storage?: Readonly<Record<string, string>>;
  /** "reduce" holds looping pictures still on their last frame, so the shot never catches them mid-loop. */
  reducedMotion?: "reduce";
  /** A window size other than the page's usual one, as the onboarding's beside System Settings. */
  size?: { readonly width: number; readonly height: number };
}

const mod = (platform: Platform) => (platform === "macos" ? "Meta" : "Control");

/** Types at the end of the open capture's title. */
const typeInTitle = async (page: Page, text: string): Promise<void> => {
  await page
    .getByTestId("title-field")
    .evaluate((field: HTMLInputElement | HTMLTextAreaElement) => {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    });
  await page.keyboard.type(text);
};

/** With saves failing, types into the title and waits for the save to fail. */
const failTypingInTitle = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    globalThis.__failSaves = true;
  });
  await typeInTitle(page, " (typed)");
  await page.getByTestId("save-failure").waitFor();
};

/**
 * A save main wrote but hasn't confirmed, after one that failed, then a
 * Discard of it that can't put the saved version back, as a lock on
 * capture.json.prev would. The held answer is let go, and the page ignores
 * it as it does any answer to a discarded save.
 */
const failDiscard = async (page: Page): Promise<void> => {
  await failTypingInTitle(page);
  await page.evaluate(() => {
    globalThis.__failSaves = false;
    globalThis.__holdAnswers = true;
  });
  await typeInTitle(page, " more");
  await page.getByTestId("more").focus();
  await page.waitForFunction(() =>
    globalThis
      .__storedTitle?.(location.hash.split("/").at(-1) ?? "")
      ?.endsWith(" (typed) more")
  );
  await page.evaluate(() => {
    globalThis.__failDiscards = true;
  });
  await page
    .getByTestId("save-failure")
    .getByRole("button", { name: "Discard changes" })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-testid='save-failure']")
        ?.textContent?.startsWith("Couldn’t discard") === true
  );
  await page.evaluate(() => {
    globalThis.__holdAnswers = false;
    globalThis.__releaseSaves?.();
  });
};

/**
 * The same landed save after one that failed, then a Discard of it that main
 * doesn't answer, as a rename a lock holds would. `__releaseDiscards` lets it
 * go on.
 */
const holdDiscard = async (page: Page): Promise<void> => {
  await failTypingInTitle(page);
  await page.evaluate(() => {
    globalThis.__failSaves = false;
    globalThis.__holdAnswers = true;
  });
  await typeInTitle(page, " more");
  await page.getByTestId("more").focus();
  await page.waitForFunction(() =>
    globalThis
      .__storedTitle?.(location.hash.split("/").at(-1) ?? "")
      ?.endsWith(" (typed) more")
  );
  await page.evaluate(() => {
    globalThis.__holdDiscards = true;
  });
  await page
    .getByTestId("save-failure")
    .getByRole("button", { name: "Discard changes" })
    .click();
  await page.getByTestId("save-failure").waitFor({ state: "detached" });
  await page.evaluate(() => {
    globalThis.__holdAnswers = false;
    globalThis.__releaseSaves?.();
  });
};

/** Asks the page as main does before the window closes or the app quits, and hands back its answer. */
const askToLeave = async (page: Page, leaving: "close" | "quit" | "restart") =>
  await page.evaluate(
    async (kind) => (await globalThis.__leave?.(kind)) ?? null,
    leaving
  );

/** The prompt a held close or quit shows, and which element has the focus; null when none shows. */
const leavePrompt = async (page: Page) =>
  await page.evaluate(() => {
    const prompt = document.querySelector("[data-testid='leave-prompt']");
    const focused = document.activeElement;

    return {
      focus:
        focused instanceof HTMLElement
          ? (focused.dataset.testid ?? focused.textContent)
          : null,
      prompt: prompt?.textContent ?? null,
    };
  });

const resumes = async (page: Page) =>
  await page.evaluate(() =>
    (globalThis.__calls ?? []).filter((call) => call === "resumeLeaving")
  );

const asking = (count: string, message: string, discard: string) =>
  `${count} couldn’t be saved${message}Cancel${discard}Retry`;

/** The page's answer to main while it holds a close or a quit. */
const HELD = {
  message: "The library holds this to save or ask first.",
  ok: false,
} as const;

const SLOW = "Saving didn’t finish in time.";

/** Whether the element gets to the state in time; never throws, so the check reads the outcome. */
const settles = async (
  locator: Locator,
  state: "attached" | "detached" | "visible",
  timeout: number
): Promise<boolean> => {
  try {
    await locator.waitFor({ state, timeout });

    return true;
  } catch {
    return false;
  }
};

const focusedId = async (page: Page) =>
  await page.evaluate(
    () =>
      (document.activeElement instanceof HTMLElement
        ? document.activeElement.dataset.testid
        : null) ?? null
  );

const makeScenes = (
  captures: readonly Capture[],
  desktop: Targets
): readonly Scene[] => {
  const library = (): SceneData => ({
    captures: [...structuredClone(captures), READ_ONLY],
  });

  const pinned = [desktop.chairs, desktop.delivery, desktop.total].flatMap(
    (point) => (point === undefined ? [] : [point])
  );

  const filled = draftView(desktop, {
    description: "Delivery adds CHF 980 we never planned for.",
    due: dueIn(0),
    pins: pinned,
    steps: [step(1, "Ask Rieder for a discount"), step(2, "Tell Marco")],
    title: "Rieder’s quote breaks the furniture cap",
  });

  return [
    {
      data: { view: draftView(desktop) },
      fit: true,
      name: "capture-1-no-pins",
      page: "capture",
    },
    {
      data: { view: filled },
      fit: true,
      name: "capture-2-three-pins",
      page: "capture",
    },
    {
      act: async (page) => {
        await page.getByTestId("pin-preview").focus();
        await page.keyboard.press("2");
      },
      data: { view: filled },
      fit: true,
      name: "capture-3-pin-selected",
      page: "capture",
      platforms: ["macos"],
    },
    {
      act: async (page) => {
        await page.getByTestId("add-menu").click();
        await page.getByRole("menuitem").first().waitFor();
      },
      data: {
        view: draftView(desktop, {
          pins: pinned.slice(0, 1),
          title: "Chairs are CHF 280 over the cap",
        }),
      },
      fit: true,
      name: "capture-4-add-menu",
      page: "capture",
    },
    {
      act: async (page, platform) => {
        await page.getByTestId("title-field").focus();
        await page.keyboard.press(`${mod(platform)}+Shift+D`);
        await page.getByTestId("due-picker").waitFor();
      },
      data: {
        view: draftView(desktop, {
          pins: pinned.slice(0, 2),
          title: "Chairs are CHF 280 over the cap",
        }),
      },
      fit: true,
      name: "capture-5-due-picker",
      page: "capture",
    },
    {
      // Round 14: the panel has no shortcuts button any more; ⌘/ opens the sheet.
      act: async (page, platform) => {
        await page.keyboard.press(`${mod(platform)}+/`);
        await page.getByTestId("shortcut-sheet").waitFor();
      },
      data: { view: filled },
      fit: true,
      name: "capture-6-shortcuts",
      page: "capture",
    },
    {
      // Round 14: the header's one tool group (pin mode, Tighten, Widen) beside the longest caption, a set-aside draft's.
      data: { view: { ...filled, reopened: true } },
      fit: true,
      name: "capture-13-reopened-header",
      page: "capture",
    },
    {
      // Round 14: Pick a date… opens shadcn's Calendar, as in the Shelf, on today with the week from the locale's first day.
      act: async (page, platform) => {
        await page.getByTestId("title-field").focus();
        await page.keyboard.press(`${mod(platform)}+Shift+D`);
        await page.getByRole("button", { name: "Pick a date…" }).click();
        await page.getByTestId("due-calendar").waitFor();
        // The pointer leaves the grid, so no day shows a hover.
        await page.mouse.move(0, 0);
      },
      data: {
        view: draftView(desktop, {
          pins: pinned.slice(0, 1),
          title: "Chairs are CHF 280 over the cap",
        }),
      },
      fit: true,
      name: "capture-12-due-calendar",
      page: "capture",
    },
    {
      // Round 14: an explicit Save locks steps and Due with the title, as main takes no edits until it lands.
      data: { view: { ...filled, write: { kind: "saving" } } },
      fit: true,
      name: "capture-11-saving-locked",
      page: "capture",
      platforms: ["macos"],
    },
    {
      data: { view: { ...filled, quitting: true } },
      fit: true,
      name: "capture-7-quit",
      page: "capture",
      platforms: ["macos"],
    },
    {
      data: { view: { ...filled, quitting: true, write: { kind: "saving" } } },
      fit: true,
      name: "capture-9-quit-save-too-slow",
      page: "capture",
      platforms: ["macos"],
    },
    {
      data: {
        view: {
          ...filled,
          quitting: true,
          write: { kind: "failed", message: "The disk is full." },
        },
      },
      fit: true,
      name: "capture-10-quit-save-failed",
      page: "capture",
      platforms: ["macos"],
    },
    {
      // Type, click the detail, type on: the click places pin 1 and the title keeps the keyboard.
      act: async (page) => {
        const title = page.getByTestId("title-field");

        await title.focus();
        await page.keyboard.type("Chairs are");
        await page.getByTestId("pin-preview").click();
        await page.keyboard.type(" over the cap");
        await page.getByLabel("Screenshot with 1 pin").waitFor();
      },
      data: { view: draftView(desktop) },
      fit: true,
      name: "capture-8-first-pin",
      page: "capture",
    },
    {
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-1-capture",
      page: "library",
    },
    {
      data: library(),
      hash: `/captures/${uuid(3)}`,
      name: "library-2-overdue",
      page: "library",
      platforms: ["macos"],
    },
    {
      data: library(),
      hash: `/captures/${uuid(3)}`,
      name: "library-16-narrow-sidebar",
      page: "library",
      // The narrowest sidebar: the overdue row keeps "Overdue · <date>" and drops its time and steps first.
      storage: { "inset.sidebar": '{"collapsed":false,"width":220}' },
    },
    {
      act: async (page, platform) => {
        // Delete on a focused row asks about that row's capture, not the one open.
        await page.getByTestId("capture-row").nth(1).focus();
        await page.keyboard.press(
          platform === "macos" ? "Backspace" : "Delete"
        );
        await page.getByRole("alertdialog").waitFor();
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-17-delete-row",
      page: "library",
    },
    {
      act: async (page) => {
        await page.getByTestId("search").fill("delivery");
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-3-search",
      page: "library",
    },
    {
      act: async (page) => {
        await page.getByTestId("search").fill("due:week");
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-4-search-due",
      page: "library",
      platforms: ["macos"],
    },
    {
      act: async (page) => {
        await page.getByTestId("search").fill("zebra");
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-5-search-empty",
      page: "library",
    },
    {
      act: async (page) => {
        await page.getByTestId("open-done").click();
      },
      data: library(),
      hash: `/captures/${uuid(5)}`,
      name: "library-6-done",
      page: "library",
    },
    {
      act: async (page) => {
        await page.getByTestId("more").click();
        await page
          .getByRole("menuitem", { name: /Copy with Details/u })
          .waitFor();
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-7-more-menu",
      page: "library",
    },
    {
      act: async (page) => {
        await page.getByTestId("capture-row").nth(1).click({ button: "right" });
        await page.getByRole("menuitem", { name: /Float on Top/u }).waitFor();
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-8-context-menu",
      page: "library",
      platforms: ["windows"],
    },
    {
      act: async (page) => {
        await page.getByTestId("due-chip").click();
        await page.getByTestId("due-picker").waitFor();
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-9-due-picker",
      page: "library",
      platforms: ["macos"],
    },
    {
      // Round 14: the capture's time and source, a quiet footer at the foot of the view.
      data: library(),
      hash: `/captures/${uuid(2)}`,
      name: "library-30-footer",
      page: "library",
      platforms: ["macos"],
    },
    {
      // Round 14: pin 2 was selected, then a click on empty space let it go.
      act: async (page) => {
        await page.getByTestId("image-editor").focus();
        await page.keyboard.press("2");
        await page.getByTestId("capture-footer").click();
        await page.mouse.move(0, 400);
      },
      data: library(),
      hash: `/captures/${uuid(2)}`,
      name: "library-31-click-away",
      page: "library",
      platforms: ["macos"],
    },
    {
      // Round 14: the calendar opens on the Due day, which it marks.
      act: async (page) => {
        await page.getByTestId("due-chip").getByRole("button").first().click();
        await page.getByRole("button", { name: "Pick a date…" }).click();
        await page.getByTestId("due-calendar").waitFor();
        // The pointer leaves the grid, so no day shows a hover.
        await page.mouse.move(0, 0);
      },
      data: library(),
      hash: `/captures/${uuid(2)}`,
      name: "library-29-due-calendar",
      page: "library",
      platforms: ["macos"],
    },
    {
      // Round 14: a row's menu was open, and a click on search went straight to search.
      act: async (page) => {
        await page
          .locator("[data-testid='capture-row']")
          .nth(1)
          .click({ button: "right" });
        await page.getByRole("menu").waitFor();
        await page.waitForTimeout(150);

        const box = await page.getByTestId("search").boundingBox();

        await page.mouse.click(
          (box?.x ?? 0) + (box?.width ?? 0) / 2,
          (box?.y ?? 0) + (box?.height ?? 0) / 2
        );
        await page.getByRole("menu").waitFor({ state: "detached" });
        await page.mouse.move(0, 400);
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-32-menu-click-away",
      page: "library",
      platforms: ["macos"],
    },
    {
      act: async (page) => {
        await page.getByTestId("pin-tool").click();
      },
      data: library(),
      hash: `/captures/${uuid(4)}`,
      name: "library-10-pin-mode",
      page: "library",
    },
    {
      act: async (page, platform) => {
        await page.keyboard.press(`${mod(platform)}+/`);
        await page.getByTestId("shortcut-sheet").waitFor();
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-11-shortcuts",
      page: "library",
    },
    {
      act: async (page) => {
        await page.getByRole("button", { name: "Hide sidebar" }).click();
      },
      data: library(),
      hash: `/captures/${uuid(2)}`,
      name: "library-12-sidebar-hidden",
      page: "library",
      platforms: ["macos"],
    },
    {
      data: { captures: [] },
      hash: "/",
      name: "library-13-welcome",
      page: "library",
    },
    {
      data: { ...library(), commands: ["shortcuts"] },
      hash: "/",
      name: "library-14-shortcuts-from-tray",
      page: "library",
      platforms: ["windows"],
    },
    {
      act: async (page) => {
        await page.getByTestId("search").fill("due:");
        await page.getByTestId("due-suggestions").waitFor();
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-15-due-suggestions",
      page: "library",
    },
    {
      act: async (page) => {
        await failTypingInTitle(page);
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-18-save-failed",
      page: "library",
    },
    {
      // The failed draft outlives leaving its capture; its row says so.
      act: async (page) => {
        await failTypingInTitle(page);
        await page.getByTestId("capture-row").nth(2).click();
        await page.locator("[data-meta='unsaved']").waitFor();
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-19-unsaved-row",
      page: "library",
      platforms: ["macos"],
    },
    {
      act: async (page) => {
        await failTypingInTitle(page);
        await askToLeave(page, "quit");
        await page.getByTestId("leave-prompt").waitFor();
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-20-unsaved-quit",
      page: "library",
      platforms: ["macos"],
    },
    {
      act: async (page) => {
        await failTypingInTitle(page);
        await askToLeave(page, "close");
        await page.getByTestId("leave-prompt").waitFor();
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-21-unsaved-close",
      page: "library",
      platforms: ["windows"],
    },
    {
      // Round 7: a copy of a capture whose changes couldn't be saved is refused at once and offers Retry.
      act: async (page, platform) => {
        await failTypingInTitle(page);
        await page.keyboard.press(`${mod(platform)}+Alt+c`);
        await page.getByTestId("notice-action").waitFor();
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-22-copy-refused",
      page: "library",
      platforms: ["macos"],
    },
    {
      // Round 7: a save still on its way after the 3 s limit holds the quit and says so.
      act: async (page) => {
        await page.evaluate(() => {
          globalThis.__holdSaves = true;
        });
        await typeInTitle(page, " (slow disk)");
        await askToLeave(page, "quit");
        await page.getByTestId("leave-prompt").waitFor();
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-23-save-too-slow",
      page: "library",
      platforms: ["macos"],
    },
    {
      // Round 9: a Discard main couldn't finish stays a failed draft with Keep changes and Discard again.
      act: async (page) => {
        await failDiscard(page);
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-24-discard-failed",
      page: "library",
      platforms: ["macos"],
    },
    {
      act: async (page) => {
        await failDiscard(page);
        await askToLeave(page, "quit");
        await page.getByTestId("leave-prompt").waitFor();
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-25-discard-failed-quit",
      page: "library",
      platforms: ["macos"],
    },
    {
      // Round 10: a Discard main doesn't answer within 3 s holds the quit with Wait and Quit anyway, never with buttons that can't act.
      act: async (page) => {
        await holdDiscard(page);
        await askToLeave(page, "quit");
        await page.getByTestId("leave-prompt").waitFor();
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-26-discard-pending-quit",
      page: "library",
      platforms: ["macos"],
    },
    {
      act: async (page) => {
        await holdDiscard(page);
        await askToLeave(page, "close");
        await page.getByTestId("leave-prompt").waitFor();
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-27-discard-pending-close",
      page: "library",
      platforms: ["windows"],
    },
    {
      // Round 12: while main can't say which Discards it owes, the library shows no capture and keeps asking.
      act: async (page) => {
        await page.getByTestId("owed-unread").waitFor();
      },
      data: { ...library(), owedFails: "always" },
      hash: `/captures/${uuid(1)}`,
      name: "library-28-owed-unread",
      page: "library",
      platforms: ["macos"],
    },
    {
      data: { view: SETTINGS_VIEW },
      fit: true,
      name: "settings",
      page: "settings",
    },
    // The first-run setup, macOS only: each page is a view main pushes, the window as tall as its page.
    ...(
      [
        ["1-welcome", onboardingView("welcome", "allow")],
        ["2-access", onboardingView("access", "allow")],
        ["3-reopen", onboardingView("access", "reopen")],
        ["4-reopening", onboardingView("access", "reopening")],
        ["5-allowed", onboardingView("access", "allowed")],
        ["6-done", onboardingView("done", "allowed")],
        ["7-done-skipped", onboardingView("done", "reopen")],
      ] as const
    ).map(([name, view]): Scene => ({
      data: { view },
      fit: true,
      name: `setup-${name}`,
      page: "onboarding",
      platforms: ["macos"],
      reducedMotion: "reduce",
    })),
    // The in-app tutorial: Getting started in the library, with the first run's examples, on both systems.
    ...(["macos", "windows"] as const).map((platform): Scene => ({
      data: {
        captures: EXAMPLE_CAPTURES,
        tutorial: tutorialView({
          examples: true,
          mac: platform === "macos",
        }),
      },
      hash: `/captures/${EXAMPLE_IDS[0] ?? ""}`,
      name: "tutorial-1-checklist-start",
      page: "library",
      platforms: [platform],
    })),
    {
      data: {
        captures: [...EXAMPLE_CAPTURES, ...structuredClone(captures)],
        tutorial: tutorialView({ done: 3, examples: true }),
      },
      hash: `/captures/${uuid(1)}`,
      name: "tutorial-2-checklist-progress",
      page: "library",
      platforms: ["macos"],
    },
    {
      data: {
        captures: EXAMPLE_CAPTURES,
        tutorial: tutorialView({
          active: {
            ...shownHint(
              "copy",
              "copy-image",
              "Copy it out",
              "⇧⌘C copies the image with its pins, ⌥⌘C the text with its details. Paste it into a chat, a doc or a ticket."
            ),
            kind: "task",
          },
          done: 3,
          examples: true,
        }),
      },
      hash: `/captures/${EXAMPLE_IDS[0] ?? ""}`,
      name: "tutorial-3-task-hint",
      page: "library",
      platforms: ["macos"],
    },
    {
      data: {
        captures: EXAMPLE_CAPTURES,
        tutorial: tutorialView({ active: LIBRARY_HINT, examples: true }),
      },
      hash: `/captures/${EXAMPLE_IDS[0] ?? ""}`,
      name: "tutorial-4-library-tip",
      page: "library",
      platforms: ["macos"],
    },
    {
      data: {
        tutorial: tutorialView({ active: PLACE_PIN_HINT, checklist: false }),
        view: draftView(desktop, {}),
      },
      fit: true,
      name: "tutorial-5-place-pin-tip",
      page: "capture",
      platforms: ["macos"],
    },
    {
      data: {
        tutorial: tutorialView({ active: TITLE_HINT, checklist: false }),
        view: draftView(desktop, { pins: pinned.slice(0, 1) }),
      },
      fit: true,
      name: "tutorial-6-title-tip",
      page: "capture",
      platforms: ["macos"],
    },
    ...[1, 3, 5].map((stop): Scene => ({
      act: async (page) => {
        await page.waitForSelector("[data-spotlight-dimmer]");

        for (let press = 1; press < stop; press += 1) {
          // Each step waits for the one before.
          // oxlint-disable-next-line no-await-in-loop
          await page
            .locator("[data-coach-bubble]")
            .getByRole("button", { exact: true, name: "Next" })
            .click();
        }
      },
      data: {
        captures: EXAMPLE_CAPTURES,
        tutorial: tutorialView({ examples: true, spotlight: 1 }),
      },
      hash: `/captures/${EXAMPLE_IDS[0] ?? ""}`,
      name: `tutorial-7-spotlight-${stop}`,
      page: "library",
      platforms: ["macos"],
      reducedMotion: "reduce",
    })),
    {
      data: { captures: [] },
      hash: "/",
      name: "tutorial-8-empty-library",
      page: "library",
    },
    {
      data: { view: problemView("denied") },
      fit: true,
      name: "problem-screen-permission",
      page: "capture",
      platforms: ["macos"],
    },
    {
      data: { view: problemView("granted-but-empty") },
      fit: true,
      name: "problem-granted-but-empty",
      page: "capture",
      platforms: ["macos"],
    },
    {
      data: { capture: captures[0] },
      name: "float-on-top",
      page: "pin",
      platforms: ["macos"],
    },
    {
      act: async (page) => {
        await page.evaluate(() => {
          globalThis.__failSaves = true;
        });
        await page.getByRole("button", { name: "Copy image" }).click();
        await page.getByTestId("copy-failed").waitFor();
      },
      data: { capture: captures[0] },
      name: "float-on-top-copy-failed",
      page: "pin",
      platforms: ["macos"],
    },
  ];
};

const SIZES = {
  capture: { height: 760, width: 380 },
  library: { height: 720, width: 1100 },
  // pinSize() of a 480×300 crop: the floating window's own size.
  // src/main/onboarding-window.ts: 460 wide, as tall as its page.
  onboarding: { height: 400, width: 460 },
  pin: { height: 263, width: 420 },
  settings: { height: 400, width: 440 },
} as const;

const CONTENT_TYPES = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

/** Serves the built renderer, and the fixtures under /.fixtures/. */
const answer = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  const url = new URL(request.url ?? "/", "http://localhost");

  const file = url.pathname.startsWith("/.fixtures/")
    ? path.join(OUT, url.pathname)
    : path.join(RENDERER, url.pathname);

  try {
    const body = await readFile(file);

    response.writeHead(200, {
      "content-type":
        CONTENT_TYPES.get(path.extname(file)) ?? "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
};

const serve = async () => {
  const server = createServer((request, response) => {
    void answer(request, response);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  // A TCP server's address has a port; a pipe path or null would fail here.
  const { port } = z.object({ port: z.number() }).parse(server.address());

  return { origin: `http://127.0.0.1:${port}`, server };
};

/** The macOS sidebar material, which Chrome cannot draw, as a flat stand-in. */
const MATERIAL = { dark: "#2b2a2e", light: "#ececee" } as const;

const shoot = async (
  browser: Browser,
  origin: string,
  scene: Scene,
  platform: Platform,
  theme: Theme
) => {
  const size = scene.size ?? SIZES[scene.page];

  const context = await browser.newContext({
    colorScheme: theme,
    deviceScaleFactor: 2,
    reducedMotion: scene.reducedMotion ?? "no-preference",
    userAgent: USER_AGENT[platform],
    viewport: size,
  });

  const page = await context.newPage();
  const errors: string[] = [];

  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  const input: BridgeInput = { ...scene.data, page: scene.page };

  await page.addInitScript(installBridge, input);

  if (scene.storage !== undefined) {
    await page.addInitScript((entries) => {
      for (const [key, value] of Object.entries(entries)) {
        localStorage.setItem(key, value);
      }
    }, scene.storage);
  }

  await page.goto(
    `${origin}/${scene.page}.html${scene.hash === undefined ? "" : `#${scene.hash}`}`
  );

  if (platform === "macos" && scene.page !== "capture") {
    await page.addStyleTag({
      content: `html { background: ${MATERIAL[theme]}; }`,
    });
  }

  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);

  // The panel and Settings take their content's height, before and after the scene's action.
  const fit = async (): Promise<void> => {
    const fitted = await page.evaluate(() => globalThis.__fitted);

    if (scene.fit === true && fitted !== undefined && fitted > 0) {
      await page.setViewportSize({
        height: Math.min(fitted, 900),
        width: size.width,
      });
      await page.waitForTimeout(150);
    }
  };

  await fit();

  if (scene.act !== undefined) {
    await scene.act(page, platform);
    await page.waitForTimeout(350);
    await fit();
  }

  if (errors.length > 0) {
    await context.close();
    throw new Error(`the page threw: ${errors.join("; ")}`);
  }

  const file = path.join(OUT, `${scene.name}-${platform}-${theme}.png`);

  await page.screenshot({ path: file });
  await context.close();

  return path.relative(OUT, file);
};

/** The pin sprite at 1× and 2× on light and dark, and an exported image with its pins drawn by the export code. */
const shootRenderer = async (
  browser: Browser,
  captures: readonly Capture[]
): Promise<string[]> => {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { height: 760, width: 1000 },
  });

  const [first] = captures;
  const png = await readFile(path.join(FIXTURES, "budget.png"));

  await page.setContent(
    `<body style="margin:0;font:13px system-ui;background:#fff"><img id="src" src="data:image/png;base64,${png.toString("base64")}"></body>`
  );
  await page.waitForFunction(
    () => document.querySelector("img")?.complete === true
  );

  const rgba = await page.evaluate(() => {
    const img = document.querySelector("img");

    if (!(img instanceof HTMLImageElement)) {
      throw new TypeError("The fixture image is missing.");
    }

    const canvas = document.createElement("canvas");

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    const context = canvas.getContext("2d");

    context?.drawImage(img, 0, 0);

    const pixels = context?.getImageData(0, 0, canvas.width, canvas.height);
    let text = "";

    for (const byte of pixels?.data ?? []) {
      text += String.fromCodePoint(byte);
    }

    return { data: btoa(text), height: canvas.height, width: canvas.width };
  });

  const exported = drawPins(
    {
      data: Buffer.from(rgba.data, "base64"),
      height: rgba.height,
      width: rgba.width,
    },
    first?.pins ?? [],
    PPD,
    "rgba"
  );

  const sprites = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].flatMap((n) =>
    [1, 2].map((scale) => {
      const sprite = pinSprite(n, scale);

      return {
        data: Buffer.from(sprite.data).toString("base64"),
        height: sprite.height,
        scale,
        width: sprite.width,
      };
    })
  );

  await page.evaluate(
    ({ exported: picture, sprites: list }) => {
      // Inside the page: evaluate serializes this function, so the helper can't live outside it.
      // oxlint-disable-next-line unicorn/consistent-function-scoping
      const decode = (text: string) =>
        Uint8ClampedArray.from(atob(text), (char) => char.codePointAt(0) ?? 0);

      document.body.innerHTML = `
        <div style="display:flex;gap:16px;padding:16px">
          <div><p>Exported image (export code, 960×600 px shown at 50%)</p><canvas id="export" style="width:480px;border-radius:6px"></canvas></div>
          <div id="sheets" style="display:flex;flex-direction:column;gap:12px"></div>
        </div>`;

      const canvas = document.querySelector<HTMLCanvasElement>("#export");

      if (canvas !== null) {
        canvas.width = picture.width;
        canvas.height = picture.height;
        canvas
          .getContext("2d")
          ?.putImageData(
            new ImageData(decode(picture.data), picture.width, picture.height),
            0,
            0
          );
      }

      for (const background of ["#ffffff", "#1e1e1e", "#9aa7b5"]) {
        for (const scale of [1, 2]) {
          const row = document.createElement("div");

          row.style.cssText = `display:flex;align-items:flex-end;gap:6px;padding:10px;border-radius:8px;background:${background}`;

          for (const sprite of list.filter((item) => item.scale === scale)) {
            const element = document.createElement("canvas");

            element.width = sprite.width;
            element.height = sprite.height;
            element.style.flex = "none";
            element
              .getContext("2d")
              ?.putImageData(
                new ImageData(decode(sprite.data), sprite.width, sprite.height),
                0,
                0
              );
            row.append(element);
          }

          document.querySelector("#sheets")?.append(row);
        }
      }
    },
    {
      exported: {
        data: Buffer.from(exported).toString("base64"),
        height: rgba.height,
        width: rgba.width,
      },
      sprites,
    }
  );

  const file = path.join(OUT, "pin-renderer.png");

  await page.screenshot({ fullPage: true, path: file });
  await page.close();

  return [path.relative(OUT, file)];
};

/* ---------- Checks: the real renderer, keys pressed, bridge calls read back ---------- */

const ROW = "[data-testid='capture-row']";

/** A way to copy that needs nothing set up first. */
const ready = async (): Promise<void> => {
  await Promise.resolve();
};

/** A small assertion log: every line is PASS or FAIL, and the FAILs fail the run. */
const makeReport = (platform: Platform) => {
  const failures: string[] = [];

  const expectSame = <T>(label: string, got: T, want: T): void => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    const line = `${platform} ${label}: ${JSON.stringify(got)}`;

    console.log(
      ok ? `PASS ${line}` : `FAIL ${line}, want ${JSON.stringify(want)}`
    );

    if (!ok) {
      failures.push(`${platform} ${label}`);
    }
  };

  /** Runs one check; one that throws, as a missing element does on an older build, is a FAIL and the rest still run. */
  const attempt = async (
    label: string,
    run: () => Promise<void>
  ): Promise<void> => {
    try {
      await run();
    } catch (error) {
      const why = String(error).split("\n")[0] ?? "";

      console.log(`FAIL ${platform} ${label}: threw ${why}`);
      failures.push(`${platform} ${label}`);
    }
  };

  return { attempt, expectSame, failures };
};

const openLibrary = async (
  browser: Browser,
  origin: string,
  input: BridgeInput,
  platform: Platform,
  hash: string,
  storage: Readonly<Record<string, string>> = {}
) => {
  const context = await browser.newContext({
    userAgent: USER_AGENT[platform],
    viewport: SIZES.library,
  });

  const page = await context.newPage();

  await page.addInitScript(installBridge, input);
  await page.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries)) {
      localStorage.setItem(key, value);
    }
  }, storage);
  await page.goto(`${origin}/library.html#${hash}`);
  await page.locator(ROW).first().waitFor();
  await page.waitForLoadState("networkidle");

  return { context, page };
};

/**
 * Round 4's context-menu ownership: with capture A open and row B's menu
 * open, each key the menu shows acts on B, never on A, and closing the menu
 * leaves the focus on row B. Copies save A's typing first and copy nothing
 * when that save fails.
 */
const checkRowMenu = async (
  browser: Browser,
  origin: string,
  captures: readonly Capture[],
  platform: Platform
): Promise<string[]> => {
  const { expectSame, failures } = makeReport(platform);
  const a = uuid(1);

  const { context, page } = await openLibrary(
    browser,
    origin,
    { captures: structuredClone(captures), page: "library" },
    platform,
    `/captures/${a}`
  );

  const rows = page.locator(ROW);

  const ids = await rows.evaluateAll((elements: HTMLElement[]) =>
    elements.map((element) => element.dataset.captureId ?? "")
  );

  const bIndex = 2;
  const b = ids[bIndex];
  const bTitle = captures.find((one) => one.id === b)?.title ?? "";
  const m = mod(platform);
  const del = platform === "macos" ? "Backspace" : "Delete";

  const takeCalls = async (): Promise<string[]> =>
    await page.evaluate(() => {
      const calls = globalThis.__calls ?? [];

      globalThis.__calls = [];

      return calls;
    });

  const focused = async (): Promise<string | null> =>
    await page.evaluate(
      (selector) =>
        document.activeElement?.closest<HTMLElement>(selector)?.dataset
          .captureId ??
        document.activeElement?.tagName ??
        null,
      ROW
    );

  // Radix listens for a click outside only a moment after the menu mounts; a person is never that fast.
  const openMenu = async (index: number): Promise<void> => {
    await rows.nth(index).click({ button: "right" });
    await page.getByRole("menu").waitFor();
    await page.waitForTimeout(150);
  };

  /**
   * Whether the menu went by itself. Commands run once it has gone, and
   * saving is a round trip; a second, wrong call would land in the wait too.
   */
  const settled = async (): Promise<boolean> => {
    const closed = await page
      .getByRole("menu")
      .waitFor({ state: "detached", timeout: 1500 })
      .then(
        () => true,
        () => false
      );

    if (!closed) {
      await page.keyboard.press("Escape");
      await page.getByRole("menu").waitFor({ state: "detached" });
    }

    await page.waitForTimeout(300);

    return closed;
  };

  const rowKey = async (key: string, command: string): Promise<void> => {
    await openMenu(bIndex);
    await page.keyboard.press(key);
    const closed = await settled();
    expectSame(
      `${key} in row B's menu acts on B, focus on B`,
      { calls: await takeCalls(), closed, focus: await focused() },
      { calls: [`${command}:${b}`], closed: true, focus: b }
    );
  };

  /** The ⋯ menu belongs to the open capture A; Space does nothing there, since its Mark as Done shows no key. */
  const moreKey = async (
    key: string,
    command: string | null
  ): Promise<void> => {
    await page.getByTestId("more").click();
    await page.getByRole("menu").waitFor();
    await page.keyboard.press(key);
    const shut = await settled();
    expectSame(
      `${key} in the ⋯ menu acts on A`,
      { calls: await takeCalls(), shut },
      command === null
        ? { calls: [], shut: false }
        : { calls: [`${command}:${a}`], shut: true }
    );
  };

  await takeCalls();
  await rowKey(`${m}+c`, "copyText");
  await rowKey(`${m}+Alt+c`, "copyDetails");
  await rowKey(`${m}+Shift+c`, "copyImage");
  await rowKey(`${m}+Alt+f`, "floatOnTop");

  await openMenu(bIndex);
  await page.getByRole("menuitem", { name: /Copy with Details/u }).click();
  let closed = await settled();
  expectSame(
    "clicking Copy with Details in row B's menu",
    { calls: await takeCalls(), closed, focus: await focused() },
    { calls: [`copyDetails:${b}`], closed: true, focus: b }
  );

  await openMenu(bIndex);
  await page.keyboard.press(del);

  const asked = await page
    .getByRole("alertdialog")
    .textContent({ timeout: 1500 })
    .catch(() => "");

  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").waitFor({ state: "detached" });
  await page.getByRole("menu").waitFor({ state: "detached" });
  await page.waitForTimeout(300);
  expectSame(
    `${del} in row B's menu asks about B; Esc returns to row B`,
    {
      asksAboutB: asked?.includes(bTitle) === true,
      calls: await takeCalls(),
      focus: await focused(),
    },
    { asksAboutB: true, calls: [], focus: b }
  );

  await openMenu(bIndex);
  await page.keyboard.press(del);
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete" })
    .click();
  await page.getByRole("alertdialog").waitFor({ state: "detached" });
  await page.waitForTimeout(300);
  expectSame(
    "confirming the delete removes B and moves on to the next row",
    { calls: await takeCalls(), focus: await focused() },
    { calls: [`remove:${b}`], focus: ids[bIndex + 1] }
  );

  await openMenu(bIndex);
  await page.keyboard.press("Escape");
  closed = await settled();
  expectSame(
    "Esc closes row B's menu onto row B",
    { calls: await takeCalls(), closed, focus: await focused() },
    { calls: [], closed: true, focus: b }
  );

  await openMenu(bIndex);

  const footer = await page.getByTestId("capture-footer").boundingBox();

  // Empty space: the menu isn't modal, so a click on a field or the image would land there instead.
  await page.mouse.click(
    (footer?.x ?? 0) + (footer?.width ?? 0) / 2,
    (footer?.y ?? 0) + (footer?.height ?? 0) / 2
  );
  closed = await settled();
  expectSame(
    "a click on empty space closes row B's menu onto row B",
    { calls: await takeCalls(), closed, focus: await focused() },
    { calls: [], closed: true, focus: b }
  );

  await moreKey(`${m}+Alt+c`, "copyDetails");
  await moreKey(`${m}+Shift+c`, "copyImage");
  await moreKey(" ", null);

  await page.getByTestId("more").click();
  await page.getByRole("menu").waitFor();
  await page.getByRole("menuitem", { name: /Delete/u }).click();
  await page.getByRole("alertdialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").waitFor({ state: "detached" });
  await page.waitForTimeout(300);

  const afterCancel = await page.evaluate(() => {
    const active = document.activeElement;

    return active instanceof HTMLElement
      ? (active.dataset.testid ?? active.tagName)
      : null;
  });

  expectSame(
    "Delete… in the ⋯ menu, then Esc, returns to the ⋯ button",
    { calls: await takeCalls(), focus: afterCancel },
    { calls: [], focus: "more" }
  );

  const title = page.getByTestId("title-field");
  const aIndex = ids.indexOf(a);
  const aTitle = captures.find((one) => one.id === a)?.title ?? "";

  const typeAtEnd = async (text: string): Promise<void> => {
    await title.evaluate((field: HTMLInputElement | HTMLTextAreaElement) => {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    });
    await page.keyboard.type(text);
  };

  await typeAtEnd(" (edited)");
  await openMenu(aIndex);
  await page.keyboard.press(`${m}+c`);
  await settled();

  const savedFirst = await takeCalls();

  expectSame(
    "copying A from its row while its title is being typed saves the typing first",
    savedFirst.slice(-2),
    [`update:${a}:${aTitle} (edited)`, `copyText:${a}`]
  );

  await page.evaluate(() => {
    globalThis.__failSaves = true;
  });
  await typeAtEnd(" again");
  await openMenu(aIndex);
  await page.keyboard.press(`${m}+c`);
  await settled();

  const afterFailure = await takeCalls();

  expectSame(
    "after a failed save the row copies nothing and says so",
    {
      copies: afterFailure.filter((call) => call.startsWith("copy")),
      notice: await page
        .getByText(/Couldn’t save your changes, so nothing was copied/u)
        .isVisible(),
    },
    { copies: [], notice: true }
  );

  // Plain ⌘C arrives as the copy event, which Chromium raises for ⌘C only on a Mac.
  if (platform === "macos") {
    await page.getByTestId("more").focus();
    await page.keyboard.press("Meta+c");
    await page.waitForTimeout(300);

    const refused = await takeCalls();

    expectSame(
      "plain ⌘C on the page after a failed save copies nothing",
      refused.filter((call) => call.startsWith("copy")),
      []
    );

    // Round 7: the disk recovers, but a failed draft is refused at once until Retry saves it.
    await page.evaluate(() => {
      globalThis.__failSaves = false;
    });
    await page.keyboard.press("Meta+c");
    await page.waitForTimeout(300);

    const recovered = await takeCalls();

    await page.getByTestId("notice-action").click();
    await page.waitForTimeout(300);

    const retried = await takeCalls();

    await page.getByTestId("more").focus();
    await page.keyboard.press("Meta+c");
    await page.waitForTimeout(300);

    expectSame(
      "once the disk recovers, plain ⌘C still refuses A's failed draft without saving it; the notice's Retry saves it, and ⌘C then copies A",
      { copied: await takeCalls(), recovered, retried },
      {
        copied: [`copyText:${a}`],
        recovered: [],
        retried: [`update:${a}:${aTitle} (edited) again`],
      }
    );
  }

  await page.evaluate(() => {
    globalThis.__failSaves = false;
  });

  // Round 5: Space and Return pick the highlighted item; the keys the menu shows act on B whatever is highlighted.
  await openMenu(bIndex);

  const rowMenuText = (await page.getByRole("menu").textContent()) ?? "";

  await page.keyboard.press(" ");
  await page.waitForTimeout(300);

  const stillOpen = await page.getByRole("menu").isVisible();

  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "detached" });
  await page.waitForTimeout(200);
  expectSame(
    "row B's menu shows no Space key, and Space with nothing highlighted does nothing",
    {
      calls: await takeCalls(),
      showsSpace: rowMenuText.includes("Space"),
      stillOpen,
    },
    { calls: [], showsSpace: false, stillOpen: true }
  );

  const hover = (name: RegExp) => async (): Promise<void> => {
    await page.getByRole("menuitem", { name }).hover();
  };

  const pickIn = async (
    label: string,
    highlight: () => Promise<void>,
    key: string,
    command: string
  ): Promise<void> => {
    await openMenu(bIndex);
    await highlight();
    await page.keyboard.press(key);
    const shut = await settled();
    expectSame(
      label,
      { calls: await takeCalls(), closed: shut, focus: await focused() },
      { calls: [`${command}:${b}`], closed: true, focus: b }
    );
  };

  await pickIn(
    "Space on the highlighted Copy Text copies B",
    async () => {
      await page.keyboard.press("ArrowDown");
    },
    " ",
    "copyText"
  );
  await pickIn(
    "Return on the highlighted Float on Top floats B",
    hover(/Float on Top/u),
    "Enter",
    "floatOnTop"
  );
  await pickIn(
    `${m}+Alt+c with Copy Image highlighted copies B with details`,
    hover(/^Copy Image/u),
    `${m}+Alt+c`,
    "copyDetails"
  );
  await pickIn(
    `${m}+c with Delete… highlighted copies B's text`,
    hover(/Delete/u),
    `${m}+c`,
    "copyText"
  );

  // Keys the menu doesn't show stay in it: none reaches capture A or the window.
  const hidden =
    platform === "macos"
      ? [
          "Meta+d",
          "Meta+Shift+d",
          "Meta+Shift+s",
          "Meta+f",
          "Meta+/",
          "Meta+z",
          "Control+Meta+s",
        ]
      : [
          "Control+d",
          "Control+Shift+d",
          "Control+Shift+s",
          "Control+f",
          "Control+/",
          "Control+z",
          "Control+b",
          "Control+,",
        ];

  interface KeyOutcome {
    readonly calls: readonly string[];
    readonly inMenu: boolean;
    readonly layers: number;
    readonly sidebarShown: boolean;
  }

  const quiet: KeyOutcome = {
    calls: [],
    inMenu: true,
    layers: 0,
    sidebarShown: true,
  };

  /** Escape until no menu, dialog or picker is left, even when a key opened one over the menu. */
  const closeLayers = async (left = 3): Promise<void> => {
    const open = await page
      .locator(
        '[role="menu"], [role="dialog"], [role="alertdialog"], [data-slot="popover-content"]'
      )
      .count();

    if (open === 0 || left === 0) {
      return;
    }

    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    await closeLayers(left - 1);
  };

  const pressInMenu = async (
    open: () => Promise<void>,
    key: string
  ): Promise<KeyOutcome> => {
    await open();
    await takeCalls();
    await page.keyboard.press(key);
    await page.waitForTimeout(250);

    const state = await page.evaluate(() => ({
      inMenu:
        (document.activeElement?.closest('[role="menu"]') ?? null) !== null,
      layers: document.querySelectorAll(
        '[role="dialog"], [role="alertdialog"], [data-slot="popover-content"]'
      ).length,
      sidebarShown:
        document.querySelector('[aria-label="Hide sidebar"]') !== null,
    }));

    const outcome = { calls: await takeCalls(), ...state };

    await closeLayers();

    return outcome;
  };

  const hiddenKeysIn = async (
    menu: string,
    open: () => Promise<void>
  ): Promise<void> => {
    const seen = new Map<string, KeyOutcome>();

    for (const key of hidden) {
      // Sequential on purpose: one menu, one key at a time.
      // oxlint-disable-next-line no-await-in-loop
      seen.set(key, await pressInMenu(open, key));
    }

    expectSame(
      `keys ${menu} doesn't show stay in it`,
      Object.fromEntries(seen),
      Object.fromEntries(hidden.map((key) => [key, quiet]))
    );
  };

  const openMore = async (): Promise<void> => {
    await page.getByTestId("more").click();
    await page.getByRole("menu").waitFor();
    await page.waitForTimeout(150);
  };

  await hiddenKeysIn("row B's menu", async () => {
    await openMenu(bIndex);
  });
  await hiddenKeysIn("the ⋯ menu", openMore);
  await hiddenKeysIn("the due filter menu", async () => {
    await page.getByRole("button", { name: "Due filters" }).click();
    await page.getByRole("menu").waitFor();
    await page.waitForTimeout(150);
  });

  await openMore();

  const moreText = (await page.getByRole("menu").textContent()) ?? "";

  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "detached" });
  expectSame(
    "the ⋯ menu shows no Space key either",
    moreText.includes("Space"),
    false
  );

  await rows.nth(bIndex).focus();
  await takeCalls();
  await page.keyboard.press(" ");
  await page.waitForTimeout(400);
  expectSame(
    "Space on focused row B with no menu open marks B done and moves on to the next row",
    { calls: await takeCalls(), focus: await focused() },
    { calls: [`setDone:${b}:true`], focus: ids[bIndex + 1] }
  );

  await context.close();

  return failures;
};

/**
 * Round 5's copy gate: every way to copy capture A asks main's gate, which
 * has the page save A's typing first. While saves fail nothing is copied and
 * the page says so; once they work, each way copies A.
 */
const checkCopyGate = async (
  browser: Browser,
  origin: string,
  captures: readonly Capture[],
  platform: Platform
): Promise<string[]> => {
  const { expectSame, failures } = makeReport(platform);
  const a = uuid(1);

  const { context, page } = await openLibrary(
    browser,
    origin,
    { captures: structuredClone(captures), page: "library" },
    platform,
    `/captures/${a}`
  );

  const rows = page.locator(ROW);

  const listed = await rows.evaluateAll((elements: HTMLElement[]) =>
    elements.map((element) => element.dataset.captureId ?? "")
  );

  const aIndex = listed.indexOf(a);

  const m = mod(platform);
  const title = page.getByTestId("title-field");

  const take = async () =>
    await page.evaluate(() => {
      const asked = globalThis.__asked ?? [];

      const calls = globalThis.__calls ?? [];

      globalThis.__asked = [];
      globalThis.__calls = [];

      return {
        asked,
        copies: calls.filter((call) => call.startsWith("copy")),
        saves: calls.filter((call) => call.startsWith("update")),
      };
    });

  const openRowMenu = async (): Promise<void> => {
    await rows.nth(aIndex).click({ button: "right" });
    await page.getByRole("menu").waitFor();
    await page.waitForTimeout(150);
  };

  const openMore = async (): Promise<void> => {
    await page.getByTestId("more").click();
    await page.getByRole("menu").waitFor();
    await page.waitForTimeout(150);
  };

  const focusRow = async (): Promise<void> => {
    await rows.nth(aIndex).focus();
  };

  const focusPage = async (): Promise<void> => {
    await page.getByTestId("more").focus();
  };

  const focusTitle = async (): Promise<void> => {
    await title.focus();
  };

  const press = (key: string) => async (): Promise<void> => {
    await page.keyboard.press(key);
  };

  const pick = (name: RegExp) => async (): Promise<void> => {
    await page.getByRole("menuitem", { name }).click();
  };

  const command = (name: string) => async (): Promise<void> => {
    await page.evaluate((sent) => {
      globalThis.__emit?.("command", sent);
    }, name);
  };

  const onMac = platform === "macos";

  const ways: readonly {
    readonly way: string;
    readonly copies: "copyText" | "copyDetails" | "copyImage";
    readonly prepare: () => Promise<void>;
    readonly act: () => Promise<void>;
  }[] = [
    {
      act: press(`${m}+c`),
      copies: "copyText",
      prepare: openRowMenu,
      way: `${m}+c in A's row menu`,
    },
    {
      act: press(`${m}+Alt+c`),
      copies: "copyDetails",
      prepare: openRowMenu,
      way: `${m}+Alt+c in A's row menu`,
    },
    {
      act: press(`${m}+Shift+c`),
      copies: "copyImage",
      prepare: openRowMenu,
      way: `${m}+Shift+c in A's row menu`,
    },
    {
      act: pick(/^Copy Text/u),
      copies: "copyText",
      prepare: openRowMenu,
      way: "Copy Text in A's row menu",
    },
    {
      act: pick(/Copy with Details/u),
      copies: "copyDetails",
      prepare: openRowMenu,
      way: "Copy with Details in A's row menu",
    },
    {
      act: pick(/^Copy Image/u),
      copies: "copyImage",
      prepare: openRowMenu,
      way: "Copy Image in A's row menu",
    },
    {
      act: press(`${m}+Alt+c`),
      copies: "copyDetails",
      prepare: focusRow,
      way: `${m}+Alt+c on A's row`,
    },
    {
      act: press(`${m}+Shift+c`),
      copies: "copyImage",
      prepare: focusRow,
      way: `${m}+Shift+c on A's row`,
    },
    {
      act: press(`${m}+c`),
      copies: "copyText",
      prepare: openMore,
      way: `${m}+c in the ⋯ menu`,
    },
    {
      act: press(`${m}+Alt+c`),
      copies: "copyDetails",
      prepare: openMore,
      way: `${m}+Alt+c in the ⋯ menu`,
    },
    {
      act: press(`${m}+Shift+c`),
      copies: "copyImage",
      prepare: openMore,
      way: `${m}+Shift+c in the ⋯ menu`,
    },
    {
      act: pick(/^Copy Text/u),
      copies: "copyText",
      prepare: openMore,
      way: "Copy Text in the ⋯ menu",
    },
    {
      act: pick(/Copy with Details/u),
      copies: "copyDetails",
      prepare: openMore,
      way: "Copy with Details in the ⋯ menu",
    },
    {
      act: pick(/^Copy Image/u),
      copies: "copyImage",
      prepare: openMore,
      way: "Copy Image in the ⋯ menu",
    },
    {
      act: press(`${m}+Alt+c`),
      copies: "copyDetails",
      prepare: focusPage,
      way: `${m}+Alt+c on the page`,
    },
    {
      act: press(`${m}+Shift+c`),
      copies: "copyImage",
      prepare: focusPage,
      way: `${m}+Shift+c on the page`,
    },
    {
      act: press(`${m}+Alt+c`),
      copies: "copyDetails",
      prepare: focusTitle,
      way: `${m}+Alt+c in the title field`,
    },
    {
      act: async () => {
        await page
          .getByRole("button", { name: "Copy image with pins" })
          .click();
      },
      copies: "copyImage",
      prepare: ready,
      way: "the image's Copy button",
    },
    {
      act: command("copyText"),
      copies: "copyText",
      prepare: ready,
      way: "Copy Text from the app menu",
    },
    {
      act: command("copyDetails"),
      copies: "copyDetails",
      prepare: ready,
      way: "Copy with Details from the app menu",
    },
    {
      act: command("copyImage"),
      copies: "copyImage",
      prepare: ready,
      way: "Copy Image from the app menu",
    },
    // Plain ⌘C arrives as the copy event, which Chromium raises only on a Mac.
    ...(onMac
      ? [
          {
            act: press("Meta+c"),
            copies: "copyText" as const,
            prepare: focusRow,
            way: "Meta+c on A's row",
          },
          {
            act: press("Meta+c"),
            copies: "copyText" as const,
            prepare: focusPage,
            way: "Meta+c on the page",
          },
        ]
      : []),
  ];

  interface CopyOutcome {
    readonly asked: readonly string[];
    readonly copies: readonly string[];
    readonly saves: readonly string[];
    readonly notice: { readonly failed: boolean; readonly text: string };
  }

  const tryWay = async ({
    act,
    prepare,
  }: (typeof ways)[number]): Promise<CopyOutcome> => {
    await prepare();
    await take();
    await act();
    await page.waitForTimeout(300);

    const notice = await page.getByTestId("notice").evaluate((element) => ({
      failed: element.getAttribute("role") === "alert",
      text: element.textContent ?? "",
    }));

    const { asked, copies, saves } = await take();
    const outcome = { asked, copies, notice, saves };

    if (await page.getByRole("menu").isVisible()) {
      await page.keyboard.press("Escape");
    }

    return outcome;
  };

  const tryEach = async (): Promise<Record<string, CopyOutcome>> => {
    const seen = new Map<string, CopyOutcome>();

    for (const one of ways) {
      // Sequential on purpose: one clipboard, one copy at a time.
      // oxlint-disable-next-line no-await-in-loop
      seen.set(one.way, await tryWay(one));
    }

    return Object.fromEntries(seen);
  };

  await title.evaluate((field: HTMLInputElement | HTMLTextAreaElement) => {
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  });
  await page.evaluate(() => {
    globalThis.__failSaves = true;
  });
  await page.keyboard.type(" (typed)");
  await page.getByTestId("save-failure").waitFor();

  const refused = {
    failed: true,
    text: "Couldn’t save your changes, so nothing was copied. The disk is full.Retry",
  };

  const refusedEach = Object.fromEntries(
    ways.map(({ copies, way }) => [
      way,
      { asked: [`${copies}:${a}`], copies: [], notice: refused, saves: [] },
    ])
  );

  expectSame(
    "once A's save has failed, every way to copy A asks the gate, refuses at once without saving again, says why and offers Retry",
    await tryEach(),
    refusedEach
  );

  await page.evaluate(() => {
    globalThis.__failSaves = false;
  });

  expectSame(
    "once the disk recovers, every way to copy A still refuses until Retry, and saves nothing by itself",
    await tryEach(),
    refusedEach
  );

  await page.getByTestId("notice-action").click();
  await page.waitForTimeout(300);

  const retriedNotice = await page.getByTestId("notice").textContent();
  const { saves: retriedSaves } = await take();
  const retried = { notice: retriedNotice, saves: retriedSaves };

  const said = {
    copyDetails: "Copied with details",
    copyImage: "Image copied with its pins",
    copyText: "Copied",
  } as const;

  expectSame(
    "the refusal's Retry saves A once and says so; every way to copy A then copies A",
    { copied: await tryEach(), retried },
    {
      copied: Object.fromEntries(
        ways.map(({ copies, way }) => [
          way,
          {
            asked: [`${copies}:${a}`],
            copies: [`${copies}:${a}`],
            notice: { failed: false, text: said[copies] },
            saves: [],
          },
        ])
      ),
      retried: {
        notice: "Saved. You can copy it now.",
        saves: [
          `update:${a}:${captures.find((one) => one.id === a)?.title ?? ""} (typed)`,
        ],
      },
    }
  );

  await context.close();

  return failures;
};

/** The floating window's Copy image: a refused copy says why and never shows Copied. */
const checkFloatCopy = async (
  browser: Browser,
  origin: string,
  captures: readonly Capture[],
  platform: Platform
): Promise<string[]> => {
  const { expectSame, failures } = makeReport(platform);

  const context = await browser.newContext({
    userAgent: USER_AGENT[platform],
    viewport: SIZES.pin,
  });

  const page = await context.newPage();

  const input: BridgeInput = { capture: captures[0], page: "pin" };

  await page.addInitScript(installBridge, input);
  await page.goto(`${origin}/pin.html`);
  await page.getByRole("img").first().waitFor();

  const state = async () =>
    await page.evaluate(() => {
      const calls = globalThis.__calls ?? [];

      globalThis.__calls = [];

      return {
        alert:
          document.querySelector("[data-testid='copy-failed']")?.textContent ??
          null,
        calls,
        // Close, the copy button, then Show in library.
        copyButton:
          document.querySelectorAll("button")[1]?.getAttribute("aria-label") ??
          null,
      };
    });

  await page.evaluate(() => {
    globalThis.__failSaves = true;
  });
  await page.getByRole("button", { name: "Copy image" }).click();
  await page.waitForTimeout(200);
  expectSame(
    "a refused copy in the floating window says why and offers Retry",
    await state(),
    {
      alert:
        "Couldn’t save your changes, so nothing was copied. The disk is full.Retry",
      calls: [],
      copyButton: "Couldn’t copy",
    }
  );

  await page.evaluate(() => {
    globalThis.__failSaves = false;
  });
  await page.getByRole("button", { name: "Couldn’t copy" }).click();
  await page.waitForTimeout(200);

  const recovered = await state();

  await page.getByTestId("retry-save").click();
  await page.waitForTimeout(200);

  const retried = {
    ...(await state()),
    saved: await page.getByTestId("saved").textContent(),
  };

  await page.getByRole("button", { name: "Copy image" }).click();
  await page.waitForTimeout(200);
  expectSame(
    "once the disk recovers the floating window still refuses until Retry; Retry saves, and the copy then works",
    { copied: await state(), recovered, retried },
    {
      copied: { alert: null, calls: ["copyImage:pin"], copyButton: "Copied" },
      recovered: {
        alert:
          "Couldn’t save your changes, so nothing was copied. The disk is full.Retry",
        calls: [],
        copyButton: "Couldn’t copy",
      },
      retried: {
        alert: null,
        calls: ["retrySave:pin"],
        copyButton: "Copy image",
        saved: "Saved. You can copy it now.",
      },
    }
  );

  await context.close();

  return failures;
};

/**
 * Round 6's draft lifecycle in the real renderer, with saves held as on a
 * slow disk: a copy carries what was on screen when it started, a capture's
 * unsaved typing outlives leaving it, a copy refuses while that typing can't
 * be saved, and Retry or Discard changes ends it.
 */
const checkDrafts = async (
  browser: Browser,
  origin: string,
  captures: readonly Capture[],
  platform: Platform
): Promise<string[]> => {
  const { attempt, expectSame, failures } = makeReport(platform);
  const a = uuid(1);
  const aTitle = captures.find((one) => one.id === a)?.title ?? "";
  const m = mod(platform);

  // The notice's text, then its Retry button.
  const refused = {
    failed: true,
    text: "Couldn’t save your changes, so nothing was copied. The disk is full.Retry",
  };

  const session = async ({
    owed = [],
    stored = captures,
  }: {
    readonly owed?: readonly OwedFixture[];
    readonly stored?: readonly Capture[];
  } = {}) => {
    const { context, page } = await openLibrary(
      browser,
      origin,
      { captures: structuredClone(stored), owed, page: "library" },
      platform,
      `/captures/${a}`
    );

    const rows = page.locator(ROW);

    const ids = await rows.evaluateAll((elements: HTMLElement[]) =>
      elements.map((element) => element.dataset.captureId ?? "")
    );

    const row = (id: string) => rows.nth(ids.indexOf(id));
    const b = ids[2] ?? "";
    const bTitle = captures.find((one) => one.id === b)?.title ?? "";

    const set = async (
      name: "__failSaves" | "__holdSaves" | "__holdAnswers",
      on: boolean
    ): Promise<void> => {
      await page.evaluate(
        ([key, value]) => {
          globalThis[key] = value;
        },
        [name, on] as const
      );
    };

    const release = async (): Promise<void> => {
      await page.evaluate(() => {
        globalThis.__releaseSaves?.();
      });
      await page.waitForTimeout(300);
    };

    /** What the bridge saw since the last look: the copies asked for and made, the clipboard, the saves. */
    const take = async () =>
      await page.evaluate(() => {
        const calls = globalThis.__calls ?? [];

        const seen = {
          asked: globalThis.__asked ?? [],
          clipboard: globalThis.__clipboard ?? [],
          copies: calls.filter((call) => call.startsWith("copy")),
          saves: calls.filter(
            (call) => call.startsWith("update") || call.startsWith("discard")
          ),
        };

        globalThis.__asked = [];
        globalThis.__calls = [];
        globalThis.__clipboard = [];

        return seen;
      });

    const notice = async () =>
      await page.getByTestId("notice").evaluate((element) => ({
        failed: element.getAttribute("role") === "alert",
        text: element.textContent ?? "",
      }));

    /** The copies since the last look, the clipboard, the saves and what the notice says. */
    const outcome = async () => {
      const seen = await take();
      const said = await notice();

      return {
        asked: seen.asked,
        clipboard: seen.clipboard,
        copies: seen.copies,
        notice: said,
        saves: seen.saves,
      };
    };

    const open = async (id: string, title: string): Promise<void> => {
      await row(id).click();
      await page.waitForFunction(
        (want) =>
          document
            .querySelector<HTMLTextAreaElement>("[data-testid='title-field']")
            ?.value.startsWith(want) === true,
        title
      );
    };

    const copyFromRow = async (id: string): Promise<void> => {
      await row(id).click({ button: "right" });
      await page.getByRole("menu").waitFor();
      await page.waitForTimeout(150);
      await page.keyboard.press(`${m}+c`);
      await page.waitForTimeout(150);
    };

    /** The capture's fields and its failure, as the page shows them. */
    const shown = async () =>
      await page.evaluate(() => ({
        failure:
          document.querySelector("[data-testid='save-failure']")?.textContent ??
          null,
        title:
          document.querySelector<HTMLTextAreaElement>(
            "[data-testid='title-field']"
          )?.value ?? null,
      }));

    const unsavedRow = async (id: string): Promise<boolean> =>
      await page
        .locator(`${ROW}[data-capture-id='${id}'] [data-meta='unsaved']`)
        .isVisible();

    /** The title a row shows; null when there is none to read. */
    const rowTitle = async (id: string) =>
      await page.evaluate(
        (selector) => document.querySelector(selector)?.textContent ?? null,
        `${ROW}[data-capture-id='${id}'] [data-testid='row-title']`
      );

    /** Every field of the open capture as it shows. */
    const fields = async () =>
      await page.evaluate(() => ({
        description:
          document.querySelector<HTMLTextAreaElement>(
            "[data-testid='description-field']"
          )?.value ?? null,
        due:
          document.querySelector("[data-testid='due-chip']")?.textContent ??
          null,
        pins: [
          ...document.querySelectorAll<HTMLInputElement>(
            "[data-testid='pin-list'] input"
          ),
        ].map((input) => input.value),
        steps: [
          ...document.querySelectorAll<HTMLInputElement>(
            "[data-testid='steps-editor'] input[aria-label^='Next step']"
          ),
        ].map((input) => input.value),
        title:
          document.querySelector<HTMLTextAreaElement>(
            "[data-testid='title-field']"
          )?.value ?? null,
      }));

    return {
      b,
      bTitle,
      context,
      copyFromRow,
      fields,
      notice,
      open,
      outcome,
      page,
      release,
      rowTitle,
      set,
      shown,
      take,
      unsavedRow,
    };
  };

  const failure =
    "Couldn’t save your changes. The disk is full.RetryDiscard changes";

  // A second edit typed while the copy waits for the first one's save.
  {
    const { context, outcome, page, release, set, take } = await session();

    await set("__holdSaves", true);
    await typeInTitle(page, " one");
    await page.keyboard.press(`${m}+Alt+c`);
    await page.waitForTimeout(150);
    await page.keyboard.type(" two");
    await page.waitForTimeout(100);
    await release();

    const copied = await outcome();

    await page.waitForTimeout(900);
    await release();
    await set("__holdSaves", false);

    const later = await take();

    expectSame(
      "a copy started before a second edit carries the first, and the second still saves",
      { copied, laterSaves: later.saves },
      {
        copied: {
          asked: [`copyDetails:${a}`],
          clipboard: [`${aTitle} one`],
          copies: [`copyDetails:${a}`],
          notice: { failed: false, text: "Copied with details" },
          saves: [`update:${a}:${aTitle} one`],
        },
        laterSaves: [`update:${a}:${aTitle} one two`],
      }
    );

    await context.close();
  }

  // Leaving A while its save is on its way, then copying A from its row.
  for (const fails of [true, false]) {
    // Sequential on purpose: each run has its own window and timers.
    // oxlint-disable-next-line no-await-in-loop
    const s = await session();
    const typed = fails ? " (mid-save)" : " (saved)";

    // oxlint-disable-next-line no-await-in-loop
    await s.set("__holdSaves", true);
    // oxlint-disable-next-line no-await-in-loop
    await typeInTitle(s.page, typed);
    // oxlint-disable-next-line no-await-in-loop
    await s.open(s.b, s.bTitle);
    // oxlint-disable-next-line no-await-in-loop
    await s.copyFromRow(a);
    // oxlint-disable-next-line no-await-in-loop
    await s.set("__failSaves", fails);
    // oxlint-disable-next-line no-await-in-loop
    await s.release();
    // oxlint-disable-next-line no-await-in-loop
    await s.set("__holdSaves", false);

    // oxlint-disable-next-line no-await-in-loop
    const copied = await s.outcome();
    // oxlint-disable-next-line no-await-in-loop
    const marked = await s.unsavedRow(a);

    // oxlint-disable-next-line no-await-in-loop
    await s.open(a, aTitle);

    expectSame(
      fails
        ? "a copy of A from its row, started while A's save was on its way after leaving it, refuses once that save fails; A keeps its typing and says so"
        : "a copy of A from its row, started while A's save was on its way after leaving it, copies the typing once the save works",
      // oxlint-disable-next-line no-await-in-loop
      { copied, marked, reopened: await s.shown() },
      fails
        ? {
            copied: {
              asked: [`copyText:${a}`],
              clipboard: [],
              copies: [],
              notice: refused,
              saves: [`update:${a}:${aTitle}${typed}`],
            },
            marked: true,
            reopened: { failure, title: `${aTitle}${typed}` },
          }
        : {
            copied: {
              asked: [`copyText:${a}`],
              clipboard: [`${aTitle}${typed}`],
              copies: [`copyText:${a}`],
              notice: { failed: false, text: "Copied" },
              saves: [`update:${a}:${aTitle}${typed}`],
            },
            marked: false,
            reopened: { failure: null, title: `${aTitle}${typed}` },
          }
    );

    // oxlint-disable-next-line no-await-in-loop
    await s.context.close();
  }

  // Leaving A after its save has failed and settled, then copying A from its row; typing on, Retry, then Discard changes.
  await attempt(
    "a settled failure, its copies, Retry and Discard changes",
    async () => {
      const s = await session();
      const { page } = s;

      try {
        await s.set("__failSaves", true);
        await typeInTitle(page, " (failed)");
        await page.getByTestId("save-failure").waitFor();
        await s.open(s.b, s.bTitle);
        await page.waitForTimeout(1200);
        await s.take();
        await s.set("__failSaves", false);
        await s.copyFromRow(a);
        await page.waitForTimeout(300);

        const copied = await s.outcome();
        const marked = await s.unsavedRow(a);
        const rowTitle = await s.rowTitle(a);

        await s.open(a, aTitle);

        expectSame(
          "once the disk recovers, a copy from the row of A, whose failed save has settled after A was left, is refused at once without saving again, offers Retry, and the row keeps the typed title",
          { copied, marked, reopened: await s.shown(), rowTitle },
          {
            copied: {
              asked: [`copyText:${a}`],
              clipboard: [],
              copies: [],
              notice: refused,
              saves: [],
            },
            marked: true,
            reopened: { failure, title: `${aTitle} (failed)` },
            rowTitle: `${aTitle} (failed)`,
          }
        );

        // Typing on while the error shows doesn't make a copy save it either.
        await typeInTitle(page, "!");
        await page.keyboard.press(`${m}+Alt+c`);
        await page.waitForTimeout(150);

        const typedOn = await s.outcome();

        await page.waitForTimeout(900);

        expectSame(
          "a copy made just after typing on from a failed save is refused at once too; the typing then saves after its pause, as typing does",
          { copied: typedOn, later: await s.take(), shown: await s.shown() },
          {
            copied: {
              asked: [`copyDetails:${a}`],
              clipboard: [],
              copies: [],
              notice: refused,
              saves: [],
            },
            later: {
              asked: [],
              clipboard: [],
              copies: [],
              saves: [`update:${a}:${aTitle} (failed)!`],
            },
            shown: { failure: null, title: `${aTitle} (failed)!` },
          }
        );

        // A held Retry: Discard changes stays available, Retry waits for its answer.
        await s.set("__failSaves", true);
        await typeInTitle(page, "!");
        await page.getByTestId("save-failure").waitFor();
        await s.take();

        const failureBar = page.getByTestId("save-failure");
        const retryButton = failureBar.getByRole("button", { name: "Retry" });

        const discardButton = failureBar.getByRole("button", {
          name: "Discard changes",
        });

        await s.set("__holdSaves", true);
        await retryButton.click();
        await page.waitForTimeout(150);

        const whileRetrying = {
          discard: await discardButton.isEnabled(),
          retry: await retryButton.isEnabled(),
        };

        await s.release();
        await s.set("__holdSaves", false);

        const afterFailedRetry = {
          discard: await discardButton.isEnabled(),
          retry: await retryButton.isEnabled(),
        };

        const { saves: retrySaves } = await s.take();

        expectSame(
          "while a Retry is on its way, Discard changes stays available and Retry waits; a failed Retry offers both again",
          { afterFailedRetry, saves: retrySaves, whileRetrying },
          {
            afterFailedRetry: { discard: true, retry: true },
            saves: [`update:${a}:${aTitle} (failed)!!`],
            whileRetrying: { discard: true, retry: false },
          }
        );

        await s.set("__failSaves", false);
        await retryButton.click();
        await page.waitForTimeout(300);

        const retried = await s.take();
        const afterRetry = await s.shown();

        await page.keyboard.press(`${m}+Alt+c`);
        await page.waitForTimeout(300);

        const copiedAfterRetry = await s.outcome();

        expectSame(
          "Retry saves A's typing and clears the failure; a copy then carries it",
          {
            copy: {
              clipboard: copiedAfterRetry.clipboard,
              notice: copiedAfterRetry.notice,
            },
            marked: await s.unsavedRow(a),
            saves: retried.saves,
            shown: afterRetry,
          },
          {
            copy: {
              clipboard: [`${aTitle} (failed)!!`],
              notice: { failed: false, text: "Copied with details" },
            },
            marked: false,
            saves: [`update:${a}:${aTitle} (failed)!!`],
            shown: { failure: null, title: `${aTitle} (failed)!!` },
          }
        );

        await s.set("__failSaves", true);
        await typeInTitle(page, " (discard me)");
        await page.getByTestId("save-failure").waitFor();
        await discardButton.click();
        await page.waitForTimeout(300);
        await s.set("__failSaves", false);

        const discarded = await s.shown();
        const focus = await focusedId(page);

        await s.take();
        await page.keyboard.press(`${m}+Alt+c`);
        await page.waitForTimeout(300);

        const copiedAfterDiscard = await s.take();

        expectSame(
          "Discard changes shows what is saved again, keeps the title focused, and nothing unsaved is left to copy",
          {
            clipboard: copiedAfterDiscard.clipboard,
            discarded,
            focus,
            marked: await s.unsavedRow(a),
          },
          {
            clipboard: [`${aTitle} (failed)!!`],
            discarded: { failure: null, title: `${aTitle} (failed)!!` },
            focus: "title-field",
            marked: false,
          }
        );
      } finally {
        await s.context.close();
      }
    }
  );

  // Round 8: a prompt owns the keys, so no field shortcut or pin key changes the capture underneath it.
  await attempt("keys under the unsaved-changes prompt", async () => {
    const s = await session();
    const { page } = s;

    try {
      await failTypingInTitle(page);

      const before = await s.fields();

      void askToLeave(page, "quit");
      await page.getByTestId("leave-prompt").waitFor();
      await page.waitForTimeout(150);

      for (const key of [
        `${m}+Shift+d`,
        `${m}+d`,
        `${m}+Shift+s`,
        "Shift+p",
        "p",
        "1",
      ]) {
        // Sequential on purpose: each key lands on the prompt in turn.
        // oxlint-disable-next-line no-await-in-loop
        await page.keyboard.press(key);
        // oxlint-disable-next-line no-await-in-loop
        await page.waitForTimeout(80);
      }

      const underPrompt = await page.evaluate(() => ({
        layers: document.querySelectorAll("[data-slot='popover-content']")
          .length,
        pinMode:
          document.querySelector(
            "[data-testid='pin-tool'][aria-pressed='true']"
          ) !== null,
        prompt: document.querySelector("[data-testid='leave-prompt']") !== null,
      }));

      const during = await s.fields();

      expectSame(
        "with the unsaved-changes prompt open, ⇧⌘D, ⌘D, ⇧⌘S, ⇧P, P and 1 change nothing in the capture underneath",
        { during, underPrompt },
        {
          during: before,
          underPrompt: { layers: 0, pinMode: false, prompt: true },
        }
      );

      // The app menu, the tray and Windows' main-side keys arrive as commands, not keys: none acts under the prompt either.
      await s.take();

      const look = async () =>
        await page.evaluate(() => ({
          dialogs: document.querySelectorAll("[role='dialog']").length,
          focusInPrompt:
            document.activeElement?.closest("[role='alertdialog']") !== null,
          hash: location.hash,
          layers: document.querySelectorAll("[data-slot='popover-content']")
            .length,
          list:
            document.querySelector("aside[aria-label='Captures']")
              ?.textContent ?? null,
          pinMode:
            document.querySelector(
              "[data-testid='pin-tool'][aria-pressed='true']"
            ) !== null,
          prompts: document.querySelectorAll("[role='alertdialog']").length,
          sidebar:
            document.querySelector<HTMLElement>("aside[aria-label='Captures']")
              ?.dataset.collapsed ?? null,
        }));

      const screenBefore = await look();

      for (const command of [
        "copyText",
        "copyDetails",
        "copyImage",
        "edit",
        "delete",
        "float",
        "done",
        "description",
        "due",
        "steps",
        "pinTool",
        "find",
        "shortcuts",
        "toggleSidebar",
        "showDone",
      ]) {
        // Sequential on purpose: each command lands on the page in turn.
        // oxlint-disable-next-line no-await-in-loop
        await page.evaluate((name) => {
          globalThis.__emit?.("command", name);
        }, command);
        // oxlint-disable-next-line no-await-in-loop
        await page.waitForTimeout(60);
      }

      // Round 8 red team: the window's own shortcuts and a capture chosen from the tray skip the command bus, and must not act under the prompt either.
      for (const key of [
        `${m}+/`,
        `${m}+f`,
        ...(platform === "windows" ? ["Control+,"] : []),
      ]) {
        // Sequential on purpose: each key lands on the prompt in turn.
        // oxlint-disable-next-line no-await-in-loop
        await page.keyboard.press(key);
        // oxlint-disable-next-line no-await-in-loop
        await page.waitForTimeout(80);
      }

      await page.evaluate((id) => {
        globalThis.__emit?.("show", id);
      }, s.b);
      await page.waitForTimeout(200);

      const others = await page.evaluate(() =>
        (globalThis.__calls ?? []).filter(
          (call) =>
            call.startsWith("setDone") ||
            call.startsWith("remove") ||
            call.startsWith("floatOnTop") ||
            call === "openSettings"
        )
      );

      const seen = await s.take();

      expectSame(
        "with the unsaved-changes prompt open, no app-menu or tray command, window shortcut or capture chosen from the tray changes the capture, the list or the store, or opens anything under it",
        {
          calls: [...seen.asked, ...seen.copies, ...seen.saves],
          fields: await s.fields(),
          others,
          screen: await look(),
        },
        { calls: [], fields: before, others: [], screen: screenBefore }
      );
    } finally {
      await s.context.close();
    }
  });

  // Round 8: autosave never locks the fields, because typing during a save is kept and saved next, never ignored.
  await attempt("typing while a save is on its way", async () => {
    const s = await session();
    const { page } = s;

    try {
      await s.set("__holdSaves", true);
      await typeInTitle(page, " one");
      await page.getByTestId("more").focus();
      await page.waitForTimeout(150);
      await typeInTitle(page, " two");

      const { title: typed } = await s.shown();

      await s.set("__holdSaves", false);
      await s.release();
      await page.getByTestId("more").focus();
      await page.waitForFunction(
        (id) => globalThis.__storedTitle?.(id)?.endsWith(" one two") === true,
        a,
        { timeout: 3000 }
      );

      const { saves } = await s.take();

      expectSame(
        "the title takes typing while its save is on its way, and that typing is saved next",
        { saves, typed },
        {
          saves: [`update:${a}:${aTitle} one`, `update:${a}:${aTitle} one two`],
          typed: `${aTitle} one two`,
        }
      );
    } finally {
      await s.context.close();
    }
  });

  // Round 8: Discard ends the epoch, so an edit typed right after it saves at once and the dropped save never lands.
  await attempt("an edit right after Discard", async () => {
    const s = await session();
    const { page } = s;
    const bar = page.getByTestId("save-failure");

    try {
      await failTypingInTitle(page);
      await s.set("__failSaves", false);
      await s.set("__holdSaves", true);
      await bar.getByRole("button", { name: "Retry" }).click();
      await bar.getByRole("button", { name: "Discard changes" }).click();
      await typeInTitle(page, " kept");
      await page.getByTestId("more").focus();
      await page.waitForTimeout(150);
      await s.set("__holdSaves", false);
      await s.release();
      await page.waitForTimeout(300);

      const { saves } = await s.take();

      expectSame(
        "an edit typed right after Discard saves, the save Discard dropped never lands, and the capture shows and keeps the new edit",
        {
          disk: await page.evaluate(
            (id) => globalThis.__storedTitle?.(id) ?? null,
            a
          ),
          saves,
          shown: await s.shown(),
        },
        {
          disk: `${aTitle} kept`,
          saves: [
            `update:${a}:${aTitle} (typed)`,
            `update:${a}:${aTitle} (typed)`,
            `discard:${a}:${aTitle} (typed)`,
            `update:${a}:${aTitle} kept`,
          ],
          shown: { failure: null, title: `${aTitle} kept` },
        }
      );
    } finally {
      await s.context.close();
    }
  });

  // Round 7 red team: Discard goes back to the last save that landed, though the capture's reload after that save hasn't answered yet.
  await attempt(
    "Discard after a save whose reload hasn't answered",
    async () => {
      const s = await session();
      const { page } = s;

      try {
        const title = page.getByTestId("title-field");
        const bar = page.getByTestId("save-failure");

        const disk = async () =>
          await page.evaluate(
            (id) => globalThis.__storedTitle?.(id) ?? null,
            a
          );

        await page.evaluate(() => {
          globalThis.__holdGets = true;
        });
        await title.fill("A newly saved title");
        await page.getByTestId("more").focus();
        await page.waitForFunction(
          (id) => globalThis.__storedTitle?.(id) === "A newly saved title",
          a
        );
        await s.set("__failSaves", true);
        await title.fill("Discard this second edit");
        await page.getByTestId("more").focus();
        await bar.waitFor();
        await s.set("__failSaves", false);
        await s.set("__holdSaves", true);
        await bar.getByRole("button", { name: "Retry" }).click();
        await bar.getByRole("button", { name: "Discard changes" }).click();

        const { title: atOnce } = await s.shown();

        await s.release();
        await s.set("__holdSaves", false);
        await page.evaluate(() => {
          globalThis.__holdGets = false;
          globalThis.__releaseGets?.();
        });
        await page.waitForTimeout(300);

        expectSame(
          "Discard shows and writes back the title saved before the discarded one, while the reload after that save is still on its way, and its late answer changes nothing",
          { atOnce, disk: await disk(), shown: await s.shown() },
          {
            atOnce: "A newly saved title",
            disk: "A newly saved title",
            shown: { failure: null, title: "A newly saved title" },
          }
        );
      } finally {
        await s.context.close();
      }
    }
  );

  // Round 8 red team: a save main wrote but hasn't confirmed, then a reload showing it, never becomes what Discard puts back.
  await attempt(
    "Discard after a save main wrote but hasn't confirmed",
    async () => {
      const s = await session();
      const { page } = s;

      try {
        const bar = page.getByTestId("save-failure");

        await failTypingInTitle(page);
        await s.set("__failSaves", false);
        await s.set("__holdAnswers", true);
        await typeInTitle(page, " more");
        await page.getByTestId("more").focus();
        await page.waitForFunction(
          (want) => globalThis.__storedTitle?.(want.id) === want.title,
          { id: a, title: `${aTitle} (typed) more` }
        );
        await page.waitForTimeout(300);
        await page.evaluate(() => {
          globalThis.__holdGets = true;
        });
        await bar.getByRole("button", { name: "Discard changes" }).click();

        const atOnce = await s.shown();

        await typeInTitle(page, "!");
        await page.getByTestId("more").focus();
        await page.waitForTimeout(150);
        await s.set("__holdAnswers", false);
        await s.release();
        await page.evaluate(() => {
          globalThis.__holdGets = false;
          globalThis.__releaseGets?.();
        });
        await page.waitForTimeout(300);

        expectSame(
          "Discard shows what was saved before the save main hadn't confirmed, though the capture reloaded with it, and the next edit builds on that",
          {
            atOnce,
            disk: await page.evaluate(
              (id) => globalThis.__storedTitle?.(id) ?? null,
              a
            ),
            shown: await s.shown(),
          },
          {
            atOnce: { failure: null, title: aTitle },
            disk: `${aTitle}!`,
            shown: { failure: null, title: `${aTitle}!` },
          }
        );
      } finally {
        await s.context.close();
      }
    }
  );

  // Round 9: a Discard main couldn't finish stays failed until Discard again or Keep changes settles it.
  await attempt(
    "a Discard main couldn't finish, then Discard again",
    async () => {
      const s = await session();
      const { page } = s;

      try {
        await failDiscard(page);
        await s.take();

        const failed = await s.shown();
        const unsaved = await s.unsavedRow(a);

        await page.keyboard.press(`${m}+Alt+c`);
        await page.getByTestId("notice-action").waitFor();

        const copy = await s.outcome();

        await page.evaluate(() => {
          globalThis.__failDiscards = false;
        });
        await page
          .getByTestId("save-failure")
          .getByRole("button", { name: "Discard again" })
          .click();
        await page.waitForTimeout(300);

        const { saves } = await s.take();

        expectSame(
          "it shows the changes failed with Keep changes and Discard again, refuses a copy, and Discard again puts back what was saved",
          {
            after: await s.shown(),
            copy: { clipboard: copy.clipboard, notice: copy.notice },
            disk: await page.evaluate(
              (id) => globalThis.__storedTitle?.(id) ?? null,
              a
            ),
            failed,
            saves,
            unsaved,
            unsavedAfter: await s.unsavedRow(a),
          },
          {
            after: { failure: null, title: aTitle },
            copy: {
              clipboard: [],
              notice: {
                failed: true,
                text: "Couldn’t discard your changes, so nothing was copied. Inset can’t write to its data folder.Keep changes",
              },
            },
            disk: aTitle,
            failed: {
              failure:
                "Couldn’t discard your changes. Inset can’t write to its data folder.Keep changesDiscard again",
              title: `${aTitle} (typed) more`,
            },
            saves: [`discard:${a}:${aTitle} (typed) more`],
            unsaved: true,
            unsavedAfter: false,
          }
        );
      } finally {
        await s.context.close();
      }
    }
  );

  await attempt(
    "Keep changes after a Discard main couldn't finish",
    async () => {
      const s = await session();
      const { page } = s;

      try {
        await failDiscard(page);
        await s.take();
        await page
          .getByTestId("save-failure")
          .getByRole("button", { name: "Keep changes" })
          .click();
        await page.waitForTimeout(300);

        const { saves } = await s.take();

        expectSame(
          "Keep changes keeps the changes the Discard couldn't take back, and the capture is saved",
          {
            disk: await page.evaluate(
              (id) => globalThis.__storedTitle?.(id) ?? null,
              a
            ),
            saves,
            shown: await s.shown(),
            unsaved: await s.unsavedRow(a),
          },
          {
            disk: `${aTitle} (typed) more`,
            saves: [`update:${a}:${aTitle} (typed) more`],
            shown: { failure: null, title: `${aTitle} (typed) more` },
            unsaved: false,
          }
        );
      } finally {
        await s.context.close();
      }
    }
  );

  // Round 9 red team: typing after a failed Discard decides nothing; the quit prompt asks, Discard again holds it until main puts back what is saved, and Return keeps the changes.
  await attempt(
    "typing after a failed Discard, then the quit prompt",
    async () => {
      const s = await session();
      const { page } = s;

      try {
        await failDiscard(page);
        await s.take();
        await typeInTitle(page, " later");
        await page.waitForTimeout(900);

        const typedSaves = await s.take();
        const typed = { saves: typedSaves.saves, shown: await s.shown() };
        const answered = await askToLeave(page, "quit");

        await page.getByTestId("leave-prompt").waitFor();
        await page.waitForTimeout(150);

        const asked = await leavePrompt(page);

        await page
          .getByTestId("leave-prompt")
          .getByRole("button", { name: "Discard again" })
          .click();
        await page.waitForTimeout(300);

        const discardResumed = await resumes(page);
        const discardSaves = await s.take();

        const discardFailed = {
          ...(await leavePrompt(page)),
          resumed: discardResumed,
          saves: discardSaves.saves,
        };

        await page.keyboard.press("Enter");
        await page.getByTestId("leave-prompt").waitFor({ state: "detached" });
        await page.waitForTimeout(150);

        const keptResumed = await resumes(page);
        const keptSaves = await s.take();

        expectSame(
          "typing saves nothing and keeps the failed Discard; the prompt offers Discard again and Keep changes with Keep changes focused; a failed Discard again keeps it held; Return on Discard again keeps the changes and goes on",
          {
            answered,
            asked,
            discardFailed,
            kept: {
              disk: await page.evaluate(
                (id) => globalThis.__storedTitle?.(id) ?? null,
                a
              ),
              resumed: keptResumed,
              saves: keptSaves.saves,
            },
            typed,
          },
          {
            answered: HELD,
            asked: {
              focus: "Keep changes",
              prompt:
                "1 change couldn’t be discardedInset can’t write to its data folder.CancelDiscard againKeep changes",
            },
            discardFailed: {
              focus: "Discard again",
              prompt:
                "1 change couldn’t be discardedInset can’t write to its data folder.CancelDiscard againKeep changes",
              resumed: [],
              saves: [`discard:${a}:${aTitle} (typed) more`],
            },
            kept: {
              disk: `${aTitle} (typed) more later`,
              resumed: ["resumeLeaving"],
              saves: [`update:${a}:${aTitle} (typed) more later`],
            },
            typed: {
              saves: [],
              shown: {
                failure:
                  "Couldn’t discard your changes. Inset can’t write to its data folder.Keep changesDiscard again",
                title: `${aTitle} (typed) more later`,
              },
            },
          }
        );
      } finally {
        await s.context.close();
      }
    }
  );

  // Round 10: Return in the banner after a failed Discard keeps the changes, as in the prompt, and Space still presses the focused button.
  await attempt("Return in the banner after a failed Discard", async () => {
    const s = await session();
    const { page } = s;

    try {
      await failDiscard(page);
      await typeInTitle(page, " later");
      await page.waitForTimeout(900);
      await page.evaluate(() => {
        globalThis.__failDiscards = false;
      });
      await s.take();
      await page
        .getByTestId("save-failure")
        .getByRole("button", { name: "Discard again" })
        .focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);

      const { saves } = await s.take();

      expectSame(
        "Return on a focused Discard again keeps the changes with the typing since, and discards nothing",
        {
          disk: await page.evaluate(
            (id) => globalThis.__storedTitle?.(id) ?? null,
            a
          ),
          saves,
          shown: await s.shown(),
          unsaved: await s.unsavedRow(a),
        },
        {
          disk: `${aTitle} (typed) more later`,
          saves: [`update:${a}:${aTitle} (typed) more later`],
          shown: { failure: null, title: `${aTitle} (typed) more later` },
          unsaved: false,
        }
      );
    } finally {
      await s.context.close();
    }
  });

  await attempt("Space in the banner after a failed Discard", async () => {
    const s = await session();
    const { page } = s;

    try {
      await failDiscard(page);
      await page.evaluate(() => {
        globalThis.__failDiscards = false;
      });
      await s.take();
      await page
        .getByTestId("save-failure")
        .getByRole("button", { name: "Discard again" })
        .focus();
      await page.keyboard.press("Space");
      await page.waitForTimeout(300);

      const { saves } = await s.take();

      expectSame(
        "Space on a focused Discard again still discards, so it stays a deliberate choice",
        {
          disk: await page.evaluate(
            (id) => globalThis.__storedTitle?.(id) ?? null,
            a
          ),
          saves,
          shown: await s.shown(),
        },
        {
          disk: aTitle,
          saves: [`discard:${a}:${aTitle} (typed) more`],
          shown: { failure: null, title: aTitle },
        }
      );
    } finally {
      await s.context.close();
    }
  });

  // Round 11: a Discard main doesn't answer within 3 s never traps a close. The prompt offers Wait and Close anyway, Return waits whichever button has the focus, Escape cancels, and Space on Close anyway leaves; the row shows the saved title meanwhile.
  await attempt("a close while main doesn't answer a Discard", async () => {
    const s = await session();
    const { page } = s;
    const prompt = page.getByTestId("leave-prompt");

    /** Return with this button focused, then what the prompt shows and whether the close went on. */
    const returnOn = async (name: string) => {
      await prompt.getByRole("button", { name }).focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(150);

      return { ...(await leavePrompt(page)), resumed: await resumes(page) };
    };

    try {
      await holdDiscard(page);
      await s.take();

      const pending = { row: await s.rowTitle(a), shown: await s.shown() };
      const answered = await askToLeave(page, "close");

      await prompt.waitFor();
      await page.waitForTimeout(150);

      const asked = await leavePrompt(page);
      const onCancel = await returnOn("Cancel");
      const onAnyway = await returnOn("Close anyway");
      const onWait = await returnOn("Wait");

      await page.keyboard.press("Escape");

      const cancelled = {
        gone: await settles(prompt, "detached", 2000),
        resumed: await resumes(page),
      };

      await askToLeave(page, "close");
      await prompt.waitFor();
      await prompt.getByRole("button", { name: "Close anyway" }).focus();
      await page.keyboard.press("Space");

      const left = {
        gone: await settles(prompt, "detached", 2000),
        resumed: await resumes(page),
      };

      await page.evaluate(() => {
        globalThis.__holdDiscards = false;
        globalThis.__releaseDiscards?.();
      });
      await page.waitForTimeout(300);

      const { saves } = await s.take();
      const waiting = `1 change isn’t discarded yetWaiting for Inset to put the earlier version back… Close anyway lets it finish on its own.CancelClose anywayWait`;

      expectSame(
        "the close prompt offers Wait and Close anyway with Wait focused; Return waits on every button; Escape cancels; Space on Close anyway leaves; the row and the capture show the saved title meanwhile, and main puts it back later",
        {
          answered,
          asked,
          cancelled,
          disk: await page.evaluate(
            (id) => globalThis.__storedTitle?.(id) ?? null,
            a
          ),
          left,
          onAnyway,
          onCancel,
          onWait,
          pending,
          saves,
        },
        {
          answered: HELD,
          asked: {
            focus: "Wait",
            prompt:
              "1 change isn’t discarded yetInset is still putting the earlier version back. Close anyway lets it finish on its own.CancelClose anywayWait",
          },
          cancelled: { gone: true, resumed: [] },
          disk: aTitle,
          left: { gone: true, resumed: ["resumeLeaving"] },
          onAnyway: { focus: "Close anyway", prompt: waiting, resumed: [] },
          onCancel: { focus: "Cancel", prompt: waiting, resumed: [] },
          onWait: { focus: "Wait", prompt: waiting, resumed: [] },
          pending: {
            row: aTitle,
            shown: { failure: null, title: aTitle },
          },
          saves: [],
        }
      );
    } finally {
      await s.context.close();
    }
  });

  // Round 10: a library opened while main still owes a Discard, as after a close during it, shows it failed rather than the discarded changes as saved.
  await attempt("a library that opens while main owes a Discard", async () => {
    const stored = captures.find((one) => one.id === a);

    if (stored === undefined) {
      throw new Error("capture A is missing");
    }

    const confirmed = {
      description: stored.description,
      due: stored.due,
      pins: stored.pins,
      steps: stored.steps,
      title: aTitle,
    };

    const discarded = `${aTitle} (discarded)`;

    const s = await session({
      owed: [
        {
          confirmed,
          id: a,
          message: "Inset can’t write to its data folder.",
          tag: { epoch: "closed-page.1", seq: 7 },
          values: { ...confirmed, title: discarded },
        },
      ],
      stored: captures.map((one) =>
        one.id === a ? { ...one, title: discarded } : one
      ),
    });

    const { page } = s;

    try {
      const opened = {
        shown: await s.shown(),
        unsaved: await s.unsavedRow(a),
      };

      await page.keyboard.press(`${m}+Alt+c`);
      await page.getByTestId("notice-action").waitFor();

      const copy = await s.outcome();

      await page.evaluate(() => {
        globalThis.__failDiscards = false;
      });
      await page
        .getByTestId("save-failure")
        .getByRole("button", { name: "Discard again" })
        .click();
      await page.waitForTimeout(300);

      const { saves } = await s.take();

      expectSame(
        "it opens with the changes failed, Keep changes and Discard again, and the Not saved row, tells main 1 change at once, refuses a copy, and Discard again puts back what was saved",
        {
          after: await s.shown(),
          copy: { clipboard: copy.clipboard, notice: copy.notice },
          counts: await page.evaluate(() => globalThis.__unsavedCounts ?? []),
          disk: await page.evaluate(
            (id) => globalThis.__storedTitle?.(id) ?? null,
            a
          ),
          opened,
          saves,
          unsavedAfter: await s.unsavedRow(a),
        },
        {
          after: { failure: null, title: aTitle },
          copy: {
            clipboard: [],
            notice: {
              failed: true,
              text: "Couldn’t discard your changes, so nothing was copied. Inset can’t write to its data folder.Keep changes",
            },
          },
          counts: [1, 0],
          disk: aTitle,
          opened: {
            shown: {
              failure:
                "Couldn’t discard your changes. Inset can’t write to its data folder.Keep changesDiscard again",
              title: discarded,
            },
            unsaved: true,
          },
          saves: [`discard:${a}:${discarded}`],
          unsavedAfter: false,
        }
      );
    } finally {
      await s.context.close();
    }
  });

  // Round 12: a library whose lookup of what main owes fails shows no capture and reports no count until a lookup answers.
  await attempt(
    "a library whose lookup of owed Discards fails once",
    async () => {
      const stored = captures.find((one) => one.id === a);

      if (stored === undefined) {
        throw new Error("capture A is missing");
      }

      const confirmed = {
        description: stored.description,
        due: stored.due,
        pins: stored.pins,
        steps: stored.steps,
        title: aTitle,
      };

      const discarded = `${aTitle} (discarded)`;

      const context = await browser.newContext({
        userAgent: USER_AGENT[platform],
        viewport: SIZES.library,
      });

      try {
        const page = await context.newPage();

        await page.addInitScript(installBridge, {
          captures: structuredClone(
            captures.map((one) =>
              one.id === a ? { ...one, title: discarded } : one
            )
          ),
          owed: [
            {
              confirmed,
              id: a,
              message: "Inset can’t write to its data folder.",
              tag: { epoch: "closed-page.1", seq: 7 },
              values: { ...confirmed, title: discarded },
            },
          ],
          owedFails: 1,
          page: "library",
        } satisfies BridgeInput);
        await page.goto(`${origin}/library.html#/captures/${a}`);
        await page.getByTestId("owed-unread").waitFor();

        const unread = await page.evaluate(
          (selector) => ({
            counts: globalThis.__unsavedCounts ?? [],
            rows: document.querySelectorAll(selector).length,
            text:
              document.querySelector("[data-testid='owed-unread']")
                ?.textContent ?? null,
          }),
          ROW
        );

        await page.locator(ROW).first().waitFor();
        await page.getByTestId("save-failure").waitFor();

        const opened = await page.evaluate(() => ({
          counts: globalThis.__unsavedCounts ?? [],
          failure:
            document.querySelector("[data-testid='save-failure']")
              ?.textContent ?? null,
          notice:
            document.querySelector("[data-testid='owed-unread']") !== null,
          title:
            document.querySelector<HTMLTextAreaElement>(
              "[data-testid='title-field']"
            )?.value ?? null,
        }));

        expectSame(
          "it shows Library can’t open yet with no capture and tells main no count, then asks again and opens with the Discard failed and a count of 1",
          { opened, unread },
          {
            opened: {
              counts: [1],
              failure:
                "Couldn’t discard your changes. Inset can’t write to its data folder.Keep changesDiscard again",
              notice: false,
              title: discarded,
            },
            unread: {
              counts: [],
              rows: 0,
              text: "Library can’t open yetInset couldn’t check which changes it still has to discard. Trying again…",
            },
          }
        );
      } finally {
        await context.close();
      }
    }
  );

  // Round 7 red team: a Retry beside the error that doesn't finish in 3 s says so, and Retry can wait again.
  await attempt("a Retry beside the error that doesn't finish", async () => {
    const s = await session();
    const { page } = s;

    try {
      const bar = page.getByTestId("save-failure");
      const retry = bar.getByRole("button", { name: "Retry" });

      await s.set("__failSaves", true);
      await typeInTitle(page, " (slow)");
      await bar.waitFor();
      await s.set("__failSaves", false);
      await s.set("__holdSaves", true);
      await retry.click();
      await page.waitForTimeout(2700);

      const early = await s.shown();
      const before = { failure: early.failure, retry: await retry.isEnabled() };

      await page.waitForTimeout(600);

      const late = await s.shown();
      const after = { failure: late.failure, retry: await retry.isEnabled() };

      const discard = await bar
        .getByRole("button", { name: "Discard changes" })
        .getAttribute("data-variant");

      await s.release();
      await s.set("__holdSaves", false);

      expectSame(
        "a Retry still on its way after 3 s says saving didn't finish and lets Retry wait again; Discard changes has the destructive tint; the save landing later clears it",
        { after, before, discard, landed: await s.shown() },
        {
          after: {
            failure:
              "Couldn’t save your changes. Saving didn’t finish in time.RetryDiscard changes",
            retry: true,
          },
          before: { failure, retry: false },
          discard: "destructive",
          landed: { failure: null, title: `${aTitle} (slow)` },
        }
      );
    } finally {
      await s.context.close();
    }
  });

  // Discard changes puts back every field, from the error and from the prompt before a quit (the window then stays, as when the capture panel cancels that quit).
  const discardEveryField = async (from: "error" | "prompt") => {
    const s = await session();
    const { page } = s;

    try {
      const before = await s.fields();

      await s.set("__failSaves", true);
      await typeInTitle(page, " (typed)");
      await page
        .getByTestId("description-field")
        .evaluate((field: HTMLTextAreaElement) => {
          field.focus();
          field.setSelectionRange(field.value.length, field.value.length);
        });
      await page.keyboard.type(" More.");
      await page
        .getByLabel("Next step 2", { exact: true })
        .evaluate((field: HTMLInputElement) => {
          field.focus();
          field.setSelectionRange(field.value.length, field.value.length);
        });
      await page.keyboard.type(" today");
      await page.getByRole("button", { name: "Clear Due" }).click();
      await page.getByRole("button", { name: "Remove pin 3" }).click();
      await page.getByRole("button", { name: "Remove pin 2" }).click();
      await page.getByTestId("save-failure").waitFor();
      await page.waitForTimeout(800);

      const edited = await s.fields();

      if (from === "error") {
        await page
          .getByTestId("save-failure")
          .getByRole("button", { name: "Discard changes" })
          .click();
      } else {
        await askToLeave(page, "quit");
        await page.getByTestId("leave-prompt").waitFor();
        await page.getByRole("button", { name: "Discard and quit" }).click();
      }

      await page.waitForTimeout(300);

      const after = await s.fields();
      const shownAfter = await s.shown();
      const rowTitle = await s.rowTitle(a);

      await s.set("__failSaves", false);
      await page.getByTestId("more").focus();
      await s.take();
      await page.keyboard.press(`${m}+z`);
      await page.waitForTimeout(300);

      const undoneFields = await s.fields();
      const { saves: undoSaves } = await s.take();
      const undone = { fields: undoneFields, saves: undoSaves };

      await page.keyboard.press(`${m}+Alt+c`);
      await page.waitForTimeout(300);

      const copied = await s.outcome();

      expectSame(
        `Discard ${from === "error" ? "changes beside the error" : "and quit in the prompt"} puts back the title, description, step, Due and pins at once, leaves no pin edit to undo, and a copy carries what is saved`,
        {
          after,
          edited,
          copied: {
            clipboard: copied.clipboard,
            notice: copied.notice,
            saves: copied.saves,
          },
          failure: shownAfter.failure,
          rowTitle,
          undone,
        },
        {
          after: before,
          edited: {
            description: `${before.description ?? ""} More.`,
            due: null,
            pins: before.pins.slice(0, 1),
            steps: before.steps.map((text, index) =>
              index === 1 ? `${text} today` : text
            ),
            title: `${before.title ?? ""} (typed)`,
          },
          copied: {
            clipboard: [aTitle],
            notice: { failed: false, text: "Copied with details" },
            saves: [],
          },
          failure: null,
          rowTitle: aTitle,
          undone: { fields: before, saves: [] },
        }
      );
    } finally {
      await s.context.close();
    }
  };

  await attempt(
    "Discard changes beside the error resets every field",
    async () => {
      await discardEveryField("error");
    }
  );
  await attempt("Discard and quit resets every field", async () => {
    await discardEveryField("prompt");
  });

  // A close or a quit while a change can't be saved is held and asks; Escape cancels, Return retries.
  await attempt("a held close, Escape, then Return", async () => {
    const s = await session();
    const { page } = s;

    try {
      const nothingTyped = await askToLeave(page, "quit");

      await failTypingInTitle(page);

      const answered = await askToLeave(page, "close");

      await page.getByTestId("leave-prompt").waitFor();
      await page.waitForTimeout(150);

      const asked = await leavePrompt(page);

      await page.keyboard.press("Escape");
      await page.getByTestId("leave-prompt").waitFor({ state: "detached" });
      await page.waitForTimeout(150);

      const cancelled = {
        ...(await leavePrompt(page)),
        resumed: await resumes(page),
        shown: await s.shown(),
      };

      await askToLeave(page, "quit");
      await page.getByTestId("leave-prompt").waitFor();
      await page.waitForTimeout(150);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);

      const retryFailed = {
        ...(await leavePrompt(page)),
        resumed: await resumes(page),
      };

      await s.set("__failSaves", false);
      await page.keyboard.press("Enter");
      await page.getByTestId("leave-prompt").waitFor({ state: "detached" });

      const resumed = await resumes(page);
      const { saves } = await s.take();

      expectSame(
        "a held close asks with Retry focused; Escape keeps the change and the window, Return retries and goes on once the save works",
        {
          answered,
          asked,
          cancelled,
          counts: await page.evaluate(() => globalThis.__unsavedCounts ?? []),
          nothingTyped,
          retried: { resumed, saves, shown: await s.shown() },
          retryFailed,
        },
        {
          answered: HELD,
          asked: {
            focus: "Retry",
            prompt: asking(
              "1 change",
              "The disk is full.",
              "Discard and close"
            ),
          },
          cancelled: {
            focus: "title-field",
            prompt: null,
            resumed: [],
            shown: { failure, title: `${aTitle} (typed)` },
          },
          // Report on load, typing, and before resuming, then the count listener also hears the completed save.
          counts: [0, 1, 0, 0],
          nothingTyped: { fields: null, ok: true },
          retried: {
            resumed: ["resumeLeaving"],
            // The pause in typing, the retry each of the two asks makes, the failed Return and the one that works. The prompt taking the focus from the failed title sends nothing: only Retry does.
            saves: Array.from(
              { length: 5 },
              () => `update:${a}:${aTitle} (typed)`
            ),
            shown: { failure: null, title: `${aTitle} (typed)` },
          },
          retryFailed: {
            focus: "Retry",
            prompt: asking("1 change", "The disk is full.", "Discard and quit"),
            resumed: [],
          },
        }
      );
    } finally {
      await s.context.close();
    }
  });

  // Round 7: Return means Retry whichever part of the prompt has the focus.
  await attempt("Return retries from every button", async () => {
    const s = await session();
    const { page } = s;
    const prompt = page.getByTestId("leave-prompt");

    try {
      await failTypingInTitle(page);
      await askToLeave(page, "quit");
      await prompt.waitFor();
      await page.waitForTimeout(150);

      const enterOn = async (focus: () => Promise<void>) => {
        await focus();
        await page.evaluate(() => {
          globalThis.__calls = [];
        });
        await page.keyboard.press("Enter");
        await page.waitForTimeout(300);

        return {
          calls: await page.evaluate(() => globalThis.__calls ?? []),
          ...(await leavePrompt(page)),
        };
      };

      // Each press finds the prompt still there only when the one before retried.
      const button = (name: string) => async () => {
        const target = prompt.getByRole("button", { exact: true, name });

        if ((await target.count()) > 0) {
          await target.focus();
        }
      };

      const onCancel = await enterOn(button("Cancel"));
      const onDiscard = await enterOn(button("Discard and quit"));
      const onRetry = await enterOn(button("Retry"));

      const onText = await enterOn(async () => {
        const text = prompt.getByText("The disk is full.");

        if ((await text.count()) > 0) {
          await text.click();
        }
      });

      await s.set("__failSaves", false);

      const working = await enterOn(button("Discard and quit"));

      const retriedHere = (focus: string) => ({
        calls: [`update:${a}:${aTitle} (typed)`],
        focus,
        prompt: asking("1 change", "The disk is full.", "Discard and quit"),
      });

      expectSame(
        "Return on Cancel, on Discard and quit, on Retry or on the prompt's text retries and keeps asking while saves fail; Return on Discard and quit retries once they work, and the quit goes on",
        {
          onCancel,
          onDiscard,
          onRetry,
          onText,
          shown: await s.shown(),
          working,
        },
        {
          onCancel: retriedHere("Cancel"),
          onDiscard: retriedHere("Discard and quit"),
          onRetry: retriedHere("Retry"),
          onText: retriedHere("leave-prompt"),
          shown: { failure: null, title: `${aTitle} (typed)` },
          working: {
            calls: [`update:${a}:${aTitle} (typed)`, "resumeLeaving"],
            focus: "title-field",
            prompt: null,
          },
        }
      );
    } finally {
      await s.context.close();
    }
  });

  // Escape cancels; Space presses the focused button, so Discard stays a deliberate choice.
  await attempt("Escape and Space in the prompt", async () => {
    const s = await session();
    const { page } = s;
    const prompt = page.getByTestId("leave-prompt");

    try {
      await failTypingInTitle(page);

      const ask = async () => {
        await askToLeave(page, "quit");
        await prompt.waitFor();
        await page.waitForTimeout(150);
        await page.evaluate(() => {
          globalThis.__calls = [];
        });
      };

      const after = async (key: string, name?: string) => {
        if (name !== undefined) {
          await prompt.getByRole("button", { exact: true, name }).focus();
        }

        await page.keyboard.press(key);
        await page.waitForTimeout(300);

        return {
          calls: await page.evaluate(() => globalThis.__calls ?? []),
          ...(await leavePrompt(page)),
          shown: await s.shown(),
        };
      };

      await ask();

      const escape = await after("Escape");

      await ask();

      const spaceOnCancel = await after(" ", "Cancel");

      await ask();

      const spaceOnDiscard = await after(" ", "Discard and quit");

      const kept = {
        calls: [],
        focus: "title-field",
        prompt: null,
        shown: { failure, title: `${aTitle} (typed)` },
      };

      expectSame(
        "Escape and Space on Cancel close the prompt and keep the change; Space on Discard and quit drops it and the quit goes on once",
        {
          again: await askToLeave(page, "quit"),
          counts: await page.evaluate(() => globalThis.__unsavedCounts ?? []),
          escape,
          spaceOnCancel,
          spaceOnDiscard,
        },
        {
          again: { fields: null, ok: true },
          // Discard reports clean; resuming confirms that count before main starts its final disk wait.
          counts: [0, 1, 0, 0],
          escape: kept,
          spaceOnCancel: kept,
          spaceOnDiscard: {
            calls: ["resumeLeaving"],
            focus: "title-field",
            prompt: null,
            shown: { failure: null, title: aTitle },
          },
        }
      );
    } finally {
      await s.context.close();
    }
  });

  // Discard and quit drops the change and lets the quit go on.
  await attempt("Discard and quit", async () => {
    const s = await session();
    const { page } = s;

    try {
      await failTypingInTitle(page);
      await askToLeave(page, "quit");
      await page.getByRole("button", { name: "Discard and quit" }).click();
      await page.getByTestId("leave-prompt").waitFor({ state: "detached" });

      const resumed = await resumes(page);
      const { failure: shownFailure } = await s.shown();

      expectSame(
        "Discard and quit drops the change, clears the row's marker and lets the quit go on; a quit after it has nothing to ask",
        {
          again: await askToLeave(page, "quit"),
          failure: shownFailure,
          marked: await s.unsavedRow(a),
          resumed,
        },
        {
          again: { fields: null, ok: true },
          failure: null,
          marked: false,
          resumed: ["resumeLeaving"],
        }
      );
    } finally {
      await s.context.close();
    }
  });

  // A save still on its way after the 3 s limit holds the restart, which goes on by itself once the save lands.
  await attempt("a slow save holds the restart", async () => {
    const s = await session();
    const { page } = s;

    try {
      await s.set("__holdSaves", true);
      await typeInTitle(page, " slow");

      const started = Date.now();
      const answered = await askToLeave(page, "restart");

      await page.getByTestId("leave-prompt").waitFor();

      const waited = Date.now() - started;
      const { prompt: asked } = await leavePrompt(page);

      await s.release();
      await page.getByTestId("leave-prompt").waitFor({ state: "detached" });

      expectSame(
        "a save slower than the 3 s limit holds the restart and says so, and the restart goes on by itself once the save lands",
        {
          answered,
          asked,
          resumed: await resumes(page),
          waitedTheLimit: waited >= 2900 && waited < 4500,
        },
        {
          answered: HELD,
          asked: asking("1 change", SLOW, "Discard and quit"),
          resumed: ["resumeLeaving"],
          waitedTheLimit: true,
        }
      );
    } finally {
      await s.context.close();
    }
  });

  // Round 7: Discard works at once while a save is on its way, and that save landing later revives nothing, on screen or on disk.
  await attempt("Discard while a save is on its way", async () => {
    const s = await session();
    const { page } = s;

    try {
      await s.set("__holdSaves", true);
      await typeInTitle(page, " (held)");
      await page.waitForTimeout(800);
      await askToLeave(page, "quit");
      await page.getByTestId("leave-prompt").waitFor();

      const { prompt: asked } = await leavePrompt(page);

      await page.evaluate((id) => {
        globalThis.__seen = [];

        const look = (): void => {
          const title =
            document.querySelector<HTMLTextAreaElement>(
              "[data-testid='title-field']"
            )?.value ?? "";

          const row =
            document.querySelector(
              `[data-capture-id='${id}'] [data-testid='row-title']`
            )?.textContent ?? "";

          const seen = `${title} | ${row}`;

          if (globalThis.__seen?.at(-1) !== seen) {
            globalThis.__seen?.push(seen);
          }

          if (globalThis.__seen !== undefined) {
            requestAnimationFrame(look);
          }
        };

        look();
      }, a);

      await page.getByRole("button", { name: "Discard and quit" }).click();
      await page.waitForTimeout(150);

      const atOnce = { resumed: await resumes(page), shown: await s.shown() };

      await page.evaluate(() => {
        globalThis.__releaseOldest?.();
      });
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        globalThis.__releaseOldest?.();
      });
      await page.waitForTimeout(400);

      const seen = await page.evaluate(() => {
        const frames = globalThis.__seen ?? [];

        globalThis.__seen = undefined;

        return frames;
      });

      const stored = await page.evaluate(
        (id) => globalThis.__storedTitle?.(id) ?? null,
        a
      );

      const { saves: heldSaves } = await s.take();

      expectSame(
        "Discard and quit works at once while a save is on its way: the quit goes on, the saved title shows, main is told to drop that save and nothing is written to undo it, the late save never shows the discarded title, and the disk keeps the saved title",
        {
          asked,
          atOnce,
          saves: heldSaves,
          seenAfterDiscard: seen.slice(seen.indexOf(`${aTitle} | ${aTitle}`)),
          stored,
        },
        {
          asked: asking("1 change", SLOW, "Discard and quit"),
          atOnce: {
            resumed: ["resumeLeaving"],
            shown: { failure: null, title: aTitle },
          },
          saves: [
            `update:${a}:${aTitle} (held)`,
            `discard:${a}:${aTitle} (held)`,
          ],
          seenAfterDiscard: [`${aTitle} | ${aTitle}`],
          stored: aTitle,
        }
      );
    } finally {
      await s.context.close();
    }
  });

  // Cancel works at once too, and the save landing later keeps the window open.
  await attempt("Cancel while a save is on its way", async () => {
    const s = await session();
    const { page } = s;

    try {
      await s.set("__holdSaves", true);
      await typeInTitle(page, " (held)");
      await page.waitForTimeout(800);
      await askToLeave(page, "close");
      await page.getByTestId("leave-prompt").waitFor();
      await page.keyboard.press("Escape");

      const closedAtOnce = await settles(
        page.getByTestId("leave-prompt"),
        "detached",
        500
      );

      await s.release();
      await s.set("__holdSaves", false);

      expectSame(
        "Cancel closes the prompt at once while a save is on its way; the save lands later and the close stays cancelled",
        { closedAtOnce, resumed: await resumes(page), shown: await s.shown() },
        {
          closedAtOnce: true,
          resumed: [],
          shown: { failure: null, title: `${aTitle} (held)` },
        }
      );
    } finally {
      await s.context.close();
    }
  });

  // Retry shows its focus ring when the prompt opens after a mouse click elsewhere.
  await attempt("Retry's focus ring", async () => {
    const s = await session();
    const { page } = s;

    try {
      await failTypingInTitle(page);
      await s.open(s.b, s.bTitle);
      await askToLeave(page, "quit");
      await page.getByTestId("leave-prompt").waitFor();
      await page.waitForTimeout(300);

      const retry = await page
        .getByTestId("leave-prompt")
        .getByRole("button", { exact: true, name: "Retry" })
        .evaluate((element) => ({
          focused: document.activeElement === element,
          ring: getComputedStyle(element).boxShadow !== "none",
        }));

      expectSame(
        "the prompt opened after a mouse click shows Retry focused, with its ring",
        retry,
        { focused: true, ring: true }
      );
    } finally {
      await s.context.close();
    }
  });

  // A trailing space typed before a pause survives the save and the reload after it.
  {
    const { context, page, take } = await session();

    await typeInTitle(page, " word ");
    await page.waitForTimeout(1200);
    await page.keyboard.type("x");
    await page.waitForTimeout(1200);

    const typed = await take();

    expectSame(
      "typing on after a save keeps the space typed before it",
      {
        saves: typed.saves,
        title: await page.getByTestId("title-field").inputValue(),
      },
      {
        saves: [`update:${a}:${aTitle} word`, `update:${a}:${aTitle} word x`],
        title: `${aTitle} word x`,
      }
    );

    await context.close();
  }

  // The page tells main while a menu is open, so main's own keys stand aside.
  {
    const { context, page } = await session();

    const reported = async () =>
      await page.evaluate(() => globalThis.__menuOpen ?? null);

    await page.locator(ROW).nth(2).click({ button: "right" });
    await page.getByRole("menu").waitFor();

    const opened = await reported();

    await page.keyboard.press("Escape");
    await page.getByRole("menu").waitFor({ state: "detached" });
    await page.waitForTimeout(100);

    const closed = await reported();

    await page.getByTestId("more").click();
    await page.getByRole("menu").waitFor();

    const more = await reported();

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    expectSame(
      "the page reports its row menu and ⋯ menu open, and closed again",
      { closed, more, opened, shut: await reported() },
      { closed: false, more: true, opened: true, shut: false }
    );

    await context.close();
  }

  return failures;
};

/**
 * Round 4's narrow-chip rule: at every sidebar width each Due chip shows its
 * calendar icon and its whole label, and a row drops its time before its step
 * progress. The widest label, an overdue day from last year, is added here.
 * The search placeholder has to fit too.
 */
const checkSidebarWidths = async (
  browser: Browser,
  origin: string,
  captures: readonly Capture[],
  platform: Platform
): Promise<string[]> => {
  const { expectSame, failures } = makeReport(platform);

  const withWidest = [
    ...structuredClone(captures),
    capture(8, "mail", {
      capturedAt: ago(0, 7, 15),
      due: `${NOW.getFullYear() - 1}-12-30`,
      pins: [],
      steps: [step(9, "Call the landlord"), step(10, "Sign", true)],
      title: "Lease renewal",
    }),
  ];

  const atWidth = async (width: number): Promise<void> => {
    const { context, page } = await openLibrary(
      browser,
      origin,
      { captures: withWidest, page: "library" },
      platform,
      `/captures/${uuid(3)}`,
      { "inset.sidebar": JSON.stringify({ collapsed: false, width }) }
    );

    const rows = await page.locator(ROW).evaluateAll((elements) => {
      // Inside the page: evaluate serializes this function, so the helper can't live outside it.
      // oxlint-disable-next-line unicorn/consistent-function-scoping
      const shown = (part: Element | null): boolean => {
        if (part === null) {
          return false;
        }

        const rect = part.getBoundingClientRect();
        let clip = part.parentElement;

        while (clip !== null && getComputedStyle(clip).overflow === "visible") {
          clip = clip.parentElement;
        }

        const box = (clip ?? document.body).getBoundingClientRect();

        return (
          rect.width > 0 &&
          rect.left >= box.left - 0.5 &&
          rect.right <= box.right + 0.5 &&
          rect.top >= box.top - 0.5 &&
          rect.bottom <= box.bottom + 0.5
        );
      };

      return elements.map((row) => {
        const chip = row.querySelector("[data-due-state]");
        const progress = row.querySelector("[data-meta='progress']");

        return {
          chip:
            chip === null
              ? null
              : {
                  icon: shown(chip.querySelector("svg")),
                  label: chip.textContent,
                  shown: shown(chip),
                  whole: [...chip.querySelectorAll("*"), chip].every(
                    (part) => part.scrollWidth <= part.clientWidth + 0.5
                  ),
                },
          // The time goes first: it never shows while the progress is gone.
          timeBeforeProgress:
            progress === null ||
            shown(progress) ||
            !shown(row.querySelector("[data-meta='time']")),
        };
      });
    });

    const chips = rows.flatMap((row) => (row.chip === null ? [] : [row.chip]));

    expectSame(
      `Due chips at a ${width} px sidebar keep the icon and the whole label`,
      chips.filter((chip) => !(chip.icon && chip.shown && chip.whole)),
      []
    );
    expectSame(
      `${width} px sidebar shows every Due chip`,
      chips.length,
      withWidest.filter((one) => one.due !== null && one.status.kind !== "done")
        .length
    );
    expectSame(
      `${width} px sidebar drops the time before the progress`,
      rows.filter((row) => !row.timeBeforeProgress).length,
      0
    );

    const placeholderFits = await page
      .getByTestId("search")
      .evaluate((input: HTMLInputElement) => {
        const text = document.createElement("canvas").getContext("2d");
        const style = input.computedStyleMap();

        const px = (property: string): number => {
          const value = style.get(property);

          return value instanceof CSSUnitValue ? value.value : 0;
        };

        if (text === null) {
          return false;
        }

        text.font = getComputedStyle(input).font;

        // Room to spare, so the hint doesn't run into the filter button.
        return (
          text.measureText(input.placeholder).width + 12 <=
          input.clientWidth - px("padding-left") - px("padding-right")
        );
      });

    expectSame(
      `${width} px sidebar: the search placeholder fits`,
      placeholderFits,
      true
    );
    await context.close();
  };

  for (const width of [220, 239, 240, 260, 300, 440]) {
    // Sequential on purpose: one window at a time, like the shots.
    // oxlint-disable-next-line no-await-in-loop
    await atWidth(width);
  }

  return failures;
};

/** The capture panel's Add menu: the keys it shows pick their field; other shortcuts stay in the menu. */
const checkAddMenu = async (
  browser: Browser,
  origin: string,
  desktop: Targets,
  platform: Platform
): Promise<string[]> => {
  const { expectSame, failures } = makeReport(platform);
  const m = mod(platform);

  const context = await browser.newContext({
    userAgent: USER_AGENT[platform],
    viewport: SIZES.capture,
  });

  const page = await context.newPage();

  const input: BridgeInput = {
    page: "capture",
    view: draftView(desktop, { title: "Chairs are CHF 280 over the cap" }),
  };

  await page.addInitScript(installBridge, input);
  await page.goto(`${origin}/capture.html`);
  await page.getByTestId("add-menu").waitFor();

  const pressInAddMenu = async (key: string) => {
    await page.getByTestId("add-menu").click();
    await page.getByRole("menu").waitFor();
    await page.waitForTimeout(150);
    await page.keyboard.press(key);
    await page.waitForTimeout(300);

    const state = await page.evaluate(() => ({
      descriptionFocused:
        (document.activeElement?.closest("[data-testid='description-field']") ??
          null) !== null,
      dialogs: document.querySelectorAll(
        '[role="dialog"], [data-slot="popover-content"]'
      ).length,
      menuOpen: document.querySelector('[role="menu"]') !== null,
    }));

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    return state;
  };

  expectSame(
    `${m}+/ in the open Add menu stays in it`,
    await pressInAddMenu(`${m}+/`),
    { descriptionFocused: false, dialogs: 0, menuOpen: true }
  );
  expectSame(
    `${m}+Shift+d in the open Add menu opens the Due picker`,
    await pressInAddMenu(`${m}+Shift+d`),
    { descriptionFocused: false, dialogs: 1, menuOpen: false }
  );
  expectSame(
    `${m}+d in the open Add menu adds the description and focuses it`,
    await pressInAddMenu(`${m}+d`),
    { descriptionFocused: true, dialogs: 0, menuOpen: false }
  );

  /*
   * The same items picked with the pointer. The menu fades out under the
   * pointer, and a move over it took the focus back: the new description
   * blurred and hid, and the Due picker shut as it opened.
   */
  const clickInAddMenu = async (item: string) => {
    await page.reload();
    await page.getByTestId("add-menu").waitFor();
    await page.getByTestId("add-menu").click();

    const target = page.getByRole("menuitem", { name: item });
    const box = await target.boundingBox();

    await target.click();

    // A hand is never still: the pointer drifts over the closing menu.
    if (box !== null) {
      await page.mouse.move(box.x + box.width / 2 + 4, box.y + box.height / 2);
      await page.mouse.move(box.x + box.width / 2 - 4, box.y + box.height / 2);
    }

    await page.waitForTimeout(400);

    const state = await page.evaluate(() => ({
      description:
        document.querySelector("[data-testid='description-field']") !== null,
      descriptionFocused:
        (document.activeElement?.closest("[data-testid='description-field']") ??
          null) !== null,
      dialogs: document.querySelectorAll(
        '[role="dialog"], [data-slot="popover-content"]'
      ).length,
    }));

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    return state;
  };

  expectSame(
    "a click on Due in the Add menu opens the Due picker",
    await clickInAddMenu("Due"),
    { description: false, descriptionFocused: false, dialogs: 1 }
  );
  expectSame(
    "a click on Description in the Add menu adds the description and focuses it",
    await clickInAddMenu("Description"),
    { description: true, descriptionFocused: true, dialogs: 0 }
  );

  await context.close();

  return failures;
};

/**
 * The capture panel's quit prompt answers keys as the library's prompt does:
 * Return saves whichever button has the focus, Escape cancels, and Space
 * presses the focused button. It blurs the panel behind it, and a save that
 * didn't finish in time still lets Cancel and Discard answer.
 */
const checkCaptureQuit = async (
  browser: Browser,
  origin: string,
  desktop: Targets,
  platform: Platform
): Promise<string[]> => {
  const { expectSame, failures } = makeReport(platform);

  const open = async (
    write: { readonly kind: string; readonly message?: string },
    quitting = true
  ) => {
    const context = await browser.newContext({
      userAgent: USER_AGENT[platform],
      viewport: SIZES.capture,
    });

    const page = await context.newPage();

    const input: BridgeInput = {
      page: "capture",
      view: {
        ...draftView(desktop, {
          description: "Keep this thought",
          title: "Chairs are CHF 280 over the cap",
        }),
        quitting,
        write,
      },
    };

    await page.addInitScript(installBridge, input);
    await page.goto(`${origin}/capture.html`);
    await page.getByTestId(quitting ? "quit-prompt" : "title-field").waitFor();
    await page.waitForTimeout(200);

    return { context, page };
  };

  const shortcuts = await open({ kind: "editing" }, false);

  await shortcuts.page.keyboard.press(`${mod(platform)}+/`);
  await shortcuts.page.getByTestId("shortcut-sheet").waitFor();

  const setQuitting = async (quitting: boolean): Promise<void> => {
    await shortcuts.page.evaluate(
      (view) => {
        type EmitView = NonNullable<typeof globalThis.__emit> &
          ((name: "view", payload: typeof view) => void);

        // SAFETY: installBridge forwards view events unchanged; its Payload type only models library events.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- capture's view event uses the same fixture emitter.
        const emit = globalThis.__emit as EmitView;

        emit("view", view);
      },
      { ...draftView(desktop), quitting }
    );
  };

  await setQuitting(true);
  expectSame(
    "quitting on the same surface takes precedence over the open shortcut sheet",
    {
      prompt: await settles(
        shortcuts.page.getByTestId("quit-prompt"),
        "visible",
        1500
      ),
      sheet: await shortcuts.page.getByTestId("shortcut-sheet").count(),
      focus: await shortcuts.page.evaluate(
        () => document.activeElement?.textContent
      ),
    },
    { prompt: true, sheet: 0, focus: "Save" }
  );
  await shortcuts.page.keyboard.press("Escape");
  expectSame(
    "Escape answers the quit, not the shortcut sheet",
    await shortcuts.page.evaluate(() => globalThis.__calls ?? []),
    ["answerQuit:cancel"]
  );
  await setQuitting(false);
  await shortcuts.page.getByTestId("shortcut-sheet").waitFor();
  await shortcuts.page.keyboard.press("Escape");
  expectSame(
    "canceling quit keeps the shortcut sheet and the draft's local content",
    await shortcuts.page.getByTestId("title-field").inputValue(),
    "Chairs are CHF 280 over the cap"
  );
  await shortcuts.context.close();

  const prompt = await open({ kind: "editing" });

  const looks = await prompt.page.evaluate(() => ({
    backdrop: getComputedStyle(
      document.querySelector("[data-slot='alert-dialog-overlay']") ??
        document.body
    ).backdropFilter,
    focus: document.activeElement?.textContent ?? null,
  }));

  const answers: Record<string, string[]> = {};

  for (const name of ["Cancel", "Discard", "Save"]) {
    for (const key of ["Enter", "Escape", "Space"]) {
      // Sequential on purpose: each key press reads back what the page answered.
      // oxlint-disable-next-line no-await-in-loop
      await prompt.page.evaluate(() => {
        globalThis.__calls = [];
      });
      // oxlint-disable-next-line no-await-in-loop
      await prompt.page
        .getByTestId("quit-prompt")
        .getByRole("button", { exact: true, name })
        .focus();
      // oxlint-disable-next-line no-await-in-loop
      await prompt.page.keyboard.press(key);
      // oxlint-disable-next-line no-await-in-loop
      await prompt.page.waitForTimeout(100);
      // oxlint-disable-next-line no-await-in-loop
      answers[`${name} ${key}`] = await prompt.page.evaluate(
        () => globalThis.__calls ?? []
      );
    }
  }

  await prompt.context.close();

  expectSame(
    "the capture panel's quit prompt: Return saves from every button, Escape cancels, Space presses the focused button, Save has the focus, and the panel behind blurs",
    { answers, looks },
    {
      answers: {
        "Cancel Enter": ["answerQuit:save"],
        "Cancel Escape": ["answerQuit:cancel"],
        "Cancel Space": ["answerQuit:cancel"],
        "Discard Enter": ["answerQuit:save"],
        "Discard Escape": ["answerQuit:cancel"],
        "Discard Space": ["answerQuit:discard"],
        "Save Enter": ["answerQuit:save"],
        "Save Escape": ["answerQuit:cancel"],
        "Save Space": ["answerQuit:save"],
      },
      looks: { backdrop: "blur(4px)", focus: "Save" },
    }
  );

  const slow = await open({ kind: "saving" });

  const timedOut = await slow.page.evaluate(() => {
    const shown = document.querySelector("[data-testid='quit-prompt']");

    return {
      detail:
        shown?.querySelector("[data-slot='alert-dialog-description']")
          ?.textContent ?? null,
      enabled: [...(shown?.querySelectorAll("button") ?? [])].flatMap(
        (button) => (button.disabled ? [] : [button.textContent])
      ),
    };
  });

  await slow.page
    .getByTestId("quit-prompt")
    .getByRole("button", { exact: true, name: "Discard" })
    .focus();
  await slow.page.keyboard.press("Space");
  await slow.page.waitForTimeout(100);

  const discarded = await slow.page.evaluate(() => globalThis.__calls ?? []);

  await slow.context.close();

  expectSame(
    "a quit whose save didn't finish in 3 s asks in the panel with Retry, as the library does, and Cancel, Discard and Retry all answer while the save is on its way",
    { discarded, timedOut },
    {
      discarded: ["answerQuit:discard"],
      timedOut: {
        detail: "Saving didn’t finish in time.",
        enabled: ["Cancel", "Discard", "Retry"],
      },
    }
  );

  // The dialog covers the panel's own error, so it says why the save failed.
  const failed = await open({ kind: "failed", message: "The disk is full." });

  // Each sentence on a line of its own, never a ragged block balanced at half the dialog's width.
  const failedDetail = await failed.page.evaluate(() => {
    const shown = document.querySelector("[data-testid='quit-prompt']");

    const lines = [
      ...(shown?.querySelectorAll(
        "[data-slot='alert-dialog-description'] > span"
      ) ?? []),
    ].map((line) => ({
      rows: Math.round(
        line.getBoundingClientRect().height /
          Number(getComputedStyle(line).lineHeight.replace("px", ""))
      ),
      text: line.textContent,
    }));

    return {
      action:
        shown?.querySelector("[data-default-action]")?.textContent ?? null,
      lines,
    };
  });

  await failed.context.close();

  expectSame(
    "a quit after the capture's save failed says why on a line of its own, and offers Retry",
    failedDetail,
    {
      action: "Retry",
      lines: [
        { rows: 1, text: "This capture isn’t saved yet." },
        { rows: 1, text: "The disk is full." },
      ],
    }
  );

  return failures;
};

type PanelView = ReturnType<typeof draftView>;

/** The capture panel on its own, at its usual width, with the scene's draft. */
const openPanel = async (
  browser: Browser,
  origin: string,
  platform: Platform,
  view: PanelView
) => {
  const context = await browser.newContext({
    userAgent: USER_AGENT[platform],
    viewport: SIZES.capture,
  });

  const page = await context.newPage();
  const input: BridgeInput = { page: "capture", view };

  await page.addInitScript(installBridge, input);
  await page.goto(`${origin}/capture.html`);
  await page.getByTestId("title-field").waitFor();
  await page.waitForTimeout(150);

  return { context, page };
};

/**
 * Main takes no edits while an explicit Save runs (src/main/draft.ts), so
 * the panel locks steps and Due with the title: a Due picker open at ⌘↩
 * shuts, and no click or key on a step or the chip sends an edit.
 */
const checkSaveLock = async (
  browser: Browser,
  origin: string,
  desktop: Targets,
  platform: Platform
): Promise<string[]> => {
  const { expectSame, failures } = makeReport(platform);
  const m = mod(platform);

  const { context, page } = await openPanel(
    browser,
    origin,
    platform,
    draftView(desktop, {
      due: dueIn(1),
      steps: [step(1, "Ask Rieder"), step(2, "Tell Marco")],
      title: "Chairs are CHF 280 over the cap",
    })
  );

  const chip = page.getByTestId("due-chip");
  const before = await chip.textContent();

  await page.getByTestId("title-field").focus();
  await page.keyboard.press(`${m}+Shift+d`);
  await page.getByTestId("due-picker").waitFor();
  await page.evaluate(() => {
    globalThis.__panelCalls = [];
  });
  await page.keyboard.press(`${m}+Enter`);
  await page.waitForTimeout(200);

  const pickerOpen = await page.getByTestId("due-picker").count();

  await page.getByLabel("Next step 1", { exact: true }).click({ force: true });
  await page.keyboard.type(" now");
  await page.keyboard.press("Enter");
  await page.getByLabel("Done: next step 2").click({ force: true });
  await page.getByLabel("Remove next step 1").click({ force: true });
  await chip.getByRole("button", { name: /^Due /u }).click({ force: true });
  await page.getByLabel("Clear Due").click({ force: true });
  await page.waitForTimeout(200);

  expectSame(
    "during Save the open Due picker shuts, and steps and Due send no edit and keep what they showed",
    {
      calls: await page.evaluate(() => globalThis.__panelCalls ?? []),
      chip: (await chip.count()) === 0 ? null : await chip.textContent(),
      picker: pickerOpen + (await page.getByTestId("due-picker").count()),
      steps: await page
        .getByTestId("steps-editor")
        .locator("input:not([aria-hidden])")
        .evaluateAll((fields: HTMLInputElement[]) =>
          fields.map((field) => `${field.value}:${field.disabled}`)
        ),
      ticked: await page
        .getByLabel("Done: next step 2")
        .getAttribute("aria-checked"),
    },
    {
      calls: ["save"],
      chip: before,
      picker: 0,
      steps: ["Ask Rieder:true", "Tell Marco:true"],
      ticked: "false",
    }
  );

  await context.close();

  return failures;
};

/** The day the calendar names a date by, as the page writes it in en-US. */
const longDay = (offset: number): string =>
  new Date(
    NOW.getFullYear(),
    NOW.getMonth(),
    NOW.getDate() + offset
  ).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  });

/** What has the focus: its name, or its words. */
const focusName = async (page: Page) =>
  await page.evaluate(() => {
    const focused = document.activeElement;

    return focused instanceof HTMLElement
      ? (focused.getAttribute("aria-label") ??
          focused.dataset.testid ??
          focused.textContent)
      : null;
  });

/**
 * Round 14: Due's Pick a date… opens shadcn's Calendar, as in the Shelf.
 * It focuses today (or the Due day), the week starts on the locale's first
 * day (Sunday in en-US), the arrows move, Return picks and focus lands on the
 * chip, which replaces the Add button it opened from. Esc closes only the
 * calendar and gives the focus back; the next Esc sets the panel aside.
 */
const checkDueCalendar = async (
  browser: Browser,
  origin: string,
  desktop: Targets,
  platform: Platform
): Promise<string[]> => {
  const { expectSame, failures } = makeReport(platform);
  const m = mod(platform);

  const { context, page } = await openPanel(
    browser,
    origin,
    platform,
    draftView(desktop, { title: "Chairs are CHF 280 over the cap" })
  );

  const calendar = page.getByTestId("due-calendar");

  const pickADate = async (): Promise<void> => {
    await page.getByRole("button", { name: "Pick a date…" }).click();
    await calendar.waitFor();
    await page.waitForTimeout(150);
  };

  // The mouse path: Add, then Due, then Esc gives the focus back to Add.
  await page.getByTestId("add-menu").click();
  await page.getByRole("menuitem", { name: /^Due/u }).click();
  await page.getByTestId("due-picker").waitFor();
  await page.waitForTimeout(150);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);

  const fromAdd = {
    focus: await focusName(page),
    picker: await page.getByTestId("due-picker").count(),
  };

  await page.getByTestId("title-field").focus();
  await page.keyboard.press(`${m}+Shift+d`);
  await page.getByTestId("due-picker").waitFor();
  await pickADate();

  const opened = {
    firstWeekday: await calendar
      .locator("thead th")
      .first()
      .getAttribute("aria-label"),
    focus: await focusName(page),
  };

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");

  const moved = await focusName(page);

  await page.evaluate(() => {
    globalThis.__panelCalls = [];
  });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);

  expectSame(
    "Esc after Add, then Due, gives the focus back to Add; Pick a date… opens the calendar on today, starting the week on Sunday in en-US; the arrows move, Return picks, and focus lands on the new chip",
    {
      calendar: await calendar.count(),
      calls: await page.evaluate(() => globalThis.__panelCalls ?? []),
      chip: await page.getByTestId("due-chip").textContent(),
      focus: await focusName(page),
      fromAdd,
      moved,
      opened,
    },
    {
      calendar: 0,
      calls: ["edit"],
      chip: "Tomorrow",
      focus: `Due tomorrow. Change it (${platform === "macos" ? "⇧⌘D" : "Ctrl+Shift+D"})`,
      fromAdd: { focus: "add-menu", picker: 0 },
      moved: longDay(1),
      opened: { firstWeekday: "Sunday", focus: `${longDay(0)}, today` },
    }
  );

  await page.getByTestId("due-chip").getByRole("button").first().click();
  await page.getByTestId("due-picker").waitFor();
  await pickADate();

  const onDueDay = await focusName(page);

  await page.evaluate(() => {
    globalThis.__panelCalls = [];
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);

  const firstEscape = {
    calendar: await calendar.count(),
    calls: await page.evaluate(() => globalThis.__panelCalls ?? []),
    focus: await focusName(page),
  };

  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);

  expectSame(
    "the calendar opens on the Due day; the first Esc closes only it and gives the focus back to the chip, the next sets the panel aside",
    {
      firstEscape,
      onDueDay,
      secondEscape: await page.evaluate(() => globalThis.__panelCalls ?? []),
    },
    {
      firstEscape: {
        calendar: 0,
        calls: [],
        focus: `Due tomorrow. Change it (${platform === "macos" ? "⇧⌘D" : "Ctrl+Shift+D"})`,
      },
      onDueDay: `${longDay(1)}, selected`,
      secondEscape: ["dismiss"],
    }
  );

  await page.getByTestId("due-chip").getByRole("button").first().click();
  await page.getByTestId("due-picker").waitFor();
  await page.waitForTimeout(150);
  await page.getByTestId("title-field").click();
  await page.waitForTimeout(250);

  expectSame(
    "a click on the title while the picker is open closes it and leaves the focus in the title",
    {
      focus: await focusName(page),
      picker: await page.getByTestId("due-picker").count(),
    },
    { focus: "Title", picker: 0 }
  );

  await context.close();

  return failures;
};

/**
 * Round 14: the panel's header holds one tool group, pin mode then Tighten
 * and Widen as icons named by their labels, all on one line; the panel has no shortcuts
 * button, and ⌘/ still opens the sheet. The crop buttons and keys still crop.
 */
const checkPanelHeader = async (
  browser: Browser,
  origin: string,
  desktop: Targets,
  platform: Platform
): Promise<string[]> => {
  const { expectSame, failures } = makeReport(platform);
  const m = mod(platform);

  const { context, page } = await openPanel(
    browser,
    origin,
    platform,
    draftView(desktop, { title: "Chairs are CHF 280 over the cap" })
  );

  const tools = await page
    .getByTestId("preview-tools")
    .locator("button")
    .evaluateAll((buttons: HTMLButtonElement[]) => {
      const middles = buttons.map((button) => {
        const box = button.getBoundingClientRect();

        return Math.round(box.top + box.height / 2);
      });

      return {
        names: buttons.map(
          (button) =>
            `${button.getAttribute("aria-label") ?? ""}|${button.textContent}`
        ),
        oneLine: new Set(middles).size === 1,
      };
    });

  const shortcutButtons = await page
    .getByRole("button", { name: /shortcuts/iu })
    .count();

  await page.evaluate(() => {
    globalThis.__panelCalls = [];
  });
  await page.getByRole("button", { exact: true, name: "Widen" }).click();
  await page.getByTestId("title-field").focus();
  await page.keyboard.press(`${m}+=`);
  await page.waitForTimeout(150);

  const cropped = await page.evaluate(() => globalThis.__panelCalls ?? []);

  await page.keyboard.press(`${m}+/`);

  expectSame(
    "the header's tools are pin mode, Tighten and Widen icons on one line; no shortcuts button; Widen and the crop key still crop; ⌘/ opens the sheet",
    {
      cropped,
      sheet: await settles(page.getByTestId("shortcut-sheet"), "visible", 1500),
      shortcutButtons,
      tools,
    },
    {
      cropped: ["edit", "edit"],
      sheet: true,
      shortcutButtons: 0,
      tools: {
        names: ["Pin mode|", "Tighten|", "Widen|"],
        oneLine: true,
      },
    }
  );

  await context.close();

  return failures;
};

/** Where the focus is: in a capture row, in the image or its pins, else the element's test id or tag. */
const focusPlace = async (page: Page) =>
  await page.evaluate(() => {
    const focused = document.activeElement;

    if (focused?.closest("[data-capture-id]")) {
      return "row";
    }

    if (focused?.closest("[data-pin-area]")) {
      return "image";
    }

    return focused instanceof HTMLElement
      ? (focused.dataset.testid ?? focused.tagName)
      : null;
  });

/**
 * Round 14 in the library, as the Shelf's feedback asked:
 * - the capture's time and source sit in a quiet footer at the foot of the
 *   capture, or of the view when the capture is short;
 * - a step row's circle, words and × share one centre line, with no jump on focus;
 * - the Done row's › ends where the rows' Due chips end, once the classic
 *   scrollbar the harness reserves is set aside (macOS overlays it);
 * - a click on search or empty space lets go of a selected pin and of a
 *   focused row, and ↓ still moves through the list;
 * - Esc in a pin's label takes back only the typing, so ⌘Z then undoes the
 *   change before it.
 */
const checkLibraryPolish = async (
  browser: Browser,
  origin: string,
  captures: readonly Capture[],
  platform: Platform
): Promise<string[]> => {
  const { expectSame, failures } = makeReport(platform);
  const m = mod(platform);

  const footerText = (id: string): string => {
    const one = captures.find((item) => item.id === id);

    return `${dayAndTime(new Date(one?.capturedAt ?? ""), new Date(), "en-US")} · Studio Display`;
  };

  const { context, page } = await openLibrary(
    browser,
    origin,
    { captures: structuredClone(captures), page: "library" },
    platform,
    `/captures/${uuid(2)}`
  );

  const footerAt = async () =>
    await page.evaluate(() => {
      const footer = document.querySelector("[data-testid='capture-footer']");
      const main = footer?.closest("main") ?? null;

      if (footer === null || main === null) {
        return null;
      }

      main.scrollTop = main.scrollHeight;

      return {
        gap: Math.round(
          main.getBoundingClientRect().bottom -
            footer.getBoundingClientRect().bottom
        ),
        header: main.previousElementSibling?.textContent ?? null,
        last: footer.parentElement?.lastElementChild === footer,
        text: footer.textContent,
      };
    });

  const short = await footerAt();

  await page.locator(`[data-capture-id='${uuid(1)}']`).click();
  await page.getByLabel("Label for pin 1").waitFor();

  expectSame(
    "the capture's time and source are a quiet footer at the foot of the view (short capture) or of the capture (long one), not in the header",
    { long: await footerAt(), short },
    {
      long: { gap: 24, header: "", last: true, text: footerText(uuid(1)) },
      short: { gap: 24, header: "", last: true, text: footerText(uuid(2)) },
    }
  );

  const stepRow = async () =>
    await page.evaluate(() => {
      const input = document.querySelector("[aria-label='Next step 2']");
      const row = input?.closest("li");

      // Inside the page: evaluate serializes this function, so the helper can't live outside it.
      // oxlint-disable-next-line unicorn/consistent-function-scoping
      const centre = (element: Element | null | undefined): number => {
        const box = element?.getBoundingClientRect();

        return box === undefined ? Number.NaN : box.top + box.height / 2;
      };

      const centres = [
        row?.querySelector("[role='checkbox']"),
        input,
        row?.querySelector("[aria-label='Remove next step 2']"),
      ].map(centre);

      return {
        height: row?.getBoundingClientRect().height ?? 0,
        spread: Math.max(...centres) - Math.min(...centres),
      };
    });

  const viewing = await stepRow();

  await page.getByLabel("Next step 2", { exact: true }).focus();

  const editing = await stepRow();

  expectSame(
    "a step row's circle, words and × share one centre line, viewing or editing, at the same height",
    {
      centred: viewing.spread <= 0.5 && editing.spread <= 0.5,
      heights: [viewing.height, editing.height],
    },
    { centred: true, heights: [32, 32] }
  );

  const trailing = await page.evaluate(() => {
    const sidebar = document.querySelector("aside")?.getBoundingClientRect();
    const nav = document.querySelector("aside nav");

    const chevron = document
      .querySelector("[data-testid='open-done'] svg:last-of-type")
      ?.getBoundingClientRect();

    const chip = document
      .querySelector("[data-testid='capture-row'] [data-due-state]")
      ?.getBoundingClientRect();

    const gutter =
      nav instanceof HTMLElement ? nav.offsetWidth - nav.clientWidth : 0;

    return {
      chevron: Math.round((sidebar?.right ?? 0) - (chevron?.right ?? 0)),
      chip: Math.round((sidebar?.right ?? 0) - (chip?.right ?? 0) - gutter),
    };
  });

  expectSame(
    "the Done row's › sits flush right, as far in as the rows' Due chips",
    trailing,
    { chevron: 16, chip: 16 }
  );

  const selectedPins = async () =>
    await page.locator("[data-testid='image-editor'] .pin-selection").count();

  const pinLeft = async () =>
    await page
      .locator("[data-testid='image-editor'] [data-pin='1']")
      .evaluate((pin: HTMLElement) => pin.style.getPropertyValue("--pin-x"));

  await page.getByTestId("image-editor").focus();
  await page.keyboard.press("1");

  const picked = await selectedPins();

  await page.getByTestId("search").click();

  const onSearch = {
    focus: await focusPlace(page),
    pins: await selectedPins(),
  };

  await page.getByTestId("image-editor").focus();
  await page.keyboard.press("2");
  await page.getByTestId("capture-footer").click();

  const onEmpty = { focus: await focusPlace(page), pins: await selectedPins() };

  await page.locator(ROW).nth(1).focus();

  const rowFirst = await focusPlace(page);

  await page.getByTestId("capture-footer").click();

  const rowAfter = await focusPlace(page);
  const before = await page.evaluate(() => location.hash);

  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(150);

  expectSame(
    "a click on search or on empty space lets go of the selected pin and of a focused row, and ↓ still moves through the list",
    {
      moved: (await page.evaluate(() => location.hash)) !== before,
      onEmpty,
      onSearch,
      picked,
      row: [rowFirst, rowAfter],
    },
    {
      moved: true,
      onEmpty: { focus: "BODY", pins: 0 },
      onSearch: { focus: "search", pins: 0 },
      picked: 1,
      row: ["row", "BODY"],
    }
  );

  await page.locator(`[data-capture-id='${uuid(1)}']`).click();
  await page.getByLabel("Label for pin 1").waitFor();

  const label = page.getByLabel("Label for pin 1");
  const original = await label.inputValue();
  const left = await pinLeft();

  await page.getByTestId("image-editor").focus();
  await page.keyboard.press("1");
  await page.keyboard.press("Shift+ArrowRight");

  const nudged = await pinLeft();

  await label.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" (typed)");
  await page.keyboard.press("Escape");

  const escaped = {
    focus: await focusPlace(page),
    pin: (await pinLeft()) === nudged,
    value: await label.inputValue(),
  };

  await page.keyboard.press(`${m}+z`);

  const undone = {
    pin: (await pinLeft()) === left,
    value: await label.inputValue(),
  };

  await label.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" kept");
  await page.keyboard.press("Enter");

  expectSame(
    "Esc in a pin's label takes back only the typing and leaves it as text; ⌘Z then undoes the nudge before it; Return keeps what was typed",
    {
      escaped,
      kept: await label.inputValue(),
      nudgedMoved: nudged !== left,
      undone,
    },
    {
      escaped: { focus: "BODY", pin: true, value: original },
      kept: `${original} kept`,
      nudgedMoved: true,
      undone: { pin: true, value: original },
    }
  );

  await context.close();

  return failures;
};

/**
 * Round 14, item 8 with a menu open, as in the Shelf and Window Links: the
 * library's menus don't hold the page. A click on search or a field closes
 * the menu and lands there at once; a click on empty space, Esc or a command
 * closes it and gives the focus back to the menu's owner.
 */
const checkMenuClickAway = async (
  browser: Browser,
  origin: string,
  captures: readonly Capture[],
  platform: Platform
): Promise<string[]> => {
  const { expectSame, failures } = makeReport(platform);

  const { context, page } = await openLibrary(
    browser,
    origin,
    { captures: structuredClone(captures), page: "library" },
    platform,
    `/captures/${uuid(1)}`
  );

  // Where a person's pointer lands: a locator click would wait out a modal menu instead of trying.
  const clickOn = async (locator: Locator): Promise<void> => {
    const box = await locator.boundingBox();

    if (box === null) {
      throw new Error("nothing to click on");
    }

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };

  const opens = {
    filter: async () => {
      await page.getByRole("button", { name: "Due filters" }).click();
    },
    more: async () => {
      await page.getByTestId("more").click();
    },
    row: async () => {
      await page.locator(ROW).nth(1).click({ button: "right" });
    },
  };

  const ends = {
    copy: async () => {
      await page.getByRole("menuitem", { name: /^Copy Text/u }).click();
    },
    empty: async () => {
      await clickOn(page.getByTestId("capture-footer"));
    },
    escape: async () => {
      await page.keyboard.press("Escape");
    },
    search: async () => {
      await clickOn(page.getByTestId("search"));
    },
    title: async () => {
      await clickOn(page.getByTestId("title-field"));
    },
  };

  // In the order the report lists them, which compares as written.
  const cases = [
    ["filter", "empty"],
    ["filter", "escape"],
    ["filter", "title"],
    ["more", "copy"],
    ["more", "empty"],
    ["more", "escape"],
    ["more", "search"],
    ["more", "title"],
    ["row", "copy"],
    ["row", "empty"],
    ["row", "escape"],
    ["row", "search"],
    ["row", "title"],
  ] as const;

  const landed: Record<string, string | null> = {};

  for (const [menu, end] of cases) {
    // One at a time: each opens a menu after the last one has gone.
    // oxlint-disable-next-line no-await-in-loop
    await opens[menu]();
    // oxlint-disable-next-line no-await-in-loop
    await page.getByRole("menu").waitFor();
    // Radix listens for a click outside only a moment after the menu mounts; a person is never that fast.
    // oxlint-disable-next-line no-await-in-loop
    await page.waitForTimeout(150);
    // oxlint-disable-next-line no-await-in-loop
    await ends[end]();

    // oxlint-disable-next-line no-await-in-loop
    const closed = await settles(page.getByRole("menu"), "detached", 1500);

    // oxlint-disable-next-line no-await-in-loop
    await page.waitForTimeout(250);
    // oxlint-disable-next-line no-await-in-loop
    landed[`${menu} then ${end}`] = closed ? await focusPlace(page) : "open";

    if (!closed) {
      // oxlint-disable-next-line no-await-in-loop
      await page.keyboard.press("Escape");
    }
  }

  expectSame(
    "with a menu open, a click on search or a field lands there at once; empty space, Esc and a command give the focus back to the menu's owner",
    landed,
    {
      "filter then empty": "search",
      "filter then escape": "search",
      "filter then title": "title-field",
      "more then copy": "more",
      "more then empty": "more",
      "more then escape": "more",
      "more then search": "search",
      "more then title": "title-field",
      "row then copy": "row",
      "row then empty": "row",
      "row then escape": "row",
      "row then search": "search",
      "row then title": "title-field",
    }
  );

  await context.close();

  return failures;
};

/**
 * Round 14: Due opens on its quick choices every time, as in the Shelf and
 * Window Links, also after a day was picked on the library's calendar.
 */
const checkDueReopen = async (
  browser: Browser,
  origin: string,
  captures: readonly Capture[],
  platform: Platform
): Promise<string[]> => {
  const { expectSame, failures } = makeReport(platform);

  const { context, page } = await openLibrary(
    browser,
    origin,
    { captures: structuredClone(captures), page: "library" },
    platform,
    `/captures/${uuid(2)}`
  );

  const chip = page.getByTestId("due-chip").getByRole("button").first();
  const calendar = page.getByTestId("due-calendar");

  await chip.click();
  await page.getByRole("button", { name: "Pick a date…" }).click();
  await calendar.waitFor();
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await calendar.waitFor({ state: "detached" });
  await page.waitForTimeout(250);
  await chip.click();
  await page.waitForTimeout(250);

  expectSame(
    "after a day is picked on the library's calendar, Due opens again on its quick choices, Clear among them, with Today in focus",
    {
      calendar: await calendar.count(),
      clear: await page
        .getByRole("button", { exact: true, name: "Clear" })
        .count(),
      focus: ((await focusName(page)) ?? "").startsWith("Today"),
      quick: await page.getByTestId("due-picker").count(),
    },
    { calendar: 0, clear: 1, focus: true, quick: 1 }
  );

  await context.close();

  return failures;
};

/**
 * Round 14 in the capture panel: a click on the panel's empty space or on
 * the title lets go of a selected pin, and empty space also lets go of a
 * step being typed in.
 */
const checkPanelClickAway = async (
  browser: Browser,
  origin: string,
  desktop: Targets,
  platform: Platform
): Promise<string[]> => {
  const { expectSame, failures } = makeReport(platform);

  const pins = [desktop.chairs, desktop.delivery].flatMap((point) =>
    point === undefined ? [] : [point]
  );

  const { context, page } = await openPanel(
    browser,
    origin,
    platform,
    draftView(desktop, {
      pins,
      steps: [step(1, "Ask Rieder")],
      title: "Chairs are CHF 280 over the cap",
    })
  );

  const selectedPins = async () =>
    await page.locator("[data-testid='pin-preview'] .pin-selection").count();

  const preview = page.getByTestId("pin-preview");

  await preview.focus();
  await page.keyboard.press("2");

  const picked = await selectedPins();

  // The form's left padding: empty space, beside the preview.
  await page.mouse.click(4, 300);

  const onEmpty = { focus: await focusPlace(page), pins: await selectedPins() };

  await preview.focus();
  await page.keyboard.press("1");
  await page.getByTestId("title-field").click();

  const onTitle = { focus: await focusPlace(page), pins: await selectedPins() };

  await page.getByLabel("Next step 1", { exact: true }).click();
  await page.mouse.click(4, 300);

  expectSame(
    "a click on the panel's empty space or its title lets go of the selected pin, and empty space lets go of a step being typed in",
    { onEmpty, onStep: await focusPlace(page), onTitle, picked },
    {
      onEmpty: { focus: "BODY", pins: 0 },
      onStep: "BODY",
      onTitle: { focus: "title-field", pins: 0 },
      picked: 1,
    }
  );

  await context.close();

  return failures;
};

/**
 * The onboarding's controls and the problem panel's hand-off ask main for
 * the right thing: the page only reports, and main moves the flow on.
 */
/** The focused element's text when it is inside the tutorial's bubble, else where focus is. */
const focusInBubble = async (tab: Page): Promise<string> =>
  await tab.evaluate(() => {
    const focused = document.activeElement;

    return focused instanceof HTMLElement &&
      focused.closest("[data-coach-bubble]") !== null
      ? (focused.textContent ?? "")
      : `outside: ${focused?.tagName ?? "none"}`;
  });

/** Clicks a button by its exact name. */
const click = async (tab: Page, name: string): Promise<void> => {
  await tab.getByRole("button", { exact: true, name }).click();
};

/** What the fake bridge was asked: the library's and the setup's calls, or the panel's. */
const bridgeCalls = async (tab: Page, key: "__calls" | "__panelCalls") =>
  await tab.evaluate((name) => globalThis[name] ?? [], key);

/**
 * Setup and the in-app tutorial ask main for the right thing: the pages
 * only report, and main moves the flow on and ticks tasks off.
 */
const checkOnboarding = async (
  browser: Browser,
  origin: string,
  platform: Platform
): Promise<string[]> => {
  const { expectSame, failures } = makeReport(platform);

  const open = async (
    page: "onboarding" | "capture" | "library" | "settings",
    data: SceneData,
    hash = ""
  ) => {
    const context = await browser.newContext({
      userAgent: USER_AGENT[platform],
      viewport: SIZES[page],
    });

    const tab = await context.newPage();
    const input: BridgeInput = { ...data, page };

    await tab.addInitScript(installBridge, input);
    await tab.goto(`${origin}/${page}.html${hash === "" ? "" : `#${hash}`}`);
    await tab.waitForLoadState("networkidle");

    return { context, tab };
  };

  const calls = async (
    page: "onboarding" | "capture" | "library" | "settings",
    data: SceneData,
    run: (tab: Page) => Promise<void>,
    options: { readonly hash?: string; readonly panel?: boolean } = {}
  ): Promise<string[]> => {
    const { context, tab } = await open(page, data, options.hash);

    await run(tab);
    await tab.waitForTimeout(150);

    const got = await bridgeCalls(
      tab,
      options.panel === true ? "__panelCalls" : "__calls"
    );

    await context.close();

    return got;
  };

  const welcome = await calls(
    "onboarding",
    { view: onboardingView("welcome", "allow") },
    async (tab) => {
      await tab.keyboard.press("Enter");
      await click(tab, "Not now");
    }
  );

  const access = await calls(
    "onboarding",
    { view: onboardingView("access", "allow") },
    async (tab) => {
      await click(tab, "Allow Screen Recording");
      await click(tab, "Back");
    }
  );

  const reopen = await calls(
    "onboarding",
    { view: onboardingView("access", "reopen") },
    async (tab) => {
      await click(tab, "Reopen to finish");
      await tab
        .getByRole("button", { name: /^Drag /u })
        .dispatchEvent("dragstart");
      await click(tab, "Not now");
    }
  );

  const reopening = await calls(
    "onboarding",
    { view: onboardingView("access", "reopening") },
    async (tab) => {
      await click(tab, "Reopening…");
    }
  );

  const done = await calls(
    "onboarding",
    { view: onboardingView("done", "allowed") },
    async (tab) => {
      await click(tab, "Show Me Around");
      await click(tab, "Start Using");
    }
  );

  const examplesLibrary: SceneData = {
    captures: EXAMPLE_CAPTURES,
    tutorial: tutorialView({ examples: true }),
  };

  let tags = 0;

  const checklist = await calls(
    "library",
    examplesLibrary,
    async (tab) => {
      await tab.getByText("Getting started").waitFor();
      tags = await tab.getByText("Example", { exact: true }).count();
      await tab.getByRole("button", { name: /^Place a pin/u }).click();
      await tab.getByRole("button", { name: "Getting started menu" }).click();
      await tab.getByRole("menuitem", { name: "Remove Examples" }).click();
    },
    { hash: `/captures/${EXAMPLE_IDS[0] ?? ""}` }
  );

  const libraryTip = await calls(
    "library",
    {
      ...examplesLibrary,
      tutorial: tutorialView({ active: LIBRARY_HINT, examples: true }),
    },
    async (tab) => {
      await tab.getByText("Your library").waitFor();
      await click(tab, "Got it");
    },
    { hash: `/captures/${EXAMPLE_IDS[0] ?? ""}` }
  );

  // A tip never takes the keyboard from the title: typing after ⌥⌘P still lands there.
  let titleKept = { focus: "", typed: false };

  const panelCalls = await calls(
    "capture",
    {
      tutorial: tutorialView({ active: PLACE_PIN_HINT, checklist: false }),
      view: draftView({}, {}),
    },
    async (tab) => {
      await tab.getByText("Pin what matters").waitFor();

      const focus = await tab.evaluate(() =>
        document.activeElement instanceof HTMLElement
          ? (document.activeElement.dataset.testid ?? "")
          : ""
      );

      await tab.keyboard.type("abc");
      await tab.waitForTimeout(150);

      const sent = await bridgeCalls(tab, "__panelCalls");

      titleKept = { focus, typed: sent.includes("edit") };
      await tab.keyboard.press("Escape");
    },
    { panel: true }
  );

  const panelTip = panelCalls.filter((call) => call.startsWith("tutorial:"));

  // In the app the panel is exactly as tall as its page before a tip shows: the tip must fit beside the preview, not over it.
  const fitted = await open("capture", { view: draftView({}, {}) });

  await fitted.tab.waitForTimeout(300);

  const panelHeight = await fitted.tab.evaluate(() => globalThis.__fitted ?? 0);

  await fitted.context.close();

  const sized = await browser.newContext({
    userAgent: USER_AGENT[platform],
    viewport: { height: panelHeight, width: SIZES.capture.width },
  });

  const sizedTab = await sized.newPage();

  const sizedInput: BridgeInput = {
    page: "capture",
    tutorial: tutorialView({ active: PLACE_PIN_HINT, checklist: false }),
    view: draftView({}, {}),
  };

  await sizedTab.addInitScript(installBridge, sizedInput);
  await sizedTab.goto(`${origin}/capture.html`);
  await sizedTab.locator("[data-coach-bubble]").waitFor();
  await sizedTab.waitForTimeout(300);

  const pinTipPlace = await sizedTab.evaluate(() => {
    const bubble = document
      .querySelector("[data-coach-bubble]")
      ?.getBoundingClientRect();

    const preview = document
      .querySelector("[data-testid='pin-preview']")
      ?.getBoundingClientRect();

    if (bubble === undefined || preview === undefined) {
      return "missing";
    }

    const covered =
      Math.max(
        0,
        Math.min(bubble.bottom, preview.bottom) -
          Math.max(bubble.top, preview.top)
      ) *
      Math.max(
        0,
        Math.min(bubble.right, preview.right) -
          Math.max(bubble.left, preview.left)
      );

    const side =
      document.querySelector<HTMLElement>(".coach-arrow")?.dataset.side ??
      "inside";

    return `${side}, covers ${Math.round((covered / (preview.width * preview.height)) * 100)}% of the preview`;
  });

  await sizedTab.screenshot({
    path: path.join(OUT, `check-pin-tip-${platform}.png`),
  });
  await sized.close();

  // The walkthrough's bubble takes the keyboard: Next has focus at every stop.
  const walkFocus: string[] = [];

  const walkthrough = await calls(
    "library",
    {
      ...examplesLibrary,
      tutorial: tutorialView({ examples: true, spotlight: 1 }),
    },
    async (tab) => {
      await tab.waitForSelector("[data-spotlight-dimmer]");
      await tab.getByText("1 of 6").waitFor();
      await tab.waitForTimeout(300);
      walkFocus.push(await focusInBubble(tab));
      await tab.keyboard.press("Enter");
      await tab.getByText("2 of 6").waitFor();
      await tab.waitForTimeout(300);
      walkFocus.push(await focusInBubble(tab));
      await tab.keyboard.press("Escape");
    },
    { hash: `/captures/${EXAMPLE_IDS[0] ?? ""}` }
  );

  const settingsCalls = await calls(
    "settings",
    { view: SETTINGS_VIEW },
    async (tab) => {
      await tab.getByRole("switch", { name: "Show tips" }).click();
      await click(tab, "Reset Tutorial");
    }
  );

  const panel = await calls(
    "capture",
    { view: problemView("denied") },
    async (tab) => {
      await click(tab, "Set Up Screen Recording…");
    },
    { panel: true }
  );

  const empty = await calls(
    "capture",
    { view: problemView("granted-but-empty") },
    async (tab) => {
      await click(tab, "Open System Settings");
      await click(tab, "Quit and Reopen");
    },
    { panel: true }
  );

  expectSame(
    "setup and tutorial: Welcome's Return and Not now; Allow and Back; Reopen to finish, the tile's drag and Not now; Reopening… asks again; Done's two ways into the library; the checklist tags the examples, asks only for a task's how-to, and removes the examples; a drawn tip is seen and Got it puts it away, in the library and the panel, where the title keeps the keyboard; the walkthrough's Next has focus at stops 1 and 2, and Esc ends it; Settings' Show tips and Reset Tutorial; the panel hands Screen Recording to setup, and an empty image offers the pane and a reopen",
    {
      access,
      checklist,
      done,
      empty,
      libraryTip,
      panel,
      panelTip,
      pinTipPlace,
      reopen,
      reopening,
      settingsCalls,
      tags,
      titleKept,
      walkFocus,
      walkthrough,
      welcome,
    },
    {
      access: ["allow:screen", "back"],
      checklist: ["tutorial:taskHint:pin", "tutorial:removeExamples:"],
      done: ["finish:showAround", "finish:start"],
      empty: ["openScreenSettings", "relaunch"],
      libraryTip: [
        "tutorial:hintShown:library",
        "tutorial:dismissHint:library",
      ],
      panel: ["setUpScreenRecording"],
      panelTip: [
        "tutorial:hintShown:place-pin",
        "tutorial:dismissHint:place-pin",
      ],
      pinTipPlace: "below, covers 0% of the preview",
      reopen: ["reopen", "startDrag", "next"],
      reopening: ["reopen"],
      settingsCalls: ["setTips:false", "resetTutorial"],
      tags: 2,
      titleKept: { focus: "title-field", typed: true },
      walkFocus: ["Next", "Next"],
      walkthrough: ["tutorial:spotlightDone:"],
      welcome: ["next", "skip"],
    }
  );

  return failures;
};

const runChecks = async (
  browser: Browser,
  origin: string,
  captures: readonly Capture[],
  desktop: Targets
): Promise<string[]> => {
  const onPlatform = async (platform: Platform): Promise<string[]> => {
    /** A check that throws, as on a build without the element it waits for, fails alone and the others still run. */
    const guarded = async (
      name: string,
      run: () => Promise<string[]>
    ): Promise<string[]> => {
      // SCREENS_CHECK="save lock" runs only the checks whose name holds it, for a quick loop on one.
      const only = process.env.SCREENS_CHECK;

      if (only !== undefined && !name.includes(only)) {
        return [];
      }

      try {
        return await run();
      } catch (error) {
        const why = String(error).split("\n")[0] ?? "";

        console.log(`FAIL ${platform} ${name}: threw ${why}`);

        return [`${platform} ${name}`];
      }
    };

    return [
      ...(platform === "macos"
        ? await guarded(
            "onboarding",
            async () => await checkOnboarding(browser, origin, platform)
          )
        : []),
      ...(await guarded(
        "add menu",
        async () => await checkAddMenu(browser, origin, desktop, platform)
      )),
      ...(await guarded(
        "library polish",
        async () =>
          await checkLibraryPolish(browser, origin, captures, platform)
      )),
      ...(await guarded(
        "menu click away",
        async () =>
          await checkMenuClickAway(browser, origin, captures, platform)
      )),
      ...(await guarded(
        "due reopen",
        async () => await checkDueReopen(browser, origin, captures, platform)
      )),
      ...(await guarded(
        "panel click away",
        async () =>
          await checkPanelClickAway(browser, origin, desktop, platform)
      )),
      ...(await guarded(
        "panel header",
        async () => await checkPanelHeader(browser, origin, desktop, platform)
      )),
      ...(await guarded(
        "due calendar",
        async () => await checkDueCalendar(browser, origin, desktop, platform)
      )),
      ...(await guarded(
        "save lock",
        async () => await checkSaveLock(browser, origin, desktop, platform)
      )),
      ...(await guarded(
        "capture quit prompt",
        async () => await checkCaptureQuit(browser, origin, desktop, platform)
      )),
      ...(await guarded(
        "row menu",
        async () => await checkRowMenu(browser, origin, captures, platform)
      )),
      ...(await guarded(
        "copy gate",
        async () => await checkCopyGate(browser, origin, captures, platform)
      )),
      ...(await guarded(
        "floating copy",
        async () => await checkFloatCopy(browser, origin, captures, platform)
      )),
      ...(await guarded(
        "drafts",
        async () => await checkDrafts(browser, origin, captures, platform)
      )),
      ...(await guarded(
        "sidebar widths",
        async () =>
          await checkSidebarWidths(browser, origin, captures, platform)
      )),
    ];
  };

  const failures: string[] = [];

  for (const platform of ["macos", "windows"] as const) {
    // Sequential on purpose: the checks wait on timers, like the shots.
    // oxlint-disable-next-line no-await-in-loop
    failures.push(...(await onPlatform(platform)));
  }

  return failures;
};

interface Shot {
  scene: Scene;
  platform: Platform;
  theme: Theme;
}

/** One at a time: every shot waits on timers, and a loaded machine would change what it catches. */
const shootEach = async (
  browser: Browser,
  origin: string,
  shots: readonly Shot[]
): Promise<{ taken: string[]; failed: string[] }> => {
  const taken: string[] = [];
  const failed: string[] = [];

  for (const { platform, scene, theme } of shots) {
    const name = `${scene.name}-${platform}-${theme}`;

    try {
      // Sequential on purpose: see above.
      // oxlint-disable-next-line no-await-in-loop
      taken.push(await shoot(browser, origin, scene, platform, theme));
    } catch (error) {
      failed.push(name);
      console.error(`${name}: ${String(error)}`);
    }
  }

  return { failed, taken };
};

const main = async () => {
  await rm(OUT, { force: true, recursive: true });
  await mkdir(FIXTURES, { recursive: true });

  const browser = await chromium.launch();

  const fixtureTargets = new Map(
    await Promise.all(
      Object.entries(SAMPLES).map(
        async ([name, sample]) =>
          [name, await renderFixture(browser, name, sample.body, CROP)] as const
      )
    )
  );

  const sampleTargets = (name: SampleName): Targets =>
    fixtureTargets.get(name) ?? {};

  const desktop = await renderFixture(browser, "desktop", DESKTOP, {
    height: 900,
    width: 1440,
  });

  const captures = makeCaptures(sampleTargets);

  // The tutorial's example captures show the image the app ships (resources/).
  await writeFile(
    path.join(FIXTURES, "example-capture.png"),
    await readFile(path.join(ROOT, "resources", "example-capture.png"))
  );

  // The sample data, for anyone driving the pages by hand.
  await writeFile(
    path.join(FIXTURES, "captures.json"),
    `${JSON.stringify(captures, null, 2)}\n`
  );
  const scenes = makeScenes(captures, desktop);

  // SCREENS_SCENE="calendar" shoots only the scenes whose name holds it, for a quick look at one.
  const only = process.env.SCREENS_SCENE;

  const shots: Shot[] = scenes
    .filter((scene) => only === undefined || scene.name.includes(only))
    .flatMap((scene) =>
      (scene.platforms ?? (["macos", "windows"] as const)).flatMap((platform) =>
        (["light", "dark"] as const).map((theme) => ({
          platform,
          scene,
          theme,
        }))
      )
    );

  const { origin, server } = await serve();
  const checkFailures = await runChecks(browser, origin, captures, desktop);

  if (process.env.SCREENS_ONLY !== "checks") {
    const { failed, taken } = await shootEach(browser, origin, shots);
    const rendered = await shootRenderer(browser, captures);

    await writeFile(
      path.join(OUT, "index.json"),
      `${JSON.stringify([...rendered, ...taken], null, 2)}\n`
    );
    console.log(`${taken.length + rendered.length} screenshots in ${OUT}`);

    if (failed.length > 0) {
      console.error(`${failed.length} failed: ${failed.join(", ")}`);
      process.exitCode = 1;
    }
  }

  await browser.close();
  server.close();

  if (checkFailures.length > 0) {
    console.error(
      `${checkFailures.length} checks failed: ${checkFailures.join("; ")}`
    );
    process.exitCode = 1;
  }
};

await main();
