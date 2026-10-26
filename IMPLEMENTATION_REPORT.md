# Implementation report

This report covers Inset Context Pin version 0.1.0 as of 26 October 2026. It records what the prototype implements, what was tested and on which system, and what remains open. No user test has run yet, so the user-test sections are empty on purpose.

## What the prototype does

On macOS Inset Context Pin is a regular app with a Dock icon, a menu bar of its own and a pin in the menu bar; Settings can drop the Dock icon or the pin. On Windows it is a tray utility. Until the first capture exists, it opens the library at launch as a welcome; after that it opens no window at launch. `CommandOrControl+Alt+P` samples the pointer position and captures that display before any Inset window appears. A 380 DIP wide panel then opens beside the point with a crop preview, a pin on the sampled point, and the **What matters here?** field. Saving writes the approved crop, the pin relative to that crop, the thought, and the capture time, then hides the panel. Escape and an outside click hide the panel and keep the draft in memory. **Discard** clears it. Quitting with an unsaved thought shows the panel, which asks whether to save first.

**Recent captures…** in the tray menu, a click on the Dock icon, **File > Show Library** or a capture named in the tray or Dock menu opens a separate library window. It uses TanStack Router with hash history on `/` and `/captures/$captureId`. The detail page supports editing the thought, deletion, **Copy note**, **Copy image**, **Pin**, and native file drag of the crop. **Pin** keeps the capture in a small window above other apps. **Settings…** sets Open at Login, where the app's icon shows, and Copy after saving.

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
| Smallest crop | 160 × 100 DIP, after **Tighten**, a pinch or dragging an edge | `MIN_CROP_DIP` |
| **Widen context** step | Each side × √2, so one click doubles the area | `WIDEN_STEP` |
| Panel width | 380 DIP, height from content | `POPOVER_WIDTH_DIP` |
| Panel placement | Right of the point with a 16 DIP gap, else left, clamped to the work area | `placePopover` |
| Pin nudge | Arrow keys move 1 DIP, Shift moves 10 DIP | `src/renderer/capture/pin-preview.tsx` |
| Pin mark | A hollow ring with a centre dot, so the detail under it stays readable | `.pin-marker` in `src/renderer/styles.css` |
| Pinch over the preview | A trackpad pinch (ctrl+wheel) scales the crop about the pin continuously; 120 units of wheel delta double or halve its width | `usePinch`, `PINCH_DOUBLING_DELTA` in `src/renderer/capture/pin-preview.tsx` |
| Editing the crop | The preview shows the crop as a frame at 78 % of a fixed 356 × 220 box, with the screen around it dimmed. Dragging the frame moves it, dragging a corner or an edge crops (any shape), and a click or a drag on the pin moves the pin. The frame stops at the image edge, at the pin and at the smallest crop. The view holds still during a drag and settles on the new crop after it. | `PinPreview`, `fitView`, `moveCrop`, `resizeCrop` |
| Reopened draft | The panel says **Unsaved draft from** with the capture time and asks to save or discard before capturing something new | `reopened` in `viewOf`, `src/main/draft.ts` |
| Discard with text | Asks **Click again to discard**. A second click within 4 s discards, and Escape takes the question back. An empty draft discards at once. | `useArmedDiscard` in `src/renderer/capture/draft-editor.tsx` |
| Save requires text | A thought must contain a non-blank character | `canSaveThought` in `src/shared/capture-record.ts` |
| Shortcut while the panel is open | Focuses the panel. It does not toggle it closed. | `step` in `src/main/draft.ts` |
| Tray fallback | **New capture in 3 seconds** samples the pointer after 3 s | `TRAY_CAPTURE_DELAY_MS` |
| Quit with a savable draft | The panel opens and asks **Quit Inset Context Pin?** with **Save and quit**, **Discard and quit**, and **Cancel**, instead of a system dialog. `Escape` cancels and the save shortcut saves. | `QuitQuestion` in `src/renderer/capture/draft-editor.tsx` |
| First launch | While no capture exists, the library opens at launch as a welcome: one line on how to capture that doubles as the practice line, where to find the window again, and a warning when the shortcut is taken. The first saved capture replaces it. | `Welcome` in `src/renderer/library/welcome.tsx`, `start` in `src/main/index.ts` |
| Starting the app again | Opens the library, so a second start never looks like nothing happened | `second-instance` in `src/main/index.ts` |
| Tray icon on Windows | A white pin on a dark taskbar and a black pin on a light one, following the taskbar's own theme | `trayIconPath` in `src/main/index.ts` |
| Panel corners on Windows | The panel window is transparent and draws 22 px corners, the preview's 10 px plus the 12 px padding, with a 1 px border instead of the system frame and shadow. macOS keeps its system corners. | `.capture-surface` in `src/renderer/styles.css`, `src/main/surface.ts` |
| Library window on Windows | Only the caption buttons, drawn over the page; no title bar, icon or window name. `Ctrl+W` closes it and `Ctrl+,` opens Settings, like `⌘W` and `⌘,` on macOS. **Keep library on top** in the tray menu stands in for the View menu's item. | `src/main/library-window.ts`, `handleMenuKeys` in `src/renderer/shared/keys.ts`, `src/main/tray-menu.ts` |
| Failed save while hidden | Notification and a tray item **Show unsaved draft (save failed)**. The panel does not reopen by itself. | `src/main/tray-menu.ts` |
| Source label | The display name only, such as "Built-in Retina Display". No app, file, or URL. | `src/main/capture.ts` |
| Fallback condition | Each record stores `invokedVia` as `shortcut` or `trayDelayed` | `CaptureRecordV1Schema` |
| Library on open | Two panes from 768 px wide, opening the newest capture. Narrower windows show one pane at a time. | `src/renderer/library/router.tsx` |
| List thumbnails | One 8:5 box per row, like a row that can't be shown. A wider or taller crop sits whole inside it, with the pin on the image. | `Thumbnail` in `src/renderer/library/saved-image.tsx` |
| Exported image | **Copy image** and file drag carry the pin, drawn into the PNG. The stored `crop.png` stays without it. | `drawPinMark` in `src/main/pin-mark.ts` |
| Dragged file name | The thought's first line, made safe for a file name. The named copy waits in the system temp folder under `Inset Context Pin/<id>`, is removed when the capture is deleted, and the folder is cleared at every launch. | `exportFileName` in `src/main/library-view.ts`, `src/main/library-window.ts` |
| Library keys and menu | `Enter` edits, `Backspace` or `Delete` asks to delete, `⇧⌘C` (Ctrl+Shift+C) copies the image, `⌘P` (Ctrl+P) pins it to the screen, and the copy command (`⌘C`, Ctrl+C, Edit > Copy) copies the note when no text is selected. A right-click on a row selects it and offers the same five commands. On macOS the **Capture** menu lists them with their keys, enabled only while the library has the keyboard. There is no page zoom, because all windows share one origin and it would also zoom the capture panel. | `useCaptureShortcuts` in `src/renderer/library/capture-commands.tsx`, `RowMenu` in `src/renderer/library/recent-list.tsx`, `src/main/app-menu.ts` |
| App identity | macOS: a Dock icon, a menu bar (File, Edit, Capture, View, Window, Help) and the pin in the menu bar, by default. Settings can show the Dock icon only, or the pin only, which makes the app an accessory without its own menu bar. A click on the Dock icon opens the library. Windows: the tray pin only. | `placeIcon` in `src/main/index.ts`, `src/main/app-menu.ts` |
| Settings | A small window like a Mac app's Settings, with the sidebar material on macOS: Open at Login, Show app icon in, Copy after saving. Kept in `settings.json` next to the captures folder. | `src/main/settings-window.ts`, `src/shared/settings.ts` |
| Copy after saving | Off by default. When on, every saved capture puts the image with its pin and the thought on the clipboard, as one item. | `copyBoth` in `src/main/capture-export.ts` |
| Recent captures in menus | The tray menu and the Dock menu name the five newest captures, cut to 40 characters; one opens the library on it. | `RECENT_IN_MENU` in `src/main/tray-menu.ts` |
| Pin to Screen | `⌘P` (Ctrl+P), **Pin**, the row menu or **Capture > Pin to Screen** opens the capture in a frameless window at the crop's own size, at most 420 × 320 DIP and at least 120 DIP wide, at the top right of the screen under the pointer. It floats above other apps on every Space and full-screen app, shows the thought on the image, and keeps its shape when resized. A click shows **Close**, **Copy image** and **Show in library**; `Escape` closes it, and so does `⌘W` (`Ctrl+W`). Deleting the capture closes it. On Windows the window resizes freely and snaps to the crop's shape when the resize ends, while the page letterboxes the crop; a right-click shows the same three commands instead of the system's window menu. Pins are on screen like any window, so they appear in new captures. | `src/main/pin-windows.ts`, `fitToCrop` in `src/main/pin-size.ts`, `src/renderer/pin/pin-app.tsx` |
| Library window on macOS | The traffic lights sit over the list, which shows the window's translucent sidebar material; the capture keeps the page background. **View > Keep Library on Top** floats it. | `src/main/library-window.ts` |
| Leaving an edited thought | Choosing another capture with an unsaved change asks **Keep editing**, **Discard** or **Save**; ⌘↩ (Ctrl+Enter) saves and goes on to the chosen capture. Arrow keys inside the editor never move through the list. | `useBlocker` in `src/renderer/library/capture-page.tsx` |

