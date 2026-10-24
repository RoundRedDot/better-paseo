import type { DoneWindow, LaneWidth } from "../../../shared/tasks-settings";
import type { LaneId } from "../model";
import { NAME_KEYS, type BoardSort, type SortDirection, type SortKey } from "./sort";
import type { TasksLanguage } from "../i18n";

/** The board's own words; Chinese follows the prototype. */
const en = {
  /** The board's name: screen title, sidebar row, settings page. */
  name: "Tasks",
  /** The Command Center item. */
  openBoard: "Open Tasks",
  lanes: { needs_input: "Needs input", running: "Running", review: "Review", done: "Done", archived: "Archived" } as Record<LaneId, string>,
  /** The phone's tabs: a quarter of 390 each. */
  tabs: { needs_input: "Input", running: "Running", review: "Review", done: "Done", archived: "Archived" } as Record<LaneId, string>,
  laneEmpty: {
    needs_input: "No agents waiting for you",
    running: "No agents running",
    review: "Nothing to review",
    done: "No finished tasks in this window",
    archived: "No archived tasks in this window",
  } as Record<LaneId, string>,
  laneEmptyHint: {
    needs_input: "Agents that need a permission or an answer show up here.",
    running: "Start an agent in any workspace and it shows up here.",
    review: "Finished or failed tasks wait here until you look.",
    done: "Switch to 7 days or All to see older tasks.",
    archived: "Archived tasks, and those of archived workspaces, show up here. Switch to 7 days or All to see older ones.",
  } as Record<LaneId, string>,
  boardEmpty: "No tasks yet",
  boardEmptyHint: "Start an agent in any workspace and it shows up here by status.",
  windows: { "24h": "24h", "7d": "7 days", all: "All" } as Record<DoneWindow, string>,
  total: (count: number) => `${count} ${count === 1 ? "task" : "tasks"}`,
  /** `total` without its number, for a count that rolls on its own. */
  totalUnit: (count: number): string => (count === 1 ? "task" : "tasks"),
  search: "Search titles",
  searchButton: "Search",
  project: "Project",
  workspace: "Workspace",
  agent: "Agent",
  labels: "Labels",
  /** The applied filter's chip. */
  hideSubtasks: "Hide subtasks",
  /** The board's switch: on shows every subtask. */
  showSubtasks: "Show subtasks",
  showSubtasksHint: "When off, running, waiting and failed subtasks still show, unless their parent's card is in the same lane",
  titleContains: "Title has",
  doneWindowLabel: "Done",
  clear: "Clear",
  clearAll: "Clear all",
  /** Several picks of one filter folded into one chip: "2 projects and 1 workspace selected". */
  selected: (parts: string[]) => `${parts.join(" and ")} selected`,
  selectedUnits: {
    project: (count: number) => `${count} ${count === 1 ? "project" : "projects"}`,
    workspace: (count: number) => `${count} ${count === 1 ? "workspace" : "workspaces"}`,
    label: (count: number) => `${count} ${count === 1 ? "label" : "labels"}`,
    agent: (count: number) => `${count} ${count === 1 ? "agent" : "agents"}`,
  },
  keys: { move: "Move", lane: "Lane", open: "Open", preview: "Preview", search: "Search" },
  collapse: "Collapse lane",
  expand: "Expand lane",
  emptyLanes: { collapse: "Collapse empty lanes", expand: "Expand empty lanes" },
  loadMore: "Load more",
  loading: "Loading",
  shown: (count: number) => `Showing ${count}`,
  filters: "Filters",
  reset: "Reset",
  /** The phone sheet folds the workspaces without an active task under this. */
  show: (count: number) => `Show ${count} ${count === 1 ? "task" : "tasks"}`,
  timeRange: "Range",
  doneRange: "Done time range",
  clearFilters: "Clear filters",
  hiddenByFilters: "Hidden by the current filters",
  /** Under a lane's cards while the filters leave some of its own out; the filters follow on a second line. */
  laneHidden: (count: number) => `${count} hidden by filters`,
  noOptions: "Nothing to filter yet",
  /** The search field atop the project and workspace menus. */
  menuSearch: { placeholder: "Search", clear: "Clear search", empty: "No matches" },
  /** The search field atop the phone sheet's workspaces. */
  sheetSearch: "Search projects and workspaces",
  details: "Details",
  stoppedManually: "Stopped manually",
  closeMenu: "Close menu",
  sort: "Sort",
  sortDefault: "Default order",
  /** The filter bar's lane width menu; the choice is the Tasks setting, so every client of the host follows it. */
  laneWidth: {
    title: "Lane width",
    /** Short heading beside the toolbar's inline width choices. */
    label: "Lane width",
    /** Read out for the filter-bar button, which shows only the width's name. */
    button: (name: string) => `Lanes · ${name}`,
    names: { narrow: "Narrow", default: "Default", wide: "Wide" } as Record<LaneWidth, string>,
    saveFailed: "Couldn't save the lane width",
  },
  archivedLane: {
    /** The round Archive button's hint, in the filter bar beside the done window. */
    hint: "Show the archived lane after Done",
    /** The round Archive button's name, in the filter bar and the phone and narrow board headers. */
    row: "Show the archived lane",
    saveFailed: "Couldn't save the archived lane setting",
    /** A toast when an archived task is asked to open: Paseo would show another tab. */
    cannotOpen: "Unarchive this task to open it in Paseo",
  },
  emptyGroups: {
    /** The round switch's name, in the filter bar and the phone and narrow board headers. */
    row: "Show groups with no active tasks",
    hint: (on: boolean): string => (on ? "Agents, projects, workspaces and labels with no active task are listed" : "Only agents, projects, workspaces and labels with an active task are listed"),
    saveFailed: "Couldn't save the empty groups setting",
  },
  /** The desktop bars' hover tips, shown under a control a pointer rests on. */
  tips: {
    project: "Filter by project",
    workspace: "Filter by workspace",
    agent: "Filter by agent",
    labels: "Filter by label",
    hideSubtasks: "Hide subtasks",
    doneWindow: "How far back Done and Archived reach",
    hideArchived: "Hide the archived lane",
    hideEmptyGroups: "Hide groups with no active tasks",
    sort: "Order the cards in each lane",
  },
  back: "Back",
  sortKeys: {
    workspace: "Workspace",
    project: "Project",
    branch: "Branch",
    folder: "Folder",
    title: "Title",
    created: "Created",
    updated: "Updated",
    context: "Context",
    duration: "Duration",
  } as Record<SortKey, string>,
  sortOrders: {
    name: { asc: "A\u2192Z", desc: "Z\u2192A" },
    time: { asc: "oldest first", desc: "newest first" },
    amount: { asc: "low\u2192high", desc: "high\u2192low" },
    length: { asc: "shortest first", desc: "longest first" },
  } as Record<"name" | "time" | "amount" | "length", Record<SortDirection, string>>,
  sortedAmong: (count: number) => `Sorted among the ${count} loaded`,
  boardOff: "The Tasks board is off",
  boardOffHint: "Turn it on under Tasks board in Better Paseo's settings to see your agents by status here.",
  openSettings: "Open settings",
  answerFailed: (message: string) => `Could not answer: ${message}`,
  sidebar: {
    key: "Sidebar",
    resize: "Adjust sidebar width",
    show: "Show sidebar",
    hide: "Hide sidebar",
    close: "Close",
    sheetGrow: "Expand details",
    sheetShrink: "Collapse details",
    previous: "Previous task",
    next: "Next task",
    back: (title: string) => `Back to ${title}`,
    groups: { agent: "Agent", project: "Project", workspace: "Workspace", label: "Labels" } as Record<"agent" | "project" | "workspace" | "label", string>,
    noGroups: "Nothing to group yet",
    noLabel: "No labels",
    stopRun: "Stop",
    openTab: "Open",
    openToAnswer: "Open to answer",
    archived: "Archived · removed from the board",
    hidden: "Hidden by the current filters",
    deleted: "Task deleted",
    property: { project: "Project", parent: "Parent", branch: "Branch", cwd: "Directory", pr: "PR", labels: "Labels" },
  },
};

