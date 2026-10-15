import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { useEnhancerPreferences } from "../preferences";
import { toolbarLabel } from "../i18n/toolbar-strings";
import { CopyButton } from "../ui/copy-button";
import { formatFullStamp, formatDuration } from "../ui/time";
import { TYPE } from "../ui/tokens/typography";
import { unselectable } from "./selection";

export interface FooterDetailsProps {
  agentName?: string | null;
  modelName?: string | null;
  thinkingLabel?: string | null;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
  tokens: ExtendedThemeTokens;
}

/** Two columns: a labelled icon, then its value with an inline copy action. */
export function FooterDetails({ agentName, modelName, thinkingLabel, startedAt, completedAt, durationMs, tokens }: FooterDetailsProps) {
  const { language } = useEnhancerPreferences();
  const rows: Array<{ label: string; icon: string; value: string; copyLabel?: string }> = [];
  if (agentName) rows.push({ label: "Agent", icon: "Bot", value: agentName, copyLabel: "Copy agent" });
  if (modelName) rows.push({ label: "Model name", icon: "Cpu", value: modelName, copyLabel: "Copy model name" });
  if (thinkingLabel) rows.push({ label: "Thinking level", icon: "Brain", value: thinkingLabel, copyLabel: "Copy thinking level" });
  if (startedAt != null) rows.push({ label: "Start time", icon: "Clock", value: formatFullStamp(new Date(startedAt)), copyLabel: "Copy start time" });
  if (completedAt != null) rows.push({ label: "End time", icon: "Clock", value: formatFullStamp(new Date(completedAt)), copyLabel: "Copy end time" });
  if (durationMs != null) rows.push({ label: "Elapsed time", icon: "Hourglass", value: formatDuration(durationMs) });
  const textStyle = [styles.text, unselectable, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }];
  return (
    <View testID="footer-details-table">
      {rows.map((row, index) => (
        <View key={row.label} testID={`footer-detail-${row.label}`} style={[styles.row,
          index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.v2.borderSubtle }]}>
          <View style={[styles.type, { borderRightColor: tokens.v2.borderSubtle }]}>
            <View style={styles.icon}><Icon name={row.icon} size={14} color={tokens.foregroundMuted} /></View>
            <Text style={textStyle}>{toolbarLabel(row.label, language)}</Text>
          </View>
          <View style={styles.value}>
            <Text style={[textStyle, { color: tokens.foreground }]}>{row.value}</Text>
            {row.copyLabel ? <CopyButton text={row.value} label={row.copyLabel} tokens={tokens} /> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch", minHeight: 44 },
  type: { width: 128, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 8, paddingVertical: 8, borderRightWidth: StyleSheet.hairlineWidth },
  icon: { width: 20, height: 20, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  value: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 8 },
  text: { fontSize: TYPE.button.size, lineHeight: TYPE.button.lineHeight, flexShrink: 1 },
});
