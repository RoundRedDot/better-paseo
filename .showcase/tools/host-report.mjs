// Tables for docs/bench/baseline-host.md from /bc-perf dumps (docs/bench/raw-host)
// next to the offline medians (docs/bench/raw).
//   node .showcase/tools/host-report.mjs [platform=ios]
import { readdirSync, readFileSync } from "node:fs";
const platform = process.argv[2] ?? "ios";
const hostDir = "docs/bench/raw-host/";
const offDir = "docs/bench/raw/";
const dumps = new Map();
for (const f of readdirSync(hostDir).filter((x) => x.startsWith(`${platform}-`) && x.endsWith(".json"))) {
  const m = new RegExp(`^${platform}-(.+)-\\d{4}-\\d\\d-\\d\\dT[\\d-]+Z\\.json$`).exec(f);
  if (m) dumps.set(m[1], JSON.parse(readFileSync(hostDir + f, "utf8"))); // later files overwrite
}
const median = (v) => { const n = v.filter((x) => typeof x === "number").sort((a, b) => a - b); if (!n.length) return null; const i = n.length >> 1; return n.length % 2 ? n[i] : (n[i - 1] + n[i]) / 2; };
const fmt = (v, d = 1) => (v === null || v === undefined ? "n/m" : Number.isInteger(v) ? String(v) : v.toFixed(d));
const offline = (fixture, host) => {
  const runs = readdirSync(offDir).filter((f) => f.startsWith(`${fixture}.${host}.run`)).map((f) => JSON.parse(readFileSync(offDir + f, "utf8")));
  return runs.length ? runs : null;
};
const offKind = (fixture, host, kind) => { const r = offline(fixture, host); return r ? median(r.map((x) => x.settled.renders.byKind[kind] ?? 0)) : null; };
const table = (title, headers, rows) => {
  console.log(`\n### ${title}\n`);
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`|${headers.map((_, i) => (i === 0 ? " --- " : " ---: ")).join("|")}|`);
  for (const r of rows) console.log(`| ${r.join(" | ")} |`);
};
const names = [...dumps.keys()].sort();
const kinds = ["user_message", "assistant", "reasoning", "tool_call", "todo"];
const busiest = (s) => Object.entries(s.commitMs).sort((a, b) => b[1].count - a[1].count)[0]?.[0] ?? null;
const speed = (n) => (n === "history-100" ? "max" : n === "tool-expanded-streaming" ? "4" : "1");

table(`Render counts, ${platform} (1 run)`, ["fixture", "speed", ...kinds],
  names.map((n) => [n, speed(n), ...kinds.map((k) => fmt(dumps.get(n).snapshot.renders.byKind[k] ?? 0))]));

table("User-message renders: real host vs offline replay (the card that never changes)",
  ["fixture", "real host", "offline current", "offline cached", "stream events"],
  names.map((n) => { const off = offline(n, "current"); return [n, fmt(dumps.get(n).snapshot.renders.byKind.user_message ?? 0), fmt(offKind(n, "current", "user_message")), fmt(offKind(n, "cached", "user_message")), off ? String(off[0].events) : "n/m"]; }));

table("Commit time (ms) and Markdown", ["fixture", "busiest kind", "commit p50", "commit p95", "commit max", "md parses", "md parse total ms", "block kind flips", "height decreases", "highlight RPC"],
  names.map((n) => { const s = dumps.get(n).snapshot, k = busiest(s), c = k ? s.commitMs[k] : null; return [n, k ?? "-", fmt(c?.p50, 1), fmt(c?.p95, 1), fmt(c?.max, 1), fmt(s.markdown.parses), fmt(s.markdown.parseMs.total, 1), fmt(s.markdown.formatFlips), fmt(s.heightDecreases.count), fmt(s.highlightRpc.count)]; }));

table("Commit time per kind, p50 / p95 ms: real host vs offline (current / cached)", ["fixture", "kind", "real host", "offline current", "offline cached"],
  names.flatMap((n) => { const s = dumps.get(n).snapshot; return Object.keys(s.commitMs).map((k) => {
    const off = (h) => { const r = offline(n, h); if (!r) return "n/m"; const p50 = median(r.map((x) => x.settled.commitMs[k]?.p50)), p95 = median(r.map((x) => x.settled.commitMs[k]?.p95)); return p50 === null ? "-" : `${fmt(p50, 1)} / ${fmt(p95, 1)}`; };
    return [n, k, `${fmt(s.commitMs[k].p50, 1)} / ${fmt(s.commitMs[k].p95, 1)}`, off("current"), off("cached")]; }); }));

table("Animations, frames", ["fixture", "anim peak", "anim mounted at dump", "frames", "dropped ratio", "longest frame ms", "long tasks", "layout shift", "JS heap"],
  names.map((n) => { const s = dumps.get(n).snapshot; return [n, fmt(s.animations.peak), fmt(s.animations.mounted), fmt(s.frames.count), fmt(s.frames.droppedRatio, 3), fmt(s.frames.longestMs, 0), s.longTasks.count ? fmt(s.longTasks.count) : "n/m", s.layoutShifts.count ? fmt(s.layoutShifts.total, 3) : "n/m", dumps.get(n).heapBytes == null ? "n/m" : (dumps.get(n).heapBytes / 1048576).toFixed(1) + " MB"]; }));
