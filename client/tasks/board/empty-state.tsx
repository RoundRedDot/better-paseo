import React, { type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { TaskText as Text, HOST_FONT as F, HOST_LINE } from "../typography";
import { HAIRLINE } from "./board-style";

/** The phone's empty-state design, shared by every board layout and host theme. */
export function BoardEmptyState(props: {
  theme: PluginTheme;
  icon: string;
  title: string;
  hint: string;
  /** Side-by-side lanes have less room than a phone's full-width list. */
  narrow?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const colors = props.theme.colors;
  return (
    <View
      style={[
        {
          alignItems: "center",
          gap: 8,
          paddingVertical: 28,
          paddingHorizontal: props.narrow ? 16 : 20,
          borderWidth: HAIRLINE,
          borderStyle: "dashed",
          borderColor: colors.border,
          borderRadius: 8,
        },
        props.style,
      ]}
    >
      <Icon name={props.icon} size={20} color={colors.foregroundMuted} />
      <Text style={{ alignSelf: "stretch", fontSize: props.narrow ? F.base : F.lg, fontWeight: "600", color: colors.foreground, textAlign: "center" }}>{props.title}</Text>
      <Text style={{ alignSelf: "stretch", fontSize: F.sm, lineHeight: HOST_LINE.sm, color: colors.foregroundMuted, textAlign: "center" }}>{props.hint}</Text>
      {props.children}
    </View>
  );
}
