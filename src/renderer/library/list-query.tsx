import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface ListQuery {
  readonly query: string;
  readonly setQuery: (query: string) => void;
}

const ListQueryContext = createContext<ListQuery | null>(null);

/** The search outlives the list pane, so a delete or the empty right pane can follow what the list shows. */
export const ListQueryProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const [query, setQuery] = useState("");
  const value = useMemo(() => ({ query, setQuery }), [query]);

  return <ListQueryContext value={value}>{children}</ListQueryContext>;
};

export const useListQuery = (): ListQuery => {
  const value = use(ListQueryContext);

  if (value === null) {
    throw new Error("useListQuery needs a ListQueryProvider");
  }

  return value;
};
