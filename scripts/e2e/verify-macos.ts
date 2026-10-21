import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import { CaptureRecordV1Schema } from "../../src/shared/capture-record.ts";

const root = path.resolve(import.meta.dirname, "../..");
const mode = process.argv[2] === "packaged" ? "packaged" : "dev";

const packagedApp = path.join(
  root,
  "release/mac-arm64/Inset Context Pin.app/Contents/MacOS/Inset Context Pin"
);

const processName = mode === "packaged" ? "Inset Context Pin" : "Electron";
const work = mkdtempSync(path.join(tmpdir(), "inset-e2e-"));
const bin = path.join(work, "bin");
const userData = path.join(work, "userData");
const logFile = path.join(work, "events.jsonl");
const marker = { size: 160, x: 1200, y: 700 };
const markerBundleId = "ch.inset.e2e.marker";
const markerApp = path.join(bin, "marker.app");
const away = { x: 600, y: 400 };
const thought = "Total ignores discount row";

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

const osa = (...lines: string[]) =>
  execFileSync(
    "osascript",
    lines.flatMap((line) => ["-e", line]),
    { encoding: "utf-8" }
  ).trim();

const jxa = (source: string) =>
  execFileSync("osascript", ["-l", "JavaScript", "-e", source], {
    encoding: "utf-8",
  }).trim();

const systemEvents = (line: string) =>
  osa(`tell application "System Events" to ${line}`);

const frontmost = () =>
  systemEvents("get name of first process whose frontmost is true");

const shortcut = () =>
  systemEvents('keystroke "p" using {command down, option down}');

/** A non-activating panel takes keys while the previous app stays frontmost, so only these two are safe. */
const typeText = async (text: string) => {
  const front = frontmost();

  if (front !== "marker" && front !== processName) {
    throw new Error(`refusing to type while ${front} is frontmost`);
  }

  systemEvents(`keystroke "${text}"`);
  await delay(150);
};

const escape = () => systemEvents("key code 53");
const commandEnter = () => systemEvents("key code 36 using {command down}");

const closeWindow = () => systemEvents('keystroke "w" using {command down}');

const pointer = (action: "move" | "click", x: number, y: number) =>
  execFileSync(path.join(bin, "pointer"), [action, String(x), String(y)]);

const processElements = `Application("System Events").processes.byName(${JSON.stringify(processName)}).windows().flatMap((w) => w.entireContents())`;

const clickButton = (title: string) => {
  const [x = 0, y = 0] = jxa(`const hit = ${processElements}.find((e) => {
      try { return e.role() === "AXButton" && e.name() === ${JSON.stringify(title)}; } catch { return false; }
    });
    if (!hit) throw new Error("button not found");
    const [x, y] = hit.position(); const [w, h] = hit.size();
    Math.round(x + w / 2) + " " + Math.round(y + h / 2);`)
    .split(" ")
    .map(Number);

  pointer("click", x, y);
};

const windowText = () =>
  jxa(`${processElements}.map((e) => {
      try { return String(e.value() ?? "") + " " + String(e.name() ?? ""); } catch { return ""; }
    }).join(" ");`);

/** Chromium exposes web content to accessibility clients only after AXManualAccessibility is set. */
const enableWebAccessibility = () =>
  jxa(`const p = Application("System Events").processes.byName(${JSON.stringify(processName)});
    try { p.attributes.byName("AXManualAccessibility").value = true; } catch {}
    "ok";`);

const windowShows = async (text: string, attempts = 10): Promise<boolean> => {
  if (windowText().includes(text)) {
    return true;
  }

  if (attempts <= 1) {
    return false;
  }

  await delay(500);

  return await windowShows(text, attempts - 1);
};

const trayItem = (item: string) =>
  osa(
    `tell application "System Events" to tell process "${processName}" to click menu bar item 1 of menu bar 2`,
    "delay 0.4",
    `tell application "System Events" to tell process "${processName}" to click menu item "${item}" of menu 1 of menu bar item 1 of menu bar 2`
  );

const dialogButton = (title: string) =>
  osa(
    `tell application "System Events" to tell process "${processName}" to click button "${title}" of window 1`
  );

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

const savedCaptures = () => {
  const dir = path.join(userData, "captures");

  return existsSync(dir)
    ? readdirSync(dir).filter((name) => !name.startsWith("."))
    : [];
};

