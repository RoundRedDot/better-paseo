import { spawn, type ChildProcess } from "node:child_process";
import { Socket } from "node:net";
import { editorCommand, isElectronEditor, type Editor } from "./editor-target";
import { shellOpenCommand, type PathEntry } from "./open-path";

export class LaunchUnconfirmedError extends Error {
  constructor() {
    super("The launch did not finish in time; the path may have opened.");
  }
}

/** Runs the platform's opener without a shell. */
export async function openWithShell(target: string, entry: PathEntry, realTarget = target): Promise<void> {
  const { command, args, windowsVerbatimArguments } = shellOpenCommand(process.platform, target, entry, realTarget);
  // Explorer's exit code means nothing, so starting it is the success.
  const completion = process.platform === "win32" ? "spawn" : "exit";
  const child = spawn(command, args, { detached: true, windowsHide: true, stdio: completion === "exit" ? ["ignore", "ignore", "pipe"] : "ignore", ...(windowsVerbatimArguments ? { windowsVerbatimArguments } : null) });
  await waitForOpen(child, completion, "Failed to open path");
}

/** Opens a file in the chosen editor without a shell. */
export async function openInEditor(app: Editor, target: string): Promise<void> {
  const editor = await editorCommand(app);
  const env = { ...process.env };
  // Electron must not execute the selected file as a Node program.
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === "ELECTRON_RUN_AS_NODE") delete env[key];
  }
  if (isElectronEditor(app) && process.platform === "linux") env.DONT_PROMPT_WSL_INSTALL = "1";
  const child = spawn(editor.command, [...editor.args, target], { detached: true, windowsHide: true, stdio: ["ignore", "ignore", "pipe"], env });
  await waitForOpen(child, editor.completion === "spawn" ? "gui" : "exit", `Failed to open file with ${app}`);
}

/**
 * Waits until a launch can be reported, and never kills the child. `spawn`: starting is the success.
 * `exit`: a non-zero exit fails with its stderr. `gui`: still running 500 ms after starting counts as
 * open; an earlier exit is judged as in `exit`. Undecided after 10 s, the launch is unconfirmed.
 */
export async function waitForOpen(child: ChildProcess, completion: "spawn" | "exit" | "gui", failure: string): Promise<void> {
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderr.length < 2048) stderr = (stderr + chunk.toString("utf8")).slice(0, 2048);
  });
  // Reading stderr must not hold the daemon open.
  if (child.stderr instanceof Socket) child.stderr.unref();
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let grace: ReturnType<typeof setTimeout> | undefined;
      let stderrWait: ReturnType<typeof setTimeout> | undefined;
      const timeout = setTimeout(() => finish(new LaunchUnconfirmedError()), 10_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        [timeout, grace, stderrWait].forEach(clearTimeout);
        if (error) reject(error);
        else resolve();
      };
      child.once("error", finish);
      if (completion === "spawn") {
        child.once("spawn", () => finish());
        return;
      }
      if (completion === "gui") child.once("spawn", () => { if (!settled) grace = setTimeout(() => finish(), 500); });
      child.once("exit", (code) => {
        if (settled) return;
        clearTimeout(grace);
        if (code === 0) return finish();
        const report = () => finish(new Error(`${failure} (exit ${code})${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
        // A launcher's last stderr can arrive after its exit.
        if (!child.stderr || child.stderr.readableEnded) return report();
        child.stderr.once("end", report);
        stderrWait = setTimeout(report, 100);
      });
    });
  } finally {
    child.unref();
  }
}
