import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { execCommand, type PluginServerContext } from "@getpaseo/plugin/server";
import { TASKS_SETTINGS } from "../../shared/tasks-settings";
import { createStopMarks, readMarksPath, stopMarksPath } from "./stop-marks";
import { connectHostDaemon, createSubagentWatch, hasHostDaemon, type HostDaemon, type SubagentWatch } from "./provider-subagents";
import { tasksCapabilitiesRpc, tasksReadRpc, tasksReadsRpc, tasksStopRpc, tasksStoppedRpc, tasksSubagentsRpc, tasksUnarchiveRpc } from "../../shared/tasks-rpc";

const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const STOP_TIMEOUT_MS = 10_000;
/** A reload resumes the provider's session, which can take a while (a Codex rollout). */
const UNARCHIVE_TIMEOUT_MS = 60_000;
/** The daemon loads an agent from storage before clearing it; one it cannot find gets no answer at all. */
const READ_TIMEOUT_MS = 10_000;

type CliStopOutput = { stoppedCount: number; agentIds: string[] };

let cliPathPromise: Promise<string | null> | null = null;

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findCliPath(): Promise<string | null> {
  const configured = process.env.PASEO_CLI;
  if (configured && (await isExecutableFile(configured))) return configured;

  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(entry || process.cwd(), "paseo");
    if (await isExecutableFile(candidate)) return candidate;
  }

  return null;
}

function resolveCliPath(): Promise<string | null> {
  if (!cliPathPromise) cliPathPromise = findCliPath().catch(() => null);
  return cliPathPromise;
}

function isCliStopOutput(value: unknown): value is CliStopOutput {
  if (typeof value !== "object" || value === null) return false;
  const output = value as { stoppedCount?: unknown; agentIds?: unknown };
  return (
    typeof output.stoppedCount === "number" &&
    Array.isArray(output.agentIds) &&
    output.agentIds.every((agentId) => typeof agentId === "string")
  );
}

function cliErrorMessage(error: unknown, doing = "stopping", verb = "stop"): string {
  if (typeof error === "object" && error !== null) {
    const failure = error as { code?: unknown; message?: unknown };
    if (failure.code === "ETIMEDOUT" || /timed? out/i.test(String(failure.message ?? ""))) {
      return `Paseo CLI timed out while ${doing} the agent.`;
    }
    if (typeof failure.code === "number") return `Paseo CLI exited with code ${failure.code}.`;
    if (failure.code === "ENOENT") return "Paseo CLI could not be started.";
  }
  return `Paseo CLI failed to ${verb} the agent.`;
}

async function stopAgent(cli: string, agentId: string): Promise<{ ok: boolean; error: string | null }> {
  if (!AGENT_ID_PATTERN.test(agentId)) return { ok: false, error: "Invalid agent ID." };

  try {
    const { stdout } = await execCommand(cli, ["agent", "stop", agentId, "--json"], {
      timeout: STOP_TIMEOUT_MS,
      env: process.env,
    });

    let output: unknown;
    try {
      output = JSON.parse(stdout);
    } catch {
      return { ok: false, error: "Paseo CLI returned invalid JSON." };
    }
    if (!isCliStopOutput(output)) return { ok: false, error: "Paseo CLI returned an unexpected response." };
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: cliErrorMessage(error) };
  }
}

async function unarchiveAgent(cli: string, agentId: string): Promise<{ ok: boolean; error: string | null }> {
  if (!AGENT_ID_PATTERN.test(agentId)) return { ok: false, error: "Invalid agent ID." };

  try {
    // A reload interrupts a live agent: only an archived one is reloaded.
    const { stdout } = await execCommand(cli, ["agent", "inspect", agentId, "--json"], {
      timeout: STOP_TIMEOUT_MS,
      env: process.env,
    });
    let inspected: unknown;
    try {
      inspected = JSON.parse(stdout);
    } catch {
      return { ok: false, error: "Paseo CLI returned invalid JSON." };
    }
    const archived = (inspected as { Archived?: unknown } | null)?.Archived;
    if (typeof archived !== "boolean") return { ok: false, error: "Paseo CLI returned an unexpected response." };
    if (!archived) return { ok: true, error: null };

    await execCommand(cli, ["agent", "reload", agentId, "--json"], {
      timeout: UNARCHIVE_TIMEOUT_MS,
      env: process.env,
    });
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: cliErrorMessage(error, "unarchiving", "unarchive") };
  }
}

/** How the server reaches this host's daemon for `tasks.read`; tests pass their own. */
export interface HostDaemonAccess {
  available(): boolean;
  connect(): Promise<HostDaemon | null>;
}

