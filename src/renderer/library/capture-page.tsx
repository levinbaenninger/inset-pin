import {
  Alert02Icon,
  ArrowLeft01Icon,
  Copy01Icon,
  Delete02Icon,
  Image01Icon,
  PencilEdit02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { canSaveThought, THOUGHT_MAX } from "@shared/capture-record";
import type { ActionResult, CaptureDetail } from "@shared/contracts";
import { saveShortcutLabel } from "@shared/shortcut";
import {
  getRouteApi,
  Link,
  useBlocker,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useCallback, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { libraryBridge } from "@/shared/bridge";
import { useLocalKeys } from "@/shared/keys";
import { isMac } from "@/shared/platform";
import { useExpiringState } from "@/shared/use-expiring-state";

import { useCaptureShortcuts } from "./capture-commands";
import { captureKeyLabels } from "./capture-keys";
import { formatCaptureTime, readOnlyText, sourceText, viaText } from "./format";
import { selectionAfterRemoval, visibleIds } from "./list-model";
import { useListQuery } from "./list-query";
import { SavedImage } from "./saved-image";

const api = libraryBridge();

const route = getRouteApi("/captures/$captureId");
const rootRoute = getRouteApi("__root__");

/** How long a copy button says "Copied". */
const COPIED_MS = 1600;

type SavedCapture = Extract<CaptureDetail, { kind: "ok" }>;

/** Only the one-pane layout needs a way back; two panes keep the list in view. */
const BackLink = () => (
  <Button asChild className="self-start md:hidden" size="sm" variant="ghost">
    <Link to="/">
      <HugeiconsIcon data-icon="inline-start" icon={ArrowLeft01Icon} />
      Recent captures
    </Link>
  </Button>
);

const Unavailable = ({
  description,
  title,
}: {
  readonly title: string;
  readonly description: string;
}) => (
  <div className="flex flex-col gap-4 p-6">
    <BackLink />
    <div className="text-muted-foreground flex gap-3 text-sm">
      <HugeiconsIcon className="mt-0.5 shrink-0" icon={Alert02Icon} size={16} />
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground font-medium">{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  </div>
);

const NOT_SAVED: ActionResult = {
  message: "The thought could not be saved. Try again.",
  ok: false,
};

/** Never rejects, so the editor always unlocks. */
const updateThought = async (
  id: SavedCapture["id"],
  thought: string
): Promise<ActionResult> => {
  try {
    return await api.updateThought({ id, thought });
  } catch {
    return NOT_SAVED;
  }
};

interface ThoughtEditorProps {
  readonly capture: SavedCapture;
  /** Null means cancelled. */
  readonly onDone: (result: ActionResult | null) => Promise<void>;
}

const ThoughtEditor = ({ capture, onDone }: ThoughtEditorProps) => {
  const [thought, setThought] = useState(capture.thought);
  const [saving, setSaving] = useState(false);
  const savable = canSaveThought(thought) && !saving;
  const changed = thought !== capture.thought;

  // Choosing another capture while editing would otherwise drop the change silently.
  const leaving = useBlocker({
    enableBeforeUnload: false,
    shouldBlockFn: () => changed,
    withResolver: true,
  });

  // The field and Cancel stay locked until the save settles, so no edit is silently dropped.
  const save = useCallback(async (): Promise<void> => {
    if (!savable) {
      return;
    }

    setSaving(true);
    await onDone(await updateThought(capture.id, thought));
    setSaving(false);
  }, [capture.id, onDone, savable, thought]);

  const cancel = useCallback((): void => {
    if (!saving) {
      void onDone(null);
    }
  }, [onDone, saving]);

  const saveNow = useCallback((): void => {
    void save();
  }, [save]);

  // Asked when another capture was chosen: saving goes on to it, like Save and quit in the panel.
  const saveAndLeave = useCallback(async (): Promise<void> => {
    if (!savable) {
      return;
    }

    setSaving(true);
    const result = await updateThought(capture.id, thought);

    if (result.ok) {
      leaving.proceed?.();

      return;
    }

    leaving.reset?.();
    await onDone(result);
    setSaving(false);
  }, [capture.id, leaving, onDone, savable, thought]);

  const saveAndLeaveNow = useCallback((): void => {
    void saveAndLeave();
  }, [saveAndLeave]);

  useLocalKeys({
    onEscape: cancel,
    onSave: leaving.status === "blocked" ? saveAndLeaveNow : saveNow,
  });

  return (
    <>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            leaving.reset?.();
          }
        }}
        open={leaving.status === "blocked"}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save your change?</AlertDialogTitle>
            <AlertDialogDescription>
              This thought has an unsaved change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                leaving.reset?.();
              }}
            >
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                leaving.proceed?.();
              }}
              variant="destructive"
            >
              Discard
            </AlertDialogAction>
            <Button disabled={!savable} onClick={saveAndLeaveNow}>
              {saving ? <Spinner data-icon="inline-start" /> : null}
              Save
              <Kbd>{saveShortcutLabel(isMac)}</Kbd>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          saveNow();
        }}
      >
        <Textarea
          aria-label="Thought"
          autoFocus
          className="min-h-28"
          maxLength={THOUGHT_MAX}
          onChange={(event) => {
            setThought(event.target.value);
          }}
          onFocus={(event) => {
            const end = event.currentTarget.value.length;

            event.currentTarget.setSelectionRange(end, end);
          }}
          readOnly={saving}
          value={thought}
        />
        <div className="flex items-center justify-end gap-2">
          <Button
            disabled={saving}
            onClick={cancel}
            size="sm"
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button disabled={!savable} size="sm" type="submit">
            {saving ? <Spinner data-icon="inline-start" /> : null}
            Save thought
            <Kbd>{saveShortcutLabel(isMac)}</Kbd>
          </Button>
        </div>
      </form>
    </>
  );
};

