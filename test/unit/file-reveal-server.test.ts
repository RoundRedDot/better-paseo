import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { spawn } = vi.hoisted(() => ({
  spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })),
}));
vi.mock("node:child_process", async (actual) => ({ ...(await actual<typeof import("node:child_process")>()), spawn }));

type Handler = (input: unknown) => Promise<unknown>;

let root = "";

beforeAll(async () => {
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
    get: (_, key) => key === "registerSettings" ? () => ({ read: async () => ({ status: "invalid", revision: "test", error: "test" }), subscribe: () => () => {} }) : key === "handle"
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
});
