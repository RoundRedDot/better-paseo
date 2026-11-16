import type { ChildProcess } from "node:child_process";

export class LaunchUnconfirmedError extends Error {
  constructor() {
    super("The launch did not finish in time; the path may have opened.");
  }
}

/** Some launchers can remain attached to the application they start. */
export async function waitForOpen(child: ChildProcess, completion: "spawn" | "exit", failure: string): Promise<void> {
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
        child.once("exit", (code) => finish(code === 0 ? undefined : new Error(`${failure} (exit ${code})`)));
      } else {
        child.once("spawn", () => finish());
      }
    });
  } finally {
    child.unref();
  }
}
