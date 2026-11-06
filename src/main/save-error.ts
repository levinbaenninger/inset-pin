import { z } from "zod";

const CodeSchema = z.object({ code: z.string().min(1) });

const SENTENCES = new Map([
  ["EACCES", "Inset can’t write to its data folder."],
  ["ENOSPC", "The disk is full."],
  ["EPERM", "Inset can’t write to its data folder."],
  ["EROFS", "The disk is read-only."],
]);

/**
 * Why a write to the captures folder failed, in a sentence for banners,
 * prompts and copy refusals rather than Node's own text.
 */
export const saveErrorText = (
  cause: unknown,
  action: "save" | "delete" = "save"
): string => {
  const parsed = CodeSchema.safeParse(cause);

  if (!parsed.success) {
    return `Couldn’t ${action}.`;
  }

  return (
    SENTENCES.get(parsed.data.code) ??
    `Couldn’t ${action} (${parsed.data.code}).`
  );
};
