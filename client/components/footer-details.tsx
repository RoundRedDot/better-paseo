import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { ProviderLogo } from "./provider-logo";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { useEnhancerPreferences } from "../preferences";
import { toolbarLabel } from "../i18n/toolbar-strings";
import { resolveLanguage } from "../i18n/settings-strings";
import type { SettingsLanguagePreference } from "../i18n/settings-strings";
import { CopyButton } from "../ui/copy-button";
import { formatFullStamp, formatDuration } from "../ui/time";
import { TYPE } from "../ui/tokens/typography";
import { unselectable } from "./selection";
import type { TurnUsage } from "./user-message";

export interface FooterDetailsProps {
  agentName?: string | null;
  /** The model as configured, copied verbatim; `modelName` is only its display label. */
  modelId?: string | null;
  modelName?: string | null;
  thinkingLabel?: string | null;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
  usage?: TurnUsage | null;
  tokens: ExtendedThemeTokens;
}

/** The label column fits the longest label: four CJK characters, or "Thinking level". */
const LABEL_WIDTH = { zh: 72, en: 104 } as const;
/** Room for a toolbar icon, a full timestamp, a long model name and the copy action. */
const VALUE_WIDTH = 240;
const TABLE_INSET = 6;

function labelWidth(language: SettingsLanguagePreference): number {
  return resolveLanguage(language) === "zh" ? LABEL_WIDTH.zh : LABEL_WIDTH.en;
}

/** The panel width the table needs, so it opens no wider than its content. */
export function useFooterDetailsWidth(): number {
  return labelWidth(useEnhancerPreferences().language) + VALUE_WIDTH + TABLE_INSET * 2;
}

/**
 * Two columns: a plain label, then its toolbar icon, value and inline copy action.
 */
export function FooterDetails({ agentName, modelId, modelName, thinkingLabel, startedAt, completedAt, durationMs, usage, tokens }: FooterDetailsProps) {
  const { language } = useEnhancerPreferences();
  const rows: Array<{ label: string; icon: string; provider?: string | null; value: string; copyText?: string; copyLabel?: string }> = [];
  if (agentName) rows.push({ label: "Agent", icon: "Bot", provider: agentName, value: agentName, copyLabel: "Copy agent" });
  if (modelName) rows.push({ label: "Model name", icon: "Copy", provider: agentName, value: modelName, copyText: modelId ?? undefined, copyLabel: "Copy model name" });
  if (thinkingLabel) rows.push({ label: "Thinking level", icon: "Brain", value: thinkingLabel, copyLabel: "Copy thinking level" });
  if (startedAt != null) rows.push({ label: "Start time", icon: "Clock", value: formatFullStamp(new Date(startedAt)), copyLabel: "Copy start time" });
  if (completedAt != null) rows.push({ label: "End time", icon: "Clock", value: formatFullStamp(new Date(completedAt)), copyLabel: "Copy end time" });
  if (durationMs != null) rows.push({ label: "Elapsed time", icon: "Hourglass", value: formatDuration(durationMs) });
  for (const [label, icon, count] of [
    ["Input", "LogIn", usage?.inputTokens],
    ["Cached", "Database", usage?.cachedInputTokens],
    ["Output", "LogOut", usage?.outputTokens],
  ] as const) {
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) continue;
    rows.push({ label, icon, value: count.toLocaleString(resolveLanguage(language) === "zh" ? "zh-CN" : "en-US") });
  }
  const textStyle = [styles.text, unselectable, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }];
  return (
    <View>
      <View testID="footer-panel-titlebar" style={[styles.titlebar,
        { backgroundColor: tokens.v2.surface1, borderBottomColor: tokens.v2.borderSubtle }]}>
        <Text accessibilityRole="header" style={[textStyle, styles.title, { color: tokens.foreground }]}>
          {toolbarLabel("Turn details", language)}
        </Text>
      </View>
      <View testID="footer-details-table" style={{ padding: TABLE_INSET }}>
        {rows.map((row, index) => (
          <View key={row.label} testID={`footer-detail-${row.label}`} style={[styles.row,
            { backgroundColor: index % 2 === 0 ? tokens.surface0 : tokens.v2.surface1 },
            index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.v2.borderSubtle }]}>
            <View style={[styles.type, { width: labelWidth(language), borderRightColor: tokens.v2.borderSubtle }]}>
              <Text style={textStyle}>{toolbarLabel(row.label, language)}</Text>
            </View>
            <View style={styles.value}>
              <View testID="footer-value-icon" style={styles.icon}>
                {row.provider
                  ? <ProviderLogo provider={row.provider} size={14} color={tokens.foregroundMuted} />
                  : <Icon name={row.icon} size={14} color={tokens.foregroundMuted} />}
              </View>
              {/* One line always: a long model name shrinks to an ellipsis rather than
                  pushing the copy action aside and making the row taller. */}
              <Text numberOfLines={1} style={[textStyle, { color: tokens.foreground }]}>{row.value}</Text>
              {row.copyLabel ? <CopyButton text={row.copyText || row.value} label={row.copyLabel} tokens={tokens} /> : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  titlebar: { minHeight: 32, justifyContent: "center", paddingHorizontal: TABLE_INSET + 8,
    paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontWeight: "500", textAlign: "center" },
  // 32: the copy button's 24pt box plus 4 above and below; its hitSlop keeps a 32pt target.
  row: { flexDirection: "row", alignItems: "stretch", minHeight: 32 },
  type: { flexShrink: 0, flexDirection: "row", alignItems: "center",
    paddingHorizontal: 8, paddingVertical: 4, borderRightWidth: StyleSheet.hairlineWidth },
  value: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4 },
  icon: { width: 14, height: 14, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  text: { fontSize: TYPE.button.size, lineHeight: TYPE.button.lineHeight, flexShrink: 1 },
});
