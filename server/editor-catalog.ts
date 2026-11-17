import type { FileOpenEditor } from "../shared/file-open-apps";

export type EditorId = FileOpenEditor;

/**
 * How to find and start one editor. macOS prefers a `.app` in /Applications
 * or ~/Applications. Windows checks the install folders, then PATH. Other
 * platforms use the command names, in order.
 *
 * `agy` is the Antigravity agent CLI, not the IDE, so it is not a command here.
 */
export interface EditorLaunch {
  apps: readonly string[];
  commands: readonly string[];
  /** `cursor` and `sublime` keep the launch rules their tests already lock. */
  kind: "cursor" | "electron" | "zed" | "sublime" | "cli";
  /** A PATH command counts on macOS even when it does not live inside a `.app`. */
  trustPath?: boolean;
  windowsExes: readonly string[];
  windowsShims: readonly string[];
  windowsFolders: readonly (readonly string[])[];
}

function launch(apps: readonly string[], commands: readonly string[], extra?: Partial<EditorLaunch>): EditorLaunch {
  return {
    apps,
    commands,
    kind: "cli",
    windowsExes: [],
    windowsShims: [],
    windowsFolders: [],
    ...extra,
  };
}

function electron(apps: readonly string[], command: string, exe: string, folders: readonly (readonly string[])[], extra?: Partial<EditorLaunch>): EditorLaunch {
  return launch(apps, [command], {
    kind: "electron",
    windowsExes: [exe],
    windowsShims: [`${command}.cmd`, `${command}.exe`],
    windowsFolders: folders,
    ...extra,
  });
}

function jetbrains(apps: readonly string[], command: string, folders: readonly (readonly string[])[]): EditorLaunch {
  return launch(apps, [command, `${command}.sh`], {
    windowsExes: [`${command}64.exe`, `${command}.exe`],
    windowsShims: [`${command}.cmd`, `${command}.bat`],
    windowsFolders: folders,
  });
}

export const EDITOR_LAUNCH: Record<EditorId, EditorLaunch> = {
  cursor: launch(["Cursor"], ["cursor"], { kind: "cursor" }),
  vscode: electron(["Visual Studio Code"], "code", "Code.exe", [["Microsoft VS Code"]]),
  // Windsurf now ships as Devin Desktop; an older Windsurf install still counts.
  windsurf: electron(["Devin", "Windsurf"], "devin", "Devin.exe", [["Devin"], ["Windsurf"]], {
    commands: ["devin", "windsurf"],
    windowsExes: ["Devin.exe", "Windsurf.exe"],
    windowsShims: ["devin.cmd", "devin.exe", "windsurf.cmd", "windsurf.exe"],
  }),
  trae: electron(["Trae", "Trae CN"], "trae", "Trae.exe", [["Trae"], ["Trae CN"]], {
    windowsExes: ["Trae.exe", "Trae CN.exe"],
  }),
  kiro: electron(["Kiro"], "kiro", "Kiro.exe", [["Kiro"]]),
  antigravity: electron(["Antigravity IDE", "Antigravity"], "antigravity", "Antigravity.exe", [["Antigravity"], ["Antigravity IDE"]], {
    windowsExes: ["Antigravity.exe", "Antigravity IDE.exe"],
  }),
  qoder: electron(
    ["Qoder IDE", "Qoder CN IDE", "Qoder", "Qoder CN"],
    "qoder",
    "Qoder.exe",
    [["Qoder"], ["Qoder CN"], ["Qoder IDE"], ["Qoder CN IDE"]],
    { windowsExes: ["Qoder.exe", "Qoder CN.exe", "Qoder IDE.exe", "Qoder CN IDE.exe"] },
  ),
  codebuddy: electron(
    ["CodeBuddy", "CodeBuddy CN"],
    "codebuddy",
    "CodeBuddy.exe",
    [["CodeBuddy"], ["CodeBuddy CN"]],
    { windowsExes: ["CodeBuddy.exe", "CodeBuddy CN.exe"] },
  ),
  zed: launch(["Zed"], ["zed"], { kind: "zed" }),
  sublime: launch(["Sublime Text"], ["subl"], { kind: "sublime" }),
  xcode: launch(["Xcode"], ["xed"], { trustPath: true }),
  idea: jetbrains(
    ["IntelliJ IDEA", "IntelliJ IDEA Ultimate", "IntelliJ IDEA CE", "IntelliJ IDEA Community Edition"],
    "idea",
    [["IntelliJ IDEA"], ["IntelliJ IDEA Ultimate"], ["IntelliJ IDEA Community Edition"]],
  ),
  webstorm: jetbrains(["WebStorm"], "webstorm", [["WebStorm"]]),
  pycharm: jetbrains(
    ["PyCharm", "PyCharm CE", "PyCharm Professional", "PyCharm Community Edition"],
    "pycharm",
    [["PyCharm"], ["PyCharm Professional"], ["PyCharm Community Edition"]],
  ),
  androidstudio: launch(["Android Studio"], ["studio", "android-studio"], {
    windowsExes: ["studio64.exe", "studio.exe"],
    windowsShims: ["studio.cmd", "studio.bat"],
    windowsFolders: [["Android Studio"]],
  }),
};
