# Inset Context Pin

Inset Context Pin is a menu-bar and tray utility for one capture experiment. You point at a detail in your real work, press a shortcut, and type what matters about it. The app saves a cropped screenshot with a pin on that detail next to your thought.

It is a prototype for testing whether pointing at a place can replace describing it. It is not a note app. [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) lists what was tested, on which system, and what is still open.

## Install a test build

Download a build from the [Releases page](https://github.com/levinbaenninger/inset-pin/releases). The **Preview build** release always holds the latest commit on `main`. Versioned releases hold tagged builds. Each pull request also uploads builds as workflow artifacts on its CI run.

The builds are not signed with a developer certificate, so each system warns once.

### macOS

1. Download `inset-context-pin-<version>-mac-arm64.dmg` for Apple silicon, or `-mac-x64.dmg` for an Intel Mac.
2. Open the disk image and drag **Inset Context Pin** to **Applications**.
3. Open the app. macOS blocks it the first time.
4. Open **System Settings > Privacy & Security** and click **Open Anyway** next to the message about Inset Context Pin.

   If you prefer the terminal, run `xattr -dr com.apple.quarantine "/Applications/Inset Context Pin.app"` and open the app again.

5. Press `⌥⌘P` once. If the panel asks for screen access, open **System Settings > Privacy & Security > Screen & System Audio Recording**, turn on **Inset Context Pin**, and click **Quit and Reopen** in the panel.

The app has no Dock icon. The first time it starts, a welcome window shows how to capture. After that, look for the pin in the menu bar.

### Windows

1. Download `inset-context-pin-<version>-win-x64.exe` for the installer, or `-win-x64.zip` to run it without installing. Use `-win-arm64.zip` on an Arm device.
2. If SmartScreen shows **Windows protected your PC**, click **More info**, then **Run anyway**.
3. Start **Inset Context Pin**. The first time, a welcome window shows how to capture. After that, the app lives in the notification area of the taskbar as a pin. Windows hides new icons behind the `^` arrow next to the clock at first. Drag the pin onto the taskbar to keep it in view.

The capture flow was tested on Windows 11 with real input. [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) lists what passed and what is still open, such as a complete run of the unpacked app and displays scaled above 100%.

## Capture a thought

1. Move the pointer over the detail that matters, in any app.
2. Press `⌥⌘P` on macOS or `Ctrl+Alt+P` on Windows. A small panel opens beside the pointer with a crop around that point and a ring on it.
3. Type what matters in **What matters here?**.
4. Optional: click or drag in the preview to move the pin, or use the arrow keys to nudge it. The two buttons above the preview, **Tighten** and **Widen context**, show less or more of the screen. A pinch on the trackpad over the preview does the same.
5. Press `⌘↩` or `Ctrl+Enter`, or click **Save**. The panel closes and you are back in your work.

To set a capture aside, press `Escape` or click anywhere outside the panel. The draft stays in memory. Press the shortcut again to bring the same draft back. The panel then says **Unsaved draft from** with its time, because the app does not take a new screenshot while a draft exists. Save or discard it to capture something new.

To throw a draft away, click **Discard**. Once you have typed something, the button asks **Click again to discard**. A second click within 4 seconds discards the draft. `Escape` takes the question back.

If the shortcut does not work because another app uses it, choose **New capture in 3 seconds** from the pin icon and move the pointer over your detail before the delay ends. The welcome window and the pin's menu both say when the shortcut is taken.

To quit, choose **Quit Inset Context Pin** from the pin icon. If a draft has a thought that is not saved yet, the panel asks first: **Save and quit**, **Discard and quit**, or **Cancel**.

## Read, edit, and export captures

Choose **Recent captures…** from the pin icon, or start the app again while it runs. The window shows your captures grouped by day, newest first, and opens the newest one beside the list. In a narrow window the list and a capture each take the whole window. Before the first capture it shows the welcome instead, and the first capture appears there as soon as you save it.

- Search the thoughts with the field at the top, or with `⌘F` or `Ctrl+F`. Every word you type must appear.
- Move through the list with `↑` and `↓`.
- **Copy note** copies the thought. **Copy image** copies the crop with the pin drawn on it. Each button shows **Copied** when it has worked.
- Drag the image itself into another app to drop it as a file. The file carries the pin too and is named after the thought.
- **Edit thought** changes the text. `⌘↩` saves it and `Escape` cancels. Choosing another capture with an unsaved change asks first.
- **Delete** asks once, then opens the next capture.
- `⌘W` or `Ctrl+W` closes the window.

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

`pnpm dev` starts the app with hot reload. It runs in the menu bar or tray. It opens the welcome window only while there are no captures.

The first run downloads the Electron binary into `node_modules/electron`. If a terminal inside another Electron app sets `ELECTRON_RUN_AS_NODE`, unset it first, or Electron starts as plain Node and stops with "bad option".

These scripts check the code. CI runs the first four on every pull request.

| Command | What it does |
| --- | --- |
| `pnpm check` | Runs Ultracite: Oxlint with type-aware rules and the React, TanStack, Vitest, shadcn, and anti-slop presets, plus an Oxfmt format check. |
| `pnpm typecheck` | Type-checks the main, preload, and renderer code in strict mode. |
| `pnpm test` | Runs the Vitest suite. |
| `pnpm build` | Builds the app into `out/` with electron-vite. |
| `pnpm fix` | Formats the code and applies safe lint fixes. |

To build installers on your machine, run `pnpm package:mac` on macOS or `pnpm package:win` on Windows. The files land in `release/`.

### Verify on the real macOS desktop

`scripts/e2e/verify-macos.ts` drives the real app from outside. It presses the global shortcut over a marker window and checks the panel size and position. It also checks draft retention, focus return, the saved pin pixel, widening near a screen edge, the tray fallback, failed writes, restarts, the library, and the quit dialog. It reads the app's own event log and real window bounds.

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

`.github/workflows/release.yml` publishes builds to GitHub Releases. It has not run yet. Its first run happens when this branch reaches `main`.

- A push to `main` replaces the **Preview build** prerelease with fresh macOS and Windows builds.
- A tag such as `v0.2.0` publishes a versioned release. The tag must match `version` in `package.json`.

To cut a release, bump `version` in `package.json`, merge it, then run `git tag v<version>` and `git push origin v<version>`.
