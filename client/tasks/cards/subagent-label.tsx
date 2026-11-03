import React from "react";
import { View } from "react-native";
import { TaskText as Text } from "../typography";
import type { TasksLanguage } from "../i18n";
import { tipProps } from "./card-hints";
import { cardStrings } from "./strings";
import type { TaskTokens } from "./tokens";

export function SubagentLabel(props: { language: TasksLanguage; tokens: TaskTokens; testID?: string }) {
  const strings = cardStrings(props.language);
  return (
    <View {...tipProps(strings.subagentCard)} accessibilityLabel={strings.subagentCard} testID={props.testID}
      style={{ flexShrink: 0, alignSelf: "flex-start", borderWidth: 1, borderColor: props.tokens.borderStrong, borderRadius: 3, paddingHorizontal: 3 }}>
      <Text style={{ fontSize: 10, lineHeight: 14, color: props.tokens.foregroundMuted }}>{strings.subagentLabel}</Text>
    </View>
  );
}
