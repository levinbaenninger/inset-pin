import { execFileSync, spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import { PIN_RGB } from "../../src/main/pin-mark.ts";
import { CaptureRecordV1Schema } from "../../src/shared/capture-record.ts";
import { DEFAULT_CROP_DIP } from "../../src/shared/geometry.ts";

const root = path.resolve(import.meta.dirname, "../..");
const mode = process.argv[2] === "packaged" ? "packaged" : "dev";

const appExe =
  mode === "packaged"
    ? path.join(root, "release/win-unpacked/Inset Context Pin.exe")
    : path.join(root, "node_modules/electron/dist/electron.exe");

const work = mkdtempSync(path.join(tmpdir(), "inset-e2e-"));
const bin = path.join(work, "bin");
const shots = path.join(work, "shots");
const userData = path.join(work, "userData");
const logFile = path.join(work, "events.jsonl");

// Left of centre, clear of panels that other Inset prototypes dock on the right.
const homeMarker = { size: 160, x: 250, y: 560 };
const edgeMarker = { size: 80, x: 60, y: 500 };
const away = { x: 700, y: 250 };
const thought = "Total ignores discount row";

/** Windows hides a notification nobody touches after about five seconds. */
const NOTIFICATION_GONE_MS = 8000;
let marker = homeMarker;
let markerProcess: ChildProcess | undefined;
let app: ChildProcess | undefined;

/** Holds the capture shortcut, as another app would, during the conflict check. */
let hotkeyHolder: ChildProcess | undefined;

const EventSchema = z.object({
  bounds: z
    .object({
      height: z.number(),
      width: z.number(),
      x: z.number(),
      y: z.number(),
    })
    .optional(),
  draftId: z.string().optional(),
  event: z.string(),
  t: z.number(),
  windows: z.number(),
});

type AppEvent = z.infer<typeof EventSchema>;

const ErrorSchema = z.object({ error: z.string() });

const WindowSchema = z.object({
  cls: z.string(),
  height: z.number(),
  hwnd: z.number(),
  pid: z.number(),
  title: z.string(),
  width: z.number(),
  x: z.number(),
  y: z.number(),
});

const ElementSchema = z.object({
  enabled: z.boolean(),
  name: z.string(),
  type: z.string(),
  x: z.number(),
  y: z.number(),
});

const RgbSchema = z.object({ b: z.number(), g: z.number(), r: z.number() });

const DisplaySchema = z.object({
  height: z.number(),
  primary: z.boolean(),
  scale: z.number(),
  width: z.number(),
  x: z.number(),
  y: z.number(),
});

type Element = z.infer<typeof ElementSchema>;

interface Result {
  readonly check: string;
  readonly ok: boolean;
  readonly detail: string;
}

const results: Result[] = [];

const record = (check: string, ok: boolean, detail = "") => {
  results.push({ check, detail, ok });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${check}${detail ? `  (${detail})` : ""}`
  );
};

const helper = <T>(schema: z.ZodType<T>, ...args: string[]): T => {
  const { stdout } = spawnSync(path.join(bin, "helper.exe"), args, {
    encoding: "utf-8",
  });

  const value: unknown = JSON.parse(stdout.trim() === "" ? "null" : stdout);
  const failure = ErrorSchema.safeParse(value);

  if (failure.success) {
    throw new Error(`helper ${args[0]}: ${failure.data.error}`);
  }

  return schema.parse(value);
};

const Ok = z.unknown();

const appPid = () => String(app?.pid ?? 0);

const markerPid = () => String(markerProcess?.pid ?? 0);

const front = () => helper(WindowSchema, "fg");

/** The panel takes the keyboard while it is open, so only the marker and the app may receive keys. */
const allowed = () => `${markerPid()},${appPid()}`;

const keys = (chord: string) => helper(Ok, "keys", allowed(), chord);

const typeText = async (text: string) => {
  helper(Ok, "type", appPid(), text);
  await delay(150);
};

const shortcut = () => keys("ctrl+alt+p");

const move = (x: number, y: number) => helper(Ok, "move", String(x), String(y));

const click = (pids: string, x: number, y: number) =>
  helper(Ok, "click", pids, String(x), String(y));

const elements = (): Element[] =>
  helper(z.array(ElementSchema), "elements", appPid());

const windowText = () =>
  elements()
    .map((element) => element.name)
    .join(" ");

const windowShows = async (text: string, attempts = 10): Promise<boolean> => {
  if (windowText().includes(text)) {
    return true;
  }

  if (attempts <= 1) {
    return false;
  }

  await delay(400);

  return await windowShows(text, attempts - 1);
};

/** Buttons are matched by the start of their name, because Save's name includes its shortcut. */
const findButton = async (name: string, attempts = 10): Promise<Element> => {
  const hit = elements().find(
    (element) =>
      element.type === "Button" &&
      element.name.startsWith(name) &&
      element.x > 0
  );

  if (hit !== undefined) {
    return hit;
  }

  if (attempts <= 1) {
    throw new Error(`button not found: ${name}`);
  }

  await delay(400);

  return await findButton(name, attempts - 1);
};

const clickButton = async (name: string) => {
  const button = await findButton(name);

  click(appPid(), button.x, button.y);
};

const appWindows = () => helper(z.array(WindowSchema), "windows", appPid());

const shot = (
  name: string,
  area: { x: number; y: number; width: number; height: number }
) => {
  helper(
    Ok,
    "shot",
    path.join(shots, `${name}.png`),
    String(area.x),
    String(area.y),
    String(area.width),
    String(area.height)
  );
};

/** A screenshot of every visible app window, padded so the edges and shadow show. */
const shotApp = (name: string) => {
  for (const [index, window] of appWindows().entries()) {
    const pad = 24;

    shot(`${name}${index === 0 ? "" : `-${index}`}`, {
      height: window.height + pad * 2,
      width: window.width + pad * 2,
      x: window.x - pad,
      y: window.y - pad,
    });
  }
};

const events = (): AppEvent[] =>
  existsSync(logFile)
    ? readFileSync(logFile, "utf-8")
        .split("\n")
        .filter(Boolean)
        .map((line) => EventSchema.parse(JSON.parse(line)))
    : [];

const waitFor = async (
  name: string,
  after: number,
  deadline = Date.now() + 8000
): Promise<AppEvent | undefined> => {
  const hit = events()
    .slice(after)
    .find((e) => e.event === name);

  if (hit !== undefined || Date.now() > deadline) {
    return hit;
  }

  await delay(100);

  return await waitFor(name, after, deadline);
};

const savedCaptures = (dir = userData) => {
  const captures = path.join(dir, "captures");

  return existsSync(captures)
    ? readdirSync(captures).filter((name) => !name.startsWith("."))
    : [];
};

/** The host may run this inside Electron, whose ELECTRON_RUN_AS_NODE would start the app as plain Node. */
const appEnv = (extraEnv: Record<string, string>, dataDir: string) => {
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...inherited } = process.env;

  return {
    ...inherited,
    INSET_E2E_LOG: logFile,
    INSET_USER_DATA_DIR: dataDir,
    ...extraEnv,
  };
};

/** Every instance started, so a run that stops early still ends them all. */
const instances: ChildProcess[] = [];

// UI Automation sees web content once Chromium's accessibility is on.
const launch = (
  extraEnv: Record<string, string> = {},
  dataDir = userData
): ChildProcess => {
  const child = spawn(
    appExe,
    [...(mode === "packaged" ? [] : ["."]), "--force-renderer-accessibility"],
    { cwd: root, env: appEnv(extraEnv, dataDir), stdio: "ignore" }
  );

  instances.push(child);

  return child;
};

const exited = async (child: ChildProcess) => {
  if (child.exitCode !== null) {
    return true;
  }

  return await Promise.race([
    once(child, "exit").then(() => true),
    delay(8000, false),
  ]);
};

const markerWindow = () =>
  helper(z.array(WindowSchema), "windows", markerPid()).at(0);

const startMarker = async (at: typeof homeMarker) => {
  markerProcess?.kill();
  marker = at;
  markerProcess = spawn(
    path.join(bin, "marker.exe"),
    [String(at.x), String(at.y), String(at.size)],
    { stdio: "ignore" }
  );
  await delay(800);
};

const centre = () => ({
  x: marker.x + marker.size / 2,
  y: marker.y + marker.size / 2,
});

const focusMarker = async () => {
  const window = markerWindow();

  if (window !== undefined) {
    helper(Ok, "focus", String(window.hwnd));
  }

  click(markerPid(), centre().x, centre().y);
  await delay(300);
};

const markerInFront = () => String(front().pid) === markerPid();

const appInFront = () => String(front().pid) === appPid();

/** After a recorded focus failure, a person would click into the field; so does the run, to check the rest. */
const clickFieldIfUnfocused = async () => {
  if (appInFront()) {
    return;
  }

  const field = elements().find((element) => element.type === "Edit");

  if (field !== undefined) {
    click(appPid(), field.x, field.y);
    await delay(300);
  }
};

const openPanel = async (label: string) => {
  const before = events().length;

  move(centre().x, centre().y);
  shortcut();

  const shown = await waitFor("panelShown", before);

  const captured = events()
    .slice(before)
    .some((e) => e.event === "capture");

  record(`${label}: panel shown`, shown !== undefined);
  await delay(300);
  record(`${label}: panel has the keyboard`, appInFront(), front().title);
  await clickFieldIfUnfocused();

  return { captured, shown };
};

/** The pin pixel of a saved crop, read from the file. */
const inspectRecord = (captureId: string, dataDir = userData) => {
  const dir = path.join(dataDir, "captures", captureId);

  const stored = CaptureRecordV1Schema.parse(
    JSON.parse(readFileSync(path.join(dir, "capture.json"), "utf-8"))
  );

  const pixel = helper(
    RgbSchema.extend({ height: z.number(), width: z.number() }),
    "filepixel",
    path.join(dir, "crop.png"),
    String(stored.pin.x),
    String(stored.pin.y)
  );

  return {
    height: pixel.height,
    onMarker: pixel.r > 200 && pixel.g < 90 && pixel.b > 200,
    rgb: `rgb(${pixel.r},${pixel.g},${pixel.b})`,
    stored,
    width: pixel.width,
  };
};

/** The tray menu can take a moment to appear after the click. */
const menuItems = async (attempts = 10): Promise<Element[]> => {
  await delay(300);

  const items = helper(z.array(ElementSchema), "menu", appPid());

  return items.length > 0 || attempts <= 1
    ? items
    : await menuItems(attempts - 1);
};

const trayMenu = async () => {
  // The colon tells the tray icon's tooltip from a taskbar button named after an open window.
  const icon = helper(ElementSchema, "trayfind", "Inset Context Pin:");

  const owner = helper(
    z.object({ name: z.string(), pid: z.number() }),
    "pidat",
    String(icon.x),
    String(icon.y)
  );

  // The taskbar belongs to Explorer; the ^ overflow flyout sometimes to ShellExperienceHost.
  if (!["explorer", "shellexperiencehost"].includes(owner.name.toLowerCase())) {
    throw new Error(`tray icon is not owned by the shell: ${owner.name}`);
  }

  click(String(owner.pid), icon.x, icon.y);

  return await menuItems();
};

const trayItem = async (start: string) => {
  // One more click if the first one opened nothing, for example while the overflow was closing.
  const first = await trayMenu();
  const items = first.length > 0 ? first : await trayMenu();
  const item = items.find((candidate) => candidate.name.startsWith(start));

  if (item === undefined) {
    throw new Error(
      `tray item not found: ${start} in ${items.map((i) => i.name).join(" | ")}`
    );
  }

  click(appPid(), item.x, item.y);
};

/** The page title names the window, so it is told from the hidden panel by being the visible one. */
const libraryWindow = () => appWindows().at(0);

/** Before the first capture the library opens as a welcome; it is closed again before capturing. */
const checkFirstLaunch = async () => {
  const launched = await waitFor("launch", 0, Date.now() + 20_000);

  record("launch logged", launched !== undefined && app?.exitCode === null);
  record(
    "first launch opens the welcome",
    (await waitFor("libraryOpened", 0)) !== undefined
  );
  record(
    "the welcome says how to capture",
    await windowShows("Inset Context Pin is running"),
    windowText().replaceAll(/\s+/gu, " ").slice(0, 160)
  );
  await delay(500);
  shotApp("00-welcome");

  const welcome = libraryWindow();

  if (welcome !== undefined) {
    helper(Ok, "focus", String(welcome.hwnd));
  }

  const mark = events().length;

  keys("alt+f4");
  record(
    "Alt+F4 closes the welcome",
    (await waitFor("libraryClosed", mark)) !== undefined
  );
};

const checkLaterLaunch = async (mark: number) => {
  const launched = await waitFor("launch", mark, Date.now() + 20_000);

  record("relaunch logged", launched !== undefined);
  await delay(1500);
  record(
    "a launch with captures opens no window",
    launched?.windows === 0 &&
      !events()
        .slice(mark)
        .some((e) => e.event === "libraryOpened"),
    `windows=${launched?.windows}`
  );
  record(
    "a launch with captures leaves the marker in front",
    markerInFront(),
    front().title
  );
};

const checkFirstPanel = async () => {
  await focusMarker();

  const first = await openPanel("first invocation");
  const bounds = first.shown?.bounds;
  const point = centre();

  record("capture happened before panel", first.captured);
  record(
    "panel is small",
    bounds !== undefined &&
      bounds.width >= 300 &&
      bounds.width <= 440 &&
      bounds.height <= 640,
    JSON.stringify(bounds)
  );
  record(
    "panel does not cover the point",
    bounds !== undefined &&
      (point.x < bounds.x ||
        point.x > bounds.x + bounds.width ||
        point.y < bounds.y ||
        point.y > bounds.y + bounds.height)
  );
  record(
    "only the panel is visible",
    first.shown?.windows === 1,
    `windows=${first.shown?.windows}`
  );
  shotApp("01-panel-fresh");

  return first.shown?.draftId;
};

const checkDismissAndRestore = async (draftId: string | undefined) => {
  await typeText("Total ignores discount");

  let mark = events().length;

  keys("escape");
  record(
    "Escape hides panel",
    (await waitFor("panelHidden", mark)) !== undefined
  );
  await delay(400);
  record(
    "Escape gives the keyboard back to the app in front",
    markerInFront(),
    front().title
  );

  move(away.x, away.y);
  mark = events().length;
  shortcut();

  const restored = await waitFor("panelShown", mark);

  record(
    "reopen restores the same draft",
    restored?.draftId === draftId,
    `${restored?.draftId}`
  );
  record(
    "reopen does not recapture",
    !events()
      .slice(mark)
      .some((e) => e.event === "capture")
  );
  record(
    "reopened panel says the draft is unsaved",
    await windowShows("Unsaved draft from")
  );
  await delay(200);
  record("reopened panel has the keyboard", appInFront(), front().title);
  shotApp("02-panel-reopened");

  await typeText(" row");
  mark = events().length;
  click(markerPid(), centre().x, centre().y);
  record(
    "outside click hides panel",
    (await waitFor("panelHidden", mark)) !== undefined
  );
  await delay(400);
  record("outside click leaves the marker in front", markerInFront());
};

const checkSave = async () => {
  let mark = events().length;

  shortcut();
  await waitFor("panelShown", mark);
  await delay(300);
  mark = events().length;
  keys("ctrl+enter");
  record("Ctrl+Enter saves", (await waitFor("saved", mark)) !== undefined);
  record(
    "save hides panel",
    (await waitFor("panelHidden", mark)) !== undefined
  );
  record(
    "save opens no window",
    events()
      .slice(mark)
      .every((e) => e.windows <= 1)
  );
  await delay(400);
  record(
    "save gives the keyboard back to the app in front",
    markerInFront(),
    front().title
  );
};

const checkSavedRecord = (captureId: string | undefined) => {
  if (captureId === undefined || !savedCaptures().includes(captureId)) {
    record("record persisted", false, "none");

    return;
  }

  const { height, onMarker, rgb, stored, width } = inspectRecord(captureId);

  record("record persisted", true, captureId);
  record(
    "thought typed across two panel sessions",
    stored.thought === thought,
    JSON.stringify(stored.thought)
  );
  record(
    "crop is the default size",
    width === Math.round(DEFAULT_CROP_DIP.width * stored.image.pixelsPerDip) &&
      height ===
        Math.round(DEFAULT_CROP_DIP.height * stored.image.pixelsPerDip),
    `${width}x${height} @ ${stored.image.pixelsPerDip}x`
  );
  record("pin lands on the marker", onMarker, rgb);
};

const checkDiscard = async () => {
  await focusMarker();
  await openPanel("discard flow");
  await typeText("throwaway");

  const mark = events().length;

  await clickButton("Discard");
  await delay(300);
  shotApp("03-discard-armed");
  record(
    "Discard with a thought asks for a second click",
    (await waitFor("discarded", mark, Date.now() + 600)) === undefined
  );
  await clickButton("Click again to discard");
  record("Discard logged", (await waitFor("discarded", mark)) !== undefined);
  record(
    "Discard leaves no saved capture",
    savedCaptures().length === 1,
    `${savedCaptures().length} records`
  );
  await delay(400);
  record("Discard gives the keyboard back", markerInFront(), front().title);
};

const secondDisplay = () =>
  helper(z.array(DisplaySchema), "displays").find(
    (display) => !display.primary
  );

const checkSecondDisplay = async () => {
  const display = secondDisplay();

  if (display === undefined) {
    console.log("SKIP  second display: only one display is connected");

    return;
  }

  await startMarker({ size: 120, x: display.x + 400, y: display.y + 300 });
  await focusMarker();

  const { shown } = await openPanel("second display");
  const bounds = shown?.bounds;

  record(
    "panel opens on the second display",
    bounds !== undefined &&
      bounds.x >= display.x &&
      bounds.y >= display.y &&
      bounds.x + bounds.width <= display.x + display.width &&
      bounds.y + bounds.height <= display.y + display.height,
    JSON.stringify({ bounds, display })
  );
  shotApp("04-panel-second-display");
  await typeText("Second display detail");

  const mark = events().length;

  keys("ctrl+enter");

  const saved = await waitFor("saved", mark);

  if (saved?.draftId === undefined) {
    record("second display capture saves", false);
  } else {
    const { onMarker, rgb } = inspectRecord(saved.draftId);

    record("pin lands on the marker on the second display", onMarker, rgb);
  }

  await startMarker(homeMarker);
};

const checkFailedWrite = async () => {
  await focusMarker();
  await openPanel("failed write");
  await typeText("Retry me");

  let mark = events().length;

  keys("ctrl+enter");
  record(
    "failed write is reported",
    (await waitFor("saveFailed", mark)) !== undefined
  );
  await delay(400);
  shotApp("05-panel-save-failed");
  record(
    "panel stays open after failed write",
    !events()
      .slice(mark)
      .some((e) => e.event === "panelHidden")
  );
  mark = events().length;
  keys("ctrl+enter");
  record("retry saves", (await waitFor("saved", mark)) !== undefined);
};

const checkEdgeWiden = async () => {
  await startMarker(edgeMarker);
  await focusMarker();
  await openPanel("point near the screen edge");
  await typeText("Edge detail");
  await clickButton("Widen context");
  await delay(300);
  await clickButton("Widen context");
  await delay(300);
  shotApp("06-panel-widened");

  const mark = events().length;

  keys("ctrl+enter");

  const saved = await waitFor("saved", mark);

  if (saved?.draftId === undefined) {
    record("edge capture saves", false);
    await startMarker(homeMarker);

    return;
  }

  const { onMarker, rgb, stored } = inspectRecord(saved.draftId);

  record(
    "widening near the edge enlarges the crop",
    stored.image.widthPx > DEFAULT_CROP_DIP.width * stored.image.pixelsPerDip,
    `${stored.image.widthPx}x${stored.image.heightPx}`
  );
  record("pin stays on the edge detail after widening", onMarker, rgb);
  await startMarker(homeMarker);
};

const checkTrayFallback = async () => {
  await focusMarker();

  const mark = events().length;

  await trayItem("New capture in 3 seconds");
  move(centre().x, centre().y);

  const shown = await waitFor("panelShown", mark);

  record("tray fallback opens the panel after the delay", shown !== undefined);
  await delay(300);
  record("tray panel has the keyboard", appInFront(), front().title);
  await clickFieldIfUnfocused();
  await typeText("Via tray");
  keys("ctrl+enter");

  const saved = await waitFor("saved", mark);

  if (saved?.draftId === undefined) {
    record("tray fallback saves", false);

    return null;
  }

  const { onMarker, rgb, stored } = inspectRecord(saved.draftId);

  record(
    "tray capture is recorded as trayDelayed",
    stored.invokedVia === "trayDelayed",
    stored.invokedVia
  );
  record("tray capture pins the detail under the pointer", onMarker, rgb);

  return saved.draftId;
};

/** The library opens on the newest capture, which the tray check saved. */
const checkLibrary = async (newest: string | null) => {
  let mark = events().length;
  const again = launch();

  record("a second launch exits", await exited(again));
  record(
    "a second launch opens the library",
    (await waitFor("libraryOpened", mark)) !== undefined
  );
  await delay(1500);
  record("the library comes to the front", appInFront(), front().title);
  shotApp("07-library");
  record(
    "library lists the saved thought",
    await windowShows(thought),
    windowText().replaceAll(/\s+/gu, " ").slice(0, 160)
  );

  const window = libraryWindow();

  if (window !== undefined) {
    helper(Ok, "focus", String(window.hwnd));
  }

  await clickButton("Copy note");
  await delay(400);
  record(
    "Copy note puts the newest thought on the clipboard",
    helper(z.string().nullable(), "cliptext") === "Via tray"
  );

  await clickButton("Copy image");
  await delay(600);

  const copied = path.join(work, "copied.png");
  const image = helper(z.object({ ok: z.boolean() }), "clipimage", copied);

  if (!image.ok || newest === null) {
    record("Copy image puts a picture on the clipboard", false);
  } else {
    const { stored } = inspectRecord(newest);

    const pixel = helper(
      RgbSchema,
      "filepixel",
      copied,
      String(stored.pin.x),
      String(stored.pin.y)
    );

    const [r, g, b] = PIN_RGB;

    record(
      "the copied image carries the pin in its colour",
      Math.abs(pixel.r - r) <= 3 &&
        Math.abs(pixel.g - g) <= 3 &&
        Math.abs(pixel.b - b) <= 3,
      `rgb(${pixel.r},${pixel.g},${pixel.b})`
    );
  }

  mark = events().length;

  const current = libraryWindow();

  if (current !== undefined) {
    helper(Ok, "focus", String(current.hwnd));
  }

  keys("ctrl+w");
  record(
    "Ctrl+W closes the library",
    (await waitFor("libraryClosed", mark)) !== undefined
  );
};

const checkQuitWithDraft = async () => {
  await focusMarker();

  const draft = await openPanel("quit with draft");

  await typeText("Keep me");
  keys("escape");
  await delay(300);
  await trayItem("Quit Inset Context Pin");
  await delay(1000);
  record(
    "quit asks in the panel",
    await windowShows("Quit Inset Context Pin?"),
    windowText().replaceAll(/\s+/gu, " ").slice(0, 160)
  );
  record("the quit question has the keyboard", appInFront(), front().title);
  shotApp("08-quit-question");
  await clickButton("Cancel");
  await delay(800);
  record("quit Cancel keeps the app running", app?.exitCode === null);

  const latest = events().at(-1);

  record(
    "quit Cancel shows the same draft",
    latest?.event === "panelShown" && latest.draftId === draft.shown?.draftId
  );
  keys("escape");
  await delay(300);

  const count = savedCaptures().length;

  await trayItem("Quit Inset Context Pin");
  await delay(1000);
  await clickButton("Discard and quit");
  record("quit Discard exits", app !== undefined && (await exited(app)));
  record(
    "quit Discard saves nothing",
    savedCaptures().length === count,
    `${savedCaptures().length}`
  );
};

/** Another app holding the shortcut must not leave the user without a way to capture. */
const checkShortcutTaken = async () => {
  const holder = spawn(
    path.join(bin, "helper.exe"),
    ["holdhotkey", "ctrl+alt+p"],
    {
      stdio: ["ignore", "pipe", "ignore"],
    }
  );

  hotkeyHolder = holder;
  await once(holder.stdout, "data");

  const mark = events().length;

  app = launch({}, path.join(work, "userData-taken"));
  await waitFor("launch", mark, Date.now() + 20_000);
  await delay(1500);

  const primary = helper(z.array(DisplaySchema), "displays").find(
    (display) => display.primary
  );

  // Windows shows notifications in the bottom-right corner of the primary display.
  if (primary !== undefined) {
    shot("09-shortcut-taken-notification", {
      height: 400,
      width: 600,
      x: primary.x + primary.width - 600,
      y: primary.y + primary.height - 400,
    });
  }

  record(
    "the welcome warns that the shortcut is taken",
    await windowShows("is in use by another app")
  );
  shotApp("09-welcome-shortcut-taken");
  // The notification covers the ^ overflow, so a click on the pin would land on it.
  await delay(NOTIFICATION_GONE_MS);

  const items = await trayMenu();

  shotApp("10-tray-menu-shortcut-taken");
  record(
    "the tray menu says the shortcut is taken",
    items.some((item) => item.name.includes("is in use by another app")),
    items.map((item) => item.name).join(" | ")
  );
  keys("escape");
  await trayItem("Quit Inset Context Pin");
  record("quit without a draft exits", await exited(app));
  holder.kill();
};

const buildHelpers = () => {
  mkdirSync(bin, { recursive: true });
  mkdirSync(shots, { recursive: true });

  const framework = path.join(
    process.env.WINDIR ?? "C:\\Windows",
    "Microsoft.NET/Framework64/v4.0.30319"
  );

  const wpf = path.join(framework, "WPF");
  const csc = path.join(framework, "csc.exe");
  const forms = ["-r:System.Windows.Forms.dll", "-r:System.Drawing.dll"];

  execFileSync(csc, [
    "-nologo",
    "-optimize",
    `-out:${path.join(bin, "helper.exe")}`,
    ...forms,
    `-r:${path.join(wpf, "UIAutomationClient.dll")}`,
    `-r:${path.join(wpf, "UIAutomationTypes.dll")}`,
    `-r:${path.join(wpf, "WindowsBase.dll")}`,
    path.join(import.meta.dirname, "windows-helper.cs"),
  ]);
  execFileSync(csc, [
    "-nologo",
    "-optimize",
    "-target:winexe",
    `-out:${path.join(bin, "marker.exe")}`,
    ...forms,
    path.join(import.meta.dirname, "windows-marker.cs"),
  ]);
};

/** Another running copy would hold the shortcut, so every capture check would fail. */
const assertNoRunningInstance = () => {
  const running = spawnSync("tasklist", ["/fo", "csv", "/nh"], {
    encoding: "utf-8",
  })
    .stdout.split("\n")
    .filter((line) => line.startsWith('"Inset Context Pin.exe"'));

  if (running.length > 0) {
    throw new Error(
      "Quit the running Inset Context Pin first; it holds the shortcut."
    );
  }
};

const assertScaleOne = () => {
  const displays = helper(z.array(DisplaySchema), "displays");

  if (displays.some((display) => display.scale !== 1)) {
    throw new Error(
      `This script compares DIP with pixels 1:1, so every display must be at 100% scale: ${JSON.stringify(displays)}`
    );
  }
};

const saveClipboard = () => helper(z.string().nullable(), "cliptext");

/**
 * Other Inset prototypes are tested on the same machine, and two runs that
 * both move the pointer break each other. Whoever holds this directory drives
 * the mouse and keyboard; mkdir creates it only if it is absent.
 */
const desktopLock = path.join(tmpdir(), "inset-desktop-test.lock");
const lockOwner = path.join(desktopLock, "owner.txt");
const STALE_LOCK_MS = 15 * 60_000;
const LOCK_WAIT_MS = 30 * 60_000;
const LOCK_POLL_MS = 3000;

interface ProcessInfo {
  readonly pid: number;
  readonly parent: number;
  readonly name: string;
  readonly command: string;
}

const processes = (): ProcessInfo[] =>
  spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.Name) $($_.CommandLine)" }',
    ],
    { encoding: "utf-8" }
  )
    .stdout.split("\n")
    .map((line: string) => {
      const [pid = "0", parent = "0", name = "", ...command] = line
        .trim()
        .split(" ");

      return {
        command: command.join(" "),
        name,
        parent: Number(parent),
        pid: Number(pid),
      };
    });

/** This run and its parents, since a node shim such as Vite+'s starts it through other processes with the same command line. */
const ownLine = (all: readonly ProcessInfo[]): Set<number> => {
  const byPid = new Map(all.map((info) => [info.pid, info]));
  const own = new Set<number>();

  for (
    let current = byPid.get(process.pid);
    current !== undefined && !own.has(current.pid);
    current = byPid.get(current.parent)
  ) {
    own.add(current.pid);
  }

  return own;
};

/** Test runs of the other prototypes that predate the lock: node processes, found by their scripts' names. */
const otherHarnesses = (): string[] => {
  const all = processes();
  const own = ownLine(all);

  return all
    .filter(
      (info) =>
        info.name === "node.exe" &&
        !own.has(info.pid) &&
        /verify-(?:windows|macos)\.ts|driver\.mjs/u.test(info.command)
    )
    .map((info) => `${info.pid} ${info.command}`);
};

const tryLock = (): boolean => {
  try {
    mkdirSync(desktopLock);
  } catch {
    if (Date.now() - statSync(desktopLock).mtimeMs > STALE_LOCK_MS) {
      rmSync(desktopLock, { force: true, recursive: true });
    }

    return false;
  }

  writeFileSync(
    lockOwner,
    `inset-pin scripts/e2e/verify-windows.ts, pid ${process.pid}, since ${new Date().toISOString()}\n`
  );

  return true;
};

const takeDesktop = async (deadline = Date.now() + LOCK_WAIT_MS) => {
  if (otherHarnesses().length === 0 && tryLock()) {
    return;
  }

  if (Date.now() > deadline) {
    throw new Error("Another test kept the desktop for 30 minutes.");
  }

  const owner = existsSync(lockOwner)
    ? readFileSync(lockOwner, "utf-8").trim()
    : otherHarnesses().join("; ");

  console.log(`WAIT  desktop in use: ${owner}`);
  await delay(LOCK_POLL_MS);
  await takeDesktop(deadline);
};

const releaseDesktop = () => {
  rmSync(desktopLock, { force: true, recursive: true });
};

const main = async () => {
  if (process.platform !== "win32") {
    throw new Error("Run scripts/e2e/verify-macos.ts on macOS.");
  }

  assertNoRunningInstance();
  buildHelpers();
  assertScaleOne();

  if (mode === "dev") {
    execFileSync(
      process.execPath,
      [
        path.join(root, "node_modules/electron-vite/bin/electron-vite.js"),
        "build",
      ],
      { cwd: root, env: appEnv({}, userData), stdio: "ignore" }
    );
  }

  await takeDesktop();
  process.once("SIGINT", () => {
    releaseDesktop();
    process.exit(130);
  });

  const clipboard = saveClipboard();

  try {
    await startMarker(homeMarker);
    await focusMarker();
    app = launch();
    await checkFirstLaunch();

    const draftId = await checkFirstPanel();

    await checkDismissAndRestore(draftId);
    await checkSave();
    checkSavedRecord(draftId);
    await checkDiscard();
    await checkSecondDisplay();

    await trayItem("Quit Inset Context Pin");
    record("tray Quit exits without a draft", await exited(app));

    const mark = events().length;

    await focusMarker();
    app = launch({ INSET_FAIL_NEXT_WRITE: "1" });
    await checkLaterLaunch(mark);
    record("records survive a restart", savedCaptures().length === 2);
    await checkFailedWrite();
    await checkEdgeWiden();
    const newest = await checkTrayFallback();

    markerProcess?.kill();
    await checkLibrary(newest);
    await startMarker(homeMarker);
    await checkQuitWithDraft();
    await checkShortcutTaken();
  } catch (error) {
    record("run finished", false, String(error));
  } finally {
    markerProcess?.kill();

    for (const child of instances) {
      child.kill();
    }

    hotkeyHolder?.kill();
    helper(Ok, "setcliptext", clipboard ?? "");
    releaseDesktop();
  }

  writeFileSync(
    path.join(work, "results.json"),
    JSON.stringify({ events: events(), mode, results }, null, 2)
  );
  console.log(
    `\n${results.filter((r) => r.ok).length}/${results.length} passed. Artifacts: ${work}`
  );
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
};

await main();
