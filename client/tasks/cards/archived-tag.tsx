import React from "react";
import { View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { TaskText as Text, HOST_FONT as F, HOST_LINE, useTasksFontScale } from "../typography";
import { withAlpha } from "../../components/theme-tokens";
import type { TaskTokens } from "./tokens";

/**
 * "Archived" or "Workspace archived" beside a parent task: the Archive icon
 * and the word on a faint fill, one small line tall, so it sits in a text
 * line and reads the same on a card and in the details.
 */
export function ArchivedTag(props: { tokens: TaskTokens; label: string; testID?: string }) {
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
      <Icon name="Archive" size={11} color={tokens.foregroundMuted} />
      <Text numberOfLines={1} style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: tokens.foregroundMuted }}>
        {props.label}
      </Text>
    </View>
  );
}
