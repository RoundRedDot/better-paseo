/**
 * The names a preview toolbar shows on hover, in the language the settings
 * page is set to. The buttons are labelled in English (their accessibility
 * labels, and the copy menu's entries); this translates only what is drawn.
 */
import { resolveLanguage, type SettingsLanguagePreference } from "./settings-strings";

const ZH: Readonly<Record<string, string>> = {
  Copy: "复制",
  Copied: "已复制",
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
  "Copy log": "复制日志",
  "Copy description": "复制描述",
  "Copy question": "复制问题",
  "Copy answer": "复制回答",
  "Copy thought": "复制思考",
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