const launch = (extraEnv: Record<string, string> = {}): ChildProcess =>
  spawn(
    mode === "packaged"
      ? packagedApp
      : path.join(root, "node_modules/.bin/electron"),
    mode === "packaged" ? [] : ["."],
    {
      cwd: root,
      env: {
        ...process.env,
        INSET_E2E_LOG: logFile,
        INSET_USER_DATA_DIR: userData,
        ...extraEnv,
      },
      stdio: "ignore",
    }
  );

const exited = async (child: ChildProcess) => {
  if (child.exitCode !== null) {
    return true;
  }

  const outcome = await Promise.race([
    once(child, "exit").then(() => true),
    delay(8000, false),
  ]);

  return outcome;
};

const focusMarker = async () => {
  osa(`tell application id "${markerBundleId}" to activate`);
  pointer("click", marker.x, marker.y);
  await delay(300);
};

const openPanel = async (label: string) => {
  const before = events().length;

  pointer("move", marker.x, marker.y);
  shortcut();

  const shown = await waitFor("panelShown", before);

  const captured = events()
    .slice(before)
    .some((e) => e.event === "capture");

  record(`${label}: panel shown`, shown !== undefined);

  return { captured, shown };
};

const checkLaunch = async (app: ChildProcess, frontBefore: string) => {
  const launched = await waitFor("launch", 0, Date.now() + 15_000);

  await delay(500);
  record("launch logged", launched !== undefined && app.exitCode === null);
  record(
    "launch opens no window",
    launched?.windows === 0,
    `windows=${launched?.windows}`
  );
  record(
    "launch does not take focus",
    frontmost() === frontBefore,
    `${frontBefore} -> ${frontmost()}`
  );
};

const checkFirstPanel = async () => {
  await focusMarker();

  const workApp = frontmost();
  const first = await openPanel("first invocation");
  const bounds = first.shown?.bounds;

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
      (marker.x < bounds.x ||
        marker.x > bounds.x + bounds.width ||
        marker.y < bounds.y ||
        marker.y > bounds.y + bounds.height)
  );
  record(
    "only the panel is visible",
    first.shown?.windows === 1,
    `windows=${first.shown?.windows}`
  );

  return { draftId: first.shown?.draftId, workApp };
};

const checkDismissAndRestore = async ({
  draftId,
  workApp,
}: Awaited<ReturnType<typeof checkFirstPanel>>) => {
  await typeText("Total ignores discount");
  await delay(200);

  let mark = events().length;

  escape();
  record(
    "Escape hides panel",
    (await waitFor("panelHidden", mark)) !== undefined
  );
  await delay(400);
  record(
    "Escape returns focus to the app that was in front",
    frontmost() === workApp,
    `${workApp} -> ${frontmost()}`
  );

  pointer("move", away.x, away.y);
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

  await typeText(" row");
  await delay(200);
  mark = events().length;
  pointer("click", marker.x, marker.y);
  record(
    "outside click hides panel",
    (await waitFor("panelHidden", mark)) !== undefined
  );
  await delay(400);
  record(
    "outside click leaves foreign app frontmost",
    frontmost() === "marker",
    frontmost()
  );
};

const checkSave = async () => {
  let mark = events().length;

  shortcut();
  await waitFor("panelShown", mark);
  mark = events().length;
  commandEnter();
  record("Cmd+Enter saves", (await waitFor("saved", mark)) !== undefined);
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
    "save returns focus to the foreign app",
    frontmost() === "marker",
    frontmost()
  );
};

const checkSavedRecord = () => {
  const [captureId] = savedCaptures();

  if (captureId === undefined) {
    record("record persisted", false, "none");

    return;
  }

  const dir = path.join(userData, "captures", captureId);

  const stored = CaptureRecordV1Schema.parse(
    JSON.parse(readFileSync(path.join(dir, "capture.json"), "utf-8"))
  );

  const [width, height, red = 0, green = 255, blue = 0] = execFileSync(
    path.join(bin, "pixel"),
    [path.join(dir, "crop.png"), String(stored.pin.x), String(stored.pin.y)],
    { encoding: "utf-8" }
  )
    .trim()
    .split(" ")
    .map(Number);

  record("record persisted", true, captureId);
  record(
    "thought survived dismiss and restore",
    stored.thought === thought,
    JSON.stringify(stored.thought)
  );
  record(
    "crop size matches record",
    width === stored.image.widthPx && height === stored.image.heightPx,
    `${width}x${height} @ ${stored.image.pixelsPerDip}x`
  );
  record(
    "pin lands on the marker detail",
    red > 200 && green < 90 && blue > 200,
    `rgb(${red},${green},${blue})`
  );
};

