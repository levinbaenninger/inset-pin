import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { canSaveThought, THOUGHT_MAX } from "@shared/capture-record";
import type { DraftContent, DraftView, WriteStatus } from "@shared/contracts";
import type { PinGeometry } from "@shared/geometry";
import { saveShortcutLabel } from "@shared/shortcut";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { captureBridge } from "@/shared/bridge";
import { useLocalKeys } from "@/shared/keys";
import { isMac } from "@/shared/platform";
import { useExpiringState } from "@/shared/use-expiring-state";

import { PinPreview } from "./pin-preview";

const api = captureBridge();

const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

/** How long a first click on Discard waits for the second. */
const DISCARD_ARM_MS = 4000;

const PLACEHOLDER = "For example: this total ignores the discount";

/** Discard asks for a second click once there is a thought to lose. */
const useArmedDiscard = (needsConfirm: boolean, discard: () => void) => {
  const [armedAt, setArmedAt] = useExpiringState<true>(DISCARD_ARM_MS);
  const armed = armedAt !== null;

  const disarm = useCallback((): void => {
    setArmedAt(null);
  }, [setArmedAt]);

  const press = (): void => {
    if (armed || !needsConfirm) {
      discard();
    } else {
      setArmedAt(true);
    }
  };

  return { armed, disarm, press };
};

interface DraftCaptionProps {
  readonly view: DraftView;
}

/** A set-aside draft says so, because the shortcut brought it back instead of capturing the new point. */
const DraftCaption = ({ view }: DraftCaptionProps) => {
  const time = timeFormat.format(new Date(view.capturedAt));

  if (view.reopened) {
    return (
      <p className="leading-snug">
        <span className="text-foreground font-medium">
          Unsaved draft from {time}
        </span>
        <span className="text-muted-foreground block">
          Save or discard it to capture something new.
        </span>
      </p>
    );
  }

  return (
    <p className="text-muted-foreground truncate">
      {[view.sourceLabel, time].filter((part) => part !== null).join(" · ")}
    </p>
  );
};

export interface DraftEditorProps {
  readonly view: DraftView;
}

/** Every change goes to main at once, so main has the latest copy on blur, quit or a crash. */
export const DraftEditor = ({ view }: DraftEditorProps) => {
  const [content, setContent] = useState<DraftContent>(view.seed);

  // Disables Save from the click until main reports a newer write status.
  const [submittedWhile, setSubmittedWhile] = useState<WriteStatus | null>(
    null
  );

  const thoughtRef = useRef<HTMLTextAreaElement>(null);
  const busy = view.write.kind === "saving" || submittedWhile === view.write;
  const savable = canSaveThought(content.thought);

  const { draftId, write } = view;

  const discard = useArmedDiscard(savable, () => {
    api.discard(draftId);
  });

  const { armed, disarm } = discard;

  const change = (next: DraftContent): void => {
    disarm();
    setContent(next);
    api.edit({ content: next, id: draftId });
  };

  const save = useCallback((): void => {
    if (busy || !savable) {
      return;
    }

    setSubmittedWhile(write);
    api.save({ content, id: draftId });
  }, [busy, content, draftId, savable, write]);

  // While Discard waits for its second click, Escape only takes the question back.
  const dismiss = useCallback((): void => {
    if (armed) {
      disarm();
    } else {
      api.dismiss();
    }
  }, [armed, disarm]);

  useLocalKeys({ onEscape: dismiss, onSave: save });

  useEffect(() => {
    const field = thoughtRef.current;

    if (field !== null) {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }
  }, []);

  return (
    <form
      className="flex flex-col gap-3 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <PinPreview
        caption={<DraftCaption view={view} />}
        disabled={busy}
        frame={view.frame}
        geometry={content}
        onChange={(geometry: PinGeometry) => {
          change({ ...content, ...geometry });
        }}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="thought">What matters here?</Label>
        <Textarea
          className="max-h-40 min-h-16 resize-none"
          disabled={busy}
          id="thought"
          maxLength={THOUGHT_MAX}
          onChange={(event) => {
            change({ ...content, thought: event.target.value });
          }}
          placeholder={PLACEHOLDER}
          ref={thoughtRef}
          rows={2}
          value={content.thought}
        />
      </div>
      {view.write.kind === "failed" ? (
        <Alert variant="destructive">
          <HugeiconsIcon icon={Alert02Icon} />
          <AlertTitle>Not saved. Your draft is kept.</AlertTitle>
          <AlertDescription>{view.write.message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          disabled={busy}
          onClick={() => {
            discard.press();
          }}
          size="sm"
          type="button"
          variant={armed ? "destructive" : "ghost"}
        >
          {armed ? "Click again to discard" : "Discard"}
        </Button>
        <p
          aria-live="polite"
          className="text-muted-foreground ml-auto truncate text-xs"
        >
          {armed ? "Esc keeps it" : "Esc keeps the draft"}
        </p>
        <Button disabled={busy || !savable} size="sm" type="submit">
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {view.write.kind === "failed" ? "Retry" : "Save"}
          <Kbd>{saveShortcutLabel(isMac)}</Kbd>
        </Button>
      </div>
    </form>
  );
};
