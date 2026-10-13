/**
 * The floating controls' one family (docs/prototypes/table-copy-menu.md): the
 * table's copy menu and the selection bar share the frame, the items, the
 * shadow and the motion, so they read as the same piece of UI; the edge,
 * shadow and corner radius are also the hover preview panel's.
 *
 * The frame is a rounded rectangle 30 tall, its items 24 tall like a preview
 * toolbar's buttons, inset 2 from its inner edge; an item's radius is the
 * frame's minus 3. The edge is a light border that never darkens, and the
 * shadow lifts the frame off the content under it.
 */
import { mix, radiusV2, type ExtendedThemeTokens } from "../../components/theme-tokens";
import { cssShadow } from "./css-shadow";

export const FLOAT = {
  /** The frame's height, its border included; also the closed table control's side. */
  control: 30,
  item: 24,
  /** Between an item and the frame's inner edge, and between two items. */
  inset: 2,
  /** The hover preview panel's radius, so every overlay has one corner. */
  radius: radiusV2.overlay,
  /** The frame's radius less its border and inset, so the corners nest. */
  itemRadius: radiusV2.overlay - 3,
  iconSize: 14,
  iconText: 6,
} as const;

/** Decelerating, for what arrives; accelerating, for what leaves. */
export const FLOAT_EASE = {
  out: "cubic-bezier(0.33, 1, 0.68, 1)",
  in: "cubic-bezier(0.32, 0, 0.67, 0)",
} as const;

/**
 * The hover preview's shadow, shared by the floating controls so every
 * overlay has one edge: the solid border draws it, and this one shadow,
 * dropped below, lifts the frame. Hidden, it turns transparent, so the change
 * can transition.
 */
export function floatShadow(tokens: ExtendedThemeTokens, visible = true): string {
  return cssShadow({
    ...tokens.v2.elevation.overlay,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
    shadowOpacity: visible ? (tokens.isDark ? 0.36 : 0.22) : 0,
  });
}

/** A hovered item: the preview toolbar's hover fill. */
export function floatHover(tokens: ExtendedThemeTokens): string {
  return tokens.v2.surface2;
}

/** A pressed item: the hover fill taken a step towards the muted text. */
export function floatPressed(tokens: ExtendedThemeTokens): string {
  return mix(tokens.v2.surface2, tokens.foregroundMuted, 0.14);
}
