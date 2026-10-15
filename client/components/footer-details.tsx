import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { useEnhancerPreferences } from "../preferences";
import { toolbarLabel } from "../i18n/toolbar-strings";
import { resolveLanguage } from "../i18n/settings-strings";
import type { SettingsLanguagePreference } from "../i18n/settings-strings";
import { CopyButton } from "../ui/copy-button";
import { formatFullStamp, formatDuration } from "../ui/time";
import { TYPE } from "../ui/tokens/typography";
import { unselectable } from "./selection";

export interface FooterDetailsProps {
  agentName?: string | null;
  modelName?: string | null;
  thinkingLabel?: string | null;
  startedAt?: number | null;
  durationMs?: number | null;
  tokens: ExtendedThemeTokens;
}

/** The label column fits the longest label: four CJK characters, or "Thinking level". */
const LABEL_WIDTH = { zh: 72, en: 104 } as const;
/** Room for a full timestamp and its copy action. */
const VALUE_WIDTH = 192;

function labelWidth(language: SettingsLanguagePreference): number {
  return resolveLanguage(language) === "zh" ? LABEL_WIDTH.zh : LABEL_WIDTH.en;
}

/** The panel width the table needs, so it opens no wider than its content. */
export function useFooterDetailsWidth(): number {
  return labelWidth(useEnhancerPreferences().language) + VALUE_WIDTH;
}

/**
 * Two columns: a plain label, then its value with an inline copy action. The
 * icons stay on the toolbar, beside the values they mark.
 */
export function FooterDetails({ agentName, modelName, thinkingLabel, startedAt, durationMs, tokens }: FooterDetailsProps) {
  const { language } = useEnhancerPreferences();
  const rows: Array<{ label: string; value: string; copyLabel?: string }> = [];
  if (agentName) rows.push({ label: "Agent", value: agentName, copyLabel: "Copy agent" });
  if (modelName) rows.push({ label: "Model name", value: modelName, copyLabel: "Copy model name" });
  if (thinkingLabel) rows.push({ label: "Thinking level", value: thinkingLabel, copyLabel: "Copy thinking level" });
  if (startedAt != null) rows.push({ label: "Start time", value: formatFullStamp(new Date(startedAt)), copyLabel: "Copy start time" });
  if (durationMs != null) rows.push({ label: "Elapsed time", value: formatDuration(durationMs) });
  const textStyle = [styles.text, unselectable, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }];
  return (
    <View testID="footer-details-table">
      {rows.map((row, index) => (
        <View key={row.label} testID={`footer-detail-${row.label}`} style={[styles.row,
          index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.v2.borderSubtle }]}>
          <View style={[styles.type, { width: labelWidth(language), borderRightColor: tokens.v2.borderSubtle }]}>
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
  // 32: the copy button's 24pt box plus 4 above and below; its hitSlop keeps a 32pt target.
  row: { flexDirection: "row", alignItems: "stretch", minHeight: 32 },
  type: { flexShrink: 0, flexDirection: "row", alignItems: "center",
    paddingHorizontal: 8, paddingVertical: 4, borderRightWidth: StyleSheet.hairlineWidth },
  value: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4 },
  text: { fontSize: TYPE.button.size, lineHeight: TYPE.button.lineHeight, flexShrink: 1 },
});
