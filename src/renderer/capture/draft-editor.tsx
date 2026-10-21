import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { canSaveThought, THOUGHT_MAX } from "@shared/capture-record";
import type { DraftContent, DraftView, WriteStatus } from "@shared/contracts";
import type { PinGeometry } from "@shared/geometry";
import { saveShortcutLabel } from "@shared/shortcut";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { captureBridge } from "@/shared/bridge";
import { useLocalKeys } from "@/shared/keys";
import { isMac } from "@/shared/platform";

import { PinPreview } from "./pin-preview";

const api = captureBridge();

const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

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

  const change = (next: DraftContent): void => {
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

  const dismiss = useCallback((): void => {
    api.dismiss();
  }, []);

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
        disabled={busy}
        frame={view.frame}
        geometry={content}
        onChange={(geometry: PinGeometry) => {
          change({ ...content, ...geometry });
        }}
      />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="thought">What matters here?</Label>
          <span className="text-muted-foreground truncate text-xs">
            {[view.sourceLabel, timeFormat.format(new Date(view.capturedAt))]
              .filter((part) => part !== null)
              .join(" · ")}
          </span>
        </div>
        <Textarea
          className="max-h-40 min-h-16 resize-none"
          disabled={busy}
          id="thought"
          maxLength={THOUGHT_MAX}
          onChange={(event) => {
            change({ ...content, thought: event.target.value });
          }}
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
          <AlertAction>
            <Button
              disabled={busy || !savable}
              size="xs"
              type="submit"
              variant="outline"
            >
              Retry
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <Button
          disabled={busy}
          onClick={() => {
            api.discard(draftId);
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          Discard
        </Button>
        <Button disabled={busy || !savable} size="sm" type="submit">
          {busy ? <Spinner data-icon="inline-start" /> : null}
          Save
          <Kbd>{saveShortcutLabel(isMac)}</Kbd>
        </Button>
      </div>
    </form>
  );
};
