import { StyleSheet, type ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { MENU, menuChrome } from "../board/menu";

/**
 * A floating panel in the board's Linear menu chrome (`board/menu-model.ts`):
 * radius 12, a hairline border and the menu's soft wide shadow, on the
 * menu's surface. Menus and the larger overlays use it. Hover tips use
 * `tipChrome`, the same surface with the card tips' corner.
 */
export function panelChrome(theme: PluginTheme): ViewStyle {
  const chrome = menuChrome(theme);
  return {
    backgroundColor: chrome.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chrome.border,
    borderRadius: MENU.radius,
    boxShadow: chrome.shadow,
  } as ViewStyle;
}

/** The card tips' corner: the card, detail and chart hover tips use it. */
export const TIP_RADIUS = 8;

/** A hover tip: the menu surface, hairline and shadow, at `TIP_RADIUS`. */
export function tipChrome(theme: PluginTheme): ViewStyle {
  return { ...panelChrome(theme), borderRadius: TIP_RADIUS };
}
