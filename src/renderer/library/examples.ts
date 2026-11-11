import { createContext } from "react";

/** The tutorial's example captures (src/main/pin-tutorial.ts), by id, which the list tags as examples. */
export const ExamplesContext = createContext<ReadonlySet<string>>(new Set());
