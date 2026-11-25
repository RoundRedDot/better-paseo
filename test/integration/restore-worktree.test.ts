import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTaskAvailability } from "../../server/tasks/availability";
import type { HostDaemon } from "../../server/tasks/provider-subagents";
import { registerTasksServer, type HostDaemonAccess } from "../../server/tasks/register";
import { titleGenerationSettingsSchema } from "../../shared/title-generation";
import { cleanCliEnv, connect, createPrivateDaemon, freePort, installDirectoryPlugin, paseoBin, type Connection, type PrivateDaemon } from "./helpers/real-daemon";

type Handler = (input: unknown, context: { paseo: PaseoApi }) => Promise<unknown>;

const settings = {
  read: async () => ({ status: "ready" as const, revision: "1", values: titleGenerationSettingsSchema.parse({}) }),
  subscribe: () => () => {},
};

function registerHandlers(host: HostDaemonAccess): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const server = {
    registerSettings: () => settings,
    on: () => () => {},
    before: () => () => {},
    handle(contract: { name: string }, handler: Handler) {
      handlers.set(contract.name, handler);
    },
  } as unknown as PluginServerContext;
  registerTasksServer(server, undefined, undefined, host);
  return handlers;
}

async function invoke(handlers: Map<string, Handler>, name: string, input: unknown, paseo: PaseoApi): Promise<unknown> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`Missing test handler: ${name}`);
  return handler(input, { paseo });
}

const inheritedTargets = ["PASEO_HOST", "PASEO_AGENT_ID", "PASEO_AGENT_CWD", "PASEO_WORKSPACE_ID"] as const;
let pending: Promise<unknown> | undefined;

function realLiveHome(): string {
  const home = path.join(fs.realpathSync(os.homedir()), ".paseo");
  try {
    return fs.realpathSync(home);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return home;
  }
}

function isWithin(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

describe.skipIf(!paseoBin())("worktree unarchive with a private daemon", () => {
  let daemon: PrivateDaemon;
  let connection: Connection;
  let teardownStarted = false;

  beforeAll(async () => {
    const port = await freePort();
    expect(port).not.toBe(6767);
    const scratchRoot = fs.realpathSync(os.tmpdir());
    const liveHome = realLiveHome();
    if (isWithin(liveHome, scratchRoot)) throw new Error("The integration temp directory is inside the live Paseo home");
    daemon = await createPrivateDaemon({ port, cleanEnv: true });
    expect(isWithin(liveHome, fs.realpathSync(daemon.home))).toBe(false);
    // The Tasks handler inherits process.env for its CLI calls.
    for (const key of inheritedTargets) vi.stubEnv(key, undefined);
    vi.stubEnv("PASEO_HOME", daemon.home);
    vi.stubEnv("PASEO_CLI", paseoBin()!);

    await daemon.start();
    await installDirectoryPlugin(daemon, path.resolve(__dirname, "lane-provider"), "bp-lanes");
    connection = await connect(daemon.host, "better-paseo-integration-restore-worktree");
  }, 600_000);

  afterAll(async () => {
    teardownStarted = true;
    try {
      // A Vitest timeout can leave the handler running between CLI calls.
      await pending?.catch(() => {});
      await connection?.close();
      await daemon?.dispose();
    } finally {
      vi.unstubAllEnvs();
    }
  }, 360_000); // Allows for the pinned @getpaseo/client 0.16.0 restoreWorkspace deadline (150 s),
  // CLI inspect (10 s), reload (60 s), and daemon stop (60 s), with margin.
  // Revisit this timeout if the client has no restoreWorkspace deadline.

  it("unarchives a task whose archived worktree Paseo must restore", async () => {
    const repo = path.join(daemon.home, "source");
    fs.mkdirSync(repo);
    const gitOptions = {
      cwd: repo,
      env: cleanCliEnv({ GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(daemon.home, "gitconfig") }),
    };
    execFileSync("git", ["init", "-b", "main"], gitOptions);
    execFileSync("git", ["-c", "user.name=Integration Test", "-c", "user.email=integration@example.invalid", "commit", "--allow-empty", "-m", "Initial commit"], gitOptions);

    const created = await connection.daemon.createPaseoWorktree({ cwd: repo, worktreeSlug: "restore-task" });
    expect(created.error).toBeNull();
    if (!created.workspace) throw new Error("Paseo did not return a worktree workspace");
    const { id: workspaceId, workspaceDirectory: worktreePath } = created.workspace;
    expect(created.workspace.workspaceKind).toBe("worktree");
    expect(fs.realpathSync(worktreePath).startsWith(`${fs.realpathSync(daemon.home)}${path.sep}`)).toBe(true);

    const agent = await connection.api.workspaces.ref(created.workspace).agents.create({
      config: { provider: "bp-lanes/lanes" },
      title: "Restore a task",
      prompt: "hold:300",
    });
    const agentId = agent.id;
    const finished = await agent.waitForFinish(30_000);
    expect(finished).toMatchObject({ status: "idle", final: { workspaceId } });

    const archived = await connection.daemon.archiveWorkspace(workspaceId);
    expect(archived.error).toBeNull();
    await vi.waitFor(() => expect(fs.existsSync(worktreePath)).toBe(false), { timeout: 30_000 });
    expect(await connection.daemon.inspectWorkspaceRecovery(workspaceId)).toMatchObject({ kind: "recoverable", action: "restore" });
    expect((await connection.daemon.fetchAgent({ agentId }))?.agent.archivedAt).toBeTruthy();

    // The SDK types recovery actions as strings. Use the same host interface as connectHostDaemon.
    const connectPrivate = async () => (await connect(daemon.host, "better-paseo-integration-restore-request")).daemon as unknown as HostDaemon;
    const read = createTaskAvailability(settings, () => true, async () => true, connectPrivate);
    const availability = (await read(connection.api, [agentId])).entries[0]!.availability;
    expect(availability.blocked.unarchive).toBeUndefined();
    expect(availability.issue).toBeNull();

    const handlers = registerHandlers({ available: () => true, connect: connectPrivate });
    expect(teardownStarted).toBe(false);
    for (const key of inheritedTargets) expect(process.env[key]).toBeUndefined();
    expect(process.env.PASEO_CLI).toBe(paseoBin());
    expect(process.env.PASEO_HOME).toBe(daemon.home);
    expect(isWithin(realLiveHome(), fs.realpathSync(process.env.PASEO_HOME!))).toBe(false);
    pending = invoke(handlers, "tasks.unarchive", { agentId }, connection.api);
    await expect(pending).resolves.toEqual({ ok: true, error: null });

    expect(fs.existsSync(worktreePath)).toBe(true);
    const restored = await connection.daemon.fetchAgent({ agentId });
    expect(restored?.agent.id).toBe(agentId);
    expect(restored?.agent.archivedAt ?? null).toBeNull();
  });
});
