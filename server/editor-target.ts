import { accessSync, closeSync, constants, existsSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, delimiter, dirname, join, win32 } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import type { FileOpenApp } from "../shared/preferences-settings";

export type Editor = Exclude<FileOpenApp, "system">;

/** `spawn`: the editor itself, which keeps running. `exit`: a launcher whose exit code reports the outcome. */
type Completion = "spawn" | "exit";
type Candidate = { path: string; completion: Completion };

export type EditorCommand = { command: string; args: string[]; completion: Completion };

export class EditorUnavailableError extends Error {}

const editors = {
  cursor: { app: "Cursor", command: "cursor" },
  vscode: { app: "Visual Studio Code", command: "code" },
  zed: { app: "Zed", command: "zed" },
  sublime: { app: "Sublime Text", command: "subl" },
} as const;

/**
 * Resolve on the daemon host, never through a shell. Each platform lists its
 * candidates in preference order and the first usable one wins.
 */
export async function editorCommand(app: Editor, platform = process.platform): Promise<EditorCommand> {
  const { app: name } = editors[app];
  if (platform === "darwin") {
    const bundle = ["/Applications", join(homedir(), "Applications")].map((root) => join(root, `${name}.app`)).find((path) => existsSync(path));
    if (bundle) return { command: "open", args: ["-a", bundle], completion: "exit" };
  }
  const found = platform === "win32" ? windowsCandidates(app).find((candidate) => existsSync(candidate.path)) : await firstExecutable(app, platform);
  if (!found) throw new EditorUnavailableError(`${name} is not installed or its command is not on PATH`);
  return { command: found.path, args: [], completion: found.completion };
}

const pathDirs = (separator: string) => (process.env.PATH ?? "").split(separator).filter(Boolean);
const defined = (values: (string | undefined)[]) => values.filter((value): value is string => !!value);

function windowsCandidates(app: Editor): Candidate[] {
  const at = win32.join;
  const dirs = pathDirs(win32.delimiter);
  const programs = process.env.LOCALAPPDATA && at(process.env.LOCALAPPDATA, "Programs");
  const gui = (path: string): Candidate => ({ path, completion: "spawn" });
  const launcher = (path: string): Candidate => ({ path, completion: "exit" });
  const isBin = (dir: string) => win32.basename(dir).toLowerCase() === "bin";
  if (app === "zed") {
    // The CLI first; Zed.exe alone when the CLI is absent.
    const installs = defined([programs, process.env.ProgramFiles]).map((root) => at(root, "Zed"));
    return [
      ...installs.map((root) => launcher(at(root, "bin", "zed.exe"))),
      ...dirs.flatMap((dir) => [launcher(at(dir, "bin", "zed.exe")), ...(isBin(dir) ? [launcher(at(dir, "zed.exe"))] : [])]),
      ...installs.map((root) => gui(at(root, "Zed.exe"))),
      ...dirs.filter((dir) => !isBin(dir)).map((dir) => gui(at(dir, "Zed.exe"))),
    ];
  }
  if (app === "sublime") {
    const installs = defined([process.env.ProgramFiles, process.env["ProgramFiles(x86)"], programs]);
    return [...dirs.map((dir) => launcher(at(dir, "subl.exe"))), ...installs.map((root) => launcher(at(root, "Sublime Text", "subl.exe")))];
  }
  // VS Code and Cursor: the GUI first, then a command shim, which exits.
  const { command } = editors[app];
  const exe = app === "vscode" ? "Code.exe" : "Cursor.exe";
  const hasGui = (root: string) => existsSync(at(root, "resources", "app", "product.json"));
  return [
    ...dirs.flatMap((dir) => {
      // The installer's `bin\<command>.cmd` sits below the GUI: VS Code's one level up, Cursor's under `resources\app\bin`.
      const root = app === "vscode" ? at(dir, "..") : at(dir, "..", "..", "..");
      const viaShim = isBin(dir) && existsSync(at(dir, `${command}.cmd`)) && hasGui(root);
      return [...(hasGui(dir) ? [gui(at(dir, `${command}.exe`))] : []), ...(viaShim ? [gui(at(root, exe))] : [])];
    }),
    ...defined([programs, process.env.ProgramFiles]).map((root) => gui(at(root, app === "vscode" ? "Microsoft VS Code" : "Cursor", exe))),
    ...dirs.filter((dir) => !hasGui(dir)).map((dir) => launcher(at(dir, `${command}.exe`))),
  ];
}

/**
 * The first executable file on PATH. A candidate that cannot be read is
 * remembered and the search continues; if nothing else qualifies, that error
 * is thrown instead of reporting the editor as missing.
 */
async function firstExecutable(app: Editor, platform: NodeJS.Platform): Promise<Candidate | undefined> {
  const onPath = (command: string) => pathDirs(delimiter).map((dir) => join(dir, command));
  const linuxZed = app === "zed" && platform === "linux";
  // Distributions package the Zed CLI under several names; plain `zed` may be the ZFS event daemon.
  const candidates = linuxZed
    ? [...onPath("zeditor"), join(homedir(), ".local/zed.app/bin/zed"), ...onPath("zed"), ...onPath("zedit"), ...onPath("zed-cli")]
    : onPath(editors[app].command);
  let zfs: string | undefined;
  let zfsError: unknown;
  if (linuxZed && existsSync("/usr/sbin/zed")) {
    try { zfs = realpathSync("/usr/sbin/zed"); } catch (error) { zfsError = error; }
  }
  let firstError: unknown;
  let foundFile = false;
  for (const path of candidates) {
    try { accessSync(path, constants.X_OK); } catch { continue; }
    try {
      if (!statSync(path).isFile()) continue;
      foundFile = true;
      const actual = realpathSync(path);
      // On merged-/usr systems /usr/bin/zed and /usr/sbin/zed may be the same
      // file, whether it is the editor or the daemon. Unsure, ask it.
      if ((actual === zfs || zfsError !== undefined) && !(await reportsZed(path))) continue;
      return { path, completion: isGui(app, platform, actual) ? "spawn" : "exit" };
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) throw firstError;
  if (zfsError !== undefined && foundFile) throw zfsError;
  return undefined;
}

function reportsZed(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(path, ["--version"], { encoding: "utf8", timeout: 2000 }, (error, stdout) => resolve(!error && /^Zed\s/i.test(stdout)));
  });
}

/** Whether the resolved command is the editor's GUI rather than a launcher. */
function isGui(app: Editor, platform: NodeJS.Platform, actual: string): boolean {
  if (app === "vscode") return platform === "linux" && existsSync(join(dirname(actual), "resources", "app", "product.json"));
  // Linux Cursor's Electron executable may be an AppImage or an extracted ELF.
  if (app === "cursor") return platform === "linux" && isElf(actual);
  return app === "sublime" && basename(actual) === "sublime_text";
}

function isElf(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const header = Buffer.alloc(4);
    return readSync(fd, header, 0, 4, 0) === 4 && header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  } finally {
    closeSync(fd);
  }
}
