# Implementation report

This report covers Inset Context Pin version 0.1.0 as of 21 October 2026. It records what the prototype implements, what was tested and on which system, and what remains open. No user test has run yet, so the user-test sections are empty on purpose.

## What the prototype does

Inset Context Pin runs as a menu-bar or tray utility with no window at launch. `CommandOrControl+Alt+P` samples the pointer position and captures that display before any Inset window appears. A 380 DIP wide panel then opens beside the point with a crop preview, a pin on the sampled point, and the **What matters here?** field. Saving writes the approved crop, the pin relative to that crop, the thought, and the capture time, then hides the panel. Escape and an outside click hide the panel and keep the draft in memory. **Discard** clears it.

**Recent captures…** in the tray menu opens a separate library window. It uses TanStack Router with hash history on `/` and `/captures/$captureId`. The detail page supports editing the thought, deletion, **Copy note**, **Copy image**, and native file drag of the crop.

## Architecture in brief

- The main process owns the draft as a pure reducer (`src/main/draft.ts`). The state combines the phase, panel visibility, write status, and quit status. Window visibility and the renderer view derive from that state. The renderer is the only writer of the draft content and sends the full content on every change, so main always holds the latest text at blur, quit, or a renderer crash.
- Pin and crop live in full-image pixels (`src/shared/geometry.ts`). Widening the crop never moves the pin. The pin relative to the crop is computed only when the record is written.
- The store (`src/main/store.ts`) writes each capture into a staging folder and publishes it with one directory rename. Writes go through one queue. Records with an unknown `schemaVersion` or invalid content are read-only. The store never rewrites or deletes them.
- IPC uses one contract per window (`src/shared/contracts.ts`). The contract defines the channel names, the Zod input schemas, the preload bridge, and the required main handlers, so these cannot drift apart. Main accepts a message only from the expected window's main frame at the app origin.
- The privileged `inset://` scheme serves the app bundle, the current draft preview, and saved crops. It serves a saved crop only for a valid capture ID that the store knows. It rejects queries, extra path segments, and dot segments.
- The renderers run with context isolation and the sandbox on and Node integration off. The CSP blocks other origins, and navigation, popups, and permission requests are denied.

## Design choices under test

The experiment should record these choices next to its findings, because each one can change what a participant experiences.

| Choice | Value | Where |
| --- | --- | --- |
| Default crop around the point | 480 × 300 DIP of context | `DEFAULT_CROP_DIP` in `src/shared/geometry.ts` |
| Smallest crop after **Tighten** | 160 × 100 DIP | `MIN_CROP_DIP` |
| **Widen context** step | Each side × √2, so one click doubles the area | `WIDEN_STEP` |
| Panel width | 380 DIP, height from content | `POPOVER_WIDTH_DIP` |
| Panel placement | Right of the point with a 16 DIP gap, else left, clamped to the work area | `placePopover` |
| Pin nudge | Arrow keys move 1 DIP, Shift moves 10 DIP | `src/renderer/capture/pin-preview.tsx` |
| Save requires text | A thought must contain a non-blank character | `canSaveThought` in `src/shared/capture-record.ts` |
| Shortcut while the panel is open | Focuses the panel. It does not toggle it closed. | `step` in `src/main/draft.ts` |
| Tray fallback | **New capture in 3 seconds** samples the pointer after 3 s | `TRAY_CAPTURE_DELAY_MS` |
| Quit with a savable draft | Native dialog with **Save**, **Discard**, and **Cancel** | `src/main/surface.ts` |
| Failed save while hidden | Notification and a tray item **Show unsaved draft (save failed)**. The panel does not reopen by itself. | `src/main/tray-menu.ts` |
| Source label | The display name only, such as "Built-in Retina Display". No app, file, or URL. | `src/main/capture.ts` |
| Fallback condition | Each record stores `invokedVia` as `shortcut` or `trayDelayed` | `CaptureRecordV1Schema` |

## What was tested

### Test system

- macOS 27.0.1 (build 26A434) on Apple silicon (arm64), Electron 45.0.0.
- Capability spike: an external 3440 × 1440 display at scale 1 with origin (0, 0), and the built-in display at 1800 × 1169 DIP, scale 2, with origin (3440, 728).
- Desktop runs: the built-in display alone at 1800 × 1169 DIP, scale 2, origin (0, 0). The external display was disconnected by then.

