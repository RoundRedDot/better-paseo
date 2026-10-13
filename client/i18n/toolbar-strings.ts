/**
 * The names a preview toolbar shows on hover, the selection bar's labels and
 * the copy toasts, in the language the settings page is set to. The buttons are labelled in English (their accessibility
 * labels, and the copy menu's entries); this translates only what is drawn.
 */
import { resolveLanguage, type SettingsLanguagePreference } from "./settings-strings";

const ZH: Readonly<Record<string, string>> = {
  Copy: "复制",
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
  "Copy log": "复制日志",
  "Copy description": "复制描述",
  "Copy question": "复制问题",
  "Copy answer": "复制回答",
  "Copy thought": "复制思考",
  "Copy section": "复制段落",
  "Copy reply": "复制回复",
  "Copy prompt": "复制提问",
  "Previous operation": "上一次操作",
  "Next operation": "下一次操作",
  "Wrap lines": "自动换行",
  "Do not wrap lines": "不自动换行",
  "Maximize preview": "最大化预览",
  "Close preview": "关闭预览",
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
  if (resolveLanguage(preference, locale) === "zh") {
    const zh = ZH[base];
    return zh?.startsWith("复制") ? `已${zh}` : "已复制";
  }
  const match = /^Copy (.+)$/.exec(base);
  return match ? `Copied ${match[1]}` : "Copied";
}
