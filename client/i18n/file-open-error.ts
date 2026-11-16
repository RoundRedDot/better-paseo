import { getEnhancerPreferences } from "../preferences";
import { resolveLanguage, type SettingsLanguage } from "./settings-strings";
import type { FileOpenApp } from "../../shared/preferences-settings";

const names: Record<FileOpenApp, string> = { system: "System app", cursor: "Cursor", vscode: "VS Code", zed: "Zed", sublime: "Sublime Text" };

/** Server details are retained for diagnosis, including with older servers. */
export function fileOpenError(result: { error: string | null; errorKind?: "settings_unavailable" | "editor_unavailable" | "launch_failed" | "launch_unconfirmed"; errorApp?: FileOpenApp }, language: SettingsLanguage = resolveLanguage(getEnhancerPreferences().language)): string {
  const detail = result.error ?? "";
  if (language !== "zh" || !result.errorKind) return detail;
  if (result.errorKind === "settings_unavailable") return "文件打开设置不可用";
  if (result.errorKind === "launch_unconfirmed") return "无法确认是否打开，目标可能已经打开";
  const app = result.errorApp ? names[result.errorApp] : "";
  if (result.errorKind === "editor_unavailable") return `${app} 未安装或其命令不在 PATH 中`;
  const exit = detail.match(/^Failed to open (?:path|file with \w+) \(exit (\d+)\)(?:: ([\s\S]+))?$/);
  if (exit) return `${result.errorApp === "system" ? "打开失败" : `${app} 打开失败`}（退出码 ${exit[1]}）${exit[2] ? `：${exit[2]}` : ""}`;
  return detail;
}
