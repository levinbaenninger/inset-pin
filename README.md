# Inset Context Pin

Inset Context Pin is a menu-bar utility for one capture experiment. You point at a detail in your real work, press a shortcut, and type what matters about it. The app saves a cropped screenshot with a pin on that detail next to your thought.

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

The app has no Dock icon. Look for the pin in the menu bar.

### Windows

1. Download `inset-context-pin-<version>-win-x64.exe` for the installer, or `-win-x64.zip` to run it without installing. Use `-win-arm64.zip` on an Arm device.
2. If SmartScreen shows **Windows protected your PC**, click **More info**, then **Run anyway**.
3. Look for the pin in the notification area of the taskbar. It can be hidden behind the arrow.

The Windows build compiles and packages in CI. Nobody has run it on Windows yet.

## Capture a thought

1. Move the pointer over the detail that matters, in any app.
2. Press `⌥⌘P` on macOS or `Ctrl+Alt+P` on Windows. A small panel opens beside the pointer with a crop around that point and a pin on it.
3. Type what matters in **What matters here?**.
4. Optional: click or drag in the preview to move the pin, use the arrow keys to nudge it, or click **Widen context** to include more of the screen.
5. Press `⌘↩` or `Ctrl+Enter`, or click **Save**. The panel closes and you are back in your work.

To set a capture aside, press `Escape` or click anywhere outside the panel. The draft stays in memory. Press the shortcut again to bring the same draft back. The app does not take a new screenshot while a draft exists.

To throw a draft away, click **Discard**.

If the shortcut does not work because another app uses it, choose **New capture in 3 seconds** from the menu-bar icon and move the pointer over your detail before the delay ends.

## Read, edit, and export captures

Choose **Recent captures…** from the menu-bar icon. The window lists your captures with the newest first. Open one to see the full crop with its pin. On that page you can edit the thought, use **Copy note** or **Copy image**, drag **Drag image** into another app to drop the crop file there, or delete the capture.

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

`pnpm dev` starts the app with hot reload. It runs in the menu bar and opens no window.

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

`scripts/e2e/verify-macos.ts` drives the real app from outside. It presses the global shortcut over a marker window and checks the panel size and position. It also checks draft retention, focus return, the saved pin pixel, failed writes, restarts, the library, and the quit dialog. It reads the app's own event log and real window bounds.

```sh
node scripts/e2e/verify-macos.ts dev       # builds, then tests out/ with Electron
pnpm package:dir && node scripts/e2e/verify-macos.ts packaged
```

The script takes over the mouse and keyboard for about a minute. The terminal needs **Accessibility** access, Xcode command line tools must be installed for `swiftc`, and the app under test needs **Screen & System Audio Recording** access. It writes every result and the event log to a temporary folder and prints the path. It refuses to type unless the marker or the app under test is in front.

## Release

`.github/workflows/release.yml` publishes builds to GitHub Releases.

- A push to `main` replaces the **Preview build** prerelease with fresh macOS and Windows builds.
- A tag such as `v0.2.0` publishes a versioned release. The tag must match `version` in `package.json`.

To cut a release, bump `version` in `package.json`, merge it, then run `git tag v<version>` and `git push origin v<version>`.