### Capture and coordinate mapping (capability spike)

A throwaway Electron script placed a magenta window under a known point on each display and mapped the point into the captured image. The mapped pixel was magenta on both displays. That covered scale 1 and scale 2, and a display with a non-zero origin. The spike also showed these facts, which the implementation relies on:

- `desktopCapturer.getSources` returns every screen, each scaled to fit the requested size. The app therefore requests the target display at `bounds × scaleFactor`, picks the source by exact `display_id`, and maps with the real image size.
- Visible Electron windows appear in a capture. The panel is therefore hidden before every capture, by construction of the reducer.
- One full-resolution capture took 84 to 140 ms in single observations. This is not a benchmark.

Negative display origins were not available physically. Unit tests cover them with literal expected values.

### Automated tests

`pnpm test` runs 129 Vitest tests in 9 files. They cover:

- Coordinate conversion with negative origins, mixed scale, and image sizes that differ from `bounds × scaleFactor`.
- Default crop, widen, and tighten near image edges, with the pin staying on the same image pixel.
- Draft lifecycle sequences in the reducer: dismiss and restore keep the draft ID, capture time, pin, and text, and reopening never captures again.
- Explicit discard leaves no record. A failed write keeps the draft, and a retry saves it under the same ID.
- The store, using a real temporary folder with injected failures on each write and rename. A failed publish leaves no partial capture. An unknown schema version stays byte-identical through an attempted edit and delete.
- URL parsing, IPC sender and input validation, the tray menu, and the library view mapping.

### Real desktop runs (macOS, dev build)

`scripts/e2e/verify-macos.ts dev` drove the built app from outside with real key presses and pointer events. It read real window bounds from the app's event log and checked the saved files. The last run passed 47 of 47 checks:

- Launch opens no window and does not take focus.
- The shortcut captures before the panel appears. The panel was 380 × 414 DIP at (1216, 562), beside the point and not covering it. It was the only visible Inset window.
- Escape hides the panel and focus returns to the app that was in front. Reopening with the pointer elsewhere restores the same draft without a new capture.
- An outside click hides the panel and keeps the draft.
- `⌘↩` saves, hides the panel, opens no other window, and returns focus to the app that was in front.
- The saved `capture.json` held the text typed across two panel sessions. The `crop.png` pixel at the stored pin was magenta, so the pin sat on the detail under the pointer. The crop was 960 × 600 px, which is 480 × 300 DIP at scale 2.
- **Discard** saves nothing.
- The record survives an app restart.
- A forced write failure keeps the panel open with the draft. A retry saves it.
- **Recent captures…** opens the library only on request, and it lists the saved thought after the restart. `⌘W` closes it.
- Quit with a draft shows the dialog. **Cancel** keeps the app and shows the same draft. **Discard** quits and saves nothing.
- With the marker 60 DIP from the left screen edge, two clicks on **Widen context** grew the crop to 1921 × 1201 px. The pin pixel was still on the marker.
- **New capture in 3 seconds** from the tray opened the panel at the pointer after the delay. The record stored `invokedVia: "trayDelayed"`, and its pin pixel was on the marker.
- The marker app was quit before the library check, and the library still listed the saved thought.

The desktop runs found two app defects, both fixed. `⌘W` did not close the library window. Content protection on the panel and the library hid both from screenshots and screen recordings, which the expo needs. The panel is hidden before every capture regardless, so the protection was removed.

### Code review

Two independent reviews (Claude Opus and GPT Sol) read the full diff against the brief. They found no high-severity issue. These medium and low findings were fixed and have tests where a test is possible:

- A failed start (for example an unwritable captures folder) now shows an error that names the folder and exits, instead of leaving an invisible process that holds the instance lock.
- The panel stays inside the work area when its original display is gone.
- While the quit dialog is open, the panel's own Save and Discard are ignored, and a save in progress finishes before the app quits.
- The library locks the thought editor while it saves, and the "Thought saved." status stays visible.
- A retried save adopts an existing record only when it holds the same capture.
- The store syncs the `captures` folder after publishing a capture.
- The crop preview measures the width it actually has.