## What was tested

### Test system

- macOS 27.0.1 (build 26A434) on Apple silicon (arm64), Electron 45.0.0.
- Capability spike: an external 3440 × 1440 display at scale 1 with origin (0, 0), and the built-in display at 1800 × 1169 DIP, scale 2, with origin (3440, 728).
- First desktop runs: the built-in display alone at 1800 × 1169 DIP, scale 2, origin (0, 0).
- Desktop runs after the UX iteration (22 October 2026): the external Dell U3425WE at scale 1 was connected again. The edge capture came from it, so the edge check ran at scale 1.

### Capture and coordinate mapping (capability spike)

A throwaway Electron script placed a magenta window under a known point on each display and mapped the point into the captured image. The mapped pixel was magenta on both displays. That covered scale 1 and scale 2, and a display with a non-zero origin. The spike also showed these facts, which the implementation relies on:

- `desktopCapturer.getSources` returns every screen, each scaled to fit the requested size. The app therefore requests the target display at `bounds × scaleFactor`, picks the source by exact `display_id`, and maps with the real image size.
- Visible Electron windows appear in a capture. The panel is therefore hidden before every capture, by construction of the reducer.
- One full-resolution capture took 84 to 140 ms in single observations. This is not a benchmark.

Negative display origins were not available physically. Unit tests cover them with literal expected values.

