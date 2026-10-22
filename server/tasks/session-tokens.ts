import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionTokens } from "../../shared/tasks-rpc";

/**
 * The tokens an agent's whole session has used, read from the provider's own
 * session files: the daemon keeps only the latest turn's figure (Codex's only
 * its last request's), and none from before the plugin was installed.
 *
 * - Claude: every assistant message's usage in `<config>/projects/<cwd>/<session>.jsonl`
 *   and its subagents' files, each message once (its lines repeat the usage).
 * - Codex: the last `token_count` event's `total_token_usage` in its rollout.
 *
 * Files are read once and then only what was appended since.
 */

/** The agent as the daemon sends it, the fields the reader needs. */
export interface SessionAgent {
  provider: string;
  cwd: string;
  createdAt: string;
  persistence?: { sessionId?: string | null } | null;
}

/** A session ID safe to put in a file name. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
/** Bytes read per step, so a large first read never holds a whole file. */
const CHUNK = 4 * 1024 * 1024;
const NEWLINE = 0x0a;
/** A session file not found is looked for again after this long, not on every poll. */
const MISS_RETRY_MS = 30_000;

interface Counts {
  total: number;
  cached: number;
}

/** A file read up to `offset`, the last complete line; `fold` takes each new line. */
interface Tail<S> {
  offset: number;
  state: S;
}

async function readTail<S>(path: string, tails: Map<string, Tail<S>>, fresh: () => S, fold: (state: S, line: string) => void): Promise<S | null> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    tails.delete(path);
    return null;
  }
  let tail = tails.get(path);
  // Shorter than read: the file was replaced. Read it again.
  if (!tail || size < tail.offset) {
    tail = { offset: 0, state: fresh() };
    tails.set(path, tail);
  }
  if (size === tail.offset) return tail.state;
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(Math.min(CHUNK, size - tail.offset));
    while (tail.offset < size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - tail.offset), tail.offset);
      if (bytesRead === 0) break;
      const end = buffer.lastIndexOf(NEWLINE, bytesRead - 1);
      // No whole line yet: wait for the rest, unless one line outgrows a chunk (skipped).
      if (end < 0) {
        if (bytesRead < CHUNK) break;
        tail.offset += bytesRead;
        continue;
      }
      for (const line of buffer.toString("utf8", 0, end).split("\n")) fold(tail.state, line);
      tail.offset += end + 1;
    }
  } finally {
    await handle.close();
  }
  return tail.state;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Each Claude message's tokens by ID; a message's later lines carry its final usage. */
type ClaudeMessages = Map<string, Counts>;

function foldClaude(messages: ClaudeMessages, line: string): void {
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return;
  try {
    const entry = JSON.parse(line) as { type?: string; message?: { id?: string; usage?: Record<string, unknown> } };
    const usage = entry.message?.usage;
    const id = entry.message?.id;
    if (entry.type !== "assistant" || !usage || typeof id !== "string") return;
    const cached = count(usage.cache_read_input_tokens);
    messages.set(id, { total: count(usage.input_tokens) + count(usage.cache_creation_input_tokens) + cached + count(usage.output_tokens), cached });
  } catch {
    // A line cut short or not JSON: skip it.
  }
}

/** The rollout's latest cumulative figure. */
interface CodexTotal {
  counts: Counts | null;
}

function foldCodex(state: CodexTotal, line: string): void {
  if (!line.includes('"token_count"') || !line.includes('"total_token_usage"')) return;
  try {
    const entry = JSON.parse(line) as { payload?: { type?: string; info?: { total_token_usage?: Record<string, unknown> } | null } };
    const usage = entry.payload?.type === "token_count" ? entry.payload.info?.total_token_usage : undefined;
    if (!usage) return;
    // Codex counts cached input inside its input; the total is input and output.
    const total = count(usage.total_tokens) || count(usage.input_tokens) + count(usage.output_tokens);
    state.counts = { total, cached: count(usage.cached_input_tokens) };
  } catch {
    // A line cut short or not JSON: skip it.
  }
}

/** Claude Code's project folder name for a working directory. */
export function claudeProjectName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

