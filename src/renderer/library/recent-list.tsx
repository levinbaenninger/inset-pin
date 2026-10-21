import { Alert02Icon, PinLocation01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { CaptureSummary } from "@shared/contracts";
import { shortcutLabel } from "@shared/shortcut";
import { getRouteApi, Link } from "@tanstack/react-router";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { isMac } from "@/shared/platform";

import { formatCaptureTime, readOnlyText, sourceText } from "./format";
import { SavedImage } from "./saved-image";

const route = getRouteApi("/");

const CaptureRow = ({ capture }: { readonly capture: CaptureSummary }) => (
  <Item asChild variant="outline">
    <Link params={{ captureId: capture.id }} to="/captures/$captureId">
      {capture.kind === "ok" ? (
        <>
          <ItemMedia>
            <SavedImage
              alt=""
              image={capture.image}
              pin={capture.pin}
              size="thumbnail"
            />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{capture.title}</ItemTitle>
            <ItemDescription>
              {sourceText(capture.sourceLabel)} ·{" "}
              {formatCaptureTime(capture.capturedAt)}
            </ItemDescription>
          </ItemContent>
        </>
      ) : (
        <>
          <ItemMedia variant="icon">
            <HugeiconsIcon icon={Alert02Icon} />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Read-only capture</ItemTitle>
            <ItemDescription>{readOnlyText(capture.why)}</ItemDescription>
          </ItemContent>
        </>
      )}
    </Link>
  </Item>
);

export const RecentList = () => {
  const captures = route.useLoaderData();

  if (captures.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={PinLocation01Icon} />
          </EmptyMedia>
          <EmptyTitle>No captures yet</EmptyTitle>
          <EmptyDescription>
            Point at something in your work and press {shortcutLabel(isMac)}.
            Saved captures appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ItemGroup>
      {captures.map((capture) => (
        <CaptureRow capture={capture} key={capture.id} />
      ))}
    </ItemGroup>
  );
};
