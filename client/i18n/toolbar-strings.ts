/**
 * The names a preview toolbar shows on hover, the selection bar's labels and
 * the copy toasts, in the language the settings page is set to. The buttons are labelled in English (their accessibility
 * labels, and the copy menu's entries); this translates only what is drawn.
 */
import { resolveLanguage, type SettingsLanguagePreference } from "./settings-strings";

const ZH: Readonly<Record<string, string>> = {
  Copy: "复制",
  "Copy selected": "复制选中",
  Copied: "已复制",
  "Copied instead": "已复制到剪贴板",
  "Add to chat": "添加到对话",
  Added: "已添加",
  "Couldn't copy": "复制失败",
  "Copy path": "复制路径",
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
  "Copy reply": "复制回复",
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
