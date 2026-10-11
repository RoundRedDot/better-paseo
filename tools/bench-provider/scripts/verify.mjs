#!/usr/bin/env node
// Replays fixtures through a running bench daemon and checks the stored timeline against them.
//
//   node scripts/verify.mjs [--home ~/.paseo-bench] [--port 6868] [--speed max|<n>] [--keep] [fixture ...]
//
// For every fixture it creates a bc-bench agent (`paseo run`), waits for the turn to finish,
// reads the projected timeline back through the daemon API and compares it with the timeline
// the fixture implies (appends merged per streaming item, tool calls collapsed by callId).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import WebSocket from "ws";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "..", "..", "..", "test", "fixtures", "streams");

const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const [, value] = args.splice(i, 2);
  return value;
}
const home = option("home", join(homedir(), ".paseo-bench")).replace(/^~(?=\/|$)/, homedir());
const port = option("port", "6868");
const speed = option("speed", "max");
const keep = args.includes("--keep");
const requested = args.filter((a) => !a.startsWith("--"));
const cwd = "/tmp/bc-bench-ws";
mkdirSync(cwd, { recursive: true });

// Reuse one workspace for every agent (each `paseo run --cwd` would otherwise register a new one).
function benchWorkspace() {
  const list = JSON.parse(paseo("-o", "json", "workspace", "ls"));
  return list.find((w) => w.cwd === cwd)?.workspaceId ?? null;
}

const names = readdirSync(fixturesDir)
  .filter((f) => f.endsWith(".jsonl"))
  .map((f) => f.replace(/\.jsonl$/, ""))
  .filter((n) => requested.length === 0 || requested.includes(n))
  .sort();

/** The collapsed timeline a fixture is supposed to produce. */
function expectedTimeline(text) {
  const rows = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const lines = rows.slice(1);
  const out = [];
  const calls = new Map();
  let streaming = null;
  for (const { item } of lines) {
    if (item.type === "assistant_message" || item.type === "reasoning") {
      if (streaming && streaming.type === item.type) streaming.text += item.text;
      else {
        streaming = { type: item.type, text: item.text };
        out.push(streaming);
      }
      continue;
    }
    streaming = null;
    if (item.type === "tool_call") {
      const existing = calls.get(item.callId);
      if (existing) Object.assign(existing, item);
      else {
        const copy = { ...item };
        calls.set(item.callId, copy);
        out.push(copy);
      }
    } else out.push({ ...item });
  }
  return { meta: rows[0], lines, items: out };
}

function same(a, b) {
  return isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
}

function diffItem(expected, actual) {
  if (expected.type !== actual.type) return `type ${actual.type} != ${expected.type}`;
  switch (expected.type) {
    case "user_message":
    case "assistant_message":
    case "reasoning":
      return expected.text === actual.text ? null : `text differs (${actual.text.length} vs ${expected.text.length} chars)`;
    case "tool_call":
      for (const key of ["callId", "name", "status", "detail"]) {
        if (!same(expected[key], actual[key])) return `tool_call.${key} differs for ${expected.callId}`;
      }
      if (expected.status === "failed" && !same(expected.error, actual.error)) return `tool_call.error differs for ${expected.callId}`;
      return null;
    case "todo":
      return same(expected.items, actual.items) ? null : "todo items differ";
    default:
      return null;
  }
}

function paseo(...argv) {
  return execFileSync("paseo", ["--home", home, ...argv], { encoding: "utf8", maxBuffer: 1 << 26 }).trim();
}

const credential = readFileSync(join(home, "local-credential"), "utf8").trim();
const client = new DaemonClient({
  url: `ws://127.0.0.1:${port}/ws`,
  clientId: "bc-bench-verify",
  clientType: "cli",
  localCredential: () => credential,
  connectTimeoutMs: 8000,
  reconnect: { enabled: false },
  webSocketFactory: (url, c) => new WebSocket(url, c?.protocols, { headers: c?.headers }),
});
await client.connect();

let failures = 0;
console.log(`home=${home} port=${port} speed=${speed}`);
for (const name of names) {
  const expected = expectedTimeline(readFileSync(join(fixturesDir, `${name}.jsonl`), "utf8"));
  const duration = expected.lines.at(-1)?.t ?? 0;
  const started = Date.now();
  let id = "";
  try {
    const workspace = benchWorkspace();
    id = paseo("run", "-d", "-q", "--provider", "bc-bench", ...(workspace ? ["--workspace", workspace] : ["--cwd", cwd]), "--title", `bench ${name}`, `fixture:${name} speed:${speed}`).split("\n").at(-1);
    const waitSeconds = Math.ceil(duration / 1000 / (speed === "max" ? 1000 : Number(speed))) + 60;
    paseo("wait", id, "--timeout", `${waitSeconds}s`);
    const elapsed = Date.now() - started;
    const timeline = await client.fetchAgentTimeline(id, { direction: "tail", limit: 0, projection: "projected" });
    const actual = timeline.entries.map((e) => e.item);
    const problems = [];
    if (actual.length !== expected.items.length) problems.push(`item count ${actual.length} != ${expected.items.length}`);
    const counts = (list) => list.reduce((m, i) => ((m[i.type] = (m[i.type] ?? 0) + 1), m), {});
    for (let i = 0; i < Math.min(actual.length, expected.items.length) && problems.length < 5; i++) {
      const problem = diffItem(expected.items[i], actual[i]);
      if (problem) problems.push(`#${i}: ${problem}`);
    }
    if (speed !== "max") {
      const target = duration / Number(speed);
      if (elapsed < target * 0.85) problems.push(`finished too fast: ${elapsed}ms < ${Math.round(target)}ms`);
    }
    const summary = JSON.stringify(counts(expected.items));
    if (problems.length === 0) console.log(`PASS ${name.padEnd(26)} items=${actual.length} ${summary} wall=${(elapsed / 1000).toFixed(1)}s (fixture ${(duration / 1000).toFixed(1)}s)`);
    else {
      failures++;
      console.log(`FAIL ${name.padEnd(26)} ${problems.join("; ")}`);
    }
  } catch (error) {
    failures++;
    console.log(`FAIL ${name.padEnd(26)} ${error instanceof Error ? error.message.split("\n")[0] : error}`);
  } finally {
    if (id && !keep) {
      try {
        paseo("delete", id);
      } catch {}
    }
  }
}
await client.close();
process.exit(failures ? 1 : 0);
