import type { ChildProcess } from "node:child_process";
import { Socket } from "node:net";

export class LaunchUnconfirmedError extends Error {
  constructor() {
    super("The launch did not finish in time; the path may have opened.");
  }
}

/** Some launchers can remain attached to the application they start. */
export async function waitForOpen(child: ChildProcess, completion: "spawn" | "exit" | "gui", failure: string): Promise<void> {
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderr.length < 2048) stderr = (stderr + chunk.toString("utf8")).slice(0, 2048);
  });
  if (child.stderr instanceof Socket) child.stderr.unref();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new LaunchUnconfirmedError()), 10_000);
      let earlyExitTimer: ReturnType<typeof setTimeout> | undefined;
      let stderrTimer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(earlyExitTimer);
        clearTimeout(stderrTimer);
        if (error) reject(error);
        else resolve();
      };
      child.once("error", finish);
      if (completion !== "spawn") {
        child.once("exit", (code) => {
          if (settled) return;
          clearTimeout(earlyExitTimer);
          if (code === 0) return finish();
          const report = () => finish(new Error(`${failure} (exit ${code})${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
          if (!child.stderr || child.stderr.readableEnded) return report();
          child.stderr.once("end", report);
          stderrTimer = setTimeout(report, 100);
        });
      }
      if (completion === "spawn") child.once("spawn", () => finish());
      if (completion === "gui") child.once("spawn", () => { if (!settled) earlyExitTimer = setTimeout(() => finish(), 500); });
    });
  } finally {
    child.unref();
  }
}
