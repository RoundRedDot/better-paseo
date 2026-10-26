import { constants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { execCommand, type PluginServerContext } from "@getpaseo/plugin/server";
import { TASKS_SETTINGS } from "../../shared/tasks-settings";
import { createStopMarks, readMarksPath, stopMarksPath } from "./stop-marks";
import { connectHostDaemon, createSubagentWatch, hasHostDaemon, type HostDaemon, type SubagentWatch } from "./provider-subagents";
import { iconThemeColor } from "./icon-color";
import { createSessionTokenReader, type SessionTokenReader } from "./session-tokens";
import { tasksCapabilitiesRpc, tasksChunkRpc, tasksLabelsRpc, tasksProjectIconsRpc, tasksReadRpc, tasksReadsRpc, tasksStopRpc, tasksStoppedRpc, tasksSessionTokensRpc, tasksSubagentTimelineRpc, tasksSubagentsRpc, tasksUnarchiveRpc } from "../../shared/tasks-rpc";
import { TASKS_CHUNK } from "../tasks-chunk";

const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const STOP_TIMEOUT_MS = 10_000;
/** A reload resumes the provider's session, which can take a while (a Codex rollout). */
const UNARCHIVE_TIMEOUT_MS = 60_000;
/** The daemon loads an agent from storage before clearing it; one it cannot find gets no answer at all. */
const READ_TIMEOUT_MS = 10_000;
const LABELS_TIMEOUT_MS = 10_000;

type CliStopOutput = { stoppedCount: number; agentIds: string[] };

/** How to run the Paseo CLI: an executable, or this process's Node with the CLI's script. */
interface CliCommand {
  command: string;
  args: string[];
}

let cliPromise: Promise<CliCommand | null> | null = null;

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

async function packageVersion(path: string): Promise<string | null> {
  try {
    const version = (JSON.parse(await readFile(path, "utf8")) as { version?: unknown }).version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/** The version of the `@getpaseo/server` package holding `file`, read from the nearest such package.json above it. */
async function serverVersion(file: string): Promise<string | null> {
  let directory = dirname(await realpath(file).catch(() => file));
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as { name?: unknown; version?: unknown };
      if (manifest.name === "@getpaseo/server") return typeof manifest.version === "string" ? manifest.version : null;
    } catch {
      // No package.json here, or not one we can read: keep climbing.
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/**
 * The CLI installed with the daemon running this plugin, found as the daemon
 * finds its own (`resolvePaseoCliExecutablePath` in `@getpaseo/server`'s
 * terminal.js): the plugin process runs from `@getpaseo/server`'s
 * `plugin-process.js` (`process.argv[1]`), so `@getpaseo/cli` resolves from
 * there in an npm prefix or global install. A daemon started from such a CLI
 * sets no `PASEO_CLI`, and its bin is often not on `PATH`. A CLI of another
 * version than the daemon's belongs to some other install and is left alone.
 * The bin is a Node script: it runs with this process's Node, as its shebang
 * would run it with whichever `node` is first on `PATH`.
 */
async function hostCli(entry: string | undefined): Promise<CliCommand | null> {
  if (!entry) return null;
  let bin: string;
  try {
    bin = createRequire(entry).resolve("@getpaseo/cli/bin/paseo");
  } catch {
    return null;
  }
  try {
    if (!(await stat(bin)).isFile()) return null;
  } catch {
    return null;
  }
  const cli = await packageVersion(join(dirname(bin), "..", "package.json"));
  const daemon = await serverVersion(entry);
  if (!cli || !daemon || cli !== daemon) return null;
  // The bin's own shebang flag, where this Node knows it.
  const quiet = process.allowedNodeEnvironmentFlags.has("--disable-warning") ? ["--disable-warning=DEP0040"] : [];
  return { command: process.execPath, args: [...quiet, bin] };
}

/** `PASEO_CLI` (Paseo desktop sets it), then `paseo` on `PATH`, then the CLI installed with this daemon. */
async function findCli(): Promise<CliCommand | null> {
  const configured = process.env.PASEO_CLI;
  if (configured && (await isExecutableFile(configured))) return { command: configured, args: [] };

  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(entry || process.cwd(), "paseo");
    if (await isExecutableFile(candidate)) return { command: candidate, args: [] };
  }

  return await hostCli(process.argv[1]);
}

function resolveCli(): Promise<CliCommand | null> {
  if (!cliPromise) cliPromise = findCli().catch(() => null);
  return cliPromise;
}

function runCli(cli: CliCommand, args: string[], timeout: number) {
  return execCommand(cli.command, [...cli.args, ...args], { timeout, env: process.env });
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

async function stopAgent(cli: CliCommand, agentId: string): Promise<{ ok: boolean; error: string | null }> {
  if (!AGENT_ID_PATTERN.test(agentId)) return { ok: false, error: "Invalid agent ID." };

  try {
    const { stdout } = await runCli(cli, ["agent", "stop", agentId, "--json"], STOP_TIMEOUT_MS);

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

async function unarchiveAgent(cli: CliCommand, agentId: string): Promise<{ ok: boolean; error: string | null }> {
  if (!AGENT_ID_PATTERN.test(agentId)) return { ok: false, error: "Invalid agent ID." };

  try {
    // A reload interrupts a live agent: only an archived one is reloaded.
    const { stdout } = await runCli(cli, ["agent", "inspect", agentId, "--json"], STOP_TIMEOUT_MS);
    let inspected: unknown;
    try {
      inspected = JSON.parse(stdout);
    } catch {
      return { ok: false, error: "Paseo CLI returned invalid JSON." };
    }
    const archived = (inspected as { Archived?: unknown } | null)?.Archived;
    if (typeof archived !== "boolean") return { ok: false, error: "Paseo CLI returned an unexpected response." };
    if (!archived) return { ok: true, error: null };

    await runCli(cli, ["agent", "reload", agentId, "--json"], UNARCHIVE_TIMEOUT_MS);
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

type ProjectIconEntry = { projectId: string; icon: { data: string; mimeType: string; color: string | null } | null };

/**
 * The projects' icons over one daemon connection; null when it cannot be
 * reached, has no icon API or does not answer in time. A project the daemon
 * fails to read gets no icon, so the others still draw theirs.
 */
async function readProjectIcons(host: HostDaemonAccess, projectIds: readonly string[]): Promise<ProjectIconEntry[] | null> {
  const daemon = await host.connect();
  if (!daemon) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const getProjectIcon = daemon.getProjectIcon?.bind(daemon);
    if (!getProjectIcon) return null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), LABELS_TIMEOUT_MS);
    });
    const read = Promise.all(
      [...new Set(projectIds)].map(async (projectId): Promise<ProjectIconEntry> => {
        const result = await getProjectIcon(projectId).catch(() => null);
        const icon = result?.icon;
        return { projectId, icon: icon ? { data: icon.data, mimeType: icon.mimeType, color: iconThemeColor(icon.data, icon.mimeType) } : null };
      }),
    );
    return await Promise.race([read, timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    await daemon.close().catch(() => {});
  }
}

/** A provider subagent's timeline rows with their message times; the error says why there are none. */
export async function readSubagentTimeline(
  host: HostDaemonAccess,
  input: { parentAgentId: string; subagentId: string; direction: "after" | "tail"; limit: number },
): Promise<{ rows: Array<{ type: string; text?: string; timestamp?: string }>; error: string | null }> {
  const daemon = await host.connect();
  if (!daemon) return { rows: [], error: "Could not reach the Paseo daemon." };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const fetchTimeline = daemon.fetchProviderSubagentTimeline?.bind(daemon);
    if (!fetchTimeline) return { rows: [], error: "This Paseo cannot read subagent timelines." };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("The Paseo daemon did not answer.")), LABELS_TIMEOUT_MS);
    });
    const page = await Promise.race([fetchTimeline(input.parentAgentId, input.subagentId, { direction: input.direction, limit: input.limit }), timeout]);
    return {
      rows: page.rows.map(({ item, timestamp }) => ({ type: item.type, timestamp, ...(typeof item.text === "string" ? { text: item.text } : {}) })),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
    await daemon.close().catch(() => {});
  }
}

/** The daemon's label definitions; null when it cannot be reached, has no labels API or does not answer in time. */
async function readLabels(host: HostDaemonAccess): Promise<Array<{ name: string; color: string }> | null> {
  const daemon = await host.connect();
  if (!daemon) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (typeof daemon.listWorkspaceLabels !== "function") return null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), LABELS_TIMEOUT_MS);
    });
    const { labels } = await Promise.race([daemon.listWorkspaceLabels(), timeout]);
    return labels.map(({ name, color }) => ({ name, color }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    await daemon.close().catch(() => {});
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
  tokens: SessionTokenReader = createSessionTokenReader(),
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
  server.handle(tasksSessionTokensRpc, async ({ agentId }, context) => {
    const agent = context?.paseo ? (await context.paseo.agents.ref(agentId).refresh().catch(() => null))?.agent : null;
    return { tokens: agent ? await tokens.read(agent) : null };
  });
  server.handle(tasksSubagentsRpc, async ({ since }, context) => subagents.read(context?.paseo, since));
  server.handle(tasksSubagentTimelineRpc, (input) => readSubagentTimeline(host, input));
  server.handle(tasksChunkRpc, ({ id }) => ({ code: TASKS_CHUNK?.id === id ? TASKS_CHUNK.code : null }));
  server.handle(tasksCapabilitiesRpc, async () => ({ stop: (await resolveCli()) !== null, read: host.available() }));
  server.handle(tasksReadRpc, async ({ agentIds }) => {
    const result = await markRead(host, agentIds);
    if (result.ok) for (const agentId of agentIds) await reads.mark(agentId);
    return result;
  });
  server.handle(tasksLabelsRpc, async () => ({ labels: await readLabels(host) }));
  server.handle(tasksProjectIconsRpc, async ({ projectIds }) => ({ icons: await readProjectIcons(host, projectIds) }));
  server.handle(tasksReadsRpc, async () => ({
    reads: (await reads.list()).map(({ agentId, stoppedAt }) => ({ agentId, readAt: stoppedAt })),
  }));
  server.handle(tasksStopRpc, async ({ agentIds }) => {
    const cli = await resolveCli();
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
    const cli = await resolveCli();
    if (!cli) return { ok: false, error: "Paseo CLI is unavailable." };
    return await unarchiveAgent(cli, agentId);
  });
}
