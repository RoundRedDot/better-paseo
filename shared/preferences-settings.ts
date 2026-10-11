import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Presentation preferences, stored by the daemon (plan §11.6: configuration
 * persists). The SDK's settings are host-scoped — the only scope it allows —
 * so every client of one daemon shares them. iOS and Android have no
 * `localStorage`, which is why the daemon, not the client, is the store.
 *
 * Shared by `index.server.ts` (registration, validation, the file on disk)
 * and the client (`useSettings`). Every field degrades to its default on its
 * own (`catch`), so one unusable value never invalidates the whole record;
 * a platform-specific value (Iosevka on iOS, a desktop family name on
 * Android) is stored as chosen and degraded at render by `resolveTypography`.
 */

export const ACCENT_IDS = ["host", "jade", "violet", "amber", "rose"] as const;
export const UI_FONTS = ["host", "inter", "system"] as const;
export const CODE_FONTS = ["code", "plain"] as const;
export const MONO_FONTS = ["host", "iosevka", "custom"] as const;
export const TOOL_DETAILS = ["collapsed", "expand-failed"] as const;
export const PATH_DISPLAYS = ["relative", "absolute"] as const;
export const MARKDOWN_VARIANTS_STORED = ["document", "compact", "terminal"] as const;

export const CODE_FONT_SIZE_MIN = 10;
export const CODE_FONT_SIZE_MAX = 22;

export function clampCodeFontSize(value: number): number {
  return Math.min(CODE_FONT_SIZE_MAX, Math.max(CODE_FONT_SIZE_MIN, Math.round(value)));
}

const flag = (fallback: boolean) => z.boolean().catch(fallback);

export const preferencesSchema = z.object({
  accent: z.enum(ACCENT_IDS).catch("host"),
  uiFont: z.enum(UI_FONTS).catch("host"),
  codeFont: z.enum(CODE_FONTS).catch("code"),
  monoFont: z.enum(MONO_FONTS).catch("host"),
  customMonoFont: z
    .string()
    .transform((value) => value.trim().slice(0, 200))
    .catch(""),
  codeFontSize: z
    .number()
    .refine((value) => Number.isFinite(value))
    .transform(clampCodeFontSize)
    .nullable()
    .catch(null),
  toolDetail: z.enum(TOOL_DETAILS).catch("collapsed"),
  pathDisplay: z.enum(PATH_DISPLAYS).catch("relative"),
  enhancedUserBubble: flag(true),
  selectionActions: flag(true),
  assistantMarkdown: flag(true),
  markdownVariant: z.enum(MARKDOWN_VARIANTS_STORED).catch("document"),
});

export type StoredPreferences = z.output<typeof preferencesSchema>;

export const PREFERENCES_SETTINGS = defineSettings({
  id: "presentation",
  scope: "host",
  version: 1,
  schema: preferencesSchema,
});
