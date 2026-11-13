/**
 * The names a preview toolbar shows on hover, the selection bar's labels and
 * the copy toasts, in the language the settings page is set to. The buttons are labelled in English (their accessibility
 * labels, and the copy menu's entries); this translates only what is drawn.
 */
import { resolveLanguage, type SettingsLanguagePreference } from "./settings-strings";

const ZH: Readonly<Record<string, string>> = {
  "Compacting context": "正在压缩上下文",
  "Compacted context": "已压缩上下文",
  manual: "手动",
  "Task finished": "任务已完成", "Task failed": "任务失败", "Task stopped": "任务已停止",
  "Command finished": "命令已完成", "Command failed": "命令失败", "Command stopped": "命令已停止",
  "Subtask finished": "子任务已完成", "Subtask stopped": "子任务已停止",
  "Load tools": "加载工具", "Search tools": "搜索工具", Skill: "技能",
  "Sending message": "正在发送消息", "Sent message": "已发送消息", "Wake up": "唤醒",
  Schedule: "计划", "List sessions": "列出会话", "Stop task": "停止任务",
  "Terminal input": "终端输入", Terminal: "终端", "Computer use": "操作电脑",
  Plan: "计划", "Wait for tasks": "等待任务", "Subtask output": "子任务输出", "Task output": "任务输出",
  Monitor: "监控", List: "列出", "Started subtask": "已启动子任务", "Run code": "运行代码", File: "文件",
  "Needs answer": "需要回答", "Needs permission": "需要授权", Respond: "回复", Responding: "回复中", Responded: "已回复",
  Allowed: "已允许", Denied: "已拒绝", Message: "消息", Finished: "已完成", Errored: "出错", Closed: "已关闭", Canceled: "已取消",
  "Checking status": "正在检查状态", Status: "状态", "Reading activity": "正在读取活动", Activity: "活动",
  "Listing agents": "正在列出 Agent", "Listed agents": "已列出 Agent", "List agents": "列出 Agent",
  "Checking permissions": "正在检查权限", "Pending permissions": "待处理权限",
  "Canceling turn": "正在取消轮次", "Canceled turn": "已取消轮次", "Cancel turn": "取消轮次",
  "Closing agent": "正在关闭 Agent", "Closed agent": "已关闭 Agent", "Close agent": "关闭 Agent",
  Archiving: "正在归档", Archived: "已归档", Archive: "归档", Updating: "正在更新", Updated: "已更新", Update: "更新",
  "Setting mode": "正在设置模式", "Set mode": "已设置模式",
  "Running subtask": "正在执行子任务", "Subtask failed": "子任务失败", Subtask: "子任务",
  Creating: "正在创建", Created: "已创建", "Create failed": "创建失败", "Create canceled": "创建已取消",
  "Sending prompt": "正在发送提示", "Sent prompt": "已发送提示", "Prompt failed": "提示发送失败", "Prompt canceled": "提示发送已取消",
  "Listing providers": "正在列出提供商", Providers: "提供商", "Listing models": "正在列出模型", Models: "模型",
  "Listing profiles": "正在列出配置", Profiles: "配置", "Inspecting provider": "正在查看提供商", Provider: "提供商",
  Copy: "复制",
  "Copy selected": "复制选中",
  Copied: "已复制",
  "Copied instead": "已复制到剪贴板",
  "Add to chat": "添加到对话",
  Added: "已添加",
  "Couldn't copy": "复制失败",
  "Copy path": "复制路径",
  "Copy branch name": "复制分支名",
  "Copy label name": "复制标签名称",
  "Copy folder name": "复制文件夹名",
  "Copy URL": "复制 URL",
  "Copy command": "复制命令",
  "Copy output": "复制输出",
  "Copy command and output": "复制命令和输出",
  "Copy file content": "复制文件内容",
  "Copy patch": "复制补丁",
  "Copy new content": "复制新内容",
  "Copy query": "复制查询",
  "Copy file list": "复制文件列表",
  "Copy result": "复制结果",
  "Copy arguments": "复制参数",
  "Copy code": "复制代码",
  "Copy Markdown table": "复制 Markdown 表格",
  "Copy as Markdown": "复制为 Markdown",
  "Copy as image": "复制为图片",
  "Copy log": "复制日志",
  "Copy description": "复制描述",
  "Copy thought": "复制思考",
  "Copy section": "复制段落",
  "Copy quote": "复制引用",
  "Copy reply": "复制回复",
  "Copy title": "复制标题",
  "Copy session ID": "复制会话 ID",
  "Copy workspace name": "复制工作区名称",
  "Copy project name": "复制项目名称",
  "Open details": "打开详情",
  "Expand in timeline": "在时间线中展开",
  "Collapse in timeline": "在时间线中收起",
  "View image": "查看图片",
  "Zoom in": "放大",
  "Zoom out": "缩小",
  "Reset zoom": "复原缩放",
  "Open in default app": "用默认应用打开",
  "Close the image": "关闭图片",
  "Close menu": "关闭菜单",
  Code: "代码",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  Thinking: "思考中",
  Thought: "思考",
  Completed: "已完成",
  "Previous block": "上一个区块",
  "Next block": "下一个区块",
  "Close details": "关闭详情",
  "Full screen": "全屏",
  "Exit full screen": "退出全屏",
  "Widen panel": "加宽面板",
  "Restore panel width": "恢复面板宽度",
  "Expand details": "展开详情",
  "Shrink details": "收起详情",
  "Resize details panel": "调整详情面板宽度",
  "{count} new lines": "{count} 行新输出",
  "Open in panel": "在面板中打开",
  More: "更多",
  "Back to latest": "回到最新",
  "Text size": "字号",
  "Decrease text size": "减小字号",
  "Increase text size": "增大字号",
  Reset: "复原",
  Streaming: "输出中",
  "Copy model name": "复制模型名称",
  "Agent": "Agent",
  "Model name": "模型名称",
  "Turn details": "轮次详情",
  "Start time": "开始时间",
  "End time": "结束时间",
  "Copy agent": "复制 Agent",
  "Copy thinking level": "复制思考等级",
  "Copy start time": "复制开始时间",
  "Copy end time": "复制结束时间",
  "Thinking level": "思考强度",
  "Elapsed time": "耗时",
  "Input": "输入",
  "Cached": "缓存",
  "Output": "输出",
  "Not recorded": "未记录",
  "Copy prompt": "复制提问",
  "Previous operation": "上一次操作",
  "Next operation": "下一次操作",
  "Previous question": "上一题",
  "Next question": "下一题",
  "Show raw data": "显示原始数据",
  "Show questions": "显示问答",
  "Select one": "单选",
  "Free text": "自由回答",
  Dismissed: "已取消回答",
  "Select multiple": "多选",
  Answer: "回答",
  Response: "返回内容",
  "Waiting for answer…": "等待回答…",
  "No answer recorded": "未记录回答",
  "Wrap lines": "自动换行",
  "Do not wrap lines": "不自动换行",
  "Maximize preview": "最大化预览",
  "Close preview": "关闭预览",
  "Open tasks in a window": "在窗口中打开任务",
  "Open Markdown in a window": "在窗口中打开 Markdown",
  "Render Markdown": "渲染 Markdown",
  "Show raw text": "显示原始文本",
};

