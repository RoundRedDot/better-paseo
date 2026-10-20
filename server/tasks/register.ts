import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { execCommand, type PluginServerContext } from "@getpaseo/plugin/server";
import { TASKS_SETTINGS } from "../../shared/tasks-settings";
import { tasksCapabilitiesRpc, tasksStopRpc, tasksStoppedRpc } from "../../shared/tasks-rpc";

const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const STOP_TIMEOUT_MS = 10_000;
/** The stops `tasks.stopped` remembers; the oldest go first. */
const STOPS_KEPT = 500;

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

function cliErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const failure = error as { code?: unknown; message?: unknown };
    if (failure.code === "ETIMEDOUT" || /timed? out/i.test(String(failure.message ?? ""))) {
      return "Paseo CLI timed out while stopping the agent.";
    }
    if (typeof failure.code === "number") return `Paseo CLI exited with code ${failure.code}.`;
    if (failure.code === "ENOENT") return "Paseo CLI could not be started.";
  }
  return "Paseo CLI failed to stop the agent.";
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

/** The Tasks board's settings record and stop RPCs. */
export function registerTasksServer(server: PluginServerContext): void {
  // Agent id -> when it was stopped, in insertion order (a later stop moves it last).
  const stops = new Map<string, string>();
  const remember = (agentId: string) => {
    stops.delete(agentId);
    stops.set(agentId, new Date().toISOString());
    while (stops.size > STOPS_KEPT) stops.delete(stops.keys().next().value as string);
  };
  server.registerSettings(TASKS_SETTINGS);
  server.handle(tasksStoppedRpc, async () => ({
    stops: [...stops].map(([agentId, stoppedAt]) => ({ agentId, stoppedAt })),
  }));
  server.handle(tasksCapabilitiesRpc, async () => ({ stop: (await resolveCliPath()) !== null }));
  server.handle(tasksStopRpc, async ({ agentIds }) => {
    const cli = await resolveCliPath();
    const results: Array<{ agentId: string; ok: boolean; error: string | null }> = [];

    for (const agentId of agentIds) {
      if (!cli) {
        results.push({ agentId, ok: false, error: "Paseo CLI is unavailable." });
        continue;
      }

      const result = await stopAgent(cli, agentId);
      if (result.ok) remember(agentId);
      results.push({ agentId, ...result });
    }

    return { results };
  });
}
