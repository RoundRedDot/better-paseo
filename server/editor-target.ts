import { accessSync, constants, existsSync, realpathSync } from "node:fs";
import { delimiter, join, win32, basename } from "node:path";
import { homedir } from "node:os";
import type { FileOpenApp } from "../shared/preferences-settings";

const editors = {
  cursor: { app: "Cursor", command: "cursor" },
  vscode: { app: "Visual Studio Code", command: "code" },
  zed: { app: "Zed", command: "zed" },
  sublime: { app: "Sublime Text", command: "subl" },
} as const;

export interface EditorCommand {
  command: string;
  args: string[];
  completion: "spawn" | "exit";
}

/** Resolve on the daemon host, never through a shell. */
export function editorCommand(app: Exclude<FileOpenApp, "system">, platform = process.platform): EditorCommand {
  const editor = editors[app];
  if (platform === "darwin") {
    for (const root of ["/Applications", join(homedir(), "Applications")]) {
      const path = join(root, `${editor.app}.app`);
      if (existsSync(path)) return { command: "open", args: ["-a", path], completion: "exit" };
    }
  }
  if (platform === "win32") {
    const dirs = (process.env.PATH ?? "").split(win32.delimiter).filter(Boolean);
    const paths: string[] = [];
    if (app === "vscode" || app === "cursor") {
      for (const dir of dirs) {
        paths.push(win32.join(dir, `${editor.command}.exe`));
        paths.push(app === "vscode" ? win32.join(dir, "..", "Code.exe") : win32.join(dir, "..", "..", "..", "Cursor.exe"));
      }
      for (const root of [process.env.LOCALAPPDATA && win32.join(process.env.LOCALAPPDATA, "Programs"), process.env.ProgramFiles]) {
        if (root) paths.push(win32.join(root, app === "vscode" ? "Microsoft VS Code" : "Cursor", app === "vscode" ? "Code.exe" : "Cursor.exe"));
      }
    } else {
      for (const dir of dirs) paths.push(win32.join(dir, `${editor.command}.exe`));
      if (app === "sublime") {
        for (const root of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA && win32.join(process.env.LOCALAPPDATA, "Programs")]) {
          if (root) paths.push(win32.join(root, "Sublime Text", "subl.exe"));
        }
      }
    }
    for (const path of paths) {
      if (existsSync(path)) return { command: path, args: [], completion: app === "sublime" ? "exit" : "spawn" };
    }
    throw new Error(`${editor.app} is not installed or its command is not on PATH`);
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, editor.command);
    try {
      accessSync(candidate, constants.X_OK);
    } catch {
      continue;
    }
    const actualName = basename(realpathSync(candidate));
    const gui = (app === "sublime" && actualName === "sublime_text") ||
      (app === "cursor" && /\.appimage$/i.test(actualName));
    return { command: candidate, args: [], completion: gui ? "spawn" : "exit" };
  }
  throw new Error(`${editor.app} is not installed or its command is not on PATH`);
}
