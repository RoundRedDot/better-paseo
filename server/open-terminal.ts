import { execFile } from "node:child_process";

// Queue the command in zsh's editor buffer without executing it.
const SCRIPT = String.raw`on run argv
  tell application "Terminal"
    activate
    do script "if [ -n \"$ZSH_VERSION\" ]; then print -z -- " & quoted form of (item 1 of argv) & "; else echo 'This action requires zsh. Paste the copied command manually.'; fi"
  end tell
end run`;

export async function openSystemTerminal(command: string, platform: NodeJS.Platform = process.platform): Promise<{ status: "opened" | "unsupported" | "failed" }> {
  if (platform !== "darwin") return { status: "unsupported" };
  return new Promise((resolve) => {
    execFile("/usr/bin/osascript", ["-e", SCRIPT, command], { timeout: 25_000 }, (error) => {
      resolve({ status: error ? "failed" : "opened" });
    });
  });
}