function localDay(ms: number, shiftDays: number): string[] {
  const day = new Date(ms + shiftDays * 24 * 60 * 60 * 1000);
  return [String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0")];
}

async function names(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

export function createSessionTokenReader(options: { claudeDir?: string; codexDir?: string; now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const claudeDir = options.claudeDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const codexDir = options.codexDir ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const claudeTails = new Map<string, Tail<ClaudeMessages>>();
  const codexTails = new Map<string, Tail<CodexTotal>>();
  /** Session files found, by provider and session ID. */
  const found = new Map<string, string>();
  /** When a session's file was last looked for in vain. */
  const missed = new Map<string, number>();

  /** The file `key` names, found once; a search in vain waits a while before the next. */
  async function locate(key: string, search: () => Promise<string | null>): Promise<string | null> {
    const known = found.get(key);
    if (known) return known;
    const missedAt = missed.get(key);
    if (missedAt !== undefined && now() - missedAt < MISS_RETRY_MS) return null;
    const path = await search();
    if (path) {
      found.set(key, path);
      missed.delete(key);
    } else {
      missed.set(key, now());
    }
    return path;
  }

  const exists = (path: string) => stat(path).then(() => true, () => false);

  function claudeFile(cwd: string, sessionId: string): Promise<string | null> {
    return locate(`claude:${sessionId}`, async () => {
      const projects = join(claudeDir, "projects");
      const file = `${sessionId}.jsonl`;
      // The folder is named after the working directory; a symlinked one (/tmp) is named after its real path.
      const guess = join(projects, claudeProjectName(cwd), file);
      if (await exists(guess)) return guess;
      for (const name of await names(projects)) {
        const path = join(projects, name, file);
        if (await exists(path)) return path;
      }
      return null;
    });
  }

  function codexFile(createdAt: string, sessionId: string): Promise<string | null> {
    return locate(`codex:${sessionId}`, async () => {
      const sessions = join(codexDir, "sessions");
      const suffix = `-${sessionId}.jsonl`;
      const pick = async (dir: string) => {
        const name = (await names(dir)).find((entry) => entry.endsWith(suffix));
        return name ? join(dir, name) : null;
      };
      // Rollouts sit under the local day they began: look there first, then everywhere, newest first.
      const created = Date.parse(createdAt);
      for (const shift of Number.isFinite(created) ? [0, -1, 1] : []) {
        const path = await pick(join(sessions, ...localDay(created, shift)));
        if (path) return path;
      }
      for (const year of (await names(sessions)).sort().reverse()) {
        for (const month of (await names(join(sessions, year))).sort().reverse()) {
          for (const day of (await names(join(sessions, year, month))).sort().reverse()) {
            const path = await pick(join(sessions, year, month, day));
            if (path) return path;
          }
        }
      }
      return null;
    });
  }

  async function claude(agent: SessionAgent, sessionId: string): Promise<SessionTokens | null> {
    const main = await claudeFile(agent.cwd, sessionId);
    if (!main) return null;
    if (!(await exists(main))) {
      found.delete(`claude:${sessionId}`);
      return null;
    }
    const subagentDir = join(main.slice(0, -".jsonl".length), "subagents");
    const files = [main, ...(await names(subagentDir)).filter((name) => name.endsWith(".jsonl")).map((name) => join(subagentDir, name))];
    const totals: Counts = { total: 0, cached: 0 };
    let read = false;
    for (const path of files) {
      const messages = await readTail(path, claudeTails, () => new Map(), foldClaude);
      if (!messages) continue;
      read = true;
      for (const message of messages.values()) {
        totals.total += message.total;
        totals.cached += message.cached;
      }
    }
    return read && totals.total > 0 ? totals : null;
  }

  async function codex(agent: SessionAgent, sessionId: string): Promise<SessionTokens | null> {
    const path = await codexFile(agent.createdAt, sessionId);
    if (!path) return null;
    const state = await readTail(path, codexTails, () => ({ counts: null }), foldCodex);
    // Gone (archived and compressed): look again.
    if (!state) found.delete(`codex:${sessionId}`);
    return state?.counts && state.counts.total > 0 ? { ...state.counts } : null;
  }

  return {
    /** Null for another provider, a session not found, or one without usage yet. */
    async read(agent: SessionAgent): Promise<SessionTokens | null> {
      const sessionId = agent.persistence?.sessionId;
      if (!sessionId || !SESSION_ID.test(sessionId)) return null;
      try {
        if (agent.provider === "claude") return await claude(agent, sessionId);
        if (agent.provider === "codex") return await codex(agent, sessionId);
      } catch {
        // An unreadable file reads as no figure.
      }
      return null;
    },
  };
}

export type SessionTokenReader = ReturnType<typeof createSessionTokenReader>;
