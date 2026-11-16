import { accessSync, constants, existsSync, realpathSync, openSync, readSync, closeSync } from "node:fs";
import { delimiter, join, win32, basename } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
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
export async function editorCommand(app: Exclude<FileOpenApp, "system">, platform = process.platform): Promise<EditorCommand> {
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
        const root = app === "vscode" ? win32.join(dir, "..") : win32.join(dir, "..", "..", "..");
        if (win32.basename(dir).toLowerCase() === "bin" && existsSync(win32.join(dir, `${editor.command}.cmd`)) &&
          existsSync(win32.join(root, "resources", "app", "product.json"))) {
          paths.push(win32.join(root, app === "vscode" ? "Code.exe" : "Cursor.exe"));
        }
      }
      for (const root of [process.env.LOCALAPPDATA && win32.join(process.env.LOCALAPPDATA, "Programs"), process.env.ProgramFiles]) {
        if (root) paths.push(win32.join(root, app === "vscode" ? "Microsoft VS Code" : "Cursor", app === "vscode" ? "Code.exe" : "Cursor.exe"));
      }
    } else if (app === "zed") {
      for (const root of [process.env.LOCALAPPDATA && win32.join(process.env.LOCALAPPDATA, "Programs"), process.env.ProgramFiles]) {
        if (root) paths.push(win32.join(root, "Zed", "bin", "zed.exe"));
      }
      for (const dir of dirs) {
        paths.push(win32.join(dir, "bin", "zed.exe"));
        if (win32.basename(dir).toLowerCase() === "bin") paths.push(win32.join(dir, "zed.exe"));
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
      if (existsSync(path)) return { command: path, args: [], completion: app === "sublime" || app === "zed" ? "exit" : "spawn" };
    }
    throw new Error(`${editor.app} is not installed or its command is not on PATH`);
  }
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const candidates = app === "zed" && platform === "linux"
    ? [...dirs.map((dir) => join(dir, "zeditor")), join(homedir(), ".local/zed.app/bin/zed"), ...dirs.map((dir) => join(dir, "zed"))]
    : dirs.map((dir) => join(dir, editor.command));
  const zfs = app === "zed" && platform === "linux" && existsSync("/usr/sbin/zed") ? realpathSync("/usr/sbin/zed") : null;
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
    } catch {
      continue;
    }
    const actualPath = realpathSync(candidate);
    if (zfs && actualPath === zfs) {
      // On merged-/usr systems /usr/bin/zed and /usr/sbin/zed may be the
      // same file, whether it is the editor or the ZFS daemon.
      try {
        const stdout = await new Promise<string>((resolve, reject) => {
          execFile(candidate, ["--version"], { encoding: "utf8", timeout: 2000 }, (error, output) => error ? reject(error) : resolve(output));
        });
        if (!/^Zed\s/i.test(stdout)) continue;
      } catch {
        continue;
      }
    }
    const actualName = basename(actualPath);
    const gui = (app === "vscode" && platform === "linux" && existsSync(join(actualPath, "..", "resources", "app", "product.json"))) ||
      (app === "sublime" && actualName === "sublime_text") ||
      (app === "cursor" && isAppImage(actualPath));
    return { command: candidate, args: [], completion: gui ? "spawn" : "exit" };
  }
  throw new Error(`${editor.app} is not installed or its command is not on PATH`);
}

/** AppImage type 2 is identified at offset 8, regardless of its filename. */
function isAppImage(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const header = Buffer.alloc(11);
    const size = readSync(fd, header, 0, header.length, 0);
    return size === header.length && header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) &&
      header.subarray(8, 11).equals(Buffer.from([0x41, 0x49, 0x02]));
  } finally {
    closeSync(fd);
  }
}