### Automated tests

`pnpm test` runs 186 Vitest tests in 16 files. They cover:

- Coordinate conversion with negative origins, mixed scale, and image sizes that differ from `bounds × scaleFactor`.
- Default crop, widen, and tighten near image edges, with the pin staying on the same image pixel.
- Draft lifecycle sequences in the reducer: dismiss and restore keep the draft ID, capture time, pin, and text, and reopening never captures again.
- Explicit discard leaves no record. A failed write keeps the draft, and a retry saves it under the same ID.
- The store, using a real temporary folder with injected failures on each write and rename. A failed publish leaves no partial capture. An unknown schema version stays byte-identical through an attempted edit and delete.
- URL parsing, IPC sender and input validation, the tray menu, and the library view mapping.
- The pin drawn into exported images (colour and byte order, the readable centre, edges), the exported file name, the reopened-draft flag, and the library's search, day grouping and keyboard selection.
- Moving and resizing the crop (image edges, the pin, the smallest crop) and fitting the preview view around it.
- The settings file, the app menu, the recent captures in the tray and Dock menus, the size of a pinned capture, and IPC served to several windows of one kind.
- A pin's snap to the crop's shape after a resize, ampersands in the menus' capture names, and **Keep library on top** in the Windows tray menu.

### Real desktop runs (macOS, dev build)

`scripts/e2e/verify-macos.ts dev` drove the built app from outside with real key presses and pointer events. It read real window bounds from the app's event log and checked the saved files. The last run passed 49 of 49 checks:

- Launch opens no window and does not take focus.
- The shortcut captures before the panel appears. The panel was 380 × 414 DIP at (1216, 562), beside the point and not covering it. It was the only visible Inset window.
- Escape hides the panel and focus returns to the app that was in front. Reopening with the pointer elsewhere restores the same draft without a new capture, and the panel says **Unsaved draft from**.
- An outside click hides the panel and keeps the draft.
- `⌘↩` saves, hides the panel, opens no other window, and returns focus to the app that was in front.
- The saved `capture.json` held the text typed across two panel sessions. The `crop.png` pixel at the stored pin was magenta, so the pin sat on the detail under the pointer. The crop was 960 × 600 px, which is 480 × 300 DIP at scale 2.
- **Discard** with text asks for a second click, and **Click again to discard** then saves nothing.
- The record survives an app restart.
- A forced write failure keeps the panel open with the draft. A retry saves it.
- **Recent captures…** opens the library only on request, and it lists the saved thought after the restart. `⌘W` closes it.
- Quit with a draft shows the dialog. **Cancel** keeps the app and shows the same draft. **Discard** quits and saves nothing.
- With the marker 60 DIP from the left screen edge, two clicks on **Widen context** grew the crop. On the built-in display at scale 2 it grew to 1921 × 1201 px. In the latest run, on the external display at scale 1, it grew to 960 × 600 px, double the default 480 × 300. The pin pixel was still on the marker both times. The check first assumed scale 2 and now compares against the default crop at the record's own scale.
- **New capture in 3 seconds** from the tray opened the panel at the pointer after the delay. The record stored `invokedVia: "trayDelayed"`, and its pin pixel was on the marker.
- The marker app was quit before the library check, and the library still listed the saved thought.

