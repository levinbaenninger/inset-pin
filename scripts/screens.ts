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
 */
import { once } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { z } from "zod";

import { drawPins, pinSprite } from "../src/shared/pin-sprite.ts";
import { installBridge } from "./fixtures/screens-bridge.ts";
import type { BridgeInput } from "./fixtures/screens-bridge.ts";

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

const SETTINGS_VIEW = {
  openAtLogin: true,
  settings: { copyAfterSave: true, iconIn: "dockAndMenuBar" },
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
}

interface Scene {
  name: string;
  page: "capture" | "library" | "settings" | "pin";
  hash?: string;
  data: SceneData;
  platforms?: readonly Platform[];
  act?: (page: Page, platform: Platform) => Promise<void>;
  /** Fit the window to the page's reported height first, as the panel and Settings do. */
  fit?: boolean;
  /** localStorage the page finds when it loads, such as the sidebar's width. */
  storage?: Readonly<Record<string, string>>;
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
      act: async (page) => {
        await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
        await page.getByTestId("shortcut-sheet").waitFor();
      },
      data: { view: filled },
      fit: true,
      name: "capture-6-shortcuts",
      page: "capture",
    },
    {
      data: { view: { ...filled, quitting: true } },
      fit: true,
      name: "capture-7-quit",
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
      },
      data: library(),
      hash: `/captures/${uuid(1)}`,
      name: "library-21-unsaved-close",
      page: "library",
      platforms: ["windows"],
    },
    {
      data: { view: SETTINGS_VIEW },
      fit: true,
      name: "settings",
      page: "settings",
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
  const size = SIZES[scene.page];

  const context = await browser.newContext({
    colorScheme: theme,
    deviceScaleFactor: 2,
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

  return { expectSame, failures };
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
  await page.mouse.click(760, 640);
  closed = await settled();
  expectSame(
    "a click outside closes row B's menu onto row B",
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

    await page.evaluate(() => {
      globalThis.__failSaves = false;
    });
    await page.keyboard.press("Meta+c");
    await page.waitForTimeout(300);

    const copied = await takeCalls();

    expectSame(
      "plain ⌘C on the page saves the typing, then copies A",
      copied.slice(-2),
      [`update:${a}:${aTitle} (edited) again`, `copyText:${a}`]
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

      const copies = (globalThis.__calls ?? []).filter((call) =>
        call.startsWith("copy")
      );

      globalThis.__asked = [];
      globalThis.__calls = [];

      return { asked, copies };
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

    const outcome = { ...(await take()), notice };

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
  await page.keyboard.type(" (typed)");
  await page.evaluate(() => {
    globalThis.__failSaves = true;
  });

  const refused = {
    failed: true,
    text: "Couldn’t save your changes, so nothing was copied. The disk is full.",
  };

  expectSame(
    "while saves fail, every way to copy A asks the gate, copies nothing and says why",
    await tryEach(),
    Object.fromEntries(
      ways.map(({ copies, way }) => [
        way,
        { asked: [`${copies}:${a}`], copies: [], notice: refused },
      ])
    )
  );

  await page.evaluate(() => {
    globalThis.__failSaves = false;
  });

  const said = {
    copyDetails: "Copied with details",
    copyImage: "Image copied with its pins",
    copyText: "Copied",
  } as const;

  expectSame(
    "once saves work, every way to copy A copies A",
    await tryEach(),
    Object.fromEntries(
      ways.map(({ copies, way }) => [
        way,
        {
          asked: [`${copies}:${a}`],
          copies: [`${copies}:${a}`],
          notice: { failed: false, text: said[copies] },
        },
      ])
    )
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
  expectSame("a refused copy in the floating window says why", await state(), {
    alert:
      "Couldn’t save your changes, so nothing was copied. The disk is full.",
    calls: [],
    copyButton: "Couldn’t copy",
  });

  await page.evaluate(() => {
    globalThis.__failSaves = false;
  });
  await page.getByRole("button", { name: "Couldn’t copy" }).click();
  await page.waitForTimeout(200);
  expectSame("then a copy that works says Copied", await state(), {
    alert: null,
    calls: ["copyImage:pin"],
    copyButton: "Copied",
  });

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
  const { expectSame, failures } = makeReport(platform);
  const a = uuid(1);
  const aTitle = captures.find((one) => one.id === a)?.title ?? "";
  const m = mod(platform);

  const refused = {
    failed: true,
    text: "Couldn’t save your changes, so nothing was copied. The disk is full.",
  };

  const session = async () => {
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

    const row = (id: string) => rows.nth(ids.indexOf(id));
    const b = ids[2] ?? "";
    const bTitle = captures.find((one) => one.id === b)?.title ?? "";

    const set = async (
      name: "__failSaves" | "__holdSaves",
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
          saves: calls.filter((call) => call.startsWith("update")),
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

    return {
      b,
      bTitle,
      context,
      copyFromRow,
      notice,
      open,
      outcome,
      page,
      release,
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

  // Leaving A after its save has failed and settled, then copying A from its row; Retry, then Discard changes.
  {
    const s = await session();
    const { page } = s;

    await s.set("__failSaves", true);
    await typeInTitle(page, " (failed)");
    await page.getByTestId("save-failure").waitFor();
    await s.open(s.b, s.bTitle);
    await page.waitForTimeout(1200);
    await s.take();
    await s.copyFromRow(a);
    await page.waitForTimeout(300);

    const copied = await s.outcome();
    const marked = await s.unsavedRow(a);

    await s.open(a, aTitle);

    expectSame(
      "after A's failed save has settled and A was left, a copy from A's row tries the save again, refuses, and A keeps its typing",
      { copied, marked, reopened: await s.shown() },
      {
        copied: {
          asked: [`copyText:${a}`],
          clipboard: [],
          copies: [],
          notice: refused,
          saves: [`update:${a}:${aTitle} (failed)`],
        },
        marked: true,
        reopened: { failure, title: `${aTitle} (failed)` },
      }
    );

    // Discarding waits while a retry is on its way, since the retry could still write the text.
    const discard = page.getByRole("button", { name: "Discard changes" });

    await s.set("__holdSaves", true);
    await page.getByRole("button", { name: "Retry" }).click();
    await page.waitForTimeout(150);

    const whileRetrying = await discard.isDisabled();

    await s.release();
    await s.set("__holdSaves", false);

    expectSame(
      "Discard changes waits while a retry is on its way, and comes back when it fails",
      { afterFailedRetry: await discard.isDisabled(), whileRetrying },
      { afterFailedRetry: false, whileRetrying: true }
    );

    await s.take();
    await s.set("__failSaves", false);
    await page.getByRole("button", { name: "Retry" }).click();
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
          clipboard: [`${aTitle} (failed)`],
          notice: { failed: false, text: "Copied with details" },
        },
        marked: false,
        saves: [`update:${a}:${aTitle} (failed)`],
        shown: { failure: null, title: `${aTitle} (failed)` },
      }
    );

    await s.set("__failSaves", true);
    await typeInTitle(page, " (discard me)");
    await page.getByTestId("save-failure").waitFor();
    await page.getByRole("button", { name: "Discard changes" }).click();
    await page.waitForTimeout(300);
    await s.set("__failSaves", false);

    const discarded = await s.shown();

    const focus = await page.evaluate(
      () =>
        (document.activeElement instanceof HTMLElement
          ? document.activeElement.dataset.testid
          : null) ?? null
    );

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
        clipboard: [`${aTitle} (failed)`],
        discarded: { failure: null, title: `${aTitle} (failed)` },
        focus: "title-field",
        marked: false,
      }
    );

    await s.context.close();
  }

  // A close or a quit while a change can't be saved is held and asks; Escape cancels, Return retries.
  {
    const s = await session();
    const { page } = s;
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
        nothingTyped,
        retried: { resumed, saves, shown: await s.shown() },
        retryFailed,
      },
      {
        answered: { message: "The disk is full.", ok: false },
        asked: {
          focus: "Retry",
          prompt: asking("1 change", "The disk is full.", "Discard and close"),
        },
        cancelled: {
          focus: "title-field",
          prompt: null,
          resumed: [],
          shown: { failure, title: `${aTitle} (typed)` },
        },
        nothingTyped: { fields: null, ok: true },
        retried: {
          resumed: ["resumeLeaving"],
          // The pause in typing, each of the two asks, each prompt taking the focus from the title (leaving a field saves), the failed Return, the one that works.
          saves: Array.from(
            { length: 7 },
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

    await s.context.close();
  }

  // Discard and quit drops the change and lets the quit go on.
  {
    const s = await session();
    const { page } = s;

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

    await s.context.close();
  }

  // A save still on its way after the second holds the close, which goes on by itself once the save lands.
  {
    const s = await session();
    const { page } = s;

    await s.set("__holdSaves", true);
    await typeInTitle(page, " slow");

    const answered = await askToLeave(page, "restart");

    await page.getByTestId("leave-prompt").waitFor();

    const { prompt: asked } = await leavePrompt(page);

    await s.release();
    await page.getByTestId("leave-prompt").waitFor({ state: "detached" });

    expectSame(
      "a save slower than the wait holds the restart, and it goes on by itself once the save lands",
      { answered, asked, resumed: await resumes(page) },
      {
        answered: { message: "Saving took too long.", ok: false },
        asked: asking("1 change", "Saving took too long.", "Discard and quit"),
        resumed: ["resumeLeaving"],
      }
    );

    await s.context.close();
  }

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

/** The capture panel's Add… menu: the keys it shows pick their field; other shortcuts stay in the menu. */
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
    `${m}+/ in the open Add… menu stays in it`,
    await pressInAddMenu(`${m}+/`),
    { descriptionFocused: false, dialogs: 0, menuOpen: true }
  );
  expectSame(
    `${m}+Shift+d in the open Add… menu opens the Due picker`,
    await pressInAddMenu(`${m}+Shift+d`),
    { descriptionFocused: false, dialogs: 1, menuOpen: false }
  );
  expectSame(
    `${m}+d in the open Add… menu adds the description and focuses it`,
    await pressInAddMenu(`${m}+d`),
    { descriptionFocused: true, dialogs: 0, menuOpen: false }
  );

  await context.close();

  return failures;
};

const runChecks = async (
  browser: Browser,
  origin: string,
  captures: readonly Capture[],
  desktop: Targets
): Promise<string[]> => {
  const onPlatform = async (platform: Platform): Promise<string[]> => [
    ...(await checkAddMenu(browser, origin, desktop, platform)),
    ...(await checkRowMenu(browser, origin, captures, platform)),
    ...(await checkCopyGate(browser, origin, captures, platform)),
    ...(await checkFloatCopy(browser, origin, captures, platform)),
    ...(await checkDrafts(browser, origin, captures, platform)),
    ...(await checkSidebarWidths(browser, origin, captures, platform)),
  ];

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

  // The sample data, for anyone driving the pages by hand.
  await writeFile(
    path.join(FIXTURES, "captures.json"),
    `${JSON.stringify(captures, null, 2)}\n`
  );
  const scenes = makeScenes(captures, desktop);

  const shots: Shot[] = scenes.flatMap((scene) =>
    (scene.platforms ?? (["macos", "windows"] as const)).flatMap((platform) =>
      (["light", "dark"] as const).map((theme) => ({ platform, scene, theme }))
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
