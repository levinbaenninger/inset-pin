/**
 * Screenshots every window of the built renderer in its main states, light
 * and dark, as macOS and Windows show them, without screen access or a real
 * capture. Each page runs in Playwright's Chromium with a fake preload bridge
 * (scripts/fixtures/screens-bridge.ts) that answers from the sample data
 * below, so a before and an after run show the same captures.
 *
 *   pnpm screens            # builds, then writes release/screens/*.png
 *   node scripts/screens.ts [output folder]   # after pnpm build
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
  captures?: readonly object[];
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
}

const mod = (platform: Platform) => (platform === "macos" ? "Meta" : "Control");

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
        await page.getByRole("menuitem", { name: /Copy as Text/u }).waitFor();
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
  const { failed, taken } = await shootEach(browser, origin, shots);
  const rendered = await shootRenderer(browser, captures);

  await writeFile(
    path.join(OUT, "index.json"),
    `${JSON.stringify([...rendered, ...taken], null, 2)}\n`
  );
  await browser.close();
  server.close();
  console.log(`${taken.length + rendered.length} screenshots in ${OUT}`);

  if (failed.length > 0) {
    console.error(`${failed.length} failed: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
};

await main();
