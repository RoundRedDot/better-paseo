import React, { createContext, useContext, type ReactNode } from "react";
import { Platform, StyleSheet, Text, type TextProps, type TextStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { HOST_UI_FONT_SIZE, useHostAppearance } from "../ui/tokens/host-appearance-shim";
import { readHostTypography } from "../ui/tokens/typography";

/** The face for branches, paths and commands. */
export const TASK_MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, SFMono-Regular, Menlo, monospace" });

const TasksFontScale = createContext(1);

/** One appearance subscription for the whole board, including memoized cards. */
export function TasksTypography({ theme, children }: { theme: PluginTheme; children: ReactNode }) {
  const ui = readHostTypography(theme)?.fontSize?.ui;
  const appearance = useHostAppearance(ui === undefined, theme);
  const scale = (ui ?? appearance?.uiBaseFontSize ?? HOST_UI_FONT_SIZE.default) / HOST_UI_FONT_SIZE.default;
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
