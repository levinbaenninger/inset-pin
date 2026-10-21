import {
  Alert02Icon,
  ArrowLeft01Icon,
  Copy01Icon,
  Delete02Icon,
  DragDropIcon,
  Image01Icon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { canSaveThought, THOUGHT_MAX } from "@shared/capture-record";
import type { ActionResult, CaptureDetail } from "@shared/contracts";
import {
  getRouteApi,
  Link,
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { libraryBridge } from "@/shared/bridge";
import { useLocalKeys } from "@/shared/keys";

import { formatCaptureTime, readOnlyText, sourceText, viaText } from "./format";
import { SavedImage } from "./saved-image";

const api = libraryBridge();

const route = getRouteApi("/captures/$captureId");

type SavedCapture = Extract<CaptureDetail, { kind: "ok" }>;

const BackLink = () => (
  <Button asChild size="sm" variant="ghost">
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
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <HugeiconsIcon icon={Alert02Icon} />
      </EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <BackLink />
    </EmptyContent>
  </Empty>
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

  useLocalKeys({ onEscape: cancel, onSave: saveNow });

  return (
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
        readOnly={saving}
        value={thought}
      />
      <div className="flex justify-end gap-2">
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
        </Button>
      </div>
    </form>
  );
};

const SavedCaptureView = ({ capture }: { readonly capture: SavedCapture }) => {
  const navigate = useNavigate();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState("");

  const copy = async (what: "note" | "image"): Promise<void> => {
    const result =
      what === "note"
        ? await api.copyNote(capture.id)
        : await api.copyImage(capture.id);

    setStatus(
      result.ok
        ? `${what === "note" ? "Note" : "Image"} copied.`
        : result.message
    );
  };

  const finishEdit = useCallback(
    async (result: ActionResult | null): Promise<void> => {
      if (result === null) {
        setEditing(false);
        setStatus("");

        return;
      }

      if (!result.ok) {
        setStatus(result.message);

        return;
      }

      // Leave the editor only once the new thought is loaded, so the old one never flashes.
      await router.invalidate();
      setEditing(false);
      setStatus("Thought saved.");
    },
    [router]
  );

  const remove = async (): Promise<void> => {
    const result = await api.remove(capture.id);

    if (result.ok) {
      await navigate({ to: "/" });
    } else {
      setStatus(result.message);
    }
  };

  return (
    <article className="flex flex-col gap-6">
      <section aria-label="Thought" className="flex flex-col gap-3">
        {editing ? (
          <ThoughtEditor capture={capture} onDone={finishEdit} />
        ) : (
          <p className="text-xl leading-relaxed font-medium whitespace-pre-wrap">
            {capture.thought}
          </p>
        )}
        <p className="text-muted-foreground text-sm">
          {formatCaptureTime(capture.capturedAt)} ·{" "}
          {sourceText(capture.sourceLabel)} · {viaText(capture.invokedVia)}
        </p>
      </section>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={editing}
          onClick={() => {
            setStatus("");
            setEditing(true);
          }}
          size="sm"
          variant="outline"
        >
          <HugeiconsIcon data-icon="inline-start" icon={PencilEdit02Icon} />
          Edit thought
        </Button>
        <Button
          onClick={() => {
            void copy("note");
          }}
          size="sm"
          variant="outline"
        >
          <HugeiconsIcon data-icon="inline-start" icon={Copy01Icon} />
          Copy note
        </Button>
        <Button
          onClick={() => {
            void copy("image");
          }}
          size="sm"
          variant="outline"
        >
          <HugeiconsIcon data-icon="inline-start" icon={Image01Icon} />
          Copy image
        </Button>
        <Button
          className="cursor-grab"
          draggable
          onDragStart={(event) => {
            event.preventDefault();
            api.startImageDrag(capture.id);
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <HugeiconsIcon data-icon="inline-start" icon={DragDropIcon} />
          Drag image
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive">
              <HugeiconsIcon data-icon="inline-start" icon={Delete02Icon} />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this capture?</AlertDialogTitle>
              <AlertDialogDescription>
                The thought and its image are removed from this computer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  void remove();
                }}
                variant="destructive"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {status}
        </p>
      </div>
      <figure className="flex flex-col gap-2">
        <SavedImage
          alt="The approved crop with the pin on the point that matters"
          image={capture.image}
          pin={capture.pin}
          size="full"
        />
        <figcaption className="text-muted-foreground text-xs">
          The saved crop. Copy it, or drag it into another app with Drag image.
        </figcaption>
      </figure>
    </article>
  );
};

export const CapturePage = () => {
  const detail = route.useLoaderData();

  if (detail === null) {
    return (
      <Unavailable
        description="It may have been deleted. Recent captures lists everything that is saved."
        title="This capture no longer exists"
      />
    );
  }

  if (detail.kind === "readOnly") {
    return (
      <Unavailable
        description={readOnlyText(detail.why)}
        title="This capture can't be shown"
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink />
      </div>
      <h1 className="sr-only">{detail.title}</h1>
      {/* Keyed by id only: a refresh after an edit keeps the status line and its announcement. */}
      <SavedCaptureView capture={detail} key={detail.id} />
    </div>
  );
};
