import React, { useLayoutEffect, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Modal } from "@getpaseo/plugin/client/react-native";
import type { CardSettings } from "../../../shared/tasks-settings";
import { LANE_STATUS, type TaskCard } from "../model";
import { HOST_FONT, TaskText as Text } from "../typography";
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

/** Tasks the board's filters leave out of the sidebar counts. Each one is the board's own card. */
export function HiddenCount({ tasks, theme, language, fields, compact = false, hostId }: { tasks: readonly TaskCard[]; theme: PluginTheme; language: "en" | "zh"; fields: CardSettings; compact?: boolean; hostId?: string }) {
  const [open, setOpen] = useState(false);
  const title = language === "zh" ? "被隐藏的任务" : "Hidden tasks";
  const groups = (["needs_input", "running", "review"] as const).map((lane) => ({
    lane,
    label: language === "zh" ? { needs_input: "待输入", running: "运行中", review: "待查看" }[lane] : { needs_input: "Waiting", running: "Running", review: "Review" }[lane],
    tasks: tasks.filter((task) => task.lane === lane),
  })).filter((group) => group.tasks.length > 0);
  const names = groups.map((group) => `${group.label} (${group.tasks.length})\n${group.tasks.map((task) => task.title).join("\n")}`).join("\n\n");
  const label = language === "zh" ? `${tasks.length} 个被隐藏的任务` : `${tasks.length} hidden ${tasks.length === 1 ? "task" : "tasks"}`;
  const dot = statusMarkSize(14) / 2;
  const anchor = useRef<View>(null);
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const node = anchor.current as unknown as HTMLElement | null;
    node?.setAttribute("title", `${label}\n${names}`);
  }, [label, names]);
  return <>
    <Pressable ref={anchor} testID="hidden-tasks-count" accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      <View style={{ width: 14, height: 14, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: taskTokens(theme).card.archiveBorder }} />
      </View>
      <Text style={{ fontSize: HOST_FONT.sm, color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{tasks.length}</Text>
    </Pressable>
    {open ? <Modal title={title} open onOpenChange={setOpen}>
      <Modal.Content scrollable contentContainerStyle={{ gap: 16 }}>
        <Text style={{ color: theme.colors.foregroundMuted }}>{language === "zh" ? "当前筛选或搜索隐藏了以下任务。" : "The current filters or search hide these tasks."}</Text>
        {groups.map((group) => <View key={group.lane} testID={`hidden-tasks-${group.lane}`} style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <StatusIcon kind={LANE_STATUS[group.lane]} size={14} theme={theme} />
            <Text style={{ color: theme.colors.foregroundMuted, fontWeight: "600" }}>{group.label} · {group.tasks.length}</Text>
          </View>
          {group.tasks.map((task) => <TaskCardView key={task.id} card={task} fields={fields} theme={theme} compact={compact} language={language} hostId={hostId} permissionButtons={[]} stopPhase="idle" focused={false} highlighted={false} onReveal={noop} />)}
        </View>)}
      </Modal.Content>
    </Modal> : null}
  </>;
}
