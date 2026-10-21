import type { TasksLanguage } from "../i18n";
import type { StatusKind, WorkspaceKind } from "../model";

/** The cards' own words; Chinese follows the prototype. */
const en = {
  openInWorkspace: "Open in workspace",
  openTab: "Open tab",
  stop: "Stop",
  confirmStop: "Confirm stop",
  confirmStopAll: "Stop all",
  stopping: "Stopping…",
  stopOptions: "Stop options",
  stopOnlyThis: "Stop only this task",
  stopWithChildren: "Stop with subtasks",
  parentArchived: "Parent task (archived)",
  parentUnknown: "Parent task",
  revealParent: "Show parent task",
  more: (count: number) => `${count} more`,
  context: "Context",
  contextWindow: "Context window",
  contextUsed: (percent: number) => `${percent}% used`,
  contextTokens: (used: string, max: string) => `${used} / ${max} tokens`,
  sessionCost: (cost: string) => `Session cost ${cost}`,
  starting: "Starting",
  uncommitted: "uncommitted",
  subtasks: (total: number, parts: string) => `${total} ${total === 1 ? "subtask" : "subtasks"}: ${parts}`,
  status: {
    needs_input: "needs input",
    running: "running",
    unread: "to review",
    failed: "failed",
    done: "done",
  } as Record<StatusKind, string>,
  kind: {
    local_checkout: "local checkout",
    worktree: "worktree",
    checkout: "checkout",
    directory: "directory",
  } as Record<WorkspaceKind, string>,
  details: {
    project: "Project",
    workspace: "Workspace",
    branch: "Branch",
    notGit: "Not a git directory",
    folder: "Folder",
    cwd: "Directory",
    pr: "PR",
    labels: "Labels",
    created: "Created",
    mode: "Mode",
    input: "Input tokens",
    cached: "cached",
    output: "Output tokens",
    cost: "Cost",
    context: "Context",
    dirty: "uncommitted changes",
    clean: "no uncommitted changes",
    parent: "Parent",
    updated: "Updated",
    cachedHint: (count: string) => `${count} cached`,
    subtasks: "Subtasks",
    subtasksDone: (done: number, total: number) => `${done} / ${total} done`,
    copyBranch: "Copy branch name",
    copyFolder: "Copy folder name",
    copyPath: "Copy path",
    copyLink: "Copy link",
  },
};

type CardStrings = typeof en;

const zh: CardStrings = {
  openInWorkspace: "在 workspace 中打开",
  openTab: "打开 tab",
  stop: "停止",
  confirmStop: "确认停止",
  confirmStopAll: "确认停止全部",
  stopping: "停止中…",
  stopOptions: "停止选项",
  stopOnlyThis: "仅停止此任务",
  stopWithChildren: "连同子任务一起停止",
  parentArchived: "父任务（已归档）",
  parentUnknown: "父任务",
  revealParent: "定位到父任务",
  more: (count) => `还有 ${count} 条`,
  context: "上下文",
  contextWindow: "上下文窗口",
  contextUsed: (percent) => `已使用 ${percent}%`,
  contextTokens: (used, max) => `${used} / ${max} tokens`,
  sessionCost: (cost) => `会话费用 ${cost}`,
  starting: "启动中",
  uncommitted: "未提交",
  subtasks: (total, parts) => `${total} 个子任务：${parts}`,
  status: {
    needs_input: "待输入",
    running: "运行中",
    unread: "待查看",
    failed: "失败",
    done: "已完成",
  },
  kind: {
    local_checkout: "本地 checkout",
    worktree: "worktree",
    checkout: "checkout",
    directory: "普通目录",
  },
  details: {
    project: "项目",
    workspace: "Workspace",
    branch: "分支",
    notGit: "非 git 目录",
    folder: "文件夹",
    cwd: "工作目录",
    pr: "PR",
    labels: "标签",
    created: "创建时间",
    mode: "模式",
    input: "Input token",
    cached: "缓存",
    output: "Output token",
    cost: "费用",
    context: "上下文",
    dirty: "有未提交改动",
    clean: "无未提交改动",
    parent: "父任务",
    updated: "更新",
    cachedHint: (count) => `缓存 ${count}`,
    subtasks: "子任务",
    subtasksDone: (done, total) => `${done} / ${total} 完成`,
    copyBranch: "复制分支名",
    copyFolder: "复制文件夹名",
    copyPath: "复制路径",
    copyLink: "复制链接",
  },
};

export function cardStrings(language: TasksLanguage): CardStrings {
  return language === "zh" ? zh : en;
}

const STATUS_ORDER: readonly StatusKind[] = ["running", "needs_input", "unread", "failed", "done"];

/** "3 个子任务：2 运行中 · 1 已完成" / "3 subtasks: 2 running · 1 done". */
export function subtaskSummary(children: readonly { status: StatusKind }[], language: TasksLanguage): string {
  const strings = cardStrings(language);
  const counts = new Map<StatusKind, number>();
  for (const child of children) counts.set(child.status, (counts.get(child.status) ?? 0) + 1);
  const parts = STATUS_ORDER.filter((kind) => counts.has(kind))
    .map((kind) => `${counts.get(kind)} ${strings.status[kind]}`)
    .join(" · ");
  return strings.subtasks(children.length, parts);
}