const zh: typeof en = {
  name: "任务",
  openBoard: "打开任务",
  lanes: { needs_input: "待输入", running: "运行中", review: "待查看", done: "已完成", archived: "已归档" },
  tabs: { needs_input: "待输入", running: "运行中", review: "待查看", done: "已完成", archived: "已归档" },
  laneEmpty: {
    needs_input: "没有等待你处理的 agent",
    running: "当前没有运行中的 agent",
    review: "没有未查看的结果",
    done: "这个时间范围内没有已完成的任务",
    archived: "这个时间范围内没有已归档的任务",
  },
  laneEmptyHint: {
    needs_input: "运行中的 agent 需要权限或回答时会出现在这里。",
    running: "在任一工作区启动 agent 后会出现在这里。",
    review: "跑完或失败的任务会先到这里等你查看。",
    done: "可以切换到「7 天」或「全部」查看更早的任务。",
    archived: "已归档的任务和已归档工作区里的任务会出现在这里。切换到「7 天」或「全部」可以看更早的。",
  },
  boardEmpty: "还没有任务",
  boardEmptyHint: "在任一工作区启动 agent 后，它会按状态出现在这里。",
  windows: { "24h": "24 小时", "7d": "7 天", all: "全部" },
  total: (count) => `${count} 个任务`,
  totalUnit: () => "个任务",
  search: "按标题搜索",
  searchButton: "搜索",
  project: "项目",
  workspace: "工作区",
  agent: "Agent",
  labels: "标签",
  hideSubtasks: "隐藏子任务",
  showSubtasks: "显示子任务",
  showSubtasksHint: "关闭时，运行中、待输入和失败的子任务仍会显示，父任务在同一泳道时除外",
  titleContains: "标题包含",
  doneWindowLabel: "已完成",
  clear: "清除",
  clearAll: "清除全部",
  selected: (parts) => `已选择 ${parts.join("和 ")}`,
  selectedUnits: {
    project: (count) => `${count} 个项目`,
    workspace: (count) => `${count} 个工作区`,
    label: (count) => `${count} 个标签`,
    agent: (count) => `${count} 个 Agent`,
  },
  keys: { move: "移动", lane: "换列", open: "打开", preview: "预览", search: "搜索" },
  collapse: "折叠此列",
  expand: "展开此列",
  emptyLanes: { collapse: "折叠数量为 0 的泳道", expand: "展开数量为 0 的泳道" },
  loadMore: "加载更多",
  loading: "加载中",
  shown: (count) => `已显示 ${count}`,
  filters: "筛选",
  reset: "重置",
  show: (count) => `显示 ${count} 个任务`,
  timeRange: "范围",
  doneRange: "已完成时间范围",
  clearFilters: "清除筛选",
  hiddenByFilters: "该任务被当前筛选隐藏",
  laneHidden: (count) => `${count} 个任务被筛选隐藏`,
  noOptions: "暂无可筛选的项",
  menuSearch: { placeholder: "搜索", clear: "清空搜索", empty: "没有匹配项" },
  sheetSearch: "搜索项目或工作区",
  details: "详情",
  stoppedManually: "已手动停止",
  closeMenu: "关闭菜单",
  sort: "排序",
  sortDefault: "默认顺序",
  laneWidth: {
    title: "泳道宽度",
    label: "列宽",
    button: (name: string) => `泳道 · ${name}`,
    names: { narrow: "紧凑", default: "默认", wide: "宽松" } as Record<LaneWidth, string>,
    saveFailed: "泳道宽度没有保存成功",
  },
  archivedLane: {
    hint: "在已完成之后显示已归档泳道",
    row: "显示已归档泳道",
    saveFailed: "已归档泳道的设置没有保存成功",
    cannotOpen: "已归档的任务需要先取消归档，才能在 Paseo 中打开",
  },
  emptyGroups: {
    row: "显示数量为 0 的分组",
    hint: (on) => (on ? "没有进行中任务的 Agent、项目、工作区和标签也会列出" : "只列出有进行中任务的 Agent、项目、工作区和标签"),
    saveFailed: "数量为 0 的分组设置没有保存成功",
  },
  tips: {
    project: "按项目筛选",
    workspace: "按工作区筛选",
    agent: "按 Agent 筛选",
    labels: "按标签筛选",
    hideSubtasks: "隐藏子任务",
    doneWindow: "已完成和已归档泳道显示多久以内的任务",
    hideArchived: "隐藏已归档泳道",
    hideEmptyGroups: "隐藏数量为 0 的分组",
    sort: "每列卡片的排列顺序",
  },
  back: "返回",
  sortKeys: {
    workspace: "工作区",
    project: "项目",
    branch: "分支",
    folder: "文件夹",
    title: "标题",
    created: "创建时间",
    updated: "更新时间",
    context: "上下文占用",
    duration: "耗时",
  },
  sortOrders: {
    name: { asc: "A\u2192Z", desc: "Z\u2192A" },
    time: { asc: "最早在前", desc: "最新在前" },
    amount: { asc: "低\u2192高", desc: "高\u2192低" },
    length: { asc: "短\u2192长", desc: "长\u2192短" },
  },
  sortedAmong: (count) => `仅对已加载的 ${count} 条排序`,
  boardOff: "任务看板未启用",
  boardOffHint: "在 Better Paseo 设置的「任务看板」中开启后，这里会按状态显示你的 agent。",
  openSettings: "打开设置",
  answerFailed: (message) => `回答失败：${message}`,
  sidebar: {
    key: "侧边栏",
    resize: "调整侧边栏宽度",
    show: "显示侧边栏",
    hide: "隐藏侧边栏",
    close: "关闭",
    sheetGrow: "展开详情",
    sheetShrink: "收起详情",
    previous: "上一个任务",
    next: "下一个任务",
    back: (title) => `返回 ${title}`,
    groups: { agent: "Agent", project: "项目", workspace: "工作区", label: "标签" },
    noGroups: "暂无可分组的项",
    noLabel: "无标签",
    stopRun: "停止",
    openTab: "打开",
    openToAnswer: "打开处理",
    archived: "已归档 · 已从看板移除",
    hidden: "当前筛选已隐藏这张卡",
    deleted: "任务已删除",
    property: { project: "项目", parent: "父任务", branch: "分支", cwd: "工作目录", pr: "PR", labels: "标签" },
  },
};

