import { describe, expect, it, vi } from "vitest";

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", async (original) => ({ ...await original<object>(), execFile }));
import { openSystemTerminal } from "../../server/open-terminal";
import { openTerminalRpc, updateCommand } from "../../shared/open-terminal";

describe("fill the system terminal", () => {
  it("queues the reviewed command in zsh without sending keystrokes", async () => {
    execFile.mockImplementation((_command, _args, _options, callback) => callback(null));
    const command = updateCommand("git", "a".repeat(40));
    await expect(openSystemTerminal(command, "darwin")).resolves.toEqual({ status: "opened" });
    const [executable, args, options] = execFile.mock.calls.at(-1)!;
    expect(executable).toBe("/usr/bin/osascript");
    expect(options).toEqual({ timeout: 25_000 });
    expect(args[0]).toBe("-e");
    expect(args[1]).toContain('if [ -n \\"$ZSH_VERSION\\" ]');
    expect(args[1]).toContain("print -z -- ");
    expect(args[1]).toContain("quoted form of (item 1 of argv)");
    expect(args[1]).not.toMatch(/System Events|keystroke|key code/i);
    expect(args[2]).toBe(command);
    expect(command).not.toMatch(/[\r\n]/);
  });

  it("accepts only reviewed commit hashes at the RPC boundary", () => {
    expect(openTerminalRpc.input.safeParse({ source: "git", latest: "a".repeat(40) }).success).toBe(true);
    expect(openTerminalRpc.input.safeParse({ source: "git", latest: "a".repeat(40) + "\n" }).success).toBe(false);
    expect(openTerminalRpc.input.safeParse({ source: "git", latest: "$(touch injected)" }).success).toBe(false);
    expect(updateCommand("registry", "a".repeat(40))).toBe("paseo plugin update better-paseo");
  });

  it("reports automation errors and unsupported host platforms", async () => {
    execFile.mockImplementation((_command, _args, _options, callback) => callback(new Error("permission denied")));
    await expect(openSystemTerminal("paseo plugin update better-paseo", "darwin")).resolves.toEqual({ status: "failed" });
    execFile.mockClear();
    await expect(openSystemTerminal("paseo plugin update better-paseo", "linux")).resolves.toEqual({ status: "unsupported" });
    expect(execFile).not.toHaveBeenCalled();
  });
});
