import { createHash } from "node:crypto";
import type { PaseoApi } from "../paseo-types";
import type { ProviderSubagent } from "../../shared/tasks-rpc";
import { CodexFactsFailure, createCodexThreadReader, unref, type CodexLaunch, type CodexThreadReader } from "./codex-thread-reader";

/**
 * COMPAT(codexSubagentFacts): Paseo's Codex provider sends its subagents
 * without a facts line, so the board cannot show a child's model and effort.
 * getpaseo/paseo#10770 makes the host read them off the child thread; until a
 * host does, the plugin reads the same thing (`thread/read` without turns) and
 * fills in only a missing line. A host line always wins. Remove once the
 * minimum host sends it.
 *
 * The values are the child thread's current or last persisted settings, not a
 * record of what each turn ran with. Nothing is taken from the parent: a child
 * Codex cannot read stays unknown.
 */

const CODEX = "codex";
/** Keys the host strips from every provider's environment (`paseo-env.ts`, `provider-launch-config.ts`). */
const STRIPPED_ENV = [
  "PASEO_NODE_ENV",
  "PASEO_DESKTOP_MANAGED",
  "PASEO_SUPERVISED",
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_NO_ATTACH_CONSOLE",
  "ESBUILD_BINARY_PATH",
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_AGENT_SDK_VERSION",
];

function argv(value: unknown): string[] | null {
  return Array.isArray(value) && value.length > 0 && value.every((part) => typeof part === "string" && part.length > 0) ? value : null;
}

function strings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

/**
 * The Codex app-server the host would start for an agent of `provider`, from
 * the daemon config's `providers`: Codex itself, or a custom provider that
 * extends it. As the host merges them, the custom provider's command wins over
 * Codex's, and its env goes over Codex's, over the daemon's own environment.
 * Null for any other provider.
 *
 * Not covered: an env given to one agent at its launch, which the daemon does
 * not expose. A thread id is unique, so a Codex that looks in another place
 * finds nothing and the facts stay unknown; they are never another thread's.
 */
export function resolveCodexLaunch(provider: string, providers: Record<string, unknown>, baseEnv: NodeJS.ProcessEnv = process.env): CodexLaunch | null {
  const entry = (providers[provider] ?? {}) as { extends?: unknown; command?: unknown; env?: unknown };
  if (provider !== CODEX && entry.extends !== CODEX) return null;
  const base = (provider === CODEX ? {} : providers[CODEX] ?? {}) as { command?: unknown; env?: unknown };
  const command = argv(entry.command) ?? argv(base.command) ?? [CODEX];
  const overlay = { ...strings(base.env), ...strings(entry.env) };
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...baseEnv, ...overlay })) if (typeof value === "string") env[key] = value;
  for (const key of STRIPPED_ENV) delete env[key];
  // The overlay can hold secrets: only its hash names the launch.
  const key = createHash("sha256").update(JSON.stringify([command, Object.entries(overlay).sort()])).digest("hex");
  return { command: command[0]!, args: [...command.slice(1), "app-server"], env, key };
}

/** The host's own facts line (getpaseo/paseo#10770): the type, then the model and effort Codex reports. */
export function codexSubtitle(title: string | null, settings: { model: string | null; reasoningEffort: string | null }): string | null {
  const facts = [settings.model, settings.reasoningEffort].filter((fact): fact is string => !!fact);
  return facts.length > 0 ? [title?.trim() || "Codex subagent", ...facts].join(" · ") : null;
}

/** What the registry asks of a source of missing facts lines. */
export interface SubagentFactsSource {
  /** A subagent as the registry now holds it, after any change. */
  observe(subagent: ProviderSubagent): void;
  /** The subagent left, or with no id every subagent of the parent. */
  forget(parentAgentId: string, id?: string): void;
  /** The line to show where the host sends none; null while unknown. */
  subtitle(subagent: ProviderSubagent): string | null;
  /** Called whenever a line `subtitle` answers changes. */
  onChange(listener: () => void): void;
  /** The `PaseoApi` to read the parent's provider and the daemon's config with. */
  attach(paseo: PaseoApi): void;
  /** Resolves once no read is running, or after `timeoutMs`. */
  settle(timeoutMs: number): Promise<void>;
}

export interface CodexSubagentFactsOptions {
  reader?: CodexThreadReader;
  /** The launch for a parent's Codex; null when the parent is not a Codex agent or is gone. Throws when it cannot tell. */
  launchFor?: (parentAgentId: string) => Promise<CodexLaunch | null>;
  /** A failure worth a line in the plugin's log. */
  report?: (message: string) => void;
  /** Waits before reading again a thread Codex had not stored yet, or after a failed read. */
  retryDelaysMs?: number[];
  /** Reads started at once. */
  concurrency?: number;
  /**
   * A child that just started is read this much later: a host that sends the
   * line itself does so within it, and Codex may not have stored it before.
   */
  freshDelayMs?: number;
  now?: () => number;
}

