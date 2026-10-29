import type { CardField, Density, DoneWindow, LabelLimit, LaneWidth, SidebarCount } from "../../../shared/tasks-settings";
import type { CardTitleLineCount } from "../device-store";
import type { TasksLanguage } from "../i18n";

/** The words of the Tasks board's half of the settings page. */
export interface TasksSettingsStrings {
  loading: string;
  error: (message: string) => string;
  invalid: (message: string) => string;
  saving: string;
  saveError: (message: string) => string;
  conflict: string;
  enabled: string;
  /** One line: what turning it on adds. */
  enabledHint: string;
  /** After the switch went on: where the entry appeared. */
  enabledConfirm: string;
  enabledConfirmHint: string;
  openBoard: string;
  previewTitle: string;
  previewOffHint: string;
  previewOnHint: string;
  /** The off preview's tag: what it is a preview of. */
  previewOffTag: string;
  previewLanes: string;
  density: string;
  densityHint: string;
  densities: Record<Density, string>;
  cardTitle: string;
  fieldsTitle: string;
  fieldsHint: string;
  fields: Record<CardField, string>;
  labelLimit: string;
  labelLimits: Record<LabelLimit, string>;
  titleLines: string;
  titleLinesHint: string;
  titleLineCounts: Record<CardTitleLineCount, string>;
  phoneTitle: string;
  compactCards: string;
  compactCardsHint: string;
  boardTitle: string;
  doneWindow: string;
  doneWindows: Record<DoneWindow, string>;
  showSubtasks: string;
  showSubtasksHint: string;
  showArchived: string;
  showArchivedHint: string;
  showEmptyGroups: string;
  showEmptyGroupsHint: string;
  confirmStop: string;
  laneWidth: string;
  /** Says the phone ignores it: there one lane fills the screen. */
  laneWidthHint: string;
  laneWidths: Record<LaneWidth, string>;
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
  /** The cancel row's own label, so it does not repeat its button's "Cancel". */
  resetKeep: string;
  resetInvalidHint: string;
}

