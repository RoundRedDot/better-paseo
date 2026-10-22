import { dirname } from "node:path";

/**
 * Types that run something when opened rather than show it: an app bundle, a
 * Terminal script, an installer, a script whose default app may be an
 * interpreter (Python Launcher). They are revealed instead.
 */
const LAUNCHES = /\.(app|command|tool|terminal|workflow|action|scpt|scptd|applescript|pkg|mpkg|dmg|sh|bash|zsh|py|rb|pl|jar|webloc|inetloc|fileloc)$/i;

export interface PathEntry {
  isDirectory(): boolean;
  isFile(): boolean;
  mode: number;
}

/** Whether opening the path would launch it: a launching type, or a file with an execute bit. */
export function launches(target: string, entry: PathEntry): boolean {
  return LAUNCHES.test(target.replace(/\/+$/, "")) || (entry.isFile() && (entry.mode & 0o111) !== 0);
}

/**
 * The platform shell command for a path press. macOS opens a file in its
 * default app and a folder in Finder, but only reveals anything that would
 * launch. Windows Explorer selects the file; every other platform opens the
 * containing directory, because `xdg-open` on a file launches its editor.
 */
export function shellOpenCommand(
  platform: NodeJS.Platform,
  target: string,
  entry: PathEntry,
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
  const isDirectory = entry.isDirectory();
  if (platform === "win32") {
    return { command: "explorer.exe", args: isDirectory ? [target] : [`/select,${target}`], windowsVerbatimArguments: true };
  }
  if (platform === "darwin") {
    return { command: "open", args: launches(target, entry) ? ["-R", target] : [target] };
  }
  return { command: "xdg-open", args: [isDirectory ? target : dirname(target)] };
}