The desktop runs found two app defects, both fixed. `⌘W` did not close the library window. Content protection on the panel and the library hid both from screenshots and screen recordings, which the expo needs. The panel is hidden before every capture regardless, so the protection was removed.

### Real desktop runs (Windows)

These runs happened on 23 October 2026, after the second UX pass described further down.

Test system:

- Windows 11 Enterprise 10.0.26100, x64, Electron 45.0.0, a Swiss German keyboard, dark mode for apps and the taskbar.
- Two displays at 100% scale: the primary at 1920 × 1080 with origin (0, 0), and a second one below it at 1920 × 1200 with origin (4, 1080).

`scripts/e2e/verify-windows.ts dev` drove the built app from outside with real key presses and pointer events, like the macOS script. The fifth dev run passed all 72 checks:

- First launch opens the welcome, which names the three steps, and `Alt+F4` closes it. A later launch with captures opens no window and leaves the marker in front.
- The shortcut captures before the panel appears. The panel was 380 × 416 DIP at (346, 501), 16 DIP right of the point, and it had the keyboard.
- `Escape`, an outside click, a save and **Discard** each gave the keyboard back to the marker window that was in front.
- Reopening restores the same draft without a new capture, says **Unsaved draft from**, and takes the keyboard. The saved thought held the text typed across both panel sessions.
- The crop was 480 × 300 px at scale 1, and the pixel under the stored pin was magenta.
- On the second display, the panel opened inside that display at (480, 1301), and the pin pixel was magenta. This covers the second display and the non-zero origin that the macOS runs left open.
- With the marker 60 DIP from the left edge, two clicks on **Widen context** grew the crop to 960 × 600 px with the pin still on the marker.
- A forced write failure kept the panel open with the draft, and the retry saved it.
- **New capture in 3 seconds** from the tray, reached through the `^` overflow where Windows put the icon, opened the panel at the pointer with the keyboard. The record stored `invokedVia: "trayDelayed"`.
- Starting the app a second time opened the library in front. It listed the saved thoughts. **Copy note** put the newest thought on the clipboard.
- **Copy image** put the crop on the clipboard with the pin at rgb(0, 132, 209), the exact pin colour. So the BGRA order that the drawing code assumes holds on Windows too.
- `Ctrl+W` closed the library.
- Quit from the tray with a draft showed the question in the panel, with the keyboard. **Cancel** kept the app and the same draft. **Discard and quit** quit and saved nothing.
- With another process holding `Ctrl+Alt+P` through `RegisterHotKey`, Electron reported the failure, unlike on macOS. The welcome showed the warning, the tray item read "Ctrl+Alt+P is in use by another app", and a Windows notification appeared. In the dev build the notification names "Electron" as its sender.

The four earlier dev runs failed only in the harness or through outside interference: a tray lookup that missed the space Windows puts in front of some overflow names, the helper's console code page breaking its JSON, the user's pointer moving mid-run, and a notification covering the overflow. Each was fixed in the script, and the run that followed passed those steps.

The unpacked app (`pnpm package:dir`, then `verify-windows.ts packaged`) has no complete run either. The last attempt passed 67 checks in one run, from the welcome to **Cancel** in the quit question, including the second display, the tray fallback, the copied pin colour and the second start. It stopped when a PDF-XChange Editor window opened over the tray, and the harness refused to click it. The checks it did not reach, **Discard and quit** and the shortcut conflict, passed in the dev runs only. Earlier attempts stopped the same way when a Windows Security prompt, T3 Code and File Explorer came forward while the user was working on the machine. One of them recorded `Escape` leaving T3 Code in front instead of the marker. The same check passed in every later attempt and every complete dev run, so it most likely came from the user switching windows, but that was not proven.

The runs found these defects. All are fixed and passed in the run that followed:

- `pnpm check` failed on all 96 files in a Windows checkout, because `core.autocrlf` turned them into CRLF. `.gitattributes` now keeps LF.
- While **Discard** waited for its second click, the Escape hint truncated to "Esc keep…", because `Ctrl+Enter` is wider than `⌘↩`. The hint is now for screen readers only in that state.
- Windows rounds a frameless window by 8 px, so the panel's 10 px preview and field corners did not nest inside it. The panel window is now transparent on Windows and draws 22 px corners with a 1 px border.
- Under the new caption strip, a capture in the library started about 100 px down. The page padding now accounts for the strip.
- The quit question's three buttons and the save keycap did not fit. The keycap moved into the button's tooltip.
- Two notifications named an "Inset menu" that exists on neither platform. They now point to the pin icon.

