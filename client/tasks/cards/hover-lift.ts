import { Platform, type ViewStyle } from "react-native";

/**
 * How far a card, a sidebar capsule, or a button grows on hover.
 * On a phone, which has no hover, the press stands in for it.
 * The same on the web, the desktop, the iPad, and the phone.
 */
export const HOVER_SCALE = 1.03;

export interface HoverLift {
  /** The colour wash. Only while the system asks for reduced motion. */
  overlay: boolean;
  /** The deeper shadow. Off while motion is reduced. */
  shadow: boolean;
  scale: number;
}

/**
 * Hover for a card, a sidebar capsule, and a button.
 *
 * Motion allowed: a deeper shadow and a slight scale. The fill stays.
 * Reduced motion: the same scale, the colour wash, and the resting shadow.
 */
export function hoverLift(active: boolean, reduced: boolean): HoverLift {
  if (!active) return { overlay: false, shadow: false, scale: 1 };
  if (reduced) return { overlay: true, shadow: false, scale: HOVER_SCALE };
  return { overlay: false, shadow: true, scale: HOVER_SCALE };
}

/** A pinned state (selected, open, current) keeps its own fill. The wash is the reduced-motion hover. */
export function hoverFill(rest: string, wash: string, active: boolean, reduced: boolean, pinned = false): string {
  if (pinned) return wash;
  return hoverLift(active, reduced).overlay ? wash : rest;
}

/** The deepened shadow, or none while the control is at rest or motion is reduced. */
export function hoverShadowValue(shadow: string, active: boolean, reduced: boolean): string | undefined {
  return hoverLift(active, reduced).shadow ? shadow : undefined;
}

export function hoverScaleStyle(active: boolean, reduced: boolean): ViewStyle {
  return { transform: [{ scale: hoverLift(active, reduced).scale }] };
}

/**
 * The web hover transition. Transform joins it only while motion may animate,
 * so reduced motion still reaches the scale and snaps there.
 */
export function hoverTransition(reduced: boolean): ViewStyle {
  if (Platform.OS !== "web") return {};
  return {
    transitionProperty: reduced
      ? "background-color, border-color, box-shadow, color, opacity"
      : "background-color, border-color, box-shadow, color, opacity, transform",
    transitionDuration: "120ms",
    transitionTimingFunction: "ease-out",
  } as ViewStyle;
}
