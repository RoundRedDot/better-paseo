/**
 * The phone drawer's text zoom: a pinch on its body sets the text a few
 * points larger or smaller than the timeline's (`detailsTextZoom`). Prose and
 * monospace move by the same step; the panel's own chrome keeps its size.
 *
 * Content inside the drawer reads its sizes from the row's tokens, which the
 * drawer cannot replace. The components that draw text sizes from
 * `typography.content` or `typography.mono` call `useZoomedTokens` instead,
 * which shifts both under `TextZoomContext`.
 */
import { createContext, useContext } from "react";
import { StyleSheet, type StyleProp, type TextStyle } from "react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import type { Typography } from "./tokens/typography";
import { clampDetailsTextZoom } from "../../shared/preferences-settings";

/** No size drawn below this, whatever the zoom. */
const SMALLEST = 9;

/**
 * The zoom a pinch has reached: the body size at its start, scaled by how far
 * the fingers moved apart, to whole points. `base` is the unzoomed body size.
 */
export function pinchZoom(base: number, startZoom: number, scale: number): number {
  if (!(scale > 0)) return startZoom;
  return clampDetailsTextZoom(Math.round((base + startZoom) * scale) - base);
}

export function zoomTypography(typography: Typography, zoom: number): Typography {
  if (zoom === 0) return typography;
  const content = Math.max(SMALLEST, typography.content.size + zoom);
  const mono = Math.max(SMALLEST, typography.mono.size + zoom);
  return {
    ...typography,
    content: { size: content, lineHeight: Math.round((typography.content.lineHeight * content) / typography.content.size) },
    mono: { ...typography.mono, size: mono, lineHeight: Math.round((typography.mono.lineHeight * mono) / typography.mono.size) },
  };
}

/** The drawer's zoom, in points; 0 outside it. */
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
 * A text style its caller built from unzoomed tokens, moved by `zoom` points:
 * its size by the step, its line height in proportion.
 */
export function zoomTextStyle(style: StyleProp<TextStyle>, zoom: number): StyleProp<TextStyle> {
  if (zoom === 0) return style;
  const flat = StyleSheet.flatten(style);
  const size = flat?.fontSize;
  if (typeof size !== "number" || size <= 0) return style;
  const next = Math.max(SMALLEST, size + zoom);
  const lineHeight = typeof flat?.lineHeight === "number" ? Math.round((flat.lineHeight * next) / size) : undefined;
  return [style, lineHeight === undefined ? { fontSize: next } : { fontSize: next, lineHeight }];
}
