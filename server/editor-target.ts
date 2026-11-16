import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";
import type { FileOpenApp } from "../shared/preferences-settings";

const editors = {
  cursor: { app: "Cursor", command: "cursor" },
  vscode: { app: "Visual Studio Code", command: "code" },
  zed: { app: "Zed", command: "zed" },
  sublime: { app: "Sublime Text", command: "subl" },
} as const;

/** Resolve on the daemon host, never through a shell. */
export function editorCommand(app: Exclude<FileOpenApp, "system">, platform = process.platform): { command: string; args: string[] } {
  const editor = editors[app];
  if (platform === "darwin") {
    for (const root of ["/Applications", join(homedir(), "Applications")]) {
      const path = join(root, `${editor.app}.app`);
      if (existsSync(path)) return { command: "open", args: ["-a", path] };
    }
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, platform === "win32" ? `${editor.command}.exe` : editor.command);
    try {
      accessSync(candidate, constants.X_OK);
      return { command: candidate, args: [] };
    } catch {
      // Try the next PATH entry.
    }
  }
  throw new Error(`${editor.app} is not installed or its command is not on PATH`);
}
