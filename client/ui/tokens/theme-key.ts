import { hostTypographyKey } from "./typography";

/**
 * The colour keys of `PluginTheme["colors"]`, in a fixed order. Listed rather
 * than taken from `Object.keys` so the key does not depend on the order the
 * host happened to build the object in.
 */
const COLOR_KEYS = [
  "surface0",
  "surface1",
  "surface2",
  "border",
  "foreground",
  "foregroundMuted",
  "accent",
  "accentForeground",
  "statusSuccess",
  "statusWarning",
  "statusDanger",
] as const;

/**
 * A memo key for theme tokens (plan §3.2).
 *
 * Paseo 0.11.2 builds a fresh `theme.colors` object on every render of a
 * plugin row, so a memo on that object rebuilt tokens, styles and every child
 * on every streamed chunk. The concatenated colour strings change only when
 * the theme does. Host typography (H1), when present, is part of the key.
 */
export function themeKey(theme: { colors: Readonly<Record<string, string>> }): string {
  let key = "";
  for (const name of COLOR_KEYS) key += `${theme.colors[name] ?? ""};`;
  return key + hostTypographyKey(theme);
}
