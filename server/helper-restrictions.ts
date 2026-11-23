/**
 * Restrictions for helper agents (translation, title generation): a model that
 * ignores the "no tools" system prompt must still be unable to act. Each
 * provider gets its sandbox where it has one and its least permissive mode
 * otherwise; providers that cannot be restricted are refused.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PaseoAgentHandle, PaseoApi } from "./paseo-types";

export interface HelperModeCandidate {
  id: string;
  label?: string;
  colorTier?: string;
  isUnattended?: boolean;
}

export type HelperRestrictions =
  | {
      supported: true;
      modeId?: string;
      /** Provider options; merged over the provider's `config.json` defaults. */
      options?: Record<string, unknown>;
      mcpServers?: Record<string, Record<string, unknown>>;
    }
  | { supported: false };

/** Modes chosen by name for providers whose least-privilege mode is known. */
const PREFERRED_MODE_IDS: Readonly<Record<string, readonly string[]>> = {
  // Plan mode analyses without executing tools or edits.
  claude: ["plan"],
  // Strict: tools outside the allow list are denied without asking.
  muse: ["denyUnmatched"],
  // Chat only: Goose answers without tools.
  goose: ["chat"],
};

const READ_ONLY_ID = /^read[-_ ]?only$/i;
// Words that mark a mode as granting more than the provider's ask-first default.
const PERMISSIVE_HINT = /full|bypass|yolo|accept|auto|unattended|danger|trust|skip/i;

/** Lower is fewer permissions; `null` is never chosen. */
function permissionRank(mode: HelperModeCandidate): number | null {
  if (mode.colorTier === "dangerous" || mode.isUnattended === true) return null;
  if (READ_ONLY_ID.test(mode.id)) return 0;
  if (mode.colorTier === "planning") return 1;
  if (mode.colorTier === "safe") return 2;
  const permissive = PERMISSIVE_HINT.test(`${mode.id} ${mode.label ?? ""}`);
  if (!mode.colorTier && !permissive) return 3;
  if (mode.colorTier === "moderate") return 4;
  return permissive ? 5 : 4;
}

export function leastPrivilegeModeId(
  provider: string,
  modes: readonly HelperModeCandidate[] | null | undefined,
): string | undefined {
  if (!modes || modes.length === 0) return undefined;
  for (const id of PREFERRED_MODE_IDS[provider] ?? []) {
    if (modes.some((mode) => mode.id === id)) return id;
  }
  let best: { id: string; rank: number } | undefined;
  for (const mode of modes) {
    const rank = permissionRank(mode);
    if (rank === null) continue;
    // Ties keep the provider's listed order, which puts its default first.
    if (!best || rank < best.rank) best = { id: mode.id, rank };
  }
  return best?.id;
}

/**
 * Claude Code's built-in tools plus Paseo's injected MCP server. Plan mode still
 * allows read-only tools, so every tool is listed; `--strict-mcp-config` keeps
 * the user's own MCP servers (GitHub, Notion, ...) out of the helper.
 */
export const CLAUDE_DISALLOWED_TOOLS = [
  "Agent", "AskUserQuestion", "Bash", "BashOutput", "CronCreate", "CronDelete", "CronList", "Edit",
  "EnterPlanMode", "EnterWorktree", "ExitPlanMode", "ExitWorktree", "Glob", "Grep", "KillShell", "LSP",
  "ListAgents", "ListMcpResourcesTool", "Monitor", "MultiEdit", "NotebookEdit", "NotebookRead", "Read",
  "ReadMcpResourceDirTool", "ReadMcpResourceTool", "RemoteTrigger", "ReportFindings", "ScheduleWakeup",
  "SendMessage", "Skill", "SlashCommand", "Task", "TaskCreate", "TaskGet", "TaskList", "TaskOutput",
  "TaskStop", "TaskUpdate", "TodoWrite", "ToolSearch", "WebFetch", "WebSearch", "Workflow", "Write",
  "mcp__paseo",
] as const;

const CODEX_MODE_IDS = ["auto", "auto-review", "full-access"];

/**
 * Takes the place of Paseo's own MCP server (agents, terminals), which Paseo
 * injects unless the agent already names one `paseo`. The command exits at
 * once, so the helper has no Paseo tools. Used only where a real provider was
 * seen to accept it.
 */
const PASEO_MCP_PLACEHOLDER = { paseo: { type: "stdio", command: "/usr/bin/false", args: [] } };
const PLACEHOLDER_PROVIDERS = new Set(["omp", "antigravity"]);

/** Pi has no modes, permissions or sandbox, so its tools always run. */
const UNRESTRICTABLE_PROVIDERS = new Set(["pi"]);

function isCodexFamily(provider: string, modes: readonly HelperModeCandidate[] | undefined): boolean {
  if (provider === "codex") return true;
  // A custom provider that `extends: "codex"` lists Codex's exact modes.
  const ids = modes?.map((mode) => mode.id) ?? [];
  return ids.length === CODEX_MODE_IDS.length && CODEX_MODE_IDS.every((id) => ids.includes(id));
}