export const TASKS_SETTINGS_STRINGS: Readonly<Record<TasksLanguage, TasksSettingsStrings>> = {
  en: {
    loading: "Loading the Tasks settings…",
    error: (message) => `The Tasks settings could not be loaded: ${message}`,
    invalid: (message) => `The saved Tasks settings are unusable: ${message}`,
    saving: "Saving…",
    saveError: (message) => `Could not save: ${message}`,
    conflict: "Settings changed elsewhere; reloaded the latest.",
    enabled: "Enable the Tasks board",
    enabledHint: "Adds Tasks to the sidebar: every task on this host, in lanes by status.",
    enabledConfirm: "Tasks is now at the top of the sidebar.",
    enabledConfirmHint: "Leave Settings to see it, or open the board from here.",
    openBoard: "Open board",
    previewTitle: "Preview",
    previewOffHint: "What the board looks like once it is on: sample tasks, drawn with the options below.",
    previewOnHint: "Sample tasks, drawn with the options below as you change them.",
    previewOffTag: "Sample",
    previewLanes: "Lane",
    density: "Card density",
    densityHint: "A preset sets every switch below; editing one switch makes it Custom.",
    densities: { minimal: "Minimal", standard: "Standard", full: "Full", custom: "Custom" },
    cardTitle: "Cards",
    fieldsTitle: "Fields",
    fieldsHint: "What each card shows. Phones keep the essentials whatever is picked here.",
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
      context: "Context usage ring",
      subtasks: "Subtask summary",
    },
    labelLimit: "Labels shown",
    labelLimits: { "1": "1", "2": "2", "3": "3", all: "All" },
    titleLines: "Title lines",
    titleLinesHint: "Saved on this device only.",
    titleLineCounts: { "1": "1", "2": "2", "3": "3", "4": "4" },
    phoneTitle: "Phone",
    compactCards: "Use minimal cards on phones",
    compactCardsHint: "Phones draw the Minimal card whatever the density above.",
    boardTitle: "Board",
    doneWindow: "Done lane window",
    doneWindows: { "24h": "Last 24 hours", "7d": "Last 7 days", all: "All" },
    showSubtasks: "Show subtasks",
    showSubtasksHint: "When off, running, waiting and failed subtasks still show in their lane, unless their parent's card is there too. Saved on this device only.",
    showArchived: "Show the archived lane",
    showArchivedHint: "Saved on this device only. A lane after Done with archived tasks and those of archived workspaces, in the same time window.",
    showEmptyGroups: "Show all",
    showEmptyGroupsHint: "The filters and the sidebar list every Agent, project, workspace and label in Paseo, a count of 0 where none is active. Saved on this device only.",
    confirmStop: "Confirm before stopping",
    laneWidth: "Lane width",
    laneWidthHint: "Saved on this device only. On desktop, web and tablets. Phones show one lane at a time.",
    laneWidths: { narrow: "Narrow", default: "Default", wide: "Wide" },
    sidebarTitle: "Sidebar",
    sidebarCount: "Sidebar entry count",
    sidebarCounts: { all: "Waiting · Running · Review", "input-only": "Waiting only", none: "Hidden" },
    resetTitle: "Reset",
    reset: "Restore the Tasks defaults",
    resetHint: "Puts every Tasks option back to its default; the board stays on or off.",
    resetAction: "Restore",
    resetConfirm: "Restore now",
    resetConfirmHint: "This replaces all Tasks options with the defaults.",
    resetCancel: "Cancel",
    resetKeep: "Keep the current options",
    resetInvalidHint: "Restoring the defaults replaces the unusable record.",
  },
  zh: {
    loading: "正在加载任务看板设置…",
    error: (message) => `任务看板设置加载失败：${message}`,
    invalid: (message) => `已保存的任务看板设置无法使用：${message}`,
    saving: "正在保存…",
    saveError: (message) => `保存失败：${message}`,
    conflict: "设置已在别处更改，已重新载入最新内容。",
    enabled: "启用任务看板",
    enabledHint: "在侧边栏加入「任务」，把这台主机上的所有任务按状态分泳道排列。",
    enabledConfirm: "「任务」已加入侧边栏顶部。",
    enabledConfirmHint: "退出设置即可看到，也可以直接从这里打开看板。",
    openBoard: "打开看板",
    previewTitle: "实时预览",
    previewOffHint: "开启后看板就是这个样子：示例任务，按下面的选项绘制。",
    previewOnHint: "示例任务，随下面的选项实时变化。",
    previewOffTag: "示例",
    previewLanes: "泳道",
    density: "卡片信息密度",
    densityHint: "预设会一次写入下面所有开关；手动改动任一开关后显示为「自定义」。",
    densities: { minimal: "精简", standard: "标准", full: "完整", custom: "自定义" },
    cardTitle: "卡片",
    fieldsTitle: "显示字段",
    fieldsHint: "每张卡片显示哪些信息。手机上始终保留最关键的几项。",
    fields: {
      provider: "Agent 品牌标识",
      model: "模型",
      thinking: "思考等级",
      project: "项目",
      projectIcon: "项目图标",
      workspace: "工作区名称",
      branch: "分支",
      gitStatus: "Git 状态",
      folder: "文件夹",
      path: "完整路径",
      labels: "标签",
      pullRequest: "关联 PR",
      timer: "计时 / 完成于",
      context: "上下文占用环",
      subtasks: "子任务摘要",
    },
    labelLimit: "标签数量",
    labelLimits: { "1": "1 个", "2": "2 个", "3": "3 个", all: "全部" },
    titleLines: "标题行数",
    titleLinesHint: "仅保存在当前设备。",
    titleLineCounts: { "1": "1 行", "2": "2 行", "3": "3 行", "4": "4 行" },
    phoneTitle: "手机",
    compactCards: "手机上使用精简卡片",
    compactCardsHint: "手机上无论上面选哪种密度，都按精简卡片显示。",
    boardTitle: "看板",
    doneWindow: "已完成默认时间窗口",
    doneWindows: { "24h": "近 24 小时", "7d": "近 7 天", all: "全部" },
    showSubtasks: "显示子任务",
    showSubtasksHint: "关闭时，运行中、待输入和失败的子任务仍会显示在各自的泳道，父任务卡片也在该泳道时除外。仅保存在当前设备。",
    showArchived: "显示已归档泳道",
    showArchivedHint: "仅保存在当前设备。在已完成之后多一条泳道，列出已归档的任务和已归档工作区里的任务，时间窗口与已完成相同。",
    showEmptyGroups: "显示全部",
    showEmptyGroupsHint: "筛选菜单和侧栏列出 Paseo 里所有的 Agent、项目、工作区和标签，没有进行中任务的显示 0。仅保存在当前设备。",
    confirmStop: "停止前二次确认",
    laneWidth: "泳道宽度",
    laneWidthHint: "仅保存在当前设备，用于桌面、网页和平板。手机上每次只显示一条泳道，不受影响。",
    laneWidths: { narrow: "紧凑", default: "默认", wide: "宽松" },
    sidebarTitle: "侧边栏",
    sidebarCount: "侧边栏入口计数",
    sidebarCounts: { all: "待输入 · 运行中 · 待查看", "input-only": "只显示待输入", none: "不显示" },
    resetTitle: "恢复",
    reset: "恢复任务看板默认设置",
    resetHint: "把任务看板的所有选项恢复为默认值；看板的开关保持不变。",
    resetAction: "恢复",
    resetConfirm: "确认恢复",
    resetConfirmHint: "这会用默认值替换全部任务看板选项。",
    resetCancel: "取消",
    resetKeep: "保留当前选项",
    resetInvalidHint: "恢复默认设置会替换无法使用的记录。",
  },
};