Several changes went in before the first run, because another Inset prototype tested on the same machine had shown the problems. The panel blurs itself before hiding, so Windows hands the keyboard to the window below. The pages declare `color-scheme`, so scrollbars follow the dark theme. A second start opens the library, the tray pin is white on a dark taskbar, and the library window keeps only the caption buttons. The runs confirmed the focus return with the fix in place. They did not show the panel keeping the keyboard without it.

Other Inset prototypes were tested on this machine at the same time, and two runs overlapped once. Since then every harness takes `%TEMP%\inset-desktop-test.lock` before it moves the pointer, and waits while another test holds it.

### UX iteration

A second pass worked through the panel and the library with the taste skill's rules for app screens. The direction is a neutral interface where the pin is the one colour on screen. The panel was checked in a browser preview with a stubbed bridge in every state (fresh, typed, reopened, saving, failed, the problem panels), light and dark. The library was checked at 960 × 680, at a narrow width, empty, and while searching and editing. The real packaged library was screenshotted afterwards.

- The panel says when the shortcut brought back an earlier draft. Before, pressing the shortcut over a new point silently showed the old draft.
- **Discard** asks again once there is text. A hint names what Escape does. The Retry action of a failed save moved into the main button.
- The preview controls became two icon buttons above the preview, and a trackpad pinch works too. The panel needs no extra row for them.
- The pin became a hollow ring, because the filled dot hid the word it pointed at.
- The permission panel became three numbered steps, each with its button.
- The library became a searchable two-pane window that opens on the newest capture. Copying and dragging now carry the pin, which they did not before. Copy buttons confirm in place, and Delete opens the next capture.
- The tray tooltip names the shortcut. While a draft exists, the disabled capture item says why.

The skill's checks ran on the result. `lint.mjs --app` over `src/renderer` reported 0 failures and 7 warnings. Three come from vendored shadcn files (the dialog's backdrop blur and two `transition-all`), and one from a test's zero padding. The other three are the pin's white and dark halo, which keeps it visible on any screenshot. `inspect.mjs --app` on the library reported 0 failures and one warning. The warning is the empty space under a single capture in a 1440 × 900 window, larger than the library's 960 × 680 default.

### Library pass with layout-breaking data

A third pass drove the library in the browser preview with a stubbed bridge and data chosen to break it: 34 captures over two weeks, a thought that is one long URL, a multi-line thought and a read-only entry, light and dark, at 1100 and 560 px wide. It found and fixed these:

- A long URL scrolled the capture sideways and squeezed the list to its minimum width; in a narrow window it made the list wider than the window.
- Saving an edit showed the old thought for a moment. The router reloaded in the background, so `invalidate()` returned before the new thought had loaded. Reloads now block until the data is fresh (`defaultStaleReloadMode: "blocking"`), which also makes each `↑`/`↓` step wait for its local IPC round trip.
- Deleting during a search selected the next capture of the whole list, which the search could hide. Deleting with an unsaved edit left the window on "This capture no longer exists". `⌘↩` in the unsaved-edit question saved behind it and dropped the chosen capture.
- `⌘F` did nothing in the one-pane layout while a capture was shown.
- Asking for the library again while it sat behind another app did not bring it forward on macOS (found by reading the code).

The search got a themed clear button and shows its count only while searching. The scrollbars are thin, follow the theme and keep their room. The shown capture got keys and a right-click menu, see the table above.

### Mac app pass

A fourth pass made the app look and behave like Inset Shelf on macOS: a Dock icon and menu bar, a Settings window, pinned captures, recent captures in the menus, and direct editing of the crop. The real app ran from `out/` with a separate data folder holding four sample captures, next to another instance in development. Driven with System Events and synthetic pointer events, these were observed:

- The library with the sidebar material and the traffic lights over the list, and the selected row visible on the material. Settings opened from the app menu and from the tray.
- **Capture > Pin to Screen** opened the shown capture at 210 × 150 DIP at the floating window level. A click showed its buttons, and **Show in library** opened the library.
- With a pin on screen, a delayed capture over TextEdit opened the panel, a typed key went to the panel, and after `Escape` typing went to TextEdit again. The pin stayed.
- A capture chosen in the tray menu opened a new library window on that capture.
- A launch with captures opened no window and left Finder in front, with the Dock icon showing. **Dock Only** started without the menu-bar pin, and **Menu Bar Only** as an accessory app. Quit from the tray exited with Settings open.

