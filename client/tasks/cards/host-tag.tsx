import React from "react";
import { View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { TaskText as Text, HOST_LINE, HOST_FONT as F, useTasksFontScale } from "../typography";
import { withAlpha } from "../../components/theme-tokens";
import type { TaskTokens } from "./tokens";

/** Which host a card came from, beside its project and workspace: a muted tag, as the archived mark is. */
export function HostTag(props: { tokens: TaskTokens; label: string; testID?: string }) {
  const scale = useTasksFontScale();
  const { tokens } = props;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        flexShrink: 0,
        gap: 3,
        height: Math.round(HOST_LINE.sm * scale),
        paddingHorizontal: 5,
        borderRadius: 4,
        backgroundColor: withAlpha(tokens.foreground, 0.08),
      }}
      testID={props.testID}
    >
      <Icon name="Server" size={11} color={tokens.foregroundMuted} />
      <Text numberOfLines={1} style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: tokens.foregroundMuted }}>
        {props.label}
      </Text>
    </View>
  );
}
