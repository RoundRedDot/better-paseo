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
 * a platform-specific value (Inter on iOS, a desktop family name on Android)
 * is stored as chosen and degraded at render by `resolveTypography`. A value
 * no longer offered (the removed `monoFont: "iosevka"`) falls back to its
 * default.
 */

export const ACCENT_IDS = ["host", "jade", "violet", "amber", "rose"] as const;
/** Inline code text on iOS and Android, where the span has no fill. */
export const INLINE_CODE_COLORS = ["grey", "blue", "violet", "green", "coral"] as const;
export const UI_FONTS = ["host", "inter", "system"] as const;
export const MONO_FONTS = ["host", "custom"] as const;
export const TOOL_DETAILS = ["collapsed", "expand-failed"] as const;
export const PATH_DISPLAYS = ["relative", "absolute"] as const;
export const ROW_LABEL_STYLES = ["icon", "label", "both"] as const;
export const MARKDOWN_VARIANTS_STORED = ["document", "compact", "terminal"] as const;
export const SETTINGS_LANGUAGES = ["system", "en", "zh"] as const;
/** The desktop hover preview's delay, in seconds, typed by the reader. */
export const HOVER_DELAY_MIN = 0;
export const HOVER_DELAY_MAX = 10;
export const HOVER_DELAY_DEFAULT = 1;
/** The fixed delays the setting offered before it took a typed value. */
const LEGACY_HOVER_DELAYS: Readonly<Record<string, number>> = { "200ms": 0.2, "500ms": 0.5, "1s": 1, "1.5s": 1.5, "2s": 2 };

export const CODE_FONT_SIZE_MIN = 10;
export const CODE_FONT_SIZE_MAX = 22;

export function clampCodeFontSize(value: number): number {
  return Math.min(CODE_FONT_SIZE_MAX, Math.max(CODE_FONT_SIZE_MIN, Math.round(value)));
}

/** Points the phone drawer's text sits above or below the timeline's, set by a pinch. */
export const DETAILS_TEXT_ZOOM_MIN = -4;
export const DETAILS_TEXT_ZOOM_MAX = 10;

export function clampDetailsTextZoom(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(DETAILS_TEXT_ZOOM_MAX, Math.max(DETAILS_TEXT_ZOOM_MIN, Math.round(value)));
}

/**
 * Text in tool rows, thoughts, checklists and notices. 13 is the built-in
 * row label. The smallest step a reader can pick is 9.
 */
export const BLOCK_FONT_SIZE_MIN = 9;
export const BLOCK_FONT_SIZE_MAX = 20;
export const BLOCK_FONT_SIZE_DEFAULT = 13;

export function clampBlockFontSize(value: number): number {
  return Math.min(BLOCK_FONT_SIZE_MAX, Math.max(BLOCK_FONT_SIZE_MIN, Math.round(value)));
}

/** A delay within 0-10 s, to a tenth of a second. */
export function clampHoverDelay(seconds: number): number {
  return Math.min(HOVER_DELAY_MAX, Math.max(HOVER_DELAY_MIN, Math.round(seconds * 10) / 10));
}

const flag = (fallback: boolean) => z.boolean().catch(fallback);

/**
 * Row labels were an on/off switch (`rowLabels`) before they became a style;
 * a record that turned them on keeps both the icon and the label.
 */
function migrateRowLabels(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || "rowLabelStyle" in raw) return raw;
  const { rowLabels, ...rest } = raw as Record<string, unknown>;
  return rowLabels === true ? { ...rest, rowLabelStyle: "both" } : rest;
}

/**
 * The hover delay was one of five fixed steps (`hoverDelay: "500ms"` and so
 * on) before it became a typed number of seconds; a stored step keeps its
 * length. A record without one takes the new default.
 */
function migrateHoverDelay(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || "hoverDelaySeconds" in raw) return raw;
  const { hoverDelay, ...rest } = raw as Record<string, unknown>;
  const seconds = typeof hoverDelay === "string" ? LEGACY_HOVER_DELAYS[hoverDelay] : undefined;
  return seconds === undefined ? rest : { ...rest, hoverDelaySeconds: seconds };
}

export const preferencesSchema = z.preprocess((raw) => migrateHoverDelay(migrateRowLabels(raw)), z.object({
  accent: z.enum(ACCENT_IDS).catch("host"),
  uiFont: z.enum(UI_FONTS).catch("host"),
  inlineCodeColor: z.enum(INLINE_CODE_COLORS).catch("grey"),
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
  blockFontSize: z
    .number()
    .refine((value) => Number.isFinite(value))
    .transform(clampBlockFontSize)
    .catch(BLOCK_FONT_SIZE_DEFAULT),
  toolDetail: z.enum(TOOL_DETAILS).catch("collapsed"),
  toolCallRollups: flag(false),
  pathDisplay: z.enum(PATH_DISPLAYS).catch("relative"),
  hoverPreview: flag(true),
  hoverDelaySeconds: z
    .number()
    .refine((value) => Number.isFinite(value))
    .transform(clampHoverDelay)
    .catch(HOVER_DELAY_DEFAULT),
  previewWrap: flag(true),
  detailsTextZoom: z
    .number()
    .refine((value) => Number.isFinite(value))
    .transform(clampDetailsTextZoom)
    .catch(0),
  // A stored `rowClick` (what a pointer click on a row did) is dropped like any unknown key.
  blockDetails: flag(true),
  previewLineNumbers: flag(true),
  previewStripes: flag(true),
  enhancedUserBubble: flag(false),
  selectionActions: flag(true),
  assistantMarkdown: flag(true),
  markdownVariant: z.enum(MARKDOWN_VARIANTS_STORED).catch("document"),
  rowLabelStyle: z.enum(ROW_LABEL_STYLES).catch("icon"),
  compactRowSpacing: flag(true),
  compactReplySpacing: flag(true),
  language: z.enum(SETTINGS_LANGUAGES).catch("system"),
}));

export type StoredPreferences = z.output<typeof preferencesSchema>;

export const PREFERENCES_SETTINGS = defineSettings({
  id: "presentation",
  scope: "host",
  version: 1,
  schema: preferencesSchema,
});
