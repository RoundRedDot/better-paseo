import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn, type ChildProcess } from "node:child_process";
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

  it("includes bounded stderr when a launcher fails", async () => {
    const child = childProcess();
    const stderr = new PassThrough();
    Object.defineProperty(child, "stderr", { value: stderr });
    const result = waitForOpen(child, "exit", "Failed to open file with cursor");
    stderr.write("Cursor IDE is not installed." + "x".repeat(4096));
    child.emit("exit", 1);
    await expect(result).rejects.toThrow(`Failed to open file with cursor (exit 1): ${("Cursor IDE is not installed." + "x".repeat(4096)).slice(0, 2048)}`);
  });

  it("captures an actual failing launcher's stderr", async () => {
    const child = spawn(process.execPath, ["-e", "process.stderr.write('launcher detail'); process.exitCode = 1"], { stdio: ["ignore", "ignore", "pipe"] });
    await expect(waitForOpen(child, "exit", "Failed to open path")).rejects.toThrow("Failed to open path (exit 1): launcher detail");
  });

  it("captures stderr delivered after a GUI process exits", async () => {
    const child = childProcess();
    const stderr = new PassThrough();
    Object.defineProperty(child, "stderr", { value: stderr });
    const result = waitForOpen(child, "gui", "Failed to open file with cursor");
    child.emit("spawn");
    child.emit("exit", 1);
    stderr.end("AppImage requires FUSE");
    await expect(result).rejects.toThrow("Failed to open file with cursor (exit 1): AppImage requires FUSE");
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("returns for a GUI that stays running and never terminates it", async () => {
    vi.useFakeTimers();
    const child = childProcess();
    child.kill = vi.fn();
    Object.defineProperty(child, "stderr", { value: new PassThrough() });
    const result = waitForOpen(child, "gui", "Failed to open path");
    child.emit("spawn");
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toBeUndefined();
    expect(child.kill).not.toHaveBeenCalled();
    expect(child.unref).toHaveBeenCalledOnce();
    child.emit("exit", 1);
    expect(vi.getTimerCount()).toBe(0);
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
