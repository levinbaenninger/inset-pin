import type { SettingsView } from "@shared/settings";
import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { settingsBridge } from "@/shared/bridge";
import { isMac } from "@/shared/platform";
import { usePushedView } from "@/shared/use-pushed-view";

const api = settingsBridge();

const load = async (): Promise<SettingsView> => await api.getView();

const subscribe = (listener: (view: SettingsView | null) => void) =>
  api.on("view", listener);

const ICON_LABELS = {
  dock: "Dock Only",
  dockAndMenuBar: "Dock and Menu Bar",
  menuBar: "Menu Bar Only",
} as const;

const isIconPlace = (value: string): value is keyof typeof ICON_LABELS =>
  Object.hasOwn(ICON_LABELS, value);

/** A settings row: the label on the left, its control on the right, an optional note below. */
const Row = ({
  children,
  label,
  labelFor,
  note,
}: {
  readonly label: string;
  readonly labelFor: string;
  readonly note?: string;
  readonly children: ReactNode;
}) => (
  <div className="flex min-h-12 flex-col justify-center gap-1 px-3 py-2.5">
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={labelFor}>{label}</Label>
      {children}
    </div>
    {note === undefined ? null : (
      <p className="text-muted-foreground pr-12 text-xs leading-snug">{note}</p>
    )}
  </div>
);

const Group = ({
  children,
  title,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) => (
  <section className="flex flex-col gap-1">
    <h2 className="text-muted-foreground flex h-7 items-center px-1.5 text-xs font-medium">
      {title}
    </h2>
    <div className="bg-background/60 border-foreground/10 divide-foreground/10 flex flex-col divide-y rounded-lg border">
      {children}
    </div>
  </section>
);

const SettingsForm = ({ view }: { readonly view: SettingsView }) => {
  const loginId = useId();
  const iconId = useId();
  const copyId = useId();
  const { settings } = view;
  const page = useRef<HTMLElement>(null);

  // The window takes the page's height, so it has no empty space below the last group.
  useEffect(() => {
    const element = page.current;

    const observer = new ResizeObserver(() => {
      if (element !== null) {
        api.fitHeight(Math.ceil(element.getBoundingClientRect().height));
      }
    });

    if (element !== null) {
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <main
      className={cn(
        "text-foreground flex flex-col gap-3 px-3 pb-3",
        // On macOS the window's translucent material shows through.
        isMac ? null : "bg-background pt-3"
      )}
      data-material={isMac ? "" : undefined}
      ref={page}
    >
      {/* macOS: the title strip under the traffic lights, which moves the window. */}
      {isMac ? (
        <h1 className="app-drag -mx-3 flex h-10 items-center justify-center text-sm font-semibold">
          Settings
        </h1>
      ) : (
        <h1 className="sr-only">Settings</h1>
      )}
      <Group title="General">
        <Row label="Open at Login" labelFor={loginId}>
          <Switch
            checked={view.openAtLogin}
            id={loginId}
            onCheckedChange={(checked) => {
              api.setOpenAtLogin(checked);
            }}
          />
        </Row>
        {/* Elsewhere the notification-area icon is the app's only icon, so there is no choice. */}
        {isMac ? (
          <Row
            label="Show app icon in"
            labelFor={iconId}
            note={
              settings.iconIn === "menuBar"
                ? "Without a Dock icon, the app has no menu bar of its own."
                : undefined
            }
          >
            <Select
              onValueChange={(value) => {
                if (isIconPlace(value)) {
                  api.update({ iconIn: value });
                }
              }}
              value={settings.iconIn}
            >
              <SelectTrigger id={iconId} size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dockAndMenuBar">
                  {ICON_LABELS.dockAndMenuBar}
                </SelectItem>
                <SelectItem value="dock">{ICON_LABELS.dock}</SelectItem>
                <SelectItem value="menuBar">{ICON_LABELS.menuBar}</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        ) : null}
      </Group>
      <Group title="Capturing">
        <Row
          label="Copy after saving"
          labelFor={copyId}
          note="Each saved capture goes to the clipboard, ready to paste."
        >
          <Switch
            checked={settings.copyAfterSave}
            id={copyId}
            onCheckedChange={(checked) => {
              api.update({ copyAfterSave: checked });
            }}
          />
        </Row>
      </Group>
      {/* macOS has the app menu's About panel; elsewhere it is here. */}
      {isMac ? null : (
        <p className="text-muted-foreground px-1 text-xs">
          Inset Context Pin {view.version}
        </p>
      )}
    </main>
  );
};

export const SettingsApp = () => {
  const view = usePushedView<SettingsView | null>(load, subscribe, null);

  return view === null ? null : <SettingsForm view={view} />;
};
