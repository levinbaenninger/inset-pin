import { CommandIcon, KeyboardIcon } from "@hugeicons/core-free-icons";
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

import { isMac } from "./platform";

export type Icon = typeof Add01Icon;

/** The shortcut sheet's icon: ⌘ on macOS, where every shortcut names it; a keyboard elsewhere. */
export const SHORTCUTS_ICON: Icon = isMac ? CommandIcon : KeyboardIcon;

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
