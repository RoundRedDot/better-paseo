import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { mix } from "../../components/theme-tokens";
import { effectiveCard, type TasksSettings } from "../../../shared/tasks-settings";
import type { PageLook } from "../../settings-controls";
import type { CardTitleLineCount } from "../device-store";
import type { TasksLanguage } from "../i18n";
import { TasksTypography } from "../typography";
import { TaskCardView } from "../cards";
import { previewSampleCards, previewTodoItems } from "../sample-cards";
import type { TasksSettingsStrings } from "./strings";

const noop = () => {};

export function FieldPreview(props: { values: TasksSettings; titleLines: CardTitleLineCount; theme: PluginTheme; look: PageLook; language: TasksLanguage; strings: TasksSettingsStrings; hostId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [now] = useState(() => Date.now());
  useEffect(() => { if (!props.values.card.plan) setExpanded(false); }, [props.values.card.plan]);
  const samples = previewSampleCards(now);
  const card = samples.find((item) => item.id === "sample-running")!;
  const tokens = props.look.tokens;
  return (
    <View testID="tasks-field-preview" style={{ marginTop: 16, borderWidth: 1, borderColor: tokens.v2.border, borderRadius: 10, overflow: "hidden", backgroundColor: tokens.v2.surface1 }}>
      <View style={{ paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, borderBottomWidth: 1, borderBottomColor: tokens.v2.border }}>
        <Text style={{ color: tokens.foreground, fontWeight: "600", fontSize: 12 }}>{props.strings.fieldPreviewTitle}</Text>
        <Text testID="tasks-field-preview-tag" style={{ color: tokens.accent, fontWeight: "600", fontSize: 11, lineHeight: 16, paddingHorizontal: 6, borderRadius: 4, backgroundColor: mix(tokens.v2.surface1, tokens.accent, tokens.isDark ? 0.14 : 0.1) }}>{props.values.card.plan ? props.strings.previewOffTag : props.strings.fieldPreviewHidden}</Text>
        <View style={{ flex: 1 }} />
        <Text style={{ color: tokens.foregroundMuted, fontSize: 11 }}>{props.values.card.plan ? props.strings.fieldPreviewHint : props.strings.fieldPreviewOffHint}</Text>
      </View>
      <View style={{ padding: 16, alignItems: "center", backgroundColor: tokens.v2.surface0 }}>
        <View testID="tasks-field-preview-card" style={{ width: "100%", maxWidth: 344 }}>
          <TasksTypography theme={props.theme}><TaskCardView card={card} todo={previewTodoItems(props.language)[card.id]} todoExpanded={props.values.card.plan && expanded} onTodoExpandedChange={(_, next) => setExpanded(next)} fields={effectiveCard(props.values, false)} titleLines={props.titleLines === "all" ? null : Number(props.titleLines)} theme={props.theme} compact={false} language={props.language} permissionButtons={[]} stopPhase="idle" focused={false} highlighted={false} now={now} hostId={props.hostId} onReveal={noop} animated={false} copyable={false} /></TasksTypography>
        </View>
      </View>
    </View>
  );
}