const hostDaemon: HostDaemonAccess = { available: hasHostDaemon, connect: connectHostDaemon };

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Whether the daemon can clear the agent: it resumes a stored ("closed") agent
 * first, which fails where its working directory is gone (a worktree the
 * agent removed), and then sends no answer at all.
 */
async function isClearable(daemon: HostDaemon, agentId: string): Promise<boolean> {
  const agent = (await daemon.fetchAgent(agentId))?.agent;
  return !agent || agent.status !== "closed" || (await directoryExists(agent.cwd));
}

async function markRead(host: HostDaemonAccess, agentIds: string[]): Promise<{ ok: boolean; error: string | null }> {
  if (!agentIds.every((agentId) => AGENT_ID_PATTERN.test(agentId))) return { ok: false, error: "Invalid agent ID." };
  const daemon = await host.connect();
  if (!daemon) return { ok: false, error: "Could not reach the Paseo daemon." };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), READ_TIMEOUT_MS);
    });
    const clear = async () => {
      const clearable = await Promise.all(agentIds.map((agentId) => isClearable(daemon, agentId)));
      // One the daemon cannot load keeps its attention there; the board's read mark moves its card.
      const ids = agentIds.filter((_, index) => clearable[index]);
      if (ids.length > 0) await daemon.clearAgentAttention(ids);
    };
    await Promise.race([clear(), timeout]);
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: "The Paseo daemon did not mark the agent read." };
  } finally {
    clearTimeout(timer);
    await daemon.close().catch(() => {});
  }
}

/**
 * The Tasks board's settings record, stop, read, subagent and unarchive RPCs. The
 * stops `tasks.stopped` answers with, and the reads `tasks.reads` answers
 * with, live in files under the plugin's data directory, so they outlive a
 * daemon restart; a mark goes when the agent starts a new turn or is
 * archived, and when it is 30 days old. The provider
 * subagents `tasks.subagents` answers with live in memory, as the daemon's do.
 */
export function registerTasksServer(
  server: PluginServerContext,
  stops = createStopMarks(stopMarksPath()),
  subagents: SubagentWatch = createSubagentWatch(),
  host: HostDaemonAccess = hostDaemon,
  reads = createStopMarks(readMarksPath()),
): void {
  server.registerSettings(TASKS_SETTINGS);
  // A new turn means a new prompt: the agent is no longer "stopped manually", nor read.
  server.on("agent.turn_started", async ({ agent }, context) => {
    void subagents.ensure(context?.paseo);
    await Promise.all([stops.clear(agent.id), reads.clear(agent.id)]);
  });
  // A session opened from storage replays its subagents without an update; read its list after.
  server.before("agent.session_open", ({ request }, context) => {
    if (request.purpose === "interactive" && request.reason !== "create") subagents.loaded(context?.paseo, request.agentId);
  });
  server.on("agent.archived", async ({ agent }) => {
    subagents.dropParent(agent.id);
    await Promise.all([stops.clear(agent.id), reads.clear(agent.id)]);
  });
  server.handle(tasksStoppedRpc, async () => ({ stops: await stops.list() }));
  server.handle(tasksSubagentsRpc, async ({ since }, context) => subagents.read(context?.paseo, since));
  server.handle(tasksCapabilitiesRpc, async () => ({ stop: (await resolveCliPath()) !== null, read: host.available() }));
  server.handle(tasksReadRpc, async ({ agentIds }) => {
    const result = await markRead(host, agentIds);
    if (result.ok) for (const agentId of agentIds) await reads.mark(agentId);
    return result;
  });
  server.handle(tasksReadsRpc, async () => ({
    reads: (await reads.list()).map(({ agentId, stoppedAt }) => ({ agentId, readAt: stoppedAt })),
  }));
  server.handle(tasksStopRpc, async ({ agentIds }) => {
    const cli = await resolveCliPath();
    const results: Array<{ agentId: string; ok: boolean; error: string | null }> = [];

    for (const agentId of agentIds) {
      if (!cli) {
        results.push({ agentId, ok: false, error: "Paseo CLI is unavailable." });
        continue;
      }

      const result = await stopAgent(cli, agentId);
      if (result.ok) await stops.mark(agentId);
      results.push({ agentId, ...result });
    }

    return { results };
  });
  server.handle(tasksUnarchiveRpc, async ({ agentId }) => {
    const cli = await resolveCliPath();
    if (!cli) return { ok: false, error: "Paseo CLI is unavailable." };
    return await unarchiveAgent(cli, agentId);
  });
}