### Packaged app (macOS)

`electron-builder --mac --dir --arm64` produced an ad-hoc signed app (`codesign` reports `Signature=adhoc`, identifier `ch.inset.prototype.contextpin`). The asar contains only the built `out/` files and `package.json`, with no `node_modules`.

`scripts/e2e/verify-macos.ts packaged` ran the same 47 checks against `release/mac-arm64/Inset Context Pin.app` and passed all of them. Focus return was observed with a separate marker app in front: focus went from the marker to the panel and back to the marker after Escape and after save.

A packaged app that the harness launches inherits screen access from the terminal host. The first-run grant of a downloaded app is therefore still untested (see below).

### Continuous integration

The first CI run on pull request #1 passed all four jobs: lint, typecheck, tests, and build on Ubuntu, then packaging on macOS and Windows runners. It produced `inset-context-pin-0.1.0-mac-arm64.dmg`, `-mac-x64.dmg`, and the matching zip files, plus `-win-x64.exe`, `-win-x64.zip`, and `-win-arm64.zip`. That run skipped code signing because electron-builder skips it for pull requests by default. CI now sets `CSC_FOR_PULL_REQUEST` so that pull request builds are ad-hoc signed like local builds.

`release.yml` has not run yet. Its first run happens when a commit reaches `main`.

## What was not tested

- **Windows.** CI builds the NSIS installer and the zip files, but nobody has started the app on Windows. Capture, the tray, focus return, mixed DPI, and the shortcut are all untested there. A generated installer is not evidence that capture works.
- **Intel Macs.** The x64 macOS build is produced but was not run.
- **A second display during the desktop runs.** The pin-to-pixel check ran on the built-in display only. The spike covered two displays with mixed scale, but the full panel flow did not.
- **Negative display origins** on real hardware.
- **Permission refusal and the first-run grant.** The app shows a panel with **Open System Settings** and **Quit and Reopen** when macOS reports that screen access is missing. This path was not observed. Every test run launched the app from a terminal host that already had screen access, and macOS attributes the grant to that host. A packaged app opened from Finder asks for its own grant, and that first run is untested.
- **Shortcut conflict detection does not work across apps on macOS.** `scripts/e2e/hotkey-holder.swift` registered `⌥⌘P` through Carbon in a separate process. Electron's `globalShortcut.register` still returned true, so the tray kept showing "Capture under pointer: ⌥⌘P" instead of the conflict notice. The tray item **New capture in 3 seconds** is always present and was verified, so a participant whose shortcut is taken still has a working entry. The conflict notice appears only when Electron itself reports a failure.
- **Copy image and file drag into a real receiving app.** Both are implemented and not verified with a receiving application.
- **Screen readers.** The panel has labels and keyboard paths, but no screen reader test ran.
- **The problem panel followed by a new capture.** When the problem panel is visible and the user presses the shortcut again, the app hides the panel and waits 150 ms before it captures. Whether that wait keeps the panel out of the image was not observed.
- **The startup error dialog.** The fix delegate saw the error message appear for an unwritable captures folder. Clicking OK, the exit code, and a working relaunch afterwards were not observed.

## Limitations and how they affect the experiment

- **Unsigned builds.** macOS and Windows both warn on first launch, and macOS needs **Open Anyway** in System Settings. Count this as setup effort in a session, separate from routine capture effort, as `TEST_PROTOCOL.md` asks.
- **Screen access on macOS.** The packaged app needs its own **Screen & System Audio Recording** grant and a restart. Plan this before a session.
- **No source identity.** The record names the display, not the app, document, or URL. A participant must still type what the capture is about if it is not visible in the crop. This is the intended test of whether pointing replaces describing.
- **The crop is a still image.** It is not a live link into the source document. Closing the source app does not affect the saved capture.
- **The draft lives in memory.** If the app crashes or the user logs out, an unsaved draft is lost. The quit dialog protects only an explicit quit.
- **The full display image stays in memory** while a draft exists, so widening can reach the whole display without a new capture. On a 5K display that is about 59 MB of raw pixels (5120 × 2880 × 4 bytes), a calculation rather than a measurement.

## User test results

No session has run. Use `test-record-template.csv` from the brief package for raw observations, and keep this section empty until a real session produces results.
