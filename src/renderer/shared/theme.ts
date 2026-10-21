/** Follows the system appearance with the preset's `.dark` tokens. */
export const followSystemTheme = (): void => {
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  const apply = (): void => {
    document.documentElement.classList.toggle("dark", media.matches);
  };

  apply();
  media.addEventListener("change", apply);
};
