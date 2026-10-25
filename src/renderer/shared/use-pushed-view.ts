import { useEffect, useState } from "react";

/** Loads the main process's view once and follows every pushed update; a push wins over a slower initial load. */
export const usePushedView = <T>(
  load: () => Promise<T>,
  subscribe: (listener: (view: T) => void) => () => void,
  initial: T
): T => {
  const [view, setView] = useState<T>(initial);

  useEffect(() => {
    let pushed = false;

    const unsubscribe = subscribe((next) => {
      pushed = true;
      setView(next);
    });

    const fetchInitial = async (): Promise<void> => {
      const first = await load();

      if (!pushed) {
        setView(first);
      }
    };

    void fetchInitial();

    return unsubscribe;
  }, [load, subscribe]);

  return view;
};
