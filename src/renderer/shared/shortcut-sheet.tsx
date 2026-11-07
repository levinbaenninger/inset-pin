import type { ShortcutGroup } from "@shared/shortcuts";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

/** The groups of keys, each row a label and its keys. */
export const ShortcutList = ({
  compact = false,
  groups,
}: {
  readonly groups: readonly ShortcutGroup[];
  readonly compact?: boolean;
}) => (
  <div
    className={cn(
      "-mx-1 min-h-0 overflow-y-auto px-1",
      compact
        ? "flex flex-col gap-3"
        : "columns-2 gap-x-8 lg:columns-3 [&>section]:mb-4"
    )}
  >
    {groups.map((group) => (
      <section
        className="flex break-inside-avoid flex-col gap-0.5"
        key={group.title}
      >
        <h3 className="text-muted-foreground pb-1 text-xs font-medium">
          {group.title}
        </h3>
        <dl className="flex flex-col">
          {group.rows.map((row) => (
            <div
              className={cn(
                "border-foreground/5 flex items-center justify-between gap-3 border-b last:border-b-0",
                compact ? "min-h-6 py-0.5" : "min-h-7 py-1"
              )}
              key={row.label}
            >
              <dt className={compact ? "text-xs" : "text-sm"}>{row.label}</dt>
              <dd className="shrink-0">
                <Kbd>{row.keys}</Kbd>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    ))}
  </div>
);

/** Every key of the window for this platform, grouped, as the other Inset apps list theirs. */
export const ShortcutSheet = ({
  groups,
  onOpenChange,
  open,
  shortcut,
}: {
  readonly groups: readonly ShortcutGroup[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The key that opens the sheet, named in its description. */
  readonly shortcut: string;
}) => (
  <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogContent
      className="max-w-2xl lg:max-w-4xl"
      data-testid="shortcut-sheet"
      // A list to read: the focus goes to the sheet, not to its close button.
      onOpenAutoFocus={(event) => {
        event.preventDefault();

        if (event.currentTarget instanceof HTMLElement) {
          event.currentTarget.focus();
        }
      }}
      tabIndex={-1}
    >
      <DialogHeader>
        <DialogTitle>Keyboard Shortcuts</DialogTitle>
        <DialogDescription>
          Press {shortcut} anytime to see this list.
        </DialogDescription>
      </DialogHeader>
      <ShortcutList groups={groups} />
    </DialogContent>
  </Dialog>
);