It found three defects, all fixed. The first draft of the View menu had page zoom; two **Zoom In** in the library also enlarged the capture panel, whose Save button then fell outside its fixed-width window, because all windows share the app's origin. The menu has no zoom now. Pin windows loaded a 404, because the app scheme refuses addresses with a fragment, which the pin's address used; main now tells each pin window its capture by its sender. The panel's `app.hide()` on `Escape` also hid every pin, and showing them again did not work while the app was hidden. The panel never activates the app (the app in front stayed frontmost while it was open), so `app.hide()` is now skipped while a pin is visible, as it already was for the library.

The crop editor was checked in the browser preview only, with a stubbed bridge and a mouse: dragging a corner, moving the frame, a click that places the pin, and ctrl+wheel.

### Windows pass

A fifth pass, on 26 October 2026, ran the Mac app pass's features on Windows and compared them with macOS.

Test system: Windows 11 Enterprise 10.0.26100, x64, Electron 45.0.0, dark mode for apps and the taskbar, and three displays at 100% scale. The primary is 2560 × 1440 at (0, 0). The other two have negative origins: 2560 × 1440 at (−2560, 5) and 1920 × 1200 at (−2225, 1445). Sessions testing Inset Shelf and Inset Window Links used the same desktop; after one collision, all three took `%TEMP%\inset-desktop-test.lock` before any input.

The app ran from `out/` with a separate data folder. It held nine sample captures chosen to break the layout, plus one read-only entry. The samples included an ampersand in the thought, one long URL, three lines, a 160 × 100 crop, a 1600 × 200 strip, a 300 × 900 sidebar and a scale-2 crop. Input came from the harness helper (`SendInput` and UI Automation), in a scratch copy with commands for dragging, the mouse wheel and the `,` and `Delete` keys added; `scripts/e2e/windows-helper.cs` does not have them. Page state was read, and some pages were screenshotted, through Chromium's debugging port.

Observed with real input:

- **Negative origins.** Captures on both displays with negative origins opened the panel inside that display, and the pixel under the pin was magenta. That includes the top-left corner of the left display, where the crop is clamped to the image edge. `verify-windows.ts` covered the lower display too.
- **The crop editor.** Dragging a corner took the crop from 480 × 300 to 408 × 250. Moving the frame and a click that places the pin also worked. `Ctrl`+wheel widened the crop and brought it back to the same size. `Ctrl`+wheel zoomed neither the panel nor the library.
- **Copy after saving,** turned on with a click in Settings. Each save put the thought and the 480 × 300 image on the clipboard.
- **The library's keys.** `Ctrl+F`, typing a search, `Escape` to clear it, `↓` and `↑` all worked. So did `Ctrl+C` with nothing selected (the note) and `Ctrl+Shift+C` (the image). `Enter`, typing and `Ctrl+Enter` saved an edit. `Backspace` opened the delete question, and `Escape` closed it. The right-click menu showed its five commands with their Windows keys.
- **Settings** opened from the tray, under a dark system title bar, and its content was not cut off.
- **Pins.** `Ctrl+P` opened a pin at the top right of the display under the pointer, and a click showed its buttons. **Copy image** copied the crop with the pin drawn on it. **Show in library** brought the library forward on that capture. Dragging the pin, resizing it from a corner and an edge, and `Escape` all worked.
- **The tray menu** listed the five newest captures. The narrow, one-pane library was correct under the real caption buttons; the window was narrowed with a drag.

These were checked only through the debugging port: going to a capture by its address, deleting a pinned capture (its pin closed and the library opened the next capture), and both pages in light mode. Light mode was emulated with `prefers-color-scheme`, so the Windows theme was not changed.

It found these defects, all fixed. The thumbnails were checked by measuring every row and screenshotting the list through the debugging port; the others again with real input.

- **Ampersands in the tray menu.** `Q&A: totals & discounts` showed as `QA: totals  discounts`. Windows menus, and Electron's macOS menus, read a single `&` as an access-key mark and drop it. Capture names in the menus now double it. The macOS Dock menu had the same defect; that was found in Electron's source, not observed.
- **List thumbnails stretched to the row's height.** Every thumbnail had an empty band under the image. A 1600 × 200 crop's pin sat in that band, below the image, and a 300 × 900 crop made an 80 × 240 thumbnail. All thumbnails now share one 8:5 box, with the crop whole inside it: the strip measures 80 × 10, centred, with its pin on it, and the sidebar 16.7 × 50. This affected macOS too.
- **Pins opened and resized stretched.** On Windows, Electron's `setAspectRatio` applies the ratio to a frameless window's outer frame. That frame includes 16 × 8 DIP of invisible resize borders, and Electron resizes the window at once. A 160 × 100 crop opened at 157 × 100. A 300 × 900 crop opened at 120 × 400 instead of 120 × 360, 11% too tall. Passing `extraSize` changed nothing.
  - On Windows the pin now opens at its exact size. During a resize the page letterboxes the crop, and when the resize ends the window snaps to the crop's shape.
  - Checked: 160 × 100 and 120 × 360 when opened, 200 × 600 after widening the tall pin, and 133 × 400 after shortening it.
