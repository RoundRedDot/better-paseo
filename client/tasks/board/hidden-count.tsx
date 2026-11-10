import React, { useLayoutEffect, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal, ScrollView } from "@getpaseo/plugin/client/react-native";
import type { CardSettings } from "../../../shared/tasks-settings";
import { LANE_STATUS, type TaskCard } from "../model";
import { HOST_FONT, HOST_LINE, TaskText as Text, taskControlHeight, useTasksFontScale } from "../typography";
import { StatusIcon, TaskCardView } from "../cards";
import { statusMarkSize } from "../cards/status-icon";
import { taskTokens } from "../cards/tokens";

const noop = () => {};

/** The settings preview's one hidden task: a real card, so the dialog draws the board's cell. */
export function hiddenExampleCard(language: "en" | "zh"): TaskCard {
  const now = new Date(0).toISOString();
  const workspace = language === "zh" ? "示例工作区" : "Example workspace";
  return {
    id: "example",
    title: language === "zh" ? "示例任务" : "Example task",
    lane: "needs_input",
    status: "needs_input",
    provider: "claude",
    providerLabel: "Claude",
    providerMark: "lobe:claude",
    model: "claude-opus",
    modelLabel: "Opus",
    thinkingLabel: "High",
    modeLabel: "Default",
    location: {
      projectId: null,
      projectKey: null,
      projectName: null,
      projectIcon: null,
      workspaceId: null,
      workspaceName: workspace,
      workspaceTitle: workspace,
      workspaceKind: null,
      branch: null,
      git: null,
      folder: null,
      folderName: null,
      cwd: "",
      pullRequest: null,
    },
    labels: [],
    timing: { createdAt: now, updatedAt: now, turnStartedAt: null, attentionAt: now, lastUserMessageAt: null, lastTurnMs: null, lastTurnEndedAt: null },
    context: null,
    usage: null,
    error: null,
    permission: null,
    parent: null,
    children: [],
    openTab: false,
    stoppable: false,
  };
}

/**
 * Tasks the board's filters leave out of the sidebar counts. Each one is the
 * board's own card. `onClearFilters` adds the dialog's way back to a full
 * board: the board's own clear-filters action, without touching the subtask
 * switch. Omitted in the settings preview, whose example card is not on a board.
 */
export function HiddenCount({ tasks, theme, language, fields, compact = false, hostId, onClearFilters, clearLabel = language === "zh" ? "清除筛选" : "Clear filters" }: { tasks: readonly TaskCard[]; theme: PluginTheme; language: "en" | "zh"; fields: CardSettings; compact?: boolean; hostId?: string; onClearFilters?(): void; clearLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const title = language === "zh" ? "被隐藏的任务" : "Hidden tasks";
  const groups = (["needs_input", "running", "review"] as const).map((lane) => ({
    lane,
    label: language === "zh" ? { needs_input: "待输入", running: "运行中", review: "待查看" }[lane] : { needs_input: "Waiting", running: "Running", review: "Review" }[lane],
    tasks: tasks.filter((task) => task.lane === lane),
  })).filter((group) => group.tasks.length > 0);
  const names = groups.map((group) => `${group.label} (${group.tasks.length})\n${group.tasks.map((task) => task.title).join("\n")}`).join("\n\n");
  const label = language === "zh" ? `${tasks.length} 个被隐藏的任务` : `${tasks.length} hidden ${tasks.length === 1 ? "task" : "tasks"}`;
  const dot = statusMarkSize(14) / 2;
  const body = <>
    <Text style={{ color: theme.colors.foregroundMuted }}>{language === "zh" ? "当前筛选或搜索隐藏了以下任务。" : "The current filters or search hide these tasks."}</Text>
    {groups.map((group) => <View key={group.lane} testID={`hidden-tasks-${group.lane}`} style={{ gap: 8 }}>
      <Pressable testID={`hidden-tasks-toggle-${group.lane}`} accessibilityRole="button" accessibilityLabel={`${group.label} · ${group.tasks.length}`} accessibilityState={{ expanded: !collapsed.has(group.lane) }} onPress={() => setCollapsed((previous) => {
        const next = new Set(previous);
        if (next.has(group.lane)) next.delete(group.lane);
        else next.add(group.lane);
        return next;
      })} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={collapsed.has(group.lane) ? "ChevronRight" : "ChevronDown"} size={14} color={theme.colors.foregroundMuted} />
        <StatusIcon kind={LANE_STATUS[group.lane]} size={14} theme={theme} />
        <Text style={{ color: theme.colors.foregroundMuted, fontWeight: "600" }}>{group.label} · {group.tasks.length}</Text>
      </Pressable>
      {!collapsed.has(group.lane) ? group.tasks.map((task) => <TaskCardView key={task.id} card={task} fields={fields} theme={theme} compact={compact} language={language} hostId={hostId} permissionButtons={[]} stopPhase="idle" focused={false} highlighted={false} onReveal={noop} />) : null}
    </View>)}
  </>;
  const touch = Platform.OS !== "web";
  const scale = useTasksFontScale();
  const anchor = useRef<View>(null);
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const node = anchor.current as unknown as HTMLElement | null;
    node?.setAttribute("title", `${label}\n${names}`);
  }, [label, names]);
  return <View {...(Platform.OS === "web" ? { onClick: (event: React.MouseEvent) => event.stopPropagation() } : {})}>
    <Pressable ref={anchor} testID="hidden-tasks-count" accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      <View style={{ width: 14, height: 14, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: taskTokens(theme).card.archiveBorder }} />
      </View>
      <Text style={{ fontSize: HOST_FONT.sm, color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{tasks.length}</Text>
    </Pressable>
    {open ? <Modal title={title} open onOpenChange={setOpen}>
      <Modal.Content scrollable={!onClearFilters} contentContainerStyle={onClearFilters ? { paddingHorizontal: 0, paddingTop: 0, paddingBottom: compact ? 16 : 24, gap: 0, flex: 1, minHeight: 0 } : { gap: 16 }}>
        {onClearFilters ? <ScrollView testID="hidden-tasks-scroll" style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16, gap: 16 }}>{body}</ScrollView> : body}
        {onClearFilters ? <View testID="hidden-tasks-actions" style={{ paddingTop: 12, paddingHorizontal: touch ? 16 : 24, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface0, boxShadow: `0px -5px 8px -4px rgba(0, 0, 0, ${taskTokens(theme).isDark ? 0.36 : 0.14})`, flexDirection: "row", ...(touch ? null : { justifyContent: "flex-end" }) }}>
          <Pressable testID="hidden-tasks-clear-filters" accessibilityRole="button" accessibilityLabel={clearLabel} onPress={() => { setOpen(false); onClearFilters(); }} style={touch ? { flex: 1, minHeight: taskControlHeight(44, scale), paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 22, borderWidth: 1, borderColor: theme.colors.border } : { minHeight: taskControlHeight(32, scale), paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: theme.colors.accent }}>
            <Text style={{ fontSize: HOST_FONT.base, lineHeight: HOST_LINE.base, color: touch ? theme.colors.foreground : theme.colors.accentForeground }}>{clearLabel}</Text>
          </Pressable>
        </View> : null}
      </Modal.Content>
    </Modal> : null}
  </View>;
}
