import { mix } from "../components/theme-tokens";

/** A Tasks control's feedback, mixed over its actual resting surface. */
export function hoverFill(base: string, foreground: string, hovered: boolean, pressed: boolean, rest = base): string {
  if (pressed) return mix(base, foreground, 0.08);
  if (hovered) return mix(base, foreground, 0.05);
  return rest;
}
