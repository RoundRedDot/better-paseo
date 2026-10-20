import React from "react";
import { Text, View } from "react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";

/** Placeholder until the board slice lands: the screen registers and opens. */
export function TasksBoardScreen(props: PluginScreenProps) {
  return (
    <View style={{ flex: 1, padding: 24, backgroundColor: props.theme.colors.surface0 }}>
      <Text style={{ color: props.theme.colors.foregroundMuted }}>Tasks</Text>
    </View>
  );
}
