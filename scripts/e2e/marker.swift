import AppKit

let args = CommandLine.arguments
guard args.count == 4, let x = Double(args[1]), let y = Double(args[2]), let size = Double(args[3]) else {
  FileHandle.standardError.write("usage: marker <x> <y> <size>  (global top-left DIP, centre of the square)\n".data(using: .utf8)!)
  exit(64)
}

final class KeyableWindow: NSWindow {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { true }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)

let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
let frame = NSRect(x: x - size / 2, y: primaryHeight - y - size / 2, width: size, height: size)
let window = KeyableWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
window.backgroundColor = NSColor(srgbRed: 1, green: 0, blue: 1, alpha: 1)
window.level = .floating
window.isOpaque = true
window.hasShadow = false
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
print("ready")
fflush(stdout)
app.run()