/** How long the daemon's config and a failure's log line are reused. */
const CONFIG_TTL_MS = 30_000;
const REPORT_EVERY_MS = 10 * 60_000;
const REPORTED_KEPT = 200;
/** A running child created this recently counts as just started. */
const FRESH_MS = 10_000;

interface Entry {
  parentAgentId: string;
  id: string;
  title: string | null;
  subtitle: string | null;
  /** What the last read found, kept to build the line again for a new title. */
  settings: { model: string | null; reasoningEffort: string | null } | null;
  /** Whether the host last said it finished. */
  finished: boolean;
  /** Read once the subagent had finished: its settings are final. */
  finalRead: boolean;
  /**
   * Whether a read is queued or running, or a retry is due. A read starts only
   * while it is clear (or from the read just ending), so one subagent never
   * has two reads at once and an answer can only be stale by the subagent
   * leaving, which replaces or removes its entry.
   */
  busy: boolean;
  /** Its parent is not a Codex agent, or is gone. */
  unsupported: boolean;
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Only a failure built to be logged keeps its text; anything else may carry a provider's raw output. */
function failure(error: unknown): string {
  return error instanceof CodexFactsFailure ? error.message : "could not resolve the Codex launch";
}

export function createCodexSubagentFacts(options: CodexSubagentFactsOptions = {}): SubagentFactsSource {
  const reader = options.reader ?? createCodexThreadReader();
  const retryDelaysMs = options.retryDelaysMs ?? [5_000, 30_000, 120_000];
  const concurrency = options.concurrency ?? 4;
  const freshDelayMs = options.freshDelayMs ?? 3_000;
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, Entry>();
  const queue: Entry[] = [];
  let running = 0;
  let listener: () => void = () => {};
  let settleWaiters: Array<() => void> = [];
  let paseo: PaseoApi | null = null;
  const providers = new Map<string, Promise<string | null>>();
  let config: { at: number; providers: Promise<Record<string, unknown>> } | null = null;
  const reported = new Map<string, number>();
  const key = (parentAgentId: string, id: string) => `${parentAgentId}\n${id}`;

  const report = options.report ?? ((line: string) => {
    const at = now();
    if ((reported.get(line) ?? Number.NEGATIVE_INFINITY) > at - REPORT_EVERY_MS) return;
    if (reported.size >= REPORTED_KEPT) {
      for (const [seen, when] of reported) if (when <= at - REPORT_EVERY_MS) reported.delete(seen);
      if (reported.size >= REPORTED_KEPT) reported.clear();
    }
    reported.set(line, at);
    console.error(`[better-paseo] codex subagent facts: ${line}`);
  });

  function providerOf(parentAgentId: string): Promise<string | null> {
    const known = providers.get(parentAgentId);
    if (known) return known;
    if (!paseo) return Promise.reject(new CodexFactsFailure("api", "no Paseo API yet"));
    // Only loaded parents report subagents, so reading one does not resume it.
    const read = paseo.agents.ref(parentAgentId).refresh().then(
      (result) => (typeof result?.agent?.provider === "string" ? result.agent.provider : null),
      () => {
        throw new CodexFactsFailure("parent", "could not read the parent agent");
      },
    );
    // An agent keeps its provider, and a gone one has nothing to read; a failed read is tried again.
    providers.set(parentAgentId, read);
    read.catch(() => {
      if (providers.get(parentAgentId) === read) providers.delete(parentAgentId);
    });
    return read;
  }

  function providerConfig(): Promise<Record<string, unknown>> {
    if (config && config.at > now() - CONFIG_TTL_MS) return config.providers;
    if (!paseo) return Promise.reject(new CodexFactsFailure("api", "no Paseo API yet"));
    const read = paseo.config.get().then(
      ({ config: daemon }) => (daemon.providers ?? {}) as Record<string, unknown>,
      () => {
        throw new CodexFactsFailure("config", "could not read the daemon config");
      },
    );
    const cached = { at: now(), providers: read };
    config = cached;
    read.catch(() => {
      if (config === cached) config = null;
    });
    return read;
  }

  const launchFor = options.launchFor ?? (async (parentAgentId: string) => {
    const provider = await providerOf(parentAgentId);
    if (!provider) return null;
    return resolveCodexLaunch(provider, await providerConfig());
  });

  function settled(): void {
    if (running > 0 || queue.length > 0) return;
    for (const wake of settleWaiters.splice(0)) wake();
  }

  function enqueue(entry: Entry): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    entry.busy = true;
    if (!queue.includes(entry)) queue.push(entry);
    pump();
  }

