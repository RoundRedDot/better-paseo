import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeProjectName, createSessionTokenReader } from "../../server/tasks/session-tokens";

const SESSION = "3f559794-3913-4502-b5b8-5a6ffb165dcb";
const THREAD = "01a142c1-8d72-7961-b1e5-f69750db7e6b";

const claudeLine = (id: string, usage: Record<string, number>) =>
  `${JSON.stringify({ type: "assistant", message: { id, usage } })}\n`;
const codexLine = (usage: Record<string, number> | null) =>
  `${JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: usage ? { total_token_usage: usage } : null } })}\n`;

let dir: string;
let claudeDir: string;
let codexDir: string;
let clock: number;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bc-session-tokens-"));
  claudeDir = join(dir, "claude");
  codexDir = join(dir, "codex");
  clock = 0;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const reader = () => createSessionTokenReader({ claudeDir, codexDir, now: () => clock });
const claudeAgent = (cwd = "/Users/dev/app") => ({ provider: "claude", cwd, createdAt: "2026-10-22T13:00:00Z", persistence: { sessionId: SESSION } });

describe("session tokens", () => {
  it("names a Claude project folder after its working directory", () => {
    expect(claudeProjectName("/Users/dev/workspace/rrd/beautiful-chat")).toBe("-Users-dev-workspace-rrd-beautiful-chat");
    expect(claudeProjectName("/repo/.worktrees/card-b3")).toBe("-repo--worktrees-card-b3");
  });

  it("sums a Claude session's messages once each, its subagents' too, and reads only what is appended", async () => {
    const project = join(claudeDir, "projects", claudeProjectName("/Users/dev/app"));
    await mkdir(join(project, SESSION, "subagents"), { recursive: true });
    const main = join(project, `${SESSION}.jsonl`);
    // A message's lines repeat its usage: counted once.
    await writeFile(main, [
      `${JSON.stringify({ type: "user", message: { content: "hi" } })}\n`,
      claudeLine("m1", { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 10 }),
      claudeLine("m1", { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 10 }),
      "not json\n",
    ].join(""));
    await writeFile(join(project, SESSION, "subagents", "agent-a.jsonl"), claudeLine("s1", { input_tokens: 5, cache_read_input_tokens: 500, output_tokens: 5 }));
    const tokens = reader();
    expect(await tokens.read(claudeAgent())).toEqual({ total: 1112 + 510, cached: 1500 });
    // A line half written waits for its end.
    const next = claudeLine("m2", { input_tokens: 1, cache_read_input_tokens: 2000, output_tokens: 9 });
    await appendFile(main, next.slice(0, 20));
    expect(await tokens.read(claudeAgent())).toEqual({ total: 1622, cached: 1500 });
    await appendFile(main, next.slice(20));
    expect(await tokens.read(claudeAgent())).toEqual({ total: 1622 + 2010, cached: 3500 });
  });

  it("finds a Claude session under another folder name (a symlinked /tmp)", async () => {
    const project = join(claudeDir, "projects", "-private-tmp-repro");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, `${SESSION}.jsonl`), claudeLine("m1", { input_tokens: 3, output_tokens: 4 }));
    expect(await reader().read(claudeAgent("/tmp/repro"))).toEqual({ total: 7, cached: 0 });
  });

  it("answers a Codex rollout's last cumulative figure", async () => {
    const day = join(codexDir, "sessions", "2026", "10", "16");
    await mkdir(day, { recursive: true });
    const rollout = join(day, `rollout-2026-10-16T11-29-03-${THREAD}.jsonl`);
    await writeFile(rollout, [
      codexLine(null),
      codexLine({ input_tokens: 34_870, cached_input_tokens: 7_168, output_tokens: 215, total_tokens: 35_085 }),
      codexLine({ input_tokens: 79_586, cached_input_tokens: 41_856, output_tokens: 349, total_tokens: 79_935 }),
    ].join(""));
    const tokens = reader();
    // Found by walking the sessions when the agent's day is another one.
    const agent = { provider: "codex", cwd: "/x", createdAt: "2026-09-01T00:00:00Z", persistence: { sessionId: THREAD } };
    expect(await tokens.read(agent)).toEqual({ total: 79_935, cached: 41_856 });
    await appendFile(rollout, codexLine({ input_tokens: 90_000, cached_input_tokens: 80_000, output_tokens: 500, total_tokens: 90_500 }));
    expect(await tokens.read(agent)).toEqual({ total: 90_500, cached: 80_000 });
  });

  it("answers null for another provider, an unsafe session ID, or a session not written yet, and looks again later", async () => {
    const tokens = reader();
    expect(await tokens.read({ ...claudeAgent(), provider: "opencode" })).toBeNull();
    expect(await tokens.read({ ...claudeAgent(), persistence: { sessionId: "../../etc/passwd" } })).toBeNull();
    expect(await tokens.read({ ...claudeAgent(), persistence: null })).toBeNull();
    expect(await tokens.read(claudeAgent())).toBeNull();
    const project = join(claudeDir, "projects", claudeProjectName("/Users/dev/app"));
    await mkdir(project, { recursive: true });
    await writeFile(join(project, `${SESSION}.jsonl`), claudeLine("m1", { input_tokens: 3, output_tokens: 4 }));
    // A search in vain is not repeated on every poll.
    expect(await tokens.read(claudeAgent())).toBeNull();
    clock += 30_000;
    expect(await tokens.read(claudeAgent())).toEqual({ total: 7, cached: 0 });
  });
});
