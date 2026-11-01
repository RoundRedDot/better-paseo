import { Platform, type ViewStyle } from "react-native";
import { getReducedMotion } from "../../ui/use-reduced-motion";

/** How far a phone or iPad control grows while it is pressed. Desktop hover does not scale. */
export const PRESS_SCALE = 1.03;

/**
 * Desktop web has a fine pointer, so hover is the interaction.
 * A phone, a touch browser, and an iPad (the native app, trackpad or not) use the press.
 * Vitest has no `matchMedia`, and there web is the desktop.
 */
export function liftsOnPress(): boolean {
  if (Platform.OS !== "web") return true;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return !window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export interface SurfaceLift {
  /** Deeper shadow. Desktop: while hovered. Phone and iPad: while pressed. */
  shadow: boolean;
  /** 1, or PRESS_SCALE while a phone or iPad is pressed and motion is allowed. */
  scale: number;
}

/** No colour fill either way. Reduced motion keeps the shadow and skips the scale. */
export function surfaceLift(hovered: boolean, pressed: boolean, reduced = getReducedMotion()): SurfaceLift {
  const press = liftsOnPress();
  const active = press ? pressed : hovered;
  if (!active) return { shadow: false, scale: 1 };
  return { shadow: true, scale: press && !reduced ? PRESS_SCALE : 1 };
}

export function scaleStyle(scale: number): ViewStyle {
  return scale === 1 ? {} : { transform: [{ scale }] };
}