/** `modes` undefined means they could not be read. */
export function helperRestrictionsFor(
  provider: string,
  modes: readonly HelperModeCandidate[] | undefined,
): HelperRestrictions {
  if (UNRESTRICTABLE_PROVIDERS.has(provider)) return { supported: false };
  const modeId = leastPrivilegeModeId(provider, modes);
  if (provider === "claude") {
    return {
      supported: true,
      modeId: "plan",
      options: {
        disallowedTools: [...CLAUDE_DISALLOWED_TOOLS],
        extraArgs: { "strict-mcp-config": null },
        sandbox: { enabled: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: false },
      },
    };
  }
  if (isCodexFamily(provider, modes)) {
    // The read-only sandbox blocks writes and network; reads stay possible.
    return {
      supported: true,
      ...(modeId ? { modeId } : {}),
      options: { sandbox_mode: "read-only", approval_policy: "never", web_search: "disabled" },
      mcpServers: PASEO_MCP_PLACEHOLDER,
    };
  }
  if (provider === "opencode") {
    // Denies every tool, MCP included; OpenCode's shared service refuses custom MCP servers.
    return { supported: true, ...(modeId ? { modeId } : {}), options: { permission: "deny" } };
  }
  if (provider === "muse") {
    return {
      supported: true,
      ...(modeId ? { modeId } : {}),
      options: { sandbox: { enabled: true, network: "restricted" } },
    };
  }
  // Others ask before tools run; the helper denies every request it gets.
  if (!modeId) return { supported: false };
  return {
    supported: true,
    modeId,
    ...(PLACEHOLDER_PROVIDERS.has(provider) ? { mcpServers: PASEO_MCP_PLACEHOLDER } : {}),
  };
}

const DEAD_MCP_URL = "http://127.0.0.1:9/mcp";

/**
 * Codex also loads the MCP servers in the user's own `config.toml` (GitHub,
 * Notion, computer use, ...), which its sandbox does not cover. An entry of the
 * same name in the helper's config is merged over each one: an HTTP server gets
 * an address nothing answers, a command server a command that exits at once.
 * Only the `[mcp_servers.<name>]` headers and whether each has a `url` are read.
 */
export function codexMcpOverrides(configToml: string): Record<string, Record<string, unknown>> {
  const overrides: Record<string, Record<string, unknown>> = {};
  for (const section of configToml.split(/^(?=[ \t]*\[)/m)) {
    const header = /^[ \t]*\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\][ \t]*(?:#.*)?$/m.exec(section.split("\n", 1)[0] ?? "");
    const name = header?.[1] ?? header?.[2];
    if (!name) continue;
    overrides[name] = /^[ \t]*url[ \t]*=/m.test(section)
      ? { type: "http", url: DEAD_MCP_URL }
      : { type: "stdio", command: "/usr/bin/false", args: [] };
  }
  return overrides;
}

async function readCodexConfig(): Promise<string | null> {
  const home = process.env.CODEX_HOME || join(homedir(), ".codex");
  return readFile(join(home, "config.toml"), "utf8").catch(() => null);
}

/**
 * Restrictions for a helper on `provider`. The providers snapshot already lists
 * the modes; they are asked for only when it does not.
 */
export async function resolveHelperRestrictions(
  paseo: PaseoApi,
  provider: string,
  listed: readonly HelperModeCandidate[] | undefined,
  readConfig: () => Promise<string | null> = readCodexConfig,
): Promise<HelperRestrictions> {
  let modes = listed;
  if (!modes) {
    try {
      const result = await paseo.providers.listModes(provider);
      modes = result.error ? undefined : result.modes;
    } catch {
      modes = undefined;
    }
  }
  const restrictions = helperRestrictionsFor(provider, modes);
  if (!restrictions.supported || !isCodexFamily(provider, modes)) return restrictions;
  const configToml = await readConfig().catch(() => null);
  if (!configToml) return restrictions;
  return { ...restrictions, mcpServers: { ...codexMcpOverrides(configToml), ...restrictions.mcpServers } };
}

/** The agent config fields that carry the restrictions. */
export function restrictedHelperConfig(restrictions: Extract<HelperRestrictions, { supported: true }>) {
  return {
    ...(restrictions.modeId ? { modeId: restrictions.modeId } : {}),
    ...(restrictions.options ? { options: restrictions.options } : {}),
    ...(restrictions.mcpServers ? { mcpServers: restrictions.mcpServers } : {}),
  } as Record<string, unknown>;
}

const DENY_MESSAGE = "Tools are disabled for this helper. Do not call tools; output only the requested text.";
const MAX_DENIALS = 8;

/**
 * Runs one prompt and denies every permission request the helper raises, so a
 * tool attempt ends the wait at once instead of holding the turn until timeout.
 */
export async function runRestrictedHelper(
  helper: Pick<PaseoAgentHandle, "run" | "waitForFinish" | "respondToPermission" | "refresh">,
  prompt: string,
  timeoutMs: number,
): Promise<Awaited<ReturnType<PaseoAgentHandle["run"]>>> {
  const deadline = Date.now() + timeoutMs;
  let result = await helper.run(prompt, { timeoutMs });
  let denied = 0;
  while (result.status === "permission") {
    const listed = result.final?.pendingPermissions;
    const pending = listed?.length ? listed : (await helper.refresh())?.agent.pendingPermissions ?? [];
    if (pending.length === 0 || denied >= MAX_DENIALS) break;
    for (const request of pending) {
      denied += 1;
      await helper.respondToPermission({ requestId: request.id, response: { behavior: "deny", message: DENY_MESSAGE } });
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ...result, status: "timeout" };
    result = await helper.waitForFinish(remaining);
  }
  return result;
}
