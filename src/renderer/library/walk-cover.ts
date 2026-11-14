/**
 * Whether the walkthrough covers the library. Its key guard holds every key
 * the page sees, but the menu bar acts first: a click in it, or Edit › Copy,
 * which ⌘C runs. While the walkthrough runs, neither acts on the list or the
 * capture behind it.
 */
let covered = false;

export const walkCovers = (): boolean => covered;

export const setWalkCovers = (on: boolean): void => {
  covered = on;
};
