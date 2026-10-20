import { StyleSheet, type ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { MENU, menuChrome } from "../board/menu";

/**
 * A floating panel in the board's Linear menu chrome (`board/menu-model.ts`):
 * radius 12, a hairline border and the menu's soft wide shadow, on the
 * menu's surface. The cards' details popover and context tooltip use it so
 * every overlay on the board reads as one family.
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
