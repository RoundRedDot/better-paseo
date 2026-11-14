import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type { PaseoApi } from "./paseo-types";
import type { AgentUpdate, AgentUpdates } from "../shared/agent-updates";
import { isNewerVersion } from "../shared/update-check";

const packages: Record<string, string> = {
  claude: "@anthropic-ai/claude-code", codex: "@openai/codex", gemini: "@google/gemini-cli",
  pi: "@mariozechner/pi-coding-agent", omp: "@oh-my-pi/pi-coding-agent", grok: "@xai-official/grok", opencode: "opencode-ai", copilot: "@github/copilot",
};
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

/** Read only the two single-line fields we need; diagnostics can contain environment secrets. */
export function parseAgentDiagnostic(diagnostic: string) {
  const paths = [...diagnostic.matchAll(/^  Resolved path: (.+)$/gm)];
  const versions = [...diagnostic.matchAll(/^  Version: (.+)$/gm)];
  const executable = paths.length === 1 && isAbsolute(paths[0]![1]!) ? paths[0]![1]! : null;
  const raw = versions.length === 1 ? versions[0]![1]! : "";
  const match = /^(?:codex-cli |claude |v|omp[ /]|oh-my-pi v?|grok )?(\d+\.\d+\.\d+)(?: \((?:Claude Code|[a-f0-9]{7,40})\))?$/.exec(raw)
    ?? /^grok (\d+\.\d+\.\d+)(?: \([a-f0-9]{7,40}\))? \[stable\]$/.exec(raw);
  const current = match && stableVersion.test(match[1]!) ? match[1]! : null;
  return { executable, current };
}

