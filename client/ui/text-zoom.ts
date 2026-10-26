/**
 * Text sizing for native details, resolved by the shell relative to the
 * timeline body size. Prose and monospace use that resolved size.
 *
 * Content inside the drawer reads its sizes from the row's tokens, which the
 * drawer cannot replace. The components that draw text sizes from
 * `typography.content` or `typography.mono` call `useZoomedTokens` instead,
 * which sets both under `TextZoomContext`.
 */
import { createContext, useContext } from "react";
import { StyleSheet, type StyleProp, type TextStyle } from "react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import type { Typography } from "./tokens/typography";
import { clampDetailsFontSize } from "../../shared/preferences-settings";

/**
 * The absolute size reached by a pinch, rounded to whole points.
 */
export function pinchZoom(startSize: number, scale: number): number {
  if (!(scale > 0)) return startSize;
  return clampDetailsFontSize(Math.round(startSize * scale));
}

export function zoomTypography(typography: Typography, zoom: number): Typography {
  if (zoom === 0) return typography;
  const size = Math.round(zoom);
  return {
    ...typography,
    content: { size, lineHeight: Math.round(size * 1.5) },
    mono: { ...typography.mono, size, lineHeight: Math.round(size * 1.5) },
    block: { ...typography.block, delta: 0 },
  };
}

/** The native details' resolved size; 0 leaves timeline typography unchanged. */
export const TextZoomContext = createContext(0);

// One object per tokens and zoom, so memoised children see the same tokens
// again; and what each zoomed object was made from, so zooming twice is once.
const zoomed = new WeakMap<ExtendedThemeTokens, Map<number, ExtendedThemeTokens>>();
const origin = new WeakMap<ExtendedThemeTokens, ExtendedThemeTokens>();

export function zoomTokens(tokens: ExtendedThemeTokens, zoom: number): ExtendedThemeTokens {
  const base = origin.get(tokens) ?? tokens;
  if (zoom === 0) return base;
  let byZoom = zoomed.get(base);
  if (!byZoom) {
    byZoom = new Map();
    zoomed.set(base, byZoom);
  }
  let next = byZoom.get(zoom);
  if (!next) {
    next = { ...base, typography: zoomTypography(base.typography, zoom) };
    byZoom.set(zoom, next);
    origin.set(next, base);
  }
  return next;
}

/** Whether `tokens` already carry a zoom (styles built from them are zoomed too). */
export function isZoomed(tokens: ExtendedThemeTokens): boolean {
  return origin.has(tokens);
}

/** `tokens` with the drawer's zoom applied, or `tokens` itself outside the drawer. */
export function useZoomedTokens(tokens: ExtendedThemeTokens): ExtendedThemeTokens {
  return zoomTokens(tokens, useContext(TextZoomContext));
}

/**
 * A text style built from timeline tokens, set to the details' absolute size.
 */
export function zoomTextStyle(style: StyleProp<TextStyle>, zoom: number): StyleProp<TextStyle> {
  if (zoom === 0) return style;
  const flat = StyleSheet.flatten(style);
  const size = flat?.fontSize;
  if (typeof size !== "number" || size <= 0) return style;
  const next = Math.round(zoom);
  const lineHeight = typeof flat?.lineHeight === "number" ? Math.round(next * 1.5) : undefined;
  return [style, lineHeight === undefined ? { fontSize: next } : { fontSize: next, lineHeight }];
}
