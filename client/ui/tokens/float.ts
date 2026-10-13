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
 * A tight contact shadow under a short, faint ambient one, heavier on a dark
 * surface. Both stay small: a wide, dense blur bands into visible rings on a
 * light page and smears the light stroke, so the edge stops reading as sharp.
 * Hidden, the same two layers turn transparent, so the change can transition.
 */
export function floatShadow(tokens: Pick<ExtendedThemeTokens, "isDark">, visible = true): string {
  const [contact, ambient] = tokens.isDark ? ["0, 0, 0, 0.4", "0, 0, 0, 0.45"] : ["17, 17, 20, 0.08", "17, 17, 20, 0.1"];
  const rgba = (value: string) => `rgba(${visible ? value : value.replace(/[\d.]+$/, "0")})`;
  return tokens.isDark
    ? `0 1px 2px ${rgba(contact)}, 0 4px 12px -2px ${rgba(ambient)}`
    : `0 1px 2px ${rgba(contact)}, 0 4px 10px -2px ${rgba(ambient)}`;
}

/** A hovered item: the preview toolbar's hover fill. */
export function floatHover(tokens: ExtendedThemeTokens): string {
  return tokens.v2.surface2;
}

/** A pressed item: the hover fill taken a step towards the muted text. */
export function floatPressed(tokens: ExtendedThemeTokens): string {
  return mix(tokens.v2.surface2, tokens.foregroundMuted, 0.14);
}
