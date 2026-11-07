import { parseQuery } from "@shared/search";
import type { ParsedQuery } from "@shared/search";
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode, RefObject } from "react";

import type { ListKind } from "./list-model";

interface LibraryState {
  readonly query: string;
  readonly parsed: ParsedQuery;
  readonly setQuery: (query: string) => void;
  readonly list: ListKind;
  readonly setList: (list: ListKind) => void;
  readonly sheetOpen: boolean;
  readonly setSheetOpen: (open: boolean) => void;
  readonly searchRef: RefObject<HTMLInputElement | null>;
  /** Moves "Today" along when the window comes back after midnight. */
  readonly now: Date;
}

const LibraryContext = createContext<LibraryState | null>(null);

/** What outlives a capture page: the search, the list shown, the sheet, and the day. */
export const LibraryStateProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const [query, setQuery] = useState("");
  const [list, setList] = useState<ListKind>("active");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const refresh = (): void => {
      setNow(new Date());
    };

    window.addEventListener("focus", refresh);

    return () => {
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const value = useMemo(
    () => ({
      list,
      now,
      parsed: parseQuery(query),
      query,
      searchRef,
      setList,
      setQuery,
      setSheetOpen,
      sheetOpen,
    }),
    [list, now, query, sheetOpen]
  );

  return <LibraryContext value={value}>{children}</LibraryContext>;
};

export const useLibraryState = (): LibraryState => {
  const value = use(LibraryContext);

  if (value === null) {
    throw new Error("useLibraryState needs a LibraryStateProvider");
  }

  return value;
};
