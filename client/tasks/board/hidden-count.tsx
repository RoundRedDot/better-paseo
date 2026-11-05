import React, { useLayoutEffect, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Modal } from "@getpaseo/plugin/client/react-native";
import type { TaskCard } from "../model";
import { HOST_FONT, TaskText as Text } from "../typography";
import { taskTokens } from "../cards/tokens";

export type HiddenTask = Pick<TaskCard, "id" | "title" | "lane"> & { location: Pick<TaskCard["location"], "workspaceTitle" | "projectName"> };

export function HiddenCount({ tasks, theme, language }: { tasks: readonly HiddenTask[]; theme: PluginTheme; language: "en" | "zh" }) {
  const [open, setOpen] = useState(false);
  const title = language === "zh" ? "被隐藏的任务" : "Hidden tasks";
  const groups = (["needs_input", "running", "review"] as const).map((lane) => ({
    lane,
    label: language === "zh" ? { needs_input: "待输入", running: "运行中", review: "待查看" }[lane] : { needs_input: "Waiting", running: "Running", review: "Review" }[lane],
    tasks: tasks.filter((task) => task.lane === lane),
  })).filter((group) => group.tasks.length > 0);
  const names = groups.map((group) => `${group.label} (${group.tasks.length})\n${group.tasks.map((task) => task.title).join("\n")}`).join("\n\n");
  const label = language === "zh" ? `${tasks.length} 个被隐藏的任务` : `${tasks.length} hidden ${tasks.length === 1 ? "task" : "tasks"}`;
  const anchor = useRef<View>(null);
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const node = anchor.current as unknown as HTMLElement | null;
    node?.setAttribute("title", `${label}\n${names}`);
  }, [label, names]);
  return <>
    <Pressable ref={anchor} testID="hidden-tasks-count" accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: taskTokens(theme).status.warning }} />
      <Text style={{ fontSize: HOST_FONT.sm, color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{tasks.length}</Text>
    </Pressable>
    {open ? <Modal title={title} open onOpenChange={setOpen}>
      <Modal.Content>
        <Text style={{ color: theme.colors.foregroundMuted }}>{language === "zh" ? "当前筛选或搜索隐藏了以下任务。" : "The current filters or search hide these tasks."}</Text>
        {groups.map((group) => <View key={group.lane} style={{ gap: 8 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontWeight: "600" }}>{group.label} · {group.tasks.length}</Text>
          {group.tasks.map((task) => <View key={task.id} style={{ gap: 3 }}>
            <Text style={{ color: theme.colors.foreground }}>{task.title}</Text>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: HOST_FONT.sm }}>{task.location.workspaceTitle ?? task.location.projectName ?? ""}</Text>
          </View>)}
        </View>)}
      </Modal.Content>
    </Modal> : null}
  </>;
}
