import { CommandIcon } from "@hugeicons/core-free-icons";
import type { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type Icon = typeof Add01Icon;

/**
 * The shortcut sheet's icon: ⌘ on every platform, as in Window Links and the
 * Shelf. Hugeicons' keyboard reads as a face at this size.
 */
export const SHORTCUTS_ICON: Icon = CommandIcon;

/**
 * The one icon-only button, as in Window Links: ghost, small, named by its
 * tooltip, which also shows its key. The rest of the props reach the Button,
 * so a Radix trigger can wrap it with asChild.
 */
export const IconButton = ({
  icon,
  keys,
  label,
  side = "bottom",
  ...props
}: {
  readonly label: string;
  readonly icon: Icon;
  readonly keys?: string;
  readonly side?: ComponentProps<typeof TooltipContent>["side"];
} & ComponentProps<typeof Button>) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button aria-label={label} size="icon-sm" variant="ghost" {...props}>
        <HugeiconsIcon icon={icon} />
      </Button>
    </TooltipTrigger>
    <TooltipContent side={side}>
      {label}
      {keys === undefined ? null : <Kbd>{keys}</Kbd>}
    </TooltipContent>
  </Tooltip>
);
