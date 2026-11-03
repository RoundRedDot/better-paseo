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
      style={{ flexShrink: 0, alignSelf: "flex-start", borderWidth: 1, borderColor: props.tokens.borderStrong, borderRadius: 4, paddingHorizontal: 4 }}>
      <Text style={{ fontSize: 11, lineHeight: 18, color: props.tokens.foregroundMuted }}>{strings.subagentLabel}</Text>
    </View>
  );
}
