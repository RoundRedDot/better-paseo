/**
 * The floating controls' one family (docs/prototypes/table-copy-menu.md): the
 * table's copy menu and the selection bar share the frame, the items, the
 * shadow and the motion, so they read as the same piece of UI.
 *
 * The frame is a rounded rectangle 30 tall, its items 24 tall like a preview
 * toolbar's buttons, inset 2 from its inner edge; an item's radius is the
 * frame's minus 3. The edge is a light border that never darkens, and the
 * shadow lifts the frame off the content under it.
 */
import { mix, type ExtendedThemeTokens } from "../../components/theme-tokens";
import { cssShadow } from "./css-shadow";

export const FLOAT = {
  /** The frame's height, its border included; also the closed table control's side. */
  control: 30,
  item: 24,
  /** Between an item and the frame's inner edge, and between two items. */
  inset: 2,
  radius: 7,
  itemRadius: 4,
  iconSize: 14,
  iconText: 6,
} as const;

/** Decelerating, for what arrives; accelerating, for what leaves. */
export const FLOAT_EASE = {
  out: "cubic-bezier(0.33, 1, 0.68, 1)",
  in: "cubic-bezier(0.32, 0, 0.67, 0)",
} as const;

/**
 * The hover preview's edge at the frame's size: the solid border alone draws
 * the edge, and a single shadow dropped below it lifts the frame. A layer
 * hugging the border turns the line into a gradient and the edge looks soft,
 * and the preview's own 24px blur bands into rings around a frame this small.
 * Hidden, the shadow turns transparent, so the change can transition.
 */
export function floatShadow(tokens: ExtendedThemeTokens, visible = true): string {
  return cssShadow({
    ...tokens.v2.elevation.overlay,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    shadowOpacity: visible ? (tokens.isDark ? 0.28 : 0.14) : 0,
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
