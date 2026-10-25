export const isMac = navigator.userAgent.includes("Mac");

export const isWindows = navigator.userAgent.includes("Windows");

/** Lets styles.css adjust to the system: macOS shows the window's material, Windows has smaller corners. */
export const markPlatform = (): void => {
  let platform = "other";

  if (isMac) {
    platform = "mac";
  } else if (isWindows) {
    platform = "windows";
  }

  document.documentElement.dataset.platform = platform;
};
