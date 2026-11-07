# Inset Context Pin

Inset Context Pin is a small app for one capture experiment. You point at a detail in your real work, press a shortcut, place numbered pins on what matters and give it a title. The app saves a cropped screenshot with its pins next to your notes.

It is a prototype for testing whether pointing at a place can replace describing it. It is not a note app. [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) lists what was tested, on which system, and what is still open.

## Install a test build

Install once. After that the app updates itself from the **Preview build** release, which always holds the latest commit on `main`.

Download a build from the [Releases page](https://github.com/levinbaenninger/inset-pin/releases). Versioned releases hold tagged builds. Each pull request also uploads builds as workflow artifacts on its CI run, but those copies don't update themselves.

The builds are not signed with a developer certificate, so each system warns once.

### macOS

1. Download `inset-context-pin-<version>-mac-arm64.dmg` for Apple silicon, or `-mac-x64.dmg` for an Intel Mac.
2. Open the disk image and drag **Inset Context Pin** to **Applications**.
3. Open the app. macOS blocks it the first time.
4. Open **System Settings > Privacy & Security** and click **Open Anyway** next to the message about Inset Context Pin.

   If you prefer the terminal, run `xattr -dr com.apple.quarantine "/Applications/Inset Context Pin.app"` and open the app again.

5. Press `⌥⌘P` once. If the panel asks for screen access, open **System Settings > Privacy & Security > Screen & System Audio Recording**, turn on **Inset Context Pin**, and click **Quit and Reopen** in the panel.

The first time it starts, a welcome window shows how to capture. The app has a Dock icon and a pin in the menu bar; **Settings…** (`⌘,`) can hide either.

The app checks for a new build when it starts and every four hours, and downloads it in the background. When the download is ready, a notification says so and the pin menu offers **Restart to update to v…**. If you don't restart, the update installs when you quit. The pin menu always shows the running version and **Check for updates**. Every build is signed with the same certificate, so macOS keeps the screen access you granted.

If you installed version 0.1.0, install a new build by hand one last time. Version 0.1.0 was signed ad-hoc, and macOS rejects an update for an app without a stable signature. Quit the app, repeat steps 1 to 5, and grant screen access again if macOS asks. Later builds arrive on their own.

### Windows

1. Download `inset-context-pin-<version>-win-x64.exe` for the installer, or `-win-x64.zip` to run it without installing. Use `-win-arm64.zip` on an Arm device.
2. If SmartScreen shows **Windows protected your PC**, click **More info**, then **Run anyway**.
3. Start **Inset Context Pin**. The first time, a welcome window shows how to capture. After that, the app lives in the notification area of the taskbar as a pin. Windows hides new icons behind the `^` arrow next to the clock at first. Drag the pin onto the taskbar to keep it in view.

The installer copy updates itself the same way. It checks on start and every four hours, and installs a downloaded update when you quit or choose **Restart to update**. The portable zips can't update themselves. To get a new portable build, download it again.

The capture flow was tested on Windows 11 with real input. [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) lists what passed and what is still open, such as a complete run of the unpacked app and displays scaled above 100%.

## Capture something

1. Move the pointer over the detail that matters, in any app.
2. Press `⌥⌘P` on macOS or `Ctrl+Alt+P` on Windows. A small panel opens beside the pointer with a crop around that point. It has no pin yet.
3. Click in the preview to place pin 1 ("Click to place pin 1" shows until you do). Each further click places the next numbered pin, and the title keeps the keyboard, so you can type on. Drag a pin to move it; click one, or press `1`–`9`, to select it, then nudge it with the arrow keys (one image pixel, `Shift` for 10) or remove it with `⌫`. `P` turns pin mode off and on, and `⇧P` drops a pin under the pointer.
4. Type a **Title**. **Add** adds a **Description** (`⌘D`), **Next steps** (`⇧⌘S`) and **Due** (`⇧⌘D`: Today, Tomorrow, This weekend, Next week, or Pick a date…). On Windows the keys use `Ctrl`.
5. Optional: adjust the crop. Drag the frame to move it, drag a corner or an edge, or pinch; **Tighten** (`⌘=`) and **Widen** (`⌘−`) do it in steps. The crop always keeps every pin inside.
6. Press `⌘↩` or `Ctrl+Enter`, or click **Save**. Saving needs a title.

`Escape` sets the capture aside, and the shortcut brings the same draft back. **Discard** asks a second time once there is something to lose. `⌘/` or `Ctrl+/` lists every key. While a save runs, the fields wait for it.

If the shortcut does not work because another app uses it, choose **New capture in 3 seconds** from the pin icon and move the pointer over your detail before the delay ends.

To quit, choose **Quit Inset Context Pin** from the pin icon. If a draft has anything in it, the panel asks first: **Save**, **Discard** or **Cancel**. `Return` always saves, `Esc` cancels, and `Space` presses the focused button. If the draft's save failed or is still on its way after 3 seconds, the panel asks too, with **Retry** in place of **Save**, and the app quits once the save lands unless you cancel. Discard then also gives up what that save writes, so it never shows in the library, even if the app is forced to quit before the save lands.

## The library

Click the Dock icon, choose **Recent captures…** from the pin icon, or start the app again while it runs. The sidebar lists captures by day, newest first; drag its edge to resize it, or hide it with `⌃⌘S` (`Ctrl+B`). Each row shows the image with its pins, the title, the step progress and, on the right, the Due chip ("Overdue" once the day has passed).

- **Edit in place.** Title, description, next steps, Due and pin labels save as you type. The chips under the title add a missing field, and the same keys work: `⌘D`, `⇧⌘S`, `⇧⌘D`. `Return` edits the title. The Due chip's `×` clears the day, and **Pick a date…** opens a calendar: the arrows move, `Return` picks, `Esc` closes it. When and where the capture was taken sits at its foot.
- **Unsaved changes are kept.** If a save fails, your typing stays, also after you open another capture; its row says **Not saved**. Open it again to see the error, such as "The disk is full.", with **Retry** and **Discard changes**. Discard changes puts back every field at once. A save still on its way is dropped, or the file it replaced is renamed back, so Discard works even on a full disk, and a crash halfway through still comes back to what was saved. If Discard can't put the saved version back, for example because another program locks the file, the changes stay as **Not saved** with "Couldn’t discard your changes" and the reason: **Keep changes** saves them, and **Discard again** tries again to put back the version saved before them. Typing meanwhile saves nothing and copies are refused until you choose, and `Return` in that message keeps the changes whichever button has the focus. Until Inset has answered a Discard, typing waits, a copy waits up to 3 seconds, and closing or quitting waits for it too. If it still hasn’t answered after 3 seconds, the prompt says "1 change isn’t discarded yet" with **Wait**, **Close anyway** (or **Quit anyway**) and **Cancel**. `Return` waits again; Close anyway leaves at once and the Discard finishes on its own, or the next time Inset starts. A library window opened while a Discard is still owed shows the capture this way again. If the window can't find out which Discards are owed, it says "Library can’t open yet" and shows no capture, and keeps trying until it can. Closing or quitting asks "1 change couldn’t be discarded" with **Keep changes**, **Discard again** and **Cancel**, and Discard again lets the app go only once the saved version is back. Closing the library or quitting while changes still can't be saved waits up to 3 seconds and then asks, with **Retry**, **Discard and close** (or **Discard and quit**) and **Cancel**. `Return` always presses **Retry** (or **Keep changes**), `Esc` cancels, and `Space` presses the focused button. If the library doesn't answer in time, or its window crashed or reloaded with changes unsaved, the app asks natively: **Wait**, **Quit anyway** or **Cancel**. While a prompt is open, keys never change the capture behind it.
- **Pins.** Under the image, every pin is listed as "1 · label". Press `P` or click **Add pins** to place more, drag a pin to move it, and `⌫` removes the selected one. In a label, `Return` keeps what you typed and `Esc` takes it back. `⌘Z` undoes a pin edit (a whole drag at once) and `⇧⌘Z` redoes it. A pin stays selected only while the image has the focus.
- **Search** with `⌘F` or `Ctrl+F`. It looks in titles, descriptions, steps and pin labels. `due:today`, `due:overdue`, `due:week` (overdue, today and the next six days), `due:any` and `due:none` filter by Due. Typing `due:` lists them; the filter button in the field offers them too. Matches are highlighted.
- **Mark as done** (`Space` on a focused sidebar row, or the check button) moves a capture to **Done**, at the foot of the sidebar; the notice offers Undo.
- **Copy Text** (`⌘C` when nothing is selected) copies the title and description. **Copy with Details** (`⌥⌘C`) adds the steps as `- [ ]` items, `Due: <date>` and the pin labels. **Copy Image** (`⇧⌘C`) copies the crop with every pin drawn on it. Dragging the image into another app drops the same picture as a file. Every copy, the floating window's included, saves what you are typing first and waits for it to reach the disk, then copies what was on screen when you pressed it. If that save fails, or the capture already says **Not saved**, nothing is copied. The notice says why and offers **Retry**, which saves the changes so you can copy again.
- **Float on Top** (`⌥⌘F` or `Ctrl+Alt+F`, previously "Pin") keeps the capture in a small window above every other app.
- **Delete…** (`⌫`) asks first.
- The ⋯ button and a right-click on a row hold the same commands with their keys. While a row's menu is open, the keys it shows act on that row's capture, not the one open, and so do they while the row has the focus after it closes. In an open menu, `Space` and `Return` pick the highlighted item, and other shortcuts do nothing until it closes. A click on search or a field closes the menu and goes straight there. `Esc`, a command or a click on empty space gives the focus back to the row or the ⋯ button. **Settings** and **Keyboard shortcuts** sit at the foot of the sidebar.

Captures saved by an older version open with nothing lost. A one-line thought becomes the title. A longer one stays whole, exactly as typed, as the description, and its first line becomes the title. The old pin becomes pin 1. The file is rewritten in the new format only when you change the capture.

## Settings

Choose **Settings…** from the app menu (`⌘,`) or the pin icon. On Windows, `Ctrl+,` in the library opens it too.

- **Open at Login** starts the app when you log in.
- **Show app icon in** (macOS): the Dock and the menu bar, the Dock only, or the menu bar only. Without the Dock icon the app has no menu bar of its own.
- **Copy after saving** puts each saved capture on the clipboard, the image with its pins and its text, ready to paste.

## Where captures are stored

The app stores each capture as a folder with `capture.json` and `crop.png`.

- macOS: `~/Library/Application Support/Inset Context Pin/captures`
- Windows: `%APPDATA%\Inset Context Pin\captures`

The app keeps only the approved crop. It does not keep the full screenshot or any capture history beyond what you save.

## Develop

You need Node 24 and pnpm 12. On a machine managed by Vite+, use its `node` and `pnpm`.

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the app with hot reload. It opens the welcome window only while there are no captures.

The first run downloads the Electron binary into `node_modules/electron`. If a terminal inside another Electron app sets `ELECTRON_RUN_AS_NODE`, unset it first, or Electron starts as plain Node and stops with "bad option".

These scripts check the code. CI runs the first four on every pull request.

| Command | What it does |
| --- | --- |
| `pnpm check` | Runs Ultracite: Oxlint with type-aware rules and the React, TanStack, Vitest, shadcn, and anti-slop presets, plus an Oxfmt format check. |
| `pnpm typecheck` | Type-checks the main, preload, and renderer code in strict mode. |
| `pnpm test` | Runs the Vitest suite. |
| `pnpm build` | Builds the app into `out/` with electron-vite. |
| `pnpm screens` | Builds, then screenshots every window in its main states, light and dark, as macOS and Windows show them, into `release/screens/`. It runs the pages in Playwright's Chromium with a fake preload bridge and sample data (`scripts/screens.ts`), so it needs no screen access and never starts Electron. |
| `pnpm fix` | Formats the code and applies safe lint fixes. |

To build installers on your machine, run `pnpm package:mac` on macOS or `pnpm package:win` on Windows. The files land in `release/`.

### Verify on the real macOS desktop

`scripts/e2e/verify-macos.ts` drives the real app from outside. It presses the global shortcut over a marker window and checks the panel size and position. A capture starts without a pin, so before each save the script clicks the preview where the pointer was, from the geometry the app logs with `panelShown`. It also checks draft retention, focus return, the saved pin pixel, widening near a screen edge, the tray fallback, failed writes, restarts, the library, and the quit dialog. It reads the app's own event log and real window bounds.

```sh
node scripts/e2e/verify-macos.ts dev       # builds, then tests out/ with Electron
pnpm package:dir && node scripts/e2e/verify-macos.ts packaged
```

The script takes over the mouse and keyboard for about a minute. The terminal needs **Accessibility** access, Xcode command line tools must be installed for `swiftc`, and the app under test needs **Screen & System Audio Recording** access. It writes every result and the event log to a temporary folder and prints the path. It refuses to type unless the marker or the app under test is in front.

### Verify on the real Windows desktop

`scripts/e2e/verify-windows.ts` runs the same flow on Windows. It also checks who has the keyboard after every show and hide, a capture on a second display, the pin colour in a copied image, a second start of the app, and another app holding the shortcut. It saves screenshots of each state next to the results.

```sh
node scripts/e2e/verify-windows.ts dev       # builds, then tests out/ with Electron
pnpm package:dir && node scripts/e2e/verify-windows.ts packaged
```

The script takes over the mouse and keyboard for about four minutes. It compiles a small helper with the C# compiler that ships with Windows, so it needs nothing else installed. Every display must be at 100% scale, because the script compares window positions with screen pixels one to one. It saves your clipboard text and puts it back at the end.

It sends keys only while the marker or the app is in front, and clicks only on their windows or the tray, so a window you bring forward stops the run instead of receiving its input. Other Inset prototypes are tested on the same machine. Before taking over, the script creates `%TEMP%\inset-desktop-test.lock` and waits while another test holds it. Anything else that drives the desktop should take the same lock.

## Release

`.github/workflows/release.yml` publishes builds to GitHub Releases.

- A push to `main` builds macOS and Windows and updates the **Preview build** prerelease in place. That release is the update feed. Every installed copy reads `latest-mac.yml` or `latest.yml` from it. The workflow uploads the new installers first and the update metadata last, then deletes the old files. While it replaces `latest-mac.yml` and `latest.yml`, they are missing for a few seconds, and a check in that window fails and retries four hours later.
- A tag such as `v0.2.0` publishes a versioned release. The tag must match `version` in `package.json`. Installed copies don't read versioned releases, so they keep following the preview builds.

`version` in `package.json` holds the release base. A preview build replaces its last number with the workflow run number, so `0.1.0` becomes `0.1.57`. The run number only grows, so each preview build is newer than the last. The workflow changes the version during the build and never commits it.

To cut a versioned release, raise `version` in `package.json`, for example from `0.1.0` to `0.2.0`, and merge it. Then run `git tag v0.2.0` and `git push origin v0.2.0`. Previews built after that merge are `0.2.<run number>`. Never lower the base, or installed copies stop updating until the previews catch up.

### Signing

The macOS app is signed with a self-signed certificate, "Inset Prototype Signing". electron-builder only accepts certificates that macOS trusts, so `scripts/sign-mac.ts` signs the app with `codesign` after packing. The designated requirement names this certificate, so it is the same in every build. Squirrel.Mac installs an update only when the new app matches the running app's designated requirement, and macOS keeps privacy grants for the same reason.

- Locally the hook uses the `inset-signing` keychain in `~/Library/Keychains`. Unlock it before you package.
- In CI the release workflow imports the `MAC_SIGNING_P12_BASE64` and `MAC_SIGNING_P12_PASSWORD` secrets into a temporary keychain and sets `INSET_REQUIRE_SIGNING=1`, so a missing identity fails the release.
- Without a keychain, as on pull requests from forks, the hook signs ad-hoc and warns. Those builds can't update an installed copy.

To test an update locally, run `pnpm build`, then build two versions with `pnpm exec electron-builder --mac zip --arm64 --publish never -c.extraMetadata.version=<version> -c.directories.output=<dir>`. Serve the newer build's folder over HTTP and start the older app with `INSET_UPDATE_FEED_URL=<url>`. After the update, Squirrel.Mac relaunches the app without your environment variables, so the relaunched copy opens your real data. Stop it right away.
