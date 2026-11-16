import type { ChildProcess } from "node:child_process";
import { Socket } from "node:net";

export class LaunchUnconfirmedError extends Error {
  constructor() {
    super("The launch did not finish in time; the path may have opened.");
  }
}

/** Some launchers can remain attached to the application they start. */
export async function waitForOpen(child: ChildProcess, completion: "spawn" | "exit", failure: string): Promise<void> {
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderr.length < 2048) stderr = (stderr + chunk.toString("utf8")).slice(0, 2048);
  });
  if (child.stderr instanceof Socket) child.stderr.unref();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new LaunchUnconfirmedError()), 10_000);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      child.once("error", finish);
      if (completion === "exit") {
        child.once("exit", (code) => finish(code === 0 ? undefined : new Error(`${failure} (exit ${code})${stderr.trim() ? `: ${stderr.trim()}` : ""}`)));
      } else {
        child.once("spawn", () => finish());
      }
    });
  } finally {
    child.unref();
  }
}
