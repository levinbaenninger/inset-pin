Test build of Inset Context Pin. It is not signed with a developer certificate. See the README section "Install a test build" for the macOS Gatekeeper and Windows SmartScreen steps.

Install once. The macOS app and the Windows installer update themselves from the Preview build release. The portable Windows zips don't.

| Platform | File |
| --- | --- |
| macOS, Apple silicon | `inset-context-pin-*-mac-arm64.dmg` |
| macOS, Intel | `inset-context-pin-*-mac-x64.dmg` |
| Windows, x64 | `inset-context-pin-*-win-x64.exe` (installer) or `-win-x64.zip` (portable) |
| Windows, Arm | `inset-context-pin-*-win-arm64.zip` (portable) |

Capture behaviour is verified only on the platforms named in IMPLEMENTATION_REPORT.md. A build for another platform is not evidence that capture works there.
