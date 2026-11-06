import { Alert02Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface Notice {
  readonly text: string;
  readonly failed?: boolean;
  /** A button beside the text: Undo after Mark as done, Retry on a copy refused for unsaved changes. */
  readonly action?: { readonly label: string; readonly run: () => void };
}

const NOTICE_MS = 3200;

/** A refusal with Retry stays long enough to reach for the button. */
const ACTION_FAILED_MS = 8000;

const NoticeContext = createContext<((notice: Notice | null) => void) | null>(
  null
);

/** The library's short confirmations, in one place at the foot of the window. */
export const NoticeProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const [notice, setNotice] = useState<
    (Notice & { readonly key: number }) | null
  >(null);

  const say = useCallback((next: Notice | null): void => {
    setNotice(next === null ? null : { ...next, key: Date.now() });
  }, []);

  useEffect(() => {
    const timer =
      notice === null
        ? null
        : setTimeout(
            () => {
              setNotice(null);
            },
            notice.failed === true && notice.action !== undefined
              ? ACTION_FAILED_MS
              : NOTICE_MS
          );

    return () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [notice]);

  const value = useMemo(() => say, [say]);

  return (
    <NoticeContext value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4"
      >
        {notice === null ? null : (
          <p
            className={cn(
              "bg-foreground text-background animate-in fade-in-0 slide-in-from-bottom-1 pointer-events-auto flex items-center gap-2 rounded-full py-1 pr-1 pl-3 text-xs font-medium shadow-lg",
              notice.action === undefined && "pr-3"
            )}
            data-testid="notice"
            key={notice.key}
            role={notice.failed === true ? "alert" : "status"}
          >
            <HugeiconsIcon
              className={
                notice.failed === true ? "text-destructive" : undefined
              }
              icon={notice.failed === true ? Alert02Icon : Tick02Icon}
              size={13}
            />
            {notice.text}
            {notice.action === undefined ? null : (
              <button
                className="bg-background/15 hover:bg-background/25 focus-visible:ring-background/50 rounded-full px-2 py-0.5 outline-none focus-visible:ring-2"
                data-testid="notice-action"
                onClick={() => {
                  notice.action?.run();
                  setNotice(null);
                }}
                type="button"
              >
                {notice.action.label}
              </button>
            )}
          </p>
        )}
      </div>
    </NoticeContext>
  );
};

export const useNotice = (): ((notice: Notice | null) => void) => {
  const say = use(NoticeContext);

  if (say === null) {
    throw new Error("useNotice needs a NoticeProvider");
  }

  return say;
};
