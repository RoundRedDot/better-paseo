/**
 * Editors the file-open setting can launch. `system` is the platform opener.
 * Product names stay in English; only "System app" is translated in the client.
 * The menu shows `system` plus whichever of these the host can actually launch.
 */
export const FILE_OPEN_EDITOR_IDS = [
  "cursor",
  "vscode",
  "windsurf",
  "trae",
  "kiro",
  "antigravity",
  "qoder",
  "codebuddy",
  "zed",
  "sublime",
  "xcode",
  "idea",
  "webstorm",
  "pycharm",
  "androidstudio",
] as const;

export const FILE_OPEN_APPS = ["system", ...FILE_OPEN_EDITOR_IDS] as const;
export type FileOpenApp = (typeof FILE_OPEN_APPS)[number];
export type FileOpenEditor = (typeof FILE_OPEN_EDITOR_IDS)[number];

export const FILE_OPEN_LABELS: Record<FileOpenEditor, string> = {
  cursor: "Cursor",
  vscode: "VS Code",
  windsurf: "Devin (Windsurf)",
  trae: "Trae",
  kiro: "Kiro",
  antigravity: "Antigravity",
  qoder: "Qoder",
  codebuddy: "CodeBuddy",
  zed: "Zed",
  sublime: "Sublime Text",
  xcode: "Xcode",
  idea: "IntelliJ IDEA",
  webstorm: "WebStorm",
  pycharm: "PyCharm",
  androidstudio: "Android Studio",
};
