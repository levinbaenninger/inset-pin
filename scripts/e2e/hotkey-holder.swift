import Carbon
import Foundation

// Holds ⌥⌘P system-wide so the app under test sees a real shortcut conflict.
var hotKey: EventHotKeyRef?
let id = EventHotKeyID(signature: OSType(0x494E5354), id: 1)
let status = RegisterEventHotKey(UInt32(kVK_ANSI_P), UInt32(cmdKey | optionKey), id, GetApplicationEventTarget(), 0, &hotKey)

print(status == noErr ? "holding" : "failed \(status)")
fflush(stdout)
RunLoop.main.run()
