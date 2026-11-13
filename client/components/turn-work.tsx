import React, { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAgent, usePaseo, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEnhancerPreferences } from "../preferences";
import { useThemeTokens } from "./theme-tokens";
import { useTurnWork } from "../state/turn-footers";
import { turnWorkCursorKey } from "../state/turn-work";
import { useDisclosure } from "../state/disclosure-store";
import { invalidateTurnWorkProjection, turnWorkDisclosureKey, type TurnWorkSourceIdentity } from "../state/turn-work-projection";
import { resolveLanguage } from "../i18n/settings-strings";
import { useHostLanguageVersion } from "../i18n/host-language";

interface Props extends Pick<PluginTimelineItemProps, "agentId" | "timestamp"> {
  sourceKey: string | null;
  workSource?: TurnWorkSourceIdentity;
  children: ReactNode;
}

function WorkSource({ agentId, timestamp, sourceKey, workSource, children }: Props & { sourceKey: string; workSource: TurnWorkSourceIdentity }) {
  const paseo = usePaseo();
  const running = useAgent(agentId, (agent) => agent.status === "running");
  useTurnWork(paseo, agentId, turnWorkCursorKey(sourceKey, workSource.sourceCursor.seq), timestamp.getTime(),
    typeof running === "boolean" ? running : null);
  return <>{children}</>;
}

/** Observe history only when the host supplies a stable source identity. */
export function TurnWorkItem(props: Props) {
  const preferences = useEnhancerPreferences();
  if (!preferences.autoCollapseTurnWork || !props.sourceKey || props.workSource?.agentId !== props.agentId) return <>{props.children}</>;
  return <WorkSource {...props} sourceKey={props.sourceKey} workSource={props.workSource} />;
}

export interface TurnWorkSummaryData { groupKey: string; anchor: string; count: number; failed: number }

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 26 },
  compact: { minHeight: 44 },
  label: { flexShrink: 1 },
});

export function LiveTurnWorkRenderer({ agentId, item, timestamp, theme, layout }: PluginTimelineItemProps<TurnWorkSummaryData>) {
  const paseo = usePaseo();
  const running = useAgent(agentId, (agent) => agent.status === "running");
  // Keep the shared observation through the original-row/summary handoff. The
  // item carries its own label data, so a transient read cannot leave a blank cell.
  useTurnWork(paseo, agentId, item.data.anchor, timestamp.getTime(), typeof running === "boolean" ? running : null);
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences, layout.platform);
  useHostLanguageVersion();
  const chinese = resolveLanguage(preferences.language) === "zh";
  const [expanded, setExpanded] = useDisclosure(turnWorkDisclosureKey(agentId, item.data.groupKey), false);
  const label = chinese ? "\u5de5\u4f5c\u8fc7\u7a0b" : "Work process";
  const count = chinese ? `${item.data.count} \u6b65` : `${item.data.count} steps`;
  const failed = item.data.failed ? (chinese ? `${item.data.failed} \u6b65\u5931\u8d25` : `${item.data.failed} failed`) : null;
  return <View>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[label, count, failed].filter(Boolean).join(", ")}
      accessibilityState={{ expanded }}
      onPress={() => { setExpanded(!expanded); invalidateTurnWorkProjection(); }}
      style={[styles.header, layout.compact && styles.compact]}
    >
      <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={14} color={tokens.foregroundMuted} />
      <Text style={[styles.label, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi,
        fontSize: tokens.typography.block.label.size }]}>{label}</Text>
      <Text style={{ color: tokens.foregroundMuted, fontFamily: tokens.fontMono,
        fontSize: tokens.typography.block.label.size }}>{count}</Text>
      {failed ? <Text style={{ color: tokens.danger, fontFamily: tokens.fontMono,
        fontSize: tokens.typography.block.label.size }}>{failed}</Text> : null}
    </Pressable>
  </View>;
}
