import { z } from "zod";

export const ICON_PLACES = ["dockAndMenuBar", "dock", "menuBar"] as const;

export type IconPlace = (typeof ICON_PLACES)[number];

export const SettingsSchema = z.object({
  /** macOS: where the app's icon shows; menu bar only makes it an accessory app without its own menu bar. */
  iconIn: z.enum(ICON_PLACES),
  /** A saved capture also goes to the clipboard: the image with its pin, and the thought as text. */
  copyAfterSave: z.boolean(),
});

export type Settings = z.output<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  copyAfterSave: false,
  iconIn: "dockAndMenuBar",
};

const StoredSettingsSchema = z
  .string()
  .transform((text, ctx): z.core.util.JSONType => {
    try {
      return z.json().parse(JSON.parse(text));
    } catch {
      ctx.addIssue({ code: "custom", message: "not valid JSON" });

      return z.NEVER;
    }
  })
  .pipe(SettingsSchema.partial());

/** Settings from their file; missing, unknown or damaged values fall back to the defaults. */
export const readSettings = (raw: string | null): Settings => {
  const parsed = raw === null ? null : StoredSettingsSchema.safeParse(raw);

  return parsed?.success === true
    ? { ...DEFAULT_SETTINGS, ...parsed.data }
    : DEFAULT_SETTINGS;
};

/** What the settings window shows: the stored settings, the system's login item and the app's version. */
export interface SettingsView {
  readonly settings: Settings;
  readonly openAtLogin: boolean;
  readonly version: string;
}
