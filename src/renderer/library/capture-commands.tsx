import {
  CheckmarkCircle02Icon,
  Copy01Icon,
  Delete02Icon,
  Image01Icon,
  PictureInPictureOnIcon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { CaptureId } from "@shared/capture-record";
import type { ActionResult, SavedCapture } from "@shared/contracts";
import { keyLabels } from "@shared/shortcuts";
import {
  getRouteApi,
  useNavigate,
  useParams,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { libraryBridge } from "@/shared/bridge";
import type { Icon } from "@/shared/icon-button";
import { isMac } from "@/shared/platform";

import { useLibraryState } from "./library-state";
import { isShown, listOrder, selectionAfterRemoval } from "./list-model";
import { useNotice } from "./notice";

const api = libraryBridge();
const rootRoute = getRouteApi("__root__");
const KEYS = keyLabels(isMac);

interface MenuItem {
  readonly kind: "item";
  readonly label: string;
  readonly icon: Icon;
  readonly keys?: string;
  readonly destructive?: boolean;
  readonly run: () => void;
}

export type MenuEntry =
  | MenuItem
  | { readonly kind: "separator"; readonly id: string };

/** Never rejects, so a closed channel reads as a failure the notice can show. */
const settle = async (
  call: () => Promise<ActionResult>
): Promise<ActionResult> => {
  try {
    return await call();
  } catch {
    return { message: "Inset couldn’t reach the app. Try again.", ok: false };
  }
};

/**
 * Everything that can be done to one capture, once: the right-click menu in
 * the sidebar, the capture's ⋯ menu and its keys all use these. Delete asks
 * first, in the dialog this returns.
 */
export const useCaptureCommands = (capture: SavedCapture) => {
  const navigate = useNavigate();
  const router = useRouter();
  const captures = rootRoute.useLoaderData();
  const { captureId: openId } = useParams({ strict: false });
  const { list, now, parsed, query } = useLibraryState();
  const say = useNotice();
  const [confirming, setConfirming] = useState(false);
  const done = capture.status.kind === "done";

  const report = (
    result: ActionResult,
    text: string,
    undo?: () => void
  ): void => {
    say(result.ok ? { text, undo } : { failed: true, text: result.message });
  };

  const setDone = async (id: CaptureId, value: boolean): Promise<void> => {
    const result = await settle(
      async () => await api.setDone({ done: value, id })
    );

    report(result, value ? "Moved to Done" : "Back in the list", () => {
      void setDone(id, !value);
    });
  };

  const copy = async (
    call: () => Promise<ActionResult>,
    text: string
  ): Promise<void> => {
    report(await settle(call), text);
  };

  const remove = async (): Promise<void> => {
    const ids = listOrder(captures)
      .filter((item) => isShown(item, list, parsed, query.trim() !== "", now))
      .map((item) => item.id);

    const next = selectionAfterRemoval(ids, capture.id);
    const result = await settle(async () => await api.remove(capture.id));

    if (!result.ok) {
      say({ failed: true, text: result.message });

      return;
    }

    say({ text: "Capture deleted" });

    if (openId === capture.id) {
      await router.invalidate();
      await navigate(
        next === null
          ? { to: "/" }
          : { params: { captureId: next }, to: "/captures/$captureId" }
      );
    }
  };

  const commands = {
    askDelete: () => {
      setConfirming(true);
    },
    copyImage: () => {
      void copy(
        async () => await api.copyImage(capture.id),
        "Image copied with its pins"
      );
    },
    copyText: () => {
      void copy(async () => await api.copyText(capture.id), "Copied as text");
    },
    float: () => {
      api.floatOnTop(capture.id);
      say({ text: "Floating on top of other apps" });
    },
    toggleDone: () => {
      void setDone(capture.id, !done);
    },
  };

  const entries: readonly MenuEntry[] = [
    {
      icon: Copy01Icon,
      keys: KEYS.copyText,
      kind: "item",
      label: "Copy as Text",
      run: commands.copyText,
    },
    {
      icon: Image01Icon,
      keys: KEYS.copyImage,
      kind: "item",
      label: "Copy Image",
      run: commands.copyImage,
    },
    {
      icon: PictureInPictureOnIcon,
      keys: KEYS.float,
      kind: "item",
      label: "Float on Top",
      run: commands.float,
    },
    { id: "status", kind: "separator" },
    {
      icon: done ? Undo02Icon : CheckmarkCircle02Icon,
      keys: KEYS.done,
      kind: "item",
      label: done ? "Mark as Not Done" : "Mark as Done",
      run: commands.toggleDone,
    },
    { id: "delete", kind: "separator" },
    {
      destructive: true,
      icon: Delete02Icon,
      keys: KEYS.delete,
      kind: "item",
      label: "Delete…",
      run: commands.askDelete,
    },
  ];

  const dialog = (
    <AlertDialog onOpenChange={setConfirming} open={confirming}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this capture?</AlertDialogTitle>
          <AlertDialogDescription>
            Its image and notes are removed from this computer. To keep it out
            of the list instead, mark it as done.
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
  );

  return { commands, dialog, entries };
};

const PARTS = {
  context: {
    Item: ContextMenuItem,
    Separator: ContextMenuSeparator,
    Shortcut: ContextMenuShortcut,
  },
  dropdown: {
    Item: DropdownMenuItem,
    Separator: DropdownMenuSeparator,
    Shortcut: DropdownMenuShortcut,
  },
} as const;

/** The entries as items of a right-click menu or of the ⋯ dropdown; the two take the same shape. */
export const MenuEntries = ({
  entries,
  kind,
}: {
  readonly entries: readonly MenuEntry[];
  readonly kind: keyof typeof PARTS;
}) => {
  const { Item, Separator, Shortcut } = PARTS[kind];

  return entries.map((entry) =>
    entry.kind === "separator" ? (
      <Separator key={entry.id} />
    ) : (
      <Item
        key={entry.label}
        onSelect={() => {
          entry.run();
        }}
        variant={entry.destructive === true ? "destructive" : "default"}
      >
        <HugeiconsIcon icon={entry.icon} />
        {entry.label}
        {entry.keys === undefined ? null : <Shortcut>{entry.keys}</Shortcut>}
      </Item>
    )
  );
};