/** Only follow simple shell wrappers whose final executable is an absolute path. */
async function wrapperTarget(executable: string): Promise<string | null> {
  if ((await stat(executable)).size > 64 * 1024) return null;
  const file = await readFile(executable);
  if (!file.subarray(0, 2).equals(Buffer.from("#!"))) return null;
  const lines = file.toString("utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  if (lines.some((line) => /[;`]/.test(line) || /^(?:export\s+)?(?:PATH|ENV|BASH_ENV|ZDOTDIR)=/.test(line))) return null;
  if (lines.slice(0, -1).some((line) => !/^(?:set -[A-Za-z]+(?: pipefail)?|[A-Za-z_][A-Za-z0-9_]*=.+|export [A-Za-z_][A-Za-z0-9_]*(?:=.*)?)$/.test(line))) return null;
  const match = /^exec\s+["']?(\/[^\s"']+)["']?(?:\s|$)/.exec(lines.at(-1) ?? "");
  return match?.[1] ?? null;
}

/** Prove package ownership from the daemon-resolved binary, not a separate PATH lookup. */
async function npmOwner(executable: string, expected: string, current: string): Promise<boolean> {
  const target = await realpath(executable);
  const suffix = `/lib/node_modules/${expected}/`;
  const at = target.lastIndexOf(suffix);
  if (at < 0) return false;
  const root = target.slice(0, at) + suffix.slice(0, -1);
  const metadata = z.object({ name: z.string(), version: z.string() }).parse(JSON.parse(await readFile(join(root, "package.json"), "utf8")));
  return metadata.name === expected && metadata.version === current;
}

export async function customReleasePackage(provider: string, executable: string, current: string, home = homedir()): Promise<string | null> {
  const target = await realpath(executable);
  if (provider === "grok") {
    const directory = join(home, ".grok/downloads") + "/";
    const filename = basename(target);
    if (target.startsWith(directory) && filename.startsWith(`grok-${current}-`)) return packages.grok!;
  }
  const candidates = provider === "grok" ? [packages.grok!] : [packages.codex!, "agy-acp-bridge"];
  for (const expected of candidates) {
    if (await npmOwner(executable, expected, current)) return expected;
  }
  const wrapped = await wrapperTarget(executable);
  if (!wrapped) return null;
  for (const expected of candidates) {
    if (await npmOwner(wrapped, expected, current)) return expected;
  }
  return null;
}

/** Installation evidence must belong to the daemon-resolved binary, never a second PATH lookup. */
export async function identifyInstallation(executable: string, provider: string): Promise<{ method: AgentUpdate["method"]; command: string | null }> {
  const target = await realpath(executable);
  const expected = packages[provider];
  if (process.platform !== "win32" && provider === "claude" && target.startsWith(join(homedir(), ".local/share/claude/versions") + "/")) {
    return { method: "native", command: `${quote(executable)} update` };
  }
  const cellar = /^(.*\/Cellar\/[^/]+\/[^/]+)\//.exec(target);
  if (cellar) {
    z.object({ homebrew_version: z.string() }).parse(JSON.parse(await readFile(join(cellar[1]!, "INSTALL_RECEIPT.json"), "utf8")));
    return { method: "homebrew", command: null };
  }
  if (!expected) return { method: "unknown", command: null };
  // An npm global package has one exact ownership path. Local packages and wrappers remain unknown.
  const suffix = `/lib/node_modules/${expected}/`;
  const at = target.lastIndexOf(suffix);
  if (at < 0) return { method: "unknown", command: null };
  const root = target.slice(0, at) + suffix.slice(0, -1);
  const metadata = z.object({ name: z.string() }).parse(JSON.parse(await readFile(join(root, "package.json"), "utf8")));
  if (metadata.name !== expected) return { method: "unknown", command: null };
  // The daemon may be Electron running as Node. Its execPath is not a verified terminal Node.
  return { method: "npm", command: null };
}

async function latestVersion(packageName: string, fetchVersion: typeof fetch): Promise<string> {
  const response = await fetchVersion(`https://registry.npmjs.org/-/package/${packageName.replace("/", "%2f")}/dist-tags`, { signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!response.ok) throw new Error("Latest version request failed.");
  const length = Number(response.headers.get("content-length"));
  if (length > 64 * 1024) throw new Error("Latest version response too large.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty latest version response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 64 * 1024) { await reader.cancel(); throw new Error("Latest version response too large."); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return z.object({ latest: z.string().regex(stableVersion) }).parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))).latest;
}

export function createAgentUpdateCheck(deps: { fetchVersion: typeof fetch; identify: typeof identifyInstallation; customSource?: typeof customReleasePackage } = { fetchVersion: fetch, identify: identifyInstallation }) {
  let state: AgentUpdates = { state: "idle", entries: [], error: null };
  let running: Promise<void> | null = null;
  let lastAttempt = 0;
  async function run(paseo: Pick<PaseoApi, "providers">) {
    const snapshot = await paseo.providers.snapshot();
    const entries = snapshot.entries.filter((entry) => entry.enabled);
    state = { state: "checking", entries: state.entries.filter((row) => entries.some((entry) => entry.provider === row.provider)), error: null };
    // Publish each completed row independently of slow or failing providers.
    await Promise.all(entries.map(async (entry) => {
      const result: AgentUpdate = { provider: entry.provider, label: entry.label ?? entry.provider, executable: null, current: null, latest: null, method: "unknown", status: "unknown", issue: null, command: null, updateAvailable: state.entries.find((row) => row.provider === entry.provider)?.updateAvailable ?? false };
      let stage: "diagnostic_failed" | "latest_fetch_failed" = "diagnostic_failed";
      try {
        const diagnostic = await paseo.providers.diagnostic(entry.provider);
        Object.assign(result, parseAgentDiagnostic(diagnostic.diagnostic));
        if (result.executable) {
          try { Object.assign(result, await deps.identify(result.executable, entry.provider)); }
          catch { result.issue = "installation_unreadable"; }
        }
        if (!result.issue && result.method === "unknown") result.issue = "installation_unknown";
        if (result.method === "npm") result.issue = "npm_runtime_unverified";
        if (result.method === "homebrew") result.issue = "homebrew_command_unverified";
        let packageName = entry.source === "custom" ? null : packages[entry.provider] ?? null;
        if (entry.source === "custom" && result.executable && result.current) {
          try { packageName = await (deps.customSource ?? customReleasePackage)(entry.provider, result.executable, result.current); }
          catch { result.issue = "installation_unreadable"; }
        }
        result.releasePackage = packageName ?? null;
        stage = "latest_fetch_failed";
        if (packageName) result.latest = await latestVersion(packageName, deps.fetchVersion);
        if (result.current && result.latest) {
          result.updateAvailable = isNewerVersion(result.current, result.latest, 0, 0);
          result.status = result.updateAvailable ? "available" : "current";
        }
        if (!result.current) result.issue = "version_unknown";
        if (!result.executable) result.issue = "executable_unknown";
        if (!packageName && result.issue !== "installation_unreadable") result.issue = "release_source_unknown";
      } catch {
        result.status = "error";
        result.issue = stage;
      }
      state = { ...state, entries: [...state.entries.filter((row) => row.provider !== result.provider), result].sort((a, b) => entries.findIndex((entry) => entry.provider === a.provider) - entries.findIndex((entry) => entry.provider === b.provider)) };
    }));
    state = { ...state, state: "done" };
  }
  return (action: "check" | "status", paseo: Pick<PaseoApi, "providers">, automatic = false): AgentUpdates => {
    if (!running && (action === "check" || (automatic && Date.now() - lastAttempt >= 24 * 60 * 60 * 1000))) {
      lastAttempt = Date.now();
      state = { ...state, state: "checking", error: null };
      running = run(paseo).catch(() => { state = { ...state, state: "failed", error: "snapshot_failed" }; }).finally(() => { running = null; });
    }
    return state;
  };
}
