import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { setTasksEnabled } from "../board/enabled";
import {
  SettingsAction,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import {
  CARD_FIELDS,
  DEFAULT_TASKS_SETTINGS,
  DENSITIES,
  DONE_WINDOWS,
  LABEL_LIMITS,
  SIDEBAR_COUNTS,
  TASKS_SETTINGS,
  applyDensity,
  effectiveCard,
  setCardSetting,
  type CardField,
  type Density,
  type DensityPreset,
  type DoneWindow,
  type LabelLimit,
  type SidebarCount,
  type TasksSettings,
} from "../../../shared/tasks-settings";
import { permissionButtons } from "../actions";
import { TaskCardView } from "../cards";
import { useTasksLanguage, type TasksLanguage } from "../i18n";
import type { LaneId } from "../model";
import { sampleCards } from "../sample-cards";

interface Strings {
  title: string;
  loading: string;
  error: (message: string) => string;
  invalid: (message: string) => string;
  saving: string;
  saveError: (message: string) => string;
  conflict: string;
  enabledTitle: string;
  enabled: string;
  enabledHint: string;
  previewTitle: string;
  lanes: Record<PreviewLane, string>;
  density: string;
  densityHint: string;
  densities: Record<Density, string>;
  cardTitle: string;
  fields: Record<CardField, string>;
  labelLimit: string;
  labelLimits: Record<LabelLimit, string>;
  phoneTitle: string;
  compactCards: string;
  compactCardsHint: string;
  boardTitle: string;
  doneWindow: string;
  doneWindows: Record<DoneWindow, string>;
  hideSubtasks: string;
  hideSubtasksHint: string;
  confirmStop: string;
  sidebarTitle: string;
  sidebarCount: string;
  sidebarCounts: Record<SidebarCount, string>;
  resetTitle: string;
  reset: string;
  resetHint: string;
  resetAction: string;
  resetConfirm: string;
  resetConfirmHint: string;
  resetCancel: string;
  resetInvalidHint: string;
}

type PreviewLane = Extract<LaneId, "running" | "needs_input" | "done">;
const PREVIEW_LANES: readonly PreviewLane[] = ["running", "needs_input", "done"];

const STRINGS: Record<TasksLanguage, Strings> = {
  en: {
    title: "Tasks",
    loading: "Loading settings…",
    error: (message) => `Settings could not be loaded: ${message}`,
    invalid: (message) => `The saved Tasks settings are unusable: ${message}`,
    saving: "Saving…",
    saveError: (message) => `Could not save: ${message}`,
    conflict: "Settings changed elsewhere; reloaded the latest.",
    enabledTitle: "Tasks board",
    enabled: "Enable the Tasks board",
    enabledHint: "Shows the Tasks entry and board in the sidebar",
    previewTitle: "Preview",
    lanes: { running: "Running", needs_input: "Needs input", done: "Done" },
    density: "Card density",
    densityHint: "A preset sets every switch below; editing one switch makes it Custom.",
    densities: { minimal: "Minimal", standard: "Standard", full: "Full", custom: "Custom" },
    cardTitle: "Card fields",
    fields: {
      provider: "Agent brand mark",
      model: "Model",
      thinking: "Thinking level",
      project: "Project",
      projectIcon: "Project icon",
      workspace: "Workspace name",
      branch: "Branch",
      gitStatus: "Git status",
      folder: "Folder",
      path: "Full path",
      labels: "Labels",
      pullRequest: "Linked PR",
      timer: "Timer / finished at",
      context: "Context usage bar",
      subtasks: "Subtask summary",
    },
    labelLimit: "Labels shown",
    labelLimits: { "1": "1", "2": "2", "3": "3", all: "All" },
    phoneTitle: "Phone",
    compactCards: "Use minimal cards on phones",
    compactCardsHint: "Phones draw the Minimal card whatever the density above.",
    boardTitle: "Board",
    doneWindow: "Done lane window",
    doneWindows: { "24h": "Last 24 hours", "7d": "Last 7 days", all: "All" },
    hideSubtasks: "Hide subtasks by default",
    hideSubtasksHint: "Running, waiting and failed subtasks still show in their lane.",
    confirmStop: "Confirm before stopping",
    sidebarTitle: "Sidebar",
    sidebarCount: "Sidebar entry count",
    sidebarCounts: { "running-and-input": "Running · Needs input", "input-only": "Needs input only", none: "Hidden" },
    resetTitle: "Reset",
    reset: "Restore default settings",
    resetHint: "Puts every Tasks setting back to its default; the board stays on or off.",
    resetAction: "Restore",
    resetConfirm: "Restore now",
    resetConfirmHint: "This replaces all Tasks settings with the defaults.",
    resetCancel: "Cancel",
    resetInvalidHint: "Restoring the defaults replaces the unusable record.",
  },
  zh: {
    title: "任务",
    loading: "正在加载设置…",
    error: (message) => `设置加载失败：${message}`,
    invalid: (message) => `已保存的任务设置无法使用：${message}`,
    saving: "正在保存…",
    saveError: (message) => `保存失败：${message}`,
    conflict: "设置已在别处更改，已重新载入最新内容。",
    enabledTitle: "任务面板",
    enabled: "启用任务面板",
    enabledHint: "在侧边栏显示任务入口和看板",
    previewTitle: "实时预览",
    lanes: { running: "运行中", needs_input: "待输入", done: "已完成" },
    density: "卡片信息密度",
    densityHint: "预设会一次写入下面所有开关；手动改动任一开关后显示为「自定义」。",
    densities: { minimal: "精简", standard: "标准", full: "完整", custom: "自定义" },
    cardTitle: "卡片字段",
    fields: {
      provider: "agent 品牌标识",
      model: "模型",
      thinking: "思考等级",
      project: "项目",
      projectIcon: "项目图标",
      workspace: "workspace 名称",
      branch: "分支",
      gitStatus: "Git 状态",
      folder: "文件夹",
      path: "完整路径",
      labels: "标签",
      pullRequest: "关联 PR",
      timer: "计时 / 完成于",
      context: "上下文占用条",
      subtasks: "子任务摘要",
    },
    labelLimit: "标签数量",
    labelLimits: { "1": "1 个", "2": "2 个", "3": "3 个", all: "全部" },
    phoneTitle: "手机",
    compactCards: "手机上使用精简卡片",
    compactCardsHint: "手机上无论上面选哪种密度，都按精简卡片显示。",
    boardTitle: "看板",
    doneWindow: "已完成默认时间窗口",
    doneWindows: { "24h": "近 24 小时", "7d": "近 7 天", all: "全部" },
    hideSubtasks: "默认隐藏子任务",
    hideSubtasksHint: "运行中、待输入和失败的子任务仍会显示在各自的泳道。",
    confirmStop: "停止前二次确认",
    sidebarTitle: "侧边栏",
    sidebarCount: "侧边栏入口计数",
    sidebarCounts: { "running-and-input": "运行中 · 待输入", "input-only": "只显示待输入", none: "不显示" },
    resetTitle: "恢复",
    reset: "恢复默认设置",
    resetHint: "把任务面板的所有设置恢复为默认值；面板的开关保持不变。",
    resetAction: "恢复",
    resetConfirm: "确认恢复",
    resetConfirmHint: "这会用默认值替换全部任务面板设置。",
    resetCancel: "取消",
    resetInvalidHint: "恢复默认设置会替换无法使用的记录。",
  },
};

const options = <Value extends string>(values: readonly Value[], labels: Record<Value, string>) =>
  values.map((value) => ({ value, label: labels[value] }));

export function TasksSettingsPage(props: PluginSurfaceProps) {
  const language = useTasksLanguage();
  const t = STRINGS[language];
  const settings = useSettings(TASKS_SETTINGS);
  const [conflict, setConflict] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [lane, setLane] = useState<PreviewLane>("running");
  const [now] = useState(() => Date.now());
  const samples = useMemo(() => sampleCards(now), [now]);
  const { colors } = props.theme;
  const compact = props.layout.compact;

  const { save, reload, reset } = settings;
  const revision = settings.status === "ready" ? settings.revision : null;
  const commit = useCallback(
    async (next: TasksSettings) => {
      if (revision === null) return;
      setConflict(false);
      if (await save(next, revision)) return;
      // A refused save is a stale revision more often than not: show the latest.
      await reload();
      setConflict(true);
    },
    [save, reload, revision],
  );
  // Resetting the card and board options keeps the board on or off: a reset
  // that also hid the board would read as the page breaking it. A record the
  // schema rejects has no switch to keep, so it takes the host's reset.
  const enabled = settings.status === "ready" ? settings.values.enabled : null;
  const doReset = useCallback(async () => {
    setConfirmingReset(false);
    setConflict(false);
    if (enabled === null) await reset();
    else await commit({ ...DEFAULT_TASKS_SETTINGS, enabled });
  }, [reset, commit, enabled]);
  // The sidebar entry and the Command Center item follow the switch at once.
  useEffect(() => {
    if (enabled !== null) setTasksEnabled(enabled);
  }, [enabled]);

  const note = (text: string, color: string = colors.foregroundMuted) => (
    <Text style={{ color, fontSize: 13, paddingVertical: 8 }}>{text}</Text>
  );

  const resetSection = (hint: string) => (
    <SettingsSection title={t.resetTitle}>
      {confirmingReset ? (
        <>
          <SettingsAction
            label={t.reset}
            hint={t.resetConfirmHint}
            actionLabel={t.resetConfirm}
            onPress={() => void doReset()}
          />
          <SettingsAction label={t.resetCancel} actionLabel={t.resetCancel} onPress={() => setConfirmingReset(false)} />
        </>
      ) : (
        <SettingsAction label={t.reset} hint={hint} actionLabel={t.resetAction} onPress={() => setConfirmingReset(true)} />
      )}
    </SettingsSection>
  );

  let body: React.ReactNode;
  if (settings.status === "loading") {
    body = note(t.loading);
  } else if (settings.status === "error") {
    body = note(t.error(settings.error), colors.statusDanger);
  } else if (settings.status === "invalid") {
    body = (
      <>
        {note(t.invalid(settings.error), colors.statusDanger)}
        {resetSection(t.resetInvalidHint)}
      </>
    );
  } else {
    const values = settings.values;
    const card = values.card;
    const sample = samples.find((candidate) => candidate.lane === lane && candidate.parent === null) ?? samples[0];
    const busy = settings.saving;
    body = (
      <>
        <SettingsSection title={t.enabledTitle}>
          <SettingsSwitch
            label={t.enabled}
            hint={t.enabledHint}
            value={values.enabled}
            disabled={busy}
            onValueChange={(next) => void commit({ ...values, enabled: next })}
          />
        </SettingsSection>

        {/* Off, the options stay reachable (set the board up before turning it on) but step back. */}
        <View style={{ gap: 16, opacity: values.enabled ? 1 : 0.5 }} testID="tasks-settings-options">
          <SettingsSection title={t.previewTitle}>
            <View style={{ flexDirection: "row", gap: 6, paddingBottom: 10 }}>
              {PREVIEW_LANES.map((id) => {
                const active = id === lane;
                return (
                  <Pressable
                    key={id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setLane(id)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: active ? colors.accent : colors.border,
                      backgroundColor: active ? colors.surface2 : colors.surface0,
                    }}
                  >
                    <Text style={{ color: active ? colors.foreground : colors.foregroundMuted, fontSize: 13 }}>
                      {t.lanes[id]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {sample ? (
              <TaskCardView
                card={sample}
                fields={effectiveCard(values, compact)}
                theme={props.theme}
                compact={compact}
                permissionButtons={sample.permission ? permissionButtons(sample.permission, language) : []}
                language={language}
                stopPhase="idle"
                focused={false}
                highlighted={false}
                now={now}
                onReveal={() => {}}
              />
            ) : null}
          </SettingsSection>

          <SettingsSection title={t.cardTitle}>
            <SettingsSelect<Density>
              label={t.density}
              hint={t.densityHint}
              value={values.density}
              options={options(DENSITIES, t.densities)}
              disabled={busy}
              onValueChange={(next) => {
                if (next === "custom") return;
                void commit(applyDensity(values, next as DensityPreset));
              }}
            />
            {CARD_FIELDS.map((field) => (
              <React.Fragment key={field}>
                <SettingsSwitch
                  label={t.fields[field]}
                  value={card[field]}
                  disabled={busy}
                  onValueChange={(next) => void commit(setCardSetting(values, field, next))}
                />
                {field === "labels" && card.labels ? (
                  <SettingsSelect<LabelLimit>
                    label={t.labelLimit}
                    value={card.labelLimit}
                    options={options(LABEL_LIMITS, t.labelLimits)}
                    disabled={busy}
                    onValueChange={(next) => void commit(setCardSetting(values, "labelLimit", next))}
                  />
                ) : null}
              </React.Fragment>
            ))}
          </SettingsSection>

          <SettingsSection title={t.phoneTitle}>
            <SettingsSwitch
              label={t.compactCards}
              hint={t.compactCardsHint}
              value={values.mobile.compactCards}
              disabled={busy}
              onValueChange={(next) => void commit({ ...values, mobile: { ...values.mobile, compactCards: next } })}
            />
          </SettingsSection>

          <SettingsSection title={t.boardTitle}>
            <SettingsSelect<DoneWindow>
              label={t.doneWindow}
              value={values.board.doneWindow}
              options={options(DONE_WINDOWS, t.doneWindows)}
              disabled={busy}
              onValueChange={(next) => void commit({ ...values, board: { ...values.board, doneWindow: next } })}
            />
            <SettingsSwitch
              label={t.hideSubtasks}
              hint={t.hideSubtasksHint}
              value={values.board.hideSubtasks}
              disabled={busy}
              onValueChange={(next) => void commit({ ...values, board: { ...values.board, hideSubtasks: next } })}
            />
            <SettingsSwitch
              label={t.confirmStop}
              value={values.board.confirmStop}
              disabled={busy}
              onValueChange={(next) => void commit({ ...values, board: { ...values.board, confirmStop: next } })}
            />
          </SettingsSection>

          <SettingsSection title={t.sidebarTitle}>
            <SettingsSelect<SidebarCount>
              label={t.sidebarCount}
              value={values.sidebar.count}
              options={options(SIDEBAR_COUNTS, t.sidebarCounts)}
              disabled={busy}
              onValueChange={(next) => void commit({ ...values, sidebar: { count: next } })}
            />
          </SettingsSection>

          {resetSection(t.resetHint)}
        </View>
      </>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface0 }}>
      <View style={{ padding: compact ? 16 : 24, gap: 16, maxWidth: compact ? undefined : 720, alignSelf: "stretch" }}>
        {settings.saving ? note(t.saving) : null}
        {settings.saveError ? note(t.saveError(settings.saveError), colors.statusDanger) : null}
        {conflict ? note(t.conflict) : null}
        {body}
      </View>
    </ScrollView>
  );
}