/** A button's English label as the reader's chosen language shows it; an unknown label stays English. */
export function toolbarLabel(label: string, preference: SettingsLanguagePreference, locale?: string | null): string {
  if (resolveLanguage(preference, locale) !== "zh") return label;
  const latestCount = /^Back to latest\s*[\u00B7,]\s*(\d+) new lines?$/.exec(label);
  if (latestCount) return `回到最新 · ${latestCount[1]} 行新输出`;
  // "1 new line", "5 new lines"; the pill's template is "{count} new lines" (`backToLatestText`).
  const newLines = /^(\d+) new lines?$/.exec(label);
  if (newLines) return `${newLines[1]} 行新输出`;
  // A thought's sections: "1 step", "4 steps".
  const steps = /^(\d+) steps?$/.exec(label);
  if (steps) return `${steps[1]} 步`;
  const tokens = /^from (\d+(?:\.\d+)?[KM]?) tokens$/.exec(label);
  if (tokens) return `压缩前 ${tokens[1]} tokens`;
  const wakeup = /^Wake up in (\d+(?:s|m|h)(?: \d+m)?)$/.exec(label);
  if (wakeup) return `${wakeup[1]} 后唤醒`;
  return ZH[label] ?? label;
}

/**
 * The toast for a copy, from its button's label: "Copy path" says "Copied
 * path" (已复制路径). A menu entry's "2. " prefix is dropped; a label that
 * names nothing says "Copied".
 */
export function copiedToast(label: string, preference: SettingsLanguagePreference, locale?: string | null): string {
  const base = label.replace(/^\d+\.\s*/, "");
  if (base.startsWith("Copy model name: ")) {
    const name = base.slice("Copy model name: ".length);
    return resolveLanguage(preference, locale) === "zh" ? `已复制模型名称：${name}` : `Copied model name: ${name}`;
  }
  if (resolveLanguage(preference, locale) === "zh") {
    const zh = ZH[base];
    return zh?.startsWith("复制") ? `已${zh}` : "已复制";
  }
  const match = /^Copy (.+)$/.exec(base);
  return match ? `Copied ${match[1]}` : "Copied";
}
