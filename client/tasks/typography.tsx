import React, { createContext, useContext, type ReactNode } from "react";
import { Platform, StyleSheet, Text, type TextProps, type TextStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useHostAppearance } from "../ui/tokens/host-appearance-shim";
import { readHostTypography } from "../ui/tokens/typography";

/** The face for branches, paths and commands. */
export const TASK_MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, SFMono-Regular, Menlo, monospace" });

/**
 * Paseo's interface type ramp (`FONT_SIZE` in the app's `styles/theme.ts`)
 * at its default base of 14. Size text with these steps, not with literal
 * numbers: `TaskText` scales a size by the user's base size / 14 and rounds,
 * as the host scales its own ramp (`appearance/apply.ts`), so a step here is
 * the host's step under any interface size the user picks.
 */
export const HOST_FONT = { sm: 12, base: 14, lg: 16, xl: 18, "2xl": 20, "3xl": 22 } as const;

/** Line heights for the ramp's steps, about 1.4 of the size on the 2 px grid. */
export const HOST_LINE = { sm: 16, base: 20, lg: 22, xl: 26, "2xl": 28, "3xl": 30 } as const;

/**
 * The host's interface size when the user never set one
 * (`defaultUiBaseFontSize` in its `use-settings/storage.ts`): 15 on iOS and
 * Android, 14 on the web, so the native ramp starts a step up.
 */
const HOST_DEFAULT_UI = Platform.OS === "web" ? 14 : 15;

const TasksFontScale = createContext(1);

/** One appearance subscription for the whole board, including memoized cards. */
export function TasksTypography({ theme, children }: { theme: PluginTheme; children: ReactNode }) {
  const ui = readHostTypography(theme)?.fontSize?.ui;
  const appearance = useHostAppearance(ui === undefined, theme);
  const scale = (ui ?? appearance?.uiBaseFontSize ?? HOST_DEFAULT_UI) / HOST_FONT.base;
  return <TasksFontScale.Provider value={scale}>{children}</TasksFontScale.Provider>;
}

export function useTasksFontScale(): number {
  return useContext(TasksFontScale);
}

/** Match Paseo's rounded UI ramp; nested spans keep inheriting their parent. */
export function TaskText({ style, ...props }: TextProps) {
  const scale = useTasksFontScale();
  const authored = StyleSheet.flatten(style);
  const scaled: TextStyle = {};
  if (typeof authored?.fontSize === "number") scaled.fontSize = Math.round(authored.fontSize * scale);
  if (typeof authored?.lineHeight === "number") scaled.lineHeight = Math.round(authored.lineHeight * scale);
  return <Text {...props} style={scale === 1 ? style : [style, scaled]} />;
}

/** Keep the authored target size, growing only when larger text needs room. */
export function taskControlHeight(height: number, scale: number): number {
  return Math.round(height * Math.max(1, scale));
}
