import React from "react";
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { useHover } from "../ui/use-hover";
import { hoverFill } from "./hover-fill";

/** A non-card Tasks control with a theme-relative hover and press fill. */
export function HoverControl({ base, foreground, rest = "transparent", style, disabled, ...props }: Omit<PressableProps, "style"> & {
  base: string;
  foreground: string;
  rest?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { hovered, hoverProps } = useHover();
  return <Pressable {...props} disabled={disabled} {...hoverProps} style={({ pressed }) => StyleSheet.flatten([style, { backgroundColor: hoverFill(base, foreground, hovered && !disabled, pressed && !disabled, rest) }])} />;
}
