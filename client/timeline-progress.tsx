import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Text } from "react-native";
import type { PluginHostProps } from "@getpaseo/plugin/client";
import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import { resolveLanguage } from "./i18n/settings-strings";
import { useEnhancerPreferences } from "./preferences";
import { showToolAtLevel } from "./tools/timeline-level";
import { classifyTool } from "./tools/classify";
import { useReducedMotion } from "./ui/use-reduced-motion";

export interface TimelineProgressProps extends PluginHostProps {
  agentId: string;
  activeCalls: readonly ToolCallTimelineItem[];
}

export function progressText(calls: readonly ToolCallTimelineItem[], language: "en" | "zh"): string | null {
  if (!calls.length) return null;
  if (calls.length > 1) return language === "zh" ? `正在同时进行 ${calls.length} 步` : `Running ${calls.length} steps`;
  const call = calls[0]!;
  const view = classifyTool({ name: call.name, status: call.status, detail: call.detail });
  const labels: Record<string, [string, string]> = {
    read: ["Reading file", "正在读取文件"], search: ["Searching", "正在搜索"], fetch: ["Fetching page", "正在获取网页"],
    shell: ["Running command", "正在运行命令"], bash: ["Running command", "正在运行命令"], git: ["Running command", "正在运行命令"],
    edit: ["Editing file", "正在修改文件"], write: ["Writing file", "正在写入文件"],
    sub_agent: ["Running subtask", "正在执行子任务"], mcp: ["Running tool", "正在调用工具"],
  };
  const label = labels[view.tool] ?? ["Running step", "正在执行步骤"];
  const target = view.command ?? view.filePath ?? view.search?.query;
  return `${label[language === "zh" ? 1 : 0]}${target ? ` · ${target}` : ""}`;
}

export function TimelineProgress({ activeCalls, theme }: TimelineProgressProps) {
  const preferences = useEnhancerPreferences();
  const language = resolveLanguage(preferences.language);
  const text = useMemo(() => preferences.chatEnabled && preferences.timelineLevel !== "detailed"
    ? progressText(activeCalls.filter((item) => !showToolAtLevel(item, preferences.timelineLevel)), language) : null,
  [activeCalls, preferences.chatEnabled, preferences.timelineLevel, language]);
  const [shown, setShown] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (text && !shown) {
      const timer = setTimeout(() => {
        setShown(text);
        if (reducedMotion) opacity.setValue(1);
        else Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
      }, 400);
      return () => clearTimeout(timer);
    }
    if (text && shown && text !== shown) {
      if (reducedMotion) { setShown(text); return; }
      Animated.timing(opacity, { toValue: 0, duration: 80, useNativeDriver: true }).start();
      const timer = setTimeout(() => {
        setShown(text);
        Animated.timing(opacity, { toValue: 1, duration: 80, useNativeDriver: true }).start();
      }, 80);
      return () => clearTimeout(timer);
    }
    if (!text && shown) {
      if (!reducedMotion) Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start();
      const timer = setTimeout(() => { setShown(null); opacity.setValue(0); }, 300);
      return () => clearTimeout(timer);
    }
  }, [text, shown, opacity, reducedMotion]);
  if (!shown) return null;
  return <Animated.View accessibilityRole="text" style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, opacity }}>
    <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
    <Text numberOfLines={1} style={{ flexShrink: 1, color: theme.colors.foregroundMuted }}>{shown}</Text>
  </Animated.View>;
}
