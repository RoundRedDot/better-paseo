import React from "react";
import { View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { TaskChild } from "../model";
import { BrandMark } from "./brand-mark";
import { StatusIcon } from "./status-icon";
import type { TaskTokens } from "./tokens";

/**
 * Paseo 0.12's `WorkspaceTabIcon` at 14: the provider's mark, its status on
 * the bottom-right corner over a knockout of the row's fill. Running is the
 * 12 ring in a 14 frame, unread and failed an 8 dot (6 and a 1 px knockout),
 * needs input the board's hollow amber ring. One deviation, at the user's
 * request: the host draws nothing for a finished child, here done is the
 * board's green circled check and archived its muted box, at 12 in the
 * ring's 14 knockout, so every row says where its child stands.
 */
export function ChildMark(props: { child: TaskChild; tokens: TaskTokens; theme: PluginTheme; backdrop: string; animated?: boolean }) {
  const { child, tokens } = props;
  const status = child.status;
  let corner: React.ReactNode = null;
  if (status === "running" || status === "needs_input") {
    corner = (
      <View style={{ position: "absolute", right: -5, bottom: -5, width: 14, height: 14, borderRadius: 7, backgroundColor: props.backdrop, alignItems: "center", justifyContent: "center" }}>
        <View style={{ margin: -1 }}>
          <StatusIcon kind={status} size={16} theme={props.theme} animated={props.animated} />
        </View>
      </View>
    );
  } else if (status === "unread" || status === "failed") {
    corner = (
      <View
        testID={`status-${status}`}
        style={{ position: "absolute", right: -2, bottom: -2, width: 8, height: 8, borderRadius: 4, borderWidth: 1, borderColor: props.backdrop, backgroundColor: status === "failed" ? tokens.status.danger : tokens.status.success }}
      />
    );
  } else if (status === "done" || status === "archived") {
    corner = (
      <View
        testID={`status-${status}`}
        style={{ position: "absolute", right: -5, bottom: -5, width: 14, height: 14, borderRadius: 7, backgroundColor: props.backdrop, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name={status === "done" ? "CircleCheck" : "Archive"} size={12} color={status === "done" ? tokens.status.success : tokens.foregroundMuted} />
      </View>
    );
  }
  return (
    <View style={{ width: 14, height: 14, flexShrink: 0 }}>
      {child.provider ? <BrandMark provider={child.provider} size={14} tokens={tokens} mono={tokens.foregroundMuted} /> : <Icon name="Bot" size={14} color={tokens.foregroundMuted} />}
      {corner}
    </View>
  );
}
