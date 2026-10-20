import React from "react";
import { Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";

/** Placeholder until the settings slice lands. */
export function TasksSettingsPage(props: PluginSurfaceProps) {
  return (
    <View style={{ padding: 24 }}>
      <Text style={{ color: props.theme.colors.foregroundMuted }}>Tasks settings</Text>
    </View>
  );
}
