export const CAPTURE_ACCELERATOR = "CommandOrControl+Alt+P";

export const shortcutLabel = (isMac: boolean): string =>
  isMac ? "⌥⌘P" : "Ctrl+Alt+P";

export const saveShortcutLabel = (isMac: boolean): string =>
  isMac ? "⌘↩" : "Ctrl+Enter";

export const TRAY_CAPTURE_DELAY_MS = 3000;
