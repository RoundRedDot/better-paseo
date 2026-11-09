import React from "react";
import { View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { TaskText as Text } from "../typography";
import { todoTaskStatus, type TodoTask } from "../../state/todo-timeline";
import { mix } from "../../components/theme-tokens";
import { StatusIcon } from "./status-icon";
import type { TaskTokens } from "./tokens";

export function TodoRow(props: { item: TodoTask; last: boolean; compact: boolean; theme: PluginTheme; tokens: TaskTokens; background: string; animated?: boolean }) {
  const status = todoTaskStatus(props.item);
  const line = props.compact ? 20 : 18;
  const padding = props.compact ? 6 : 3;
  return (
    <View testID={`todo-row-${status}`} style={{ minHeight: props.compact ? 32 : 24, paddingVertical: padding, paddingHorizontal: 6, marginHorizontal: -6, flexDirection: "row", gap: 7 }}>
      {!props.last ? <View testID="todo-rail" style={{ position: "absolute", left: 13.5, top: padding + line / 2, width: 1, bottom: -(padding + line / 2), backgroundColor: mix(props.background, props.tokens.foregroundMuted, props.tokens.isDark ? 0.22 : 0.26) }} /> : null}
      <View style={{ width: 16, height: line, alignItems: "center", justifyContent: "center" }}>
        <View testID="todo-mark-mask" style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: props.background, alignItems: "center", justifyContent: "center" }}>
          {status === "completed" ? <Icon name="CircleCheck" size={14} color={props.tokens.status.success} /> : status === "in_progress" ? <StatusIcon kind="running" size={16} theme={props.theme} animated={props.animated} /> : <View testID="todo-pending-mark" style={{ width: 10.8, height: 10.8, borderRadius: 5.4, borderWidth: 1.35, borderColor: props.tokens.foregroundMuted }} />}
        </View>
      </View>
      <Text numberOfLines={2} style={{ flex: 1, fontSize: props.compact ? 13 : 12, lineHeight: line, color: status === "in_progress" ? props.tokens.foreground : status === "pending" ? mix(props.tokens.foreground, props.tokens.foregroundMuted, 0.55) : props.tokens.foregroundMuted, fontWeight: status === "in_progress" ? "500" : "400" }}>{props.item.text}</Text>
    </View>
  );
}
