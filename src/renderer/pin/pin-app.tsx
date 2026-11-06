import {
  Alert02Icon,
  ArrowUpRight01Icon,
  Cancel01Icon,
  Image01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { CaptureDetail } from "@shared/contracts";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { pinBridge } from "@/shared/bridge";
import { useLocalKeys } from "@/shared/keys";
import { PinMarker } from "@/shared/pin-marker";
import { useExpiringState } from "@/shared/use-expiring-state";

const api = pinBridge();

const COPIED_MS = 1600;

/** Long enough to read why nothing was copied. */
const FAILED_MS = 4000;

/** A refusal with Retry stays long enough to reach for the button. */
const RETRY_MS = 8000;

/** A copy refused for unsaved changes offers Retry, which saves them in the library. */
type CopyOutcome =
  | { readonly kind: "copied" }
  | { readonly kind: "saved" }
  | {
      readonly kind: "failed";
      readonly message: string;
      readonly retry: boolean;
    };

const UNREACHABLE = "Inset couldn’t reach the app. Try again.";

type Saved = Extract<CaptureDetail, { kind: "ok" }>;

/** Main knows which capture this window pins. */
const useCapture = (): Saved | null => {
  const [capture, setCapture] = useState<Saved | null>(null);

  useEffect(() => {
    const load = async (): Promise<void> => {
      const detail = await api.get();

      setCapture(detail?.kind === "ok" ? detail : null);
    };

    void load();

    return api.on("changed", () => {
      void load();
    });
  }, []);

  return capture;
};

const copyImage = async (
  onDone: (outcome: CopyOutcome) => void
): Promise<void> => {
  const result = await api.copyImage().catch(() => ({
    message: UNREACHABLE,
    ok: false as const,
    retry: false,
  }));

  onDone(
    result.ok
      ? { kind: "copied" }
      : { kind: "failed", message: result.message, retry: result.retry }
  );
};

const retrySave = async (
  onDone: (outcome: CopyOutcome) => void
): Promise<void> => {
  const result = await api.retrySave().catch(() => ({
    message: UNREACHABLE,
    ok: false as const,
  }));

  onDone(
    result.ok
      ? { kind: "saved" }
      : {
          kind: "failed",
          message: `Couldn’t save your changes. ${result.message}`,
          retry: true,
        }
  );
};

const percent = (value: number, total: number): string =>
  `${((value + 0.5) / total) * 100}%`;

/** Round buttons on the image, shown while the pointer is over the floating capture. */
const ImageButton = ({
  children,
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) => (
  <button
    aria-label={label}
    className="app-no-drag focus-visible:ring-ring/50 flex size-6 items-center justify-center rounded-full bg-black/60 text-white outline-none hover:bg-black/80 focus-visible:ring-3"
    onClick={onClick}
    title={label}
    type="button"
  >
    {children}
  </button>
);

/** The window's drag region gets no pointer events, so the buttons show while the window has the keyboard, after a click. */
const useWindowFocused = (): boolean => {
  const [focused, setFocused] = useState(document.hasFocus());

  useEffect(() => {
    const update = (): void => {
      setFocused(document.hasFocus());
    };

    window.addEventListener("focus", update);
    window.addEventListener("blur", update);

    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, []);

  return focused;
};

const COPY_BUTTON = {
  copied: { icon: Tick02Icon, label: "Copied" },
  failed: { icon: Alert02Icon, label: "Couldn’t copy" },
  idle: { icon: Image01Icon, label: "Copy image" },
  saved: { icon: Image01Icon, label: "Copy image" },
} as const;

const lifetimeOf = (outcome: CopyOutcome): number => {
  if (outcome.kind !== "failed") {
    return outcome.kind === "saved" ? FAILED_MS : COPIED_MS;
  }

  return outcome.retry ? RETRY_MS : FAILED_MS;
};

const NOTE =
  "flex items-start gap-1.5 text-xs leading-snug font-medium wrap-break-word text-white";

/** Under the image: the title, or how the last copy went. */
const Caption = ({
  onRetry,
  outcome,
  title,
}: {
  readonly outcome: CopyOutcome | null;
  readonly title: string;
  readonly onRetry: () => void;
}) => {
  if (outcome?.kind === "failed") {
    return (
      <p className={NOTE} data-testid="copy-failed" role="alert">
        <HugeiconsIcon
          className="text-destructive mt-px shrink-0"
          icon={Alert02Icon}
          size={13}
        />
        <span className="line-clamp-3">{outcome.message}</span>
        {outcome.retry ? (
          <button
            className="app-no-drag focus-visible:ring-ring/50 pointer-events-auto ml-auto shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-white outline-none hover:bg-white/25 focus-visible:ring-3"
            data-testid="retry-save"
            onClick={onRetry}
            type="button"
          >
            Retry
          </button>
        ) : null}
      </p>
    );
  }

  if (outcome?.kind === "saved") {
    return (
      <output className={NOTE} data-testid="saved">
        <HugeiconsIcon className="mt-px shrink-0" icon={Tick02Icon} size={13} />
        <span className="line-clamp-3">Saved. You can copy it now.</span>
      </output>
    );
  }

  return (
    <p className="line-clamp-2 text-xs leading-snug wrap-break-word text-white">
      {title}
    </p>
  );
};

const Pin = ({ capture }: { readonly capture: Saved }) => {
  const [lifetime, setLifetime] = useState(COPIED_MS);
  const [copied, setCopied] = useExpiringState<CopyOutcome>(lifetime);
  const button = COPY_BUTTON[copied?.kind ?? "idle"];
  const focused = useWindowFocused();
  const { image, pins, title } = capture;

  const close = useCallback((): void => {
    api.close();
  }, []);

  const show = (outcome: CopyOutcome): void => {
    setLifetime(lifetimeOf(outcome));
    setCopied(outcome);
  };

  useLocalKeys({ onEscape: close });

  return (
    <main className="group app-drag relative flex h-svh w-svw items-center justify-center overflow-hidden bg-black select-none">
      {/* The crop keeps its shape while Windows resizes the window freely (src/main/pin-windows.ts). */}
      <div
        className="relative aspect-(--image-aspect) w-(--image-w)"
        style={{
          "--image-aspect": `${image.widthPx} / ${image.heightPx}`,
          "--image-w": `min(100svw, 100svh * ${image.widthPx / image.heightPx})`,
        }}
      >
        <img
          alt={title}
          className="block size-full"
          draggable={false}
          src={image.url}
        />
        {pins.map((pin, index) => (
          <PinMarker
            // Pins have no identity beyond their number.
            // oxlint-disable-next-line react/no-array-index-key
            key={index}
            left={percent(pin.x, image.widthPx)}
            number={index + 1}
            top={percent(pin.y, image.heightPx)}
          />
        ))}
      </div>
      <div
        className="absolute inset-x-1.5 top-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 data-focused:opacity-100"
        data-focused={focused ? "" : undefined}
      >
        <ImageButton label="Close" onClick={close}>
          <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
        </ImageButton>
        <span className="flex-1" />
        <ImageButton
          label={button.label}
          onClick={() => {
            void copyImage(show);
          }}
        >
          <HugeiconsIcon icon={button.icon} size={14} />
        </ImageButton>
        <ImageButton
          label="Show in library"
          onClick={() => {
            api.openInLibrary();
          }}
        >
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} />
        </ImageButton>
      </div>
      {/* The padding sits outside the clamped text, or a third line would show through it. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent px-2.5 pt-6 pb-2">
        <Caption
          onRetry={() => {
            void retrySave(show);
          }}
          outcome={copied}
          title={title}
        />
      </div>
    </main>
  );
};

export const PinApp = () => {
  const capture = useCapture();

  return capture === null ? null : <Pin capture={capture} />;
};
