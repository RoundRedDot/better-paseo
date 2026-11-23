import { getEnhancerPreferences } from "../preferences";
import { resolveLanguage, type SettingsLanguage } from "./settings-strings";
import { FILE_OPEN_LABELS, type FileOpenApp } from "../../shared/file-open-apps";
import type { FileOpenErrorKind } from "../../shared/file-rpc";

type RevealResult = { error: string | null; errorKind?: FileOpenErrorKind; errorApp?: FileOpenApp; errorCode?: "system_opener_unavailable" };

/**
 * A path press: opens or reveals the path on the host with the current file
 * open setting, and shows any failure in a toast.
 */
export function revealWithSetting(
  revealPath: (input: { cwd: string; path: string; expectedApp: FileOpenApp }) => Promise<RevealResult>,
  toast: { error(message: string): void },
  cwd: string,
  path: string,
): void {
  void revealPath({ cwd, path, expectedApp: getEnhancerPreferences().fileOpenApp })
    .then((result) => { if (result.error) toast.error(fileOpenError(result)); })
    .catch((error: unknown) => toast.error(String(error)));
}

const names: Record<FileOpenApp, string> = { system: "System app", ...FILE_OPEN_LABELS };

/** Server details are retained for diagnosis, including with older servers. */
export function fileOpenError(result: RevealResult, language: SettingsLanguage = resolveLanguage(getEnhancerPreferences().language)): string {
  const detail = result.error ?? "";
  if (result.errorCode === "system_opener_unavailable" || result.errorKind === "system_opener_unavailable") {
    return language === "zh"
      ? `daemon 主机找不到 xdg-open。请安装 xdg-open 并确认它在 daemon 的 PATH 中：${detail}`
      : `The daemon host could not find xdg-open. Install xdg-open and ensure it is in the daemon's PATH: ${detail}`;
  }
  if (language !== "zh" || !result.errorKind) return detail;
  if (result.errorKind === "settings_unavailable") return "文件打开设置不可用";
  if (result.errorKind === "settings_unsynced") return "文件打开设置尚未同步，请稍后重试";
  if (result.errorKind === "launch_unconfirmed") return "无法确认是否打开，目标可能已经打开";
  const app = result.errorApp ? names[result.errorApp] : "";
  if (result.errorKind === "editor_unavailable") return `${app} 未安装或其命令不在 PATH 中`;
  const exit = detail.match(/^Failed to open (?:path|file with \w+) \(exit (\d+)\)(?:: ([\s\S]+))?$/);
  if (exit) return `${result.errorApp === "system" ? "打开失败" : `${app} 打开失败`}（退出码 ${exit[1]}）${exit[2] ? `：${exit[2]}` : ""}`;
  return `${result.errorApp && result.errorApp !== "system" ? `${app} 打开失败` : "打开失败"}：${detail}`;
}
