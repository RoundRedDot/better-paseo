import type { Elevation } from "../../components/theme-tokens";

/**
 * A theme elevation as a CSS `box-shadow`, for the DOM overlays that live
 * outside React Native (the selection bar). React Native's `shadowRadius` is
 * the blur radius, as in CSS.
 */
export function cssShadow(elevation: Elevation): string {
  const { shadowColor, shadowOffset, shadowOpacity, shadowRadius } = elevation;
  const hex = /^#([0-9a-f]{6})$/i.exec(shadowColor)?.[1] ?? "000000";
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return `${shadowOffset.width}px ${shadowOffset.height}px ${shadowRadius}px rgba(${r}, ${g}, ${b}, ${shadowOpacity})`;
}
