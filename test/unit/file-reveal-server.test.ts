import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { spawn, editorCommand, settings } = vi.hoisted(() => ({
  spawn: vi.fn(),
  editorCommand: vi.fn(),
  settings: { app: "system", status: "ready" },
}));
vi.mock("../../server/editor-target", () => ({ editorCommand }));
vi.mock("node:child_process", async (actual) => ({ ...(await actual<typeof import("node:child_process")>()), spawn }));

type Handler = (input: unknown) => Promise<unknown>;

let root = "";

beforeAll(async () => {
  spawn.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = vi.fn();
    queueMicrotask(() => { child.emit("spawn"); child.emit("exit", 0); });
    return child;
  });
  root = await mkdtemp(join(tmpdir(), "file-reveal-"));
  await writeFile(join(root, "notes.md"), "# notes\n");
  await writeFile(join(root, "Better Paseo Icon.html"), "<html></html>");
  await writeFile(join(root, "run"), "#!/bin/sh\n");
  await chmod(join(root, "run"), 0o755);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function revealHandler(): Promise<Handler> {
  const { default: contribute } = await import("../../index.server");
  const handlers = new Map<string, Handler>();
  const server = new Proxy({}, {
    get: (_, key) => key === "registerSettings" ? () => ({ read: async () => ({ status: settings.status, revision: "test", values: { fileOpenApp: settings.app } }), subscribe: () => () => {} }) : key === "handle"
      ? (contract: { name: string }, handler: Handler) => handlers.set(contract.name, handler)
      : () => () => {},
  }) as PluginServerContext;
  contribute(server);
  return handlers.get("file.reveal")!;
}