const CopyButton = ({
  copied,
  icon,
  label,
  onClick,
  shortcut,
}: {
  readonly copied: boolean;
  readonly icon: typeof Copy01Icon;
  readonly label: string;
  readonly onClick: () => void;
  readonly shortcut: string;
}) => (
  <Button
    onClick={onClick}
    size="sm"
    title={`${label} (${shortcut})`}
    variant="outline"
  >
    <HugeiconsIcon data-icon="inline-start" icon={copied ? Tick02Icon : icon} />
    {copied ? "Copied" : label}
  </Button>
);

interface DeleteButtonProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onDelete: () => void;
  readonly shortcut: string;
}

const DeleteButton = ({
  onDelete,
  onOpenChange,
  open,
  shortcut,
}: DeleteButtonProps) => (
  <AlertDialog onOpenChange={onOpenChange} open={open}>
    <AlertDialogTrigger asChild>
      <Button
        className="ml-auto"
        size="sm"
        title={`Delete (${shortcut})`}
        variant="ghost-destructive"
      >
        <HugeiconsIcon data-icon="inline-start" icon={Delete02Icon} />
        Delete
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete this capture?</AlertDialogTitle>
        <AlertDialogDescription>This can’t be undone.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={onDelete} variant="destructive">
          Delete
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

const SavedCaptureView = ({ capture }: { readonly capture: SavedCapture }) => {
  const navigate = useNavigate();
  const router = useRouter();
  const captures = rootRoute.useLoaderData();
  const { query } = useListQuery();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const keys = captureKeyLabels(isMac);

  const [status, setStatus] = useState<{
    readonly text: string;
    readonly failed: boolean;
  } | null>(null);

  const [copied, setCopied] = useExpiringState<"note" | "image">(COPIED_MS);

  const copy = async (what: "note" | "image"): Promise<void> => {
    const result =
      what === "note"
        ? await api.copyNote(capture.id)
        : await api.copyImage(capture.id);

    if (result.ok) {
      setCopied(what);
      setStatus({
        failed: false,
        text: what === "note" ? "Note copied." : "Image copied with its pin.",
      });
    } else {
      setStatus({ failed: true, text: result.message });
    }
  };

  const finishEdit = useCallback(
    async (result: ActionResult | null): Promise<void> => {
      if (result === null) {
        setEditing(false);
        setStatus(null);

        return;
      }

      if (!result.ok) {
        setStatus({ failed: true, text: result.message });

        return;
      }

      // Leave the editor only once the new thought is loaded, so the old one never flashes.
      await router.invalidate();
      setEditing(false);
      setStatus({ failed: false, text: "Thought saved." });
    },
    [router]
  );

  const remove = async (): Promise<void> => {
    const next = selectionAfterRemoval(visibleIds(captures, query), capture.id);

    const result = await api.remove(capture.id);

    if (!result.ok) {
      setStatus({ failed: true, text: result.message });

      return;
    }

    // The delete was confirmed, so an unsaved edit of the deleted thought must not hold the navigation.
    if (next !== null) {
      await navigate({
        ignoreBlocker: true,
        params: { captureId: next },
        to: "/captures/$captureId",
      });

      return;
    }

    // The empty pane opens the newest capture the list shows, so it must not see the deleted one.
    await router.invalidate();
    await navigate({ ignoreBlocker: true, to: "/" });
  };

  const startEditing = (): void => {
    setStatus(null);
    setEditing(true);
  };

  useCaptureShortcuts(
    {
      askDelete: () => {
        setConfirmingDelete(true);
      },
      copyImage: () => {
        void copy("image");
      },
      copyNote: () => {
        void copy("note");
      },
      edit: startEditing,
      id: capture.id,
    },
    !editing
  );

  return (
    <article className="flex flex-col gap-5">
      <section aria-label="Thought" className="flex flex-col gap-2">
        {editing ? (
          <ThoughtEditor capture={capture} onDone={finishEdit} />
        ) : (
          <p className="max-w-prose text-lg leading-relaxed wrap-break-word whitespace-pre-wrap">
            {capture.thought}
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          {formatCaptureTime(capture.capturedAt)} ·{" "}
          {sourceText(capture.sourceLabel)} · {viaText(capture.invokedVia)}
        </p>
      </section>
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton
          copied={copied === "note"}
          icon={Copy01Icon}
          label="Copy note"
          onClick={() => {
            void copy("note");
          }}
          shortcut={keys.copyNote}
        />
        <CopyButton
          copied={copied === "image"}
          icon={Image01Icon}
          label="Copy image"
          onClick={() => {
            void copy("image");
          }}
          shortcut={keys.copyImage}
        />
        <Button
          disabled={editing}
          onClick={startEditing}
          size="sm"
          title={`Edit thought (${keys.edit})`}
          variant="outline"
        >
          <HugeiconsIcon data-icon="inline-start" icon={PencilEdit02Icon} />
          Edit thought
        </Button>
        <DeleteButton
          onDelete={() => {
            void remove();
          }}
          onOpenChange={setConfirmingDelete}
          open={confirmingDelete}
          shortcut={keys.delete}
        />
      </div>
      <p
        aria-live="polite"
        className={
          status?.failed === true ? "text-destructive -mt-3 text-sm" : "sr-only"
        }
      >
        {status?.text}
      </p>
      <figure className="flex flex-col gap-2">
        <div
          className="w-fit max-w-full cursor-grab active:cursor-grabbing"
          draggable
          onDragStart={(event) => {
            event.preventDefault();
            api.startImageDrag(capture.id);
          }}
          title="Drag into another app"
        >
          <SavedImage
            alt="The saved crop with the pin on the point that matters"
            image={capture.image}
            pin={capture.pin}
            size="full"
          />
        </div>
      </figure>
    </article>
  );
};

export const CapturePage = () => {
  const detail = route.useLoaderData();

  if (detail === null) {
    return (
      <Unavailable
        description="It may have been deleted."
        title="This capture no longer exists"
      />
    );
  }

  if (detail.kind === "readOnly") {
    return (
      <Unavailable
        description={readOnlyText(detail.why)}
        title="This capture can’t be shown"
      />
    );
  }

  return (
    <div className="pt-page flex flex-col gap-4 px-6 pb-8 md:px-8">
      <BackLink />
      <h2 className="sr-only">{detail.title}</h2>
      {/* Keyed by id only: a refresh after an edit keeps the status line and its announcement. */}
      <SavedCaptureView capture={detail} key={detail.id} />
    </div>
  );
};
