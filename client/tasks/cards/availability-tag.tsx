import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { TaskIssue } from "../../../shared/task-availability";
import type { TasksLanguage } from "../i18n";
import { TaskText as Text, HOST_FONT as F, HOST_LINE, taskControlHeight, useTasksFontScale } from "../typography";
import { useHover } from "../../ui/use-hover";
import { pillTint, readableOn, type TaskTokens } from "./tokens";

const labels: Record<TasksLanguage, Record<TaskIssue["code"], string>> = {
  zh: {
    checking: "正在检查可用性", host_unavailable: "主机暂时不可用", unsupported: "操作不可用", agent_missing: "任务已不存在",
    directory_missing: "工作目录不存在", directory_not_directory: "工作路径无效", directory_inaccessible: "目录无法访问",
    workspace_unavailable: "工作区已不可用", project_unavailable: "项目归属不可用", title_settings_invalid: "标题生成配置无效",
    provider_unavailable: "Provider 不可用", model_unavailable: "标题模型不可用",
  },
  en: {
    checking: "Checking availability", host_unavailable: "Host temporarily unavailable", unsupported: "Operation unavailable", agent_missing: "Task no longer exists",
    directory_missing: "Working directory missing", directory_not_directory: "Invalid working path", directory_inaccessible: "Directory inaccessible",
    workspace_unavailable: "Workspace unavailable", project_unavailable: "Project unavailable", title_settings_invalid: "Invalid title settings",
    provider_unavailable: "Provider unavailable", model_unavailable: "Title model unavailable",
  },
};

export function taskIssueText(issue: TaskIssue, language: TasksLanguage): string {
  return `${labels[language][issue.code]}${issue.detail ? `\n${issue.detail}` : ""}`;
}

/** A persistent warning; hover, keyboard focus and touch expose the same explanation. */
export function AvailabilityTag(props: { issue: TaskIssue | null | undefined; language: TasksLanguage; tokens: TaskTokens; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);
  const { hovered, hoverProps } = useHover();
  const scale = useTasksFontScale();
  if (!props.issue || props.issue.code === "checking") return null;
  const text = taskIssueText(props.issue, props.language);
  const label = labels[props.language][props.issue.code];
  const tint = pillTint(props.tokens, props.tokens.warning);
  const color = readableOn(props.tokens.warning, [tint.background], props.tokens.foreground);
  return (
    <View style={{ marginTop: 8, alignItems: "flex-start", maxWidth: "100%", zIndex: hovered || focused ? 5 : undefined }} testID="task-availability">
      <Pressable accessibilityRole="button" accessibilityLabel={text} accessibilityState={{ expanded: expanded || hovered || focused }}
        onPress={(event) => { event.stopPropagation(); setExpanded((value) => !value); }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} {...hoverProps}
        testID="task-availability-tag" style={{ maxWidth: "100%", minHeight: taskControlHeight(props.compact ? 32 : 24, scale), paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: tint.border, backgroundColor: tint.background, flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="TriangleAlert" size={15} color={color} />
        <Text style={{ flexShrink: 1, fontSize: F.sm, lineHeight: HOST_LINE.sm, fontWeight: "600", color }}>{label}</Text>
      </Pressable>
      {expanded || hovered || focused ? <View pointerEvents="none" testID="task-availability-hint" style={{ ...(expanded ? { marginTop: 4 } : { position: "absolute", top: "100%", left: 0, right: 0 }), padding: 8, borderRadius: 6, borderWidth: 1, borderColor: tint.border, backgroundColor: props.tokens.card.background }}><Text style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: props.tokens.foreground }}>{text}{"\n"}{props.language === "zh" ? "相关写操作已禁用；状态恢复后自动重新检查。" : "Affected write actions are disabled; availability is checked again automatically."}</Text></View> : null}
    </View>
  );
}