describe.runIf(process.platform === "darwin")("file.reveal on macOS", () => {
  it("opens a file in its default app and only reveals an executable", async () => {
    const reveal = await revealHandler();
    await expect(reveal({ cwd: root, path: "notes.md:3" })).resolves.toEqual({ revealed: join(root, "notes.md"), error: null });
    expect(spawn).toHaveBeenLastCalledWith("open", [join(root, "notes.md")], expect.objectContaining({ detached: true }));
    await reveal({ cwd: root, path: "Better Paseo Icon.html" });
    expect(spawn).toHaveBeenLastCalledWith("open", [join(root, "Better Paseo Icon.html")], expect.objectContaining({ detached: true }));
    await reveal({ cwd: root, path: join(root, "run") });
    expect(spawn).toHaveBeenLastCalledWith("open", ["-R", join(root, "run")], expect.objectContaining({ detached: true }));
    await expect(reveal({ cwd: root, path: "missing.md" })).resolves.toMatchObject({ revealed: null });
    expect(spawn).toHaveBeenCalledTimes(3);
  }, 30_000);

  it("opens in the selected editor and reports an unavailable editor", async () => {
    spawn.mockClear();
    settings.app = "zed";
    editorCommand.mockReturnValueOnce({ command: "/usr/bin/zed", args: [], completion: "exit" });
    const reveal = await revealHandler();
    await expect(reveal({ cwd: root, path: "notes.md" })).resolves.toMatchObject({ error: null });
    expect(spawn).toHaveBeenCalledWith("/usr/bin/zed", [join(root, "notes.md")], expect.anything());
    editorCommand.mockImplementationOnce(() => { throw new Error("Zed is not installed"); });
    await expect(reveal({ cwd: root, path: "notes.md" })).resolves.toMatchObject({ error: "Zed is not installed" });
    await reveal({ cwd: root, path: "run" });
    expect(spawn).toHaveBeenLastCalledWith("open", ["-R", join(root, "run")], expect.anything());
    settings.app = "system";
  });

  it("reports unavailable settings while still revealing folders and executables", async () => {
    settings.status = "invalid";
    spawn.mockClear();
    const reveal = await revealHandler();
    await expect(reveal({ cwd: root, path: "notes.md" })).resolves.toMatchObject({ revealed: null, error: "File open settings are unavailable", errorKind: "settings_unavailable" });
    expect(spawn).not.toHaveBeenCalled();
    await reveal({ cwd: root, path: "run" });
    expect(spawn).toHaveBeenLastCalledWith("open", ["-R", join(root, "run")], expect.anything());
    settings.status = "ready";
  });

  it("reports a failed macOS system opener", async () => {
    spawn.mockImplementationOnce(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => { child.emit("spawn"); child.emit("exit", 1); });
      return child;
    });
    const reveal = await revealHandler();
    await expect(reveal({ cwd: root, path: "notes.md" })).resolves.toMatchObject({ revealed: null, error: "Failed to open path (exit 1)", errorKind: "launch_failed", errorApp: "system" });
  });

  it("reports a Linux xdg-open failure after it starts", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { ...platform, value: "linux" });
    try {
      spawn.mockImplementationOnce(() => {
        const child = new EventEmitter() as EventEmitter & { unref: () => void };
        child.unref = vi.fn();
        queueMicrotask(() => { child.emit("spawn"); child.emit("exit", 4); });
        return child;
      });
      const reveal = await revealHandler();
      await expect(reveal({ cwd: root, path: "notes.md" })).resolves.toMatchObject({ revealed: null, error: "Failed to open path (exit 4)", errorKind: "launch_failed" });
      expect(spawn).toHaveBeenLastCalledWith("xdg-open", [root], expect.anything());
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it.each(["vscode", "cursor"])("opens %s without an interactive WSL prompt", async (app) => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { ...platform, value: "linux" });
    settings.app = app;
    try {
      editorCommand.mockReturnValueOnce({ command: "/usr/bin/code", args: [], completion: "exit" });
      const reveal = await revealHandler();
      await expect(reveal({ cwd: root, path: "notes.md" })).resolves.toMatchObject({ error: null });
      expect(spawn).toHaveBeenLastCalledWith("/usr/bin/code", [join(root, "notes.md")], expect.objectContaining({
        windowsHide: true,
        env: expect.objectContaining({ DONT_PROMPT_WSL_INSTALL: "1" }),
      }));
    } finally {
      settings.app = "system";
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("reports an asynchronous system opener spawn error", async () => {
    spawn.mockImplementationOnce(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => child.emit("error", new Error("open missing")));
      return child;
    });
    const reveal = await revealHandler();
    await expect(reveal({ cwd: root, path: "notes.md" })).resolves.toMatchObject({ revealed: null, error: "open missing", errorKind: "launch_failed", errorApp: "system" });
  });

  it("returns after a long-running GUI process starts", async () => {
    settings.app = "cursor";
    editorCommand.mockReturnValueOnce({ command: "Cursor.exe", args: [], completion: "spawn" });
    spawn.mockImplementationOnce(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    const reveal = await revealHandler();
    await expect(reveal({ cwd: root, path: "notes.md" })).resolves.toMatchObject({ error: null });
    settings.app = "system";
  });

  it("reports a GUI process that exits immediately after starting", async () => {
    settings.app = "cursor";
    editorCommand.mockReturnValueOnce({ command: "/usr/bin/cursor", args: [], completion: "spawn" });
    spawn.mockImplementationOnce(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => { child.emit("spawn"); child.emit("exit", 1); });
      return child;
    });
    try {
      const reveal = await revealHandler();
      await expect(reveal({ cwd: root, path: "notes.md" })).resolves.toMatchObject({ errorKind: "launch_failed", errorApp: "cursor" });
    } finally {
      settings.app = "system";
    }
  });

  it("reports a launcher that starts but exits unsuccessfully", async () => {
    settings.app = "zed";
    editorCommand.mockReturnValueOnce({ command: "/usr/bin/zed", args: [], completion: "exit" });
    spawn.mockImplementationOnce(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => { child.emit("spawn"); child.emit("exit", 1); });
      return child;
    });
    const reveal = await revealHandler();
    await expect(reveal({ cwd: root, path: "notes.md" })).resolves.toMatchObject({ revealed: null, error: "Failed to open file with zed (exit 1)", errorKind: "launch_failed", errorApp: "zed" });
    settings.app = "system";
  });
});