const checkDiscard = async () => {
  await openPanel("discard flow");
  await typeText("throwaway");

  const mark = events().length;

  clickButton("Discard");
  record("Discard logged", (await waitFor("discarded", mark)) !== undefined);
  record(
    "Discard leaves no saved capture",
    savedCaptures().length === 1,
    `${savedCaptures().length} records`
  );
};

const checkFailedWrite = async () => {
  await openPanel("failed write");
  await typeText("Retry me");

  let mark = events().length;

  commandEnter();
  record(
    "failed write is reported",
    (await waitFor("saveFailed", mark)) !== undefined
  );
  record(
    "panel stays open after failed write",
    !events()
      .slice(mark)
      .some((e) => e.event === "panelHidden")
  );
  mark = events().length;
  commandEnter();
  record("retry saves", (await waitFor("saved", mark)) !== undefined);
  record(
    "two records after retry",
    savedCaptures().length === 2,
    `${savedCaptures().length}`
  );
};

const checkLibrary = async () => {
  let mark = events().length;

  trayItem("Recent captures…");
  record(
    "library opens on request",
    (await waitFor("libraryOpened", mark)) !== undefined
  );
  enableWebAccessibility();
  await delay(1500);
  record(
    "library lists the saved thought after restart",
    await windowShows(thought),
    windowText().replaceAll(/\s+/gu, " ").slice(0, 160)
  );
  mark = events().length;
  closeWindow();
  record(
    "Cmd+W closes the library",
    (await waitFor("libraryClosed", mark)) !== undefined
  );
};

const checkQuitWithDraft = async (app: ChildProcess) => {
  await focusMarker();

  const draft = await openPanel("quit with draft");

  await typeText("Keep me");
  await delay(200);
  escape();
  await delay(300);
  trayItem("Quit Inset Context Pin");
  await delay(1000);
  dialogButton("Cancel");
  await delay(800);
  record("quit Cancel keeps the app running", app.exitCode === null);

  const latest = events().at(-1);

  record(
    "quit Cancel shows the same draft",
    latest?.event === "panelShown" && latest.draftId === draft.shown?.draftId
  );
  escape();
  await delay(300);
  trayItem("Quit Inset Context Pin");
  await delay(1000);
  dialogButton("Discard");
  record("quit Discard exits", await exited(app));
  record(
    "quit Discard saves nothing",
    savedCaptures().length === 2,
    `${savedCaptures().length}`
  );
};

/** macOS only lets a bundled app become frontmost, so the marker gets a minimal bundle. */
const buildHelpers = () => {
  mkdirSync(path.join(markerApp, "Contents/MacOS"), { recursive: true });
  writeFileSync(
    path.join(markerApp, "Contents/Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${markerBundleId}</string>
<key>CFBundleName</key><string>marker</string>
<key>CFBundleExecutable</key><string>marker</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`
  );

  for (const [name, output] of [
    ["pointer", path.join(bin, "pointer")],
    ["marker", path.join(markerApp, "Contents/MacOS/marker")],
    ["pixel", path.join(bin, "pixel")],
  ] as const) {
    execFileSync("swiftc", [
      "-O",
      path.join(import.meta.dirname, `${name}.swift`),
      "-o",
      output,
    ]);
  }
};

const main = async () => {
  buildHelpers();

  if (mode === "dev") {
    execFileSync("pnpm", ["build"], { cwd: root, stdio: "ignore" });
  }

  const markerProcess = spawn(
    path.join(markerApp, "Contents/MacOS/marker"),
    [String(marker.x), String(marker.y), String(marker.size)],
    { stdio: "ignore" }
  );

  await delay(800);
  await focusMarker();

  const frontBefore = frontmost();
  let app = launch();

  await checkLaunch(app, frontBefore);

  await checkDismissAndRestore(await checkFirstPanel());
  await checkSave();
  checkSavedRecord();
  await checkDiscard();

  trayItem("Quit Inset Context Pin");
  record("tray Quit exits without a draft", await exited(app));

  const mark = events().length;

  app = launch({ INSET_FAIL_NEXT_WRITE: "1" });
  record(
    "relaunch logged",
    (await waitFor("launch", mark, Date.now() + 15_000)) !== undefined
  );
  record("record survives restart", savedCaptures().length === 1);
  await focusMarker();
  await checkFailedWrite();
  await checkLibrary();
  await checkQuitWithDraft(app);
  markerProcess.kill();

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