- **Right-click on a pin.** It opened Windows' window menu (Restore, Move, Size, Minimize, Maximize, Close), because the whole pin moves the window. It now opens **Copy image**, **Show in library** and **Close**; both commands were tried.
- **Pin titles.** Every pin window took the page's title, "Pinned capture". A pin is unowned and not a tool window, so Windows lists it in Alt+Tab under that title; this follows from the window style and was not looked at in Alt+Tab. The window now keeps the thought's first line as its title.
- **`Ctrl+W`** did nothing in Settings or a pin, where macOS closes them with `⌘W` from **File > Close**. One handler now gives the library, Settings and pins `Ctrl+W` on Windows.

Two items from the macOS menus had no Windows counterpart and were added:

- `Ctrl+,` in the library opens Settings, like `⌘,`.
- **Keep library on top** in the tray menu, enabled while the library is open, like **View > Keep Library on Top**. The tick showed, and the window's `WS_EX_TOPMOST` style followed it.

Help, which opens the README on macOS, was left out.

The first `verify-windows.ts` run of this pass stopped at "Escape gives the keyboard back to the app in front". A Window Links fixture window had come forward over the marker during the run, and it shows behind the panel in the run's own screenshot. After the sessions agreed on the lock, the next complete run passed all 72 checks, this one included, with the fixes in place.

One observation is a design question, not a defect. One notch of a mouse wheel arrives as 100 units, so `Ctrl`+wheel scales the crop by 1.78× per notch. One **Widen context** click scales it by 1.41×.

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

`scripts/e2e/verify-macos.ts packaged` ran the same 49 checks against `release/mac-arm64/Inset Context Pin.app` and passed all of them. Focus return was observed with a separate marker app in front: focus went from the marker to the panel and back to the marker after Escape and after save.

A packaged app that the harness launches inherits screen access from the terminal host. The first-run grant of a downloaded app is therefore still untested (see below).

### Continuous integration

The first CI run on pull request #1 passed all four jobs: lint, typecheck, tests, and build on Ubuntu, then packaging on macOS and Windows runners. It produced `inset-context-pin-0.1.0-mac-arm64.dmg`, `-mac-x64.dmg`, and the matching zip files, plus `-win-x64.exe`, `-win-x64.zip`, and `-win-arm64.zip`. That run skipped code signing because electron-builder skips it for pull requests by default. CI now sets `CSC_FOR_PULL_REQUEST` so that pull request builds are ad-hoc signed like local builds.

`release.yml` has not run yet. Its first run happens when a commit reaches `main`.

## What was not tested

