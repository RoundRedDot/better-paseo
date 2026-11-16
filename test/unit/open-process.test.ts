import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LaunchUnconfirmedError, waitForOpen } from "../../server/open-process";

function childProcess() {
  const child = new EventEmitter() as ChildProcess;
  child.unref = vi.fn();
  return child;
}

afterEach(() => vi.useRealTimers());

describe("open process completion", () => {
  it("reports a nonzero launcher exit after successful spawn", async () => {
    const child = childProcess();
    const result = waitForOpen(child, "exit", "Failed to open path");
    child.emit("spawn");
    child.emit("exit", 4);
    await expect(result).rejects.toThrow("Failed to open path (exit 4)");
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("reports an unconfirmed launch without terminating a long-running process", async () => {
    vi.useFakeTimers();
    const child = childProcess();
    child.kill = vi.fn();
    const result = waitForOpen(child, "exit", "Failed to open path");
    const assertion = expect(result).rejects.toBeInstanceOf(LaunchUnconfirmedError);
    child.emit("spawn");
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(child.kill).not.toHaveBeenCalled();
    expect(child.unref).toHaveBeenCalledOnce();
  });
});
