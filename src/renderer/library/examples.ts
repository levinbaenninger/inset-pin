import { createContext } from "react";

/** The tutorial's example captures (src/main/pin-tutorial.ts), by id, which the list tags as examples. */
export const ExamplesContext = createContext<ReadonlySet<string>>(new Set());

/** Examples this window's Remove Examples took out: one still open moves on once it's gone. */
const removed = new Set<string>();

export const removeExamplesHere = (ids: Iterable<string>): void => {
  for (const id of ids) {
    removed.add(id);
  }
};

export const removedHere = (id: string): boolean => removed.has(id);