- **Windows beyond the dev runs.** A complete run of the unpacked app is still open, see above. The NSIS installer, SmartScreen on first start, the arm64 zip, the notification's sender name in a packaged build, and displays scaled above 100% or with mixed scale were not tried. The pin's resize snap and the 16 × 8 DIP border were measured at 100% scale only. **Open at Login** was not tried on Windows; in a dev build it would register Electron itself. No real touchpad pinch ran on Windows, only mouse-wheel notches. The Windows script requires 100% scale, because it compares window positions with screen pixels one to one.
- **This round on macOS.** The welcome, the quit question in the panel, `color-scheme`, the library's page padding and the changed notification text also apply to macOS, and none of them ran there. `verify-macos.ts` was updated for the welcome and the quit question but not run.
- **The library pass on the real desktop.** Bringing an open library forward and the check added for it to `verify-macos.ts` did not run. The one run of the script in this pass failed before the library, at the first checks that read the window through accessibility: the welcome text, **Unsaved draft from** and the **Discard** button. Inset Shelf was running in development at the same time, also as a process named Electron, so the script now finds the app by process id. That is not shown to be the cause: asked by process id, System Events also reported no windows for an instance whose welcome had just opened.
- **The Mac app pass, beyond what is listed above.** A click on the Dock icon, the Dock menu, Open at Login, Copy after saving, **Keep Library on Top**, dragging and resizing a pin, pins on other Spaces and over full-screen apps, and deleting a pinned capture were not tried in the real app on macOS. The crop editor did not run in Electron on macOS, and no real trackpad pinch was tried. The Windows pass covered most of this on Windows. The new thumbnails, the pin page's letterbox, the doubled ampersands in the Dock menu and the pin's window title, now kept from the thought on every system, did not run on macOS. `verify-macos.ts` did not run; its launch check (no window, focus stays in front) was observed once by hand with the Dock icon showing.
- **Intel Macs.** The x64 macOS build is produced but was not run.
- **A second display during the macOS runs.** The macOS pin-to-pixel check ran on the built-in display only. The spike covered two displays with mixed scale, but the full panel flow did not. On Windows the full flow ran on a second display at the same scale.
- **Negative display origins on a Mac.** On Windows, two displays with negative origins passed, see the Windows pass.
- **Permission refusal and the first-run grant.** The app shows a panel with **Open System Settings** and **Quit and Reopen** when macOS reports that screen access is missing. This path was not observed. Every test run launched the app from a terminal host that already had screen access, and macOS attributes the grant to that host. A packaged app opened from Finder asks for its own grant, and that first run is untested.
- **Shortcut conflict detection does not work across apps on macOS.** `scripts/e2e/hotkey-holder.swift` registered `⌥⌘P` through Carbon in a separate process. Electron's `globalShortcut.register` still returned true, so the tray kept showing "Capture under pointer: ⌥⌘P" instead of the conflict notice. The tray item **New capture in 3 seconds** is always present and was verified, so a participant whose shortcut is taken still has a working entry. The conflict notice appears only when Electron itself reports a failure. On Windows it does, see the Windows runs.
- **Pasting and dropping into a real receiving app.** On Windows the copied image and note were read back from the clipboard only. In the packaged macOS app, **Copy image** was clicked and the clipboard read back with AppleScript. It held the 960 × 600 crop with the pin ring in the right colour, and the button showed **Copied**. Pasting into another application and dragging the file into one were not tried.
- **Library keys, pinch and delete in the real app.** `↑`/`↓`, `⌘F`, `Enter`, `Backspace`, `⇧⌘C`, the right-click menu, the unsaved-edit guard and opening the next capture after **Delete** were checked only in the browser preview with a stubbed bridge. There, `document.execCommand("copy")` stood in for `⌘C` and Edit > Copy; that the real menu command reaches the page with nothing selected is expected from Chromium but was not observed. Pinch (ctrl+wheel) over the panel preview was not tried at all. Sending keys to the real library needs it in front, and macOS did not bring the menu-bar app forward from a script. On Windows these keys, the right-click menu and `Ctrl`+wheel ran in the real app (see the Windows pass); the unsaved-edit guard and opening the next capture after a **Delete** confirmed with real input did not.
- **A `⌘W` miss.** In one of five dev runs after the UX changes, `⌘W` did not close the library, which stayed open until the app quit. Every later run, three dev and two packaged, closed it. The cause is unknown.
- **Screen readers.** The panel has labels and keyboard paths, but no screen reader test ran.
- **The problem panel followed by a new capture.** When the problem panel is visible and the user presses the shortcut again, the app hides the panel and waits 150 ms before it captures. Whether that wait keeps the panel out of the image was not observed.
- **The startup error dialog.** The fix delegate saw the error message appear for an unwritable captures folder. Clicking OK, the exit code, and a working relaunch afterwards were not observed.

## Limitations and how they affect the experiment

- **Unsigned builds.** macOS and Windows both warn on first launch, and macOS needs **Open Anyway** in System Settings. Count this as setup effort in a session, separate from routine capture effort, as `TEST_PROTOCOL.md` asks.
- **Screen access on macOS.** The packaged app needs its own **Screen & System Audio Recording** grant and a restart. Plan this before a session.
- **No source identity.** The record names the display, not the app, document, or URL. A participant must still type what the capture is about if it is not visible in the crop. This is the intended test of whether pointing replaces describing.
- **The crop is a still image.** It is not a live link into the source document. Closing the source app does not affect the saved capture.
- **The draft lives in memory.** If the app crashes or the user logs out, an unsaved draft is lost. The quit question protects only an explicit quit.
- **The full display image stays in memory** while a draft exists, so widening can reach the whole display without a new capture. On a 5K display that is about 59 MB of raw pixels (5120 × 2880 × 4 bytes), a calculation rather than a measurement.

## User test results

No session has run. Use `test-record-template.csv` from the brief package for raw observations, and keep this section empty until a real session produces results.