export type BoardStrings = typeof en;

export const BOARD_STRINGS: Readonly<Record<TasksLanguage, BoardStrings>> = { en, zh };

/** The icon of a phone lane's empty state (prototype 04). */
export const LANE_EMPTY_ICON: Readonly<Record<LaneId, string>> = {
  needs_input: "CircleCheck",
  running: "CircleDashed",
  review: "Inbox",
  done: "Archive",
  archived: "Archive",
};

/** Which wording a key's two directions take. */
export function sortOrderKind(key: SortKey): "name" | "time" | "amount" | "length" {
  if (NAME_KEYS.has(key)) return "name";
  if (key === "created" || key === "updated") return "time";
  return key === "context" ? "amount" : "length";
}

/** A direction on its own, as a submenu row reads it: "A\u2192Z", "Newest first", "\u9ad8\u2192\u4f4e". */
export function sortOrderLabel(sort: BoardSort, strings: BoardStrings): string {
  const order = strings.sortOrders[sortOrderKind(sort.key)][sort.direction];
  return order.charAt(0).toUpperCase() + order.slice(1);
}

/** A sort as the pill reads it: "Branch A\u2192Z", "Updated newest first"; the default order when none. */
export function sortLabel(sort: BoardSort | null, strings: BoardStrings): string {
  if (!sort) return strings.sortDefault;
  return `${strings.sortKeys[sort.key]} ${strings.sortOrders[sortOrderKind(sort.key)][sort.direction]}`;
}