  function retry(entry: Entry): boolean {
    const delay = retryDelaysMs[entry.attempts - 1];
    if (delay === undefined) return false;
    later(entry, delay);
    return true;
  }

  function later(entry: Entry, delay: number): void {
    entry.busy = true;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (entries.get(key(entry.parentAgentId, entry.id)) === entry) enqueue(entry);
    }, delay);
    unref(entry.timer);
  }

  function pump(): void {
    while (running < concurrency && queue.length > 0) {
      const entry = queue.shift()!;
      if (entries.get(key(entry.parentAgentId, entry.id)) !== entry) continue;
      running += 1;
      void lookup(entry).finally(() => {
        running -= 1;
        pump();
        settled();
      });
    }
    settled();
  }

  async function lookup(entry: Entry): Promise<void> {
    const final = entry.finished;
    entry.attempts += 1;
    // The host's line or a removal drops the entry; a subagent back again gets a new one.
    const current = () => entries.get(key(entry.parentAgentId, entry.id)) === entry;
    try {
      const launch = await launchFor(entry.parentAgentId);
      if (!current()) return;
      if (!launch) {
        entry.busy = false;
        entry.unsupported = true;
        return;
      }
      const settings = await reader.read(launch, entry.id);
      if (!current()) return;
      if (!settings) {
        // Not stored yet (a child that just started), or stored where this Codex does not look.
        if (!retry(entry)) {
          entry.busy = false;
          report(`Codex has no stored thread ${entry.id} (parent ${entry.parentAgentId}); its model stays unknown`);
        }
        return;
      }
      entry.busy = false;
      entry.attempts = 0;
      if (final) entry.finalRead = true;
      entry.settings = settings;
      const subtitle = codexSubtitle(entry.title, settings);
      if (subtitle !== entry.subtitle) {
        entry.subtitle = subtitle;
        listener();
      }
      // It finished while this read ran: its last persisted settings are read once more.
      if (!final && entry.finished) enqueue(entry);
    } catch (error) {
      if (!current()) return;
      report(`could not read thread ${entry.id}: ${failure(error)}`);
      if (!retry(entry)) entry.busy = false;
    }
  }

  function drop(entryKey: string): void {
    const entry = entries.get(entryKey);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entries.delete(entryKey);
    if (entry.subtitle) listener();
  }

  return {
    observe(subagent) {
      const entryKey = key(subagent.parentAgentId, subagent.id);
      if (subagent.provider !== CODEX || subagent.subtitle?.trim()) {
        // The host's line, or not a Codex child: nothing to fill in, and an answer still on its way is dropped.
        drop(entryKey);
        return;
      }
      const finished = subagent.status !== "running";
      let entry = entries.get(entryKey);
      if (!entry) {
        entry = { parentAgentId: subagent.parentAgentId, id: subagent.id, title: subagent.title, subtitle: null, settings: null, finished, finalRead: false, busy: false, unsupported: false, attempts: 0, timer: null };
        entries.set(entryKey, entry);
        const created = Date.parse(subagent.createdAt);
        if (!finished && Number.isFinite(created) && created > now() - FRESH_MS) later(entry, freshDelayMs);
        else enqueue(entry);
        return;
      }
      entry.finished = finished;
      if (entry.unsupported) return;
      if (entry.title !== subagent.title) {
        // The line opens with the type: built again from what was read, and a read still running uses the new one.
        entry.title = subagent.title;
        const subtitle = entry.settings ? codexSubtitle(entry.title, entry.settings) : null;
        if (subtitle !== entry.subtitle) {
          entry.subtitle = subtitle;
          listener();
        }
      }
      // Once it finishes its last persisted settings are read once more; a read still running reads again when it ends.
      if (finished && !entry.finalRead && !entry.busy) {
        entry.attempts = 0;
        enqueue(entry);
      }
    },
    forget(parentAgentId, id) {
      if (id !== undefined) {
        drop(key(parentAgentId, id));
        return;
      }
      for (const [entryKey, entry] of [...entries]) if (entry.parentAgentId === parentAgentId) drop(entryKey);
      providers.delete(parentAgentId);
    },
    subtitle(subagent) {
      if (subagent.provider !== CODEX) return null;
      return entries.get(key(subagent.parentAgentId, subagent.id))?.subtitle ?? null;
    },
    onChange(next) {
      listener = next;
    },
    attach(next) {
      paseo = next;
    },
    settle(timeoutMs) {
      if (running === 0 && queue.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          settleWaiters = settleWaiters.filter((wake) => wake !== done);
          resolve();
        }, timeoutMs);
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        settleWaiters.push(done);
      });
    },
  };
}
