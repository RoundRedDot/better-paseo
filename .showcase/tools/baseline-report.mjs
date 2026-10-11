// Aggregates replay runs into median tables.
//   node .showcase/tools/baseline-report.mjs <rawDir> > tables.md
// Expects <rawDir>/<fixture>.<current|cached>.run<N>.snapshot.json.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2]);
const groups = new Map(); // fixture -> host -> runs[]
for (const file of readdirSync(dir)) {
  const match = /^(.+)\.(current|cached)\.run\d+\.snapshot\.json$/.exec(file);
  if (!match) continue;
  const [, fixture, host] = match;
  const byHost = groups.get(fixture) ?? new Map();
  groups.set(fixture, byHost);
  byHost.set(host, [...(byHost.get(host) ?? []), JSON.parse(readFileSync(path.join(dir, file), "utf8"))]);
}

const median = (values) => {
  const nums = values.filter((v) => typeof v === "number").sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
};
const med = (runs, pick) => median(runs.map(pick));
const fmt = (v, digits = 1) =>
  v === null || v === undefined ? "n/m" : Number.isInteger(v) ? String(v) : v.toFixed(digits);
const sum = (obj) => Object.values(obj ?? {}).reduce((a, b) => a + b, 0);
const kindCount = (runs, kind) => med(runs, (r) => r.settled.renders.byKind[kind] ?? 0);
const inactive = (runs) => med(runs, (r) => sum(Object.fromEntries(Object.entries(r.hostRowsStreaming).map(([k, v]) => [k, v.inactive]))));
const active = (runs) => med(runs, (r) => sum(Object.fromEntries(Object.entries(r.hostRowsStreaming).map(([k, v]) => [k, v.active]))));
const mb = (v) => (v === null ? null : v / 1048576);

function busiestKind(runs) {
  const counts = {};
  for (const r of runs)
    for (const [k, s] of Object.entries(r.settled.commitMs)) counts[k] = (counts[k] ?? 0) + s.count;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
const commit = (runs, field) => {
  const kind = busiestKind(runs);
  return kind ? med(runs, (r) => r.settled.commitMs[kind]?.[field]) : null;
};

const names = [...groups.keys()].sort();
const pair = (fixture, fn, digits) => {
  const h = groups.get(fixture);
  const cur = h.get("current");
  const cac = h.get("cached");
  return `${cur ? fmt(fn(cur), digits) : "n/m"} / ${cac ? fmt(fn(cac), digits) : "n/m"}`;
};
const table = (title, headers, rows) => {
  console.log(`\n### ${title}\n`);
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`|${headers.map((_, i) => (i === 0 ? " --- " : " ---: ")).join("|")}|`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
};

const first = (fixture) => [...groups.get(fixture).values()][0][0];
console.log("Cells read `current / cached` (host mode), each a median of 3 runs.");

table(
  "Render counts (whole run: stream + completion + 600 ms settle)",
  ["fixture", "speed", "events", "rows", "user_message", "assistant", "reasoning", "tool_call", "todo", "non-active row renders", "active row renders"],
  names.map((n) => [
    n, String(first(n).speed), String(first(n).events), String(first(n).rows),
    pair(n, (r) => kindCount(r, "user_message")),
    pair(n, (r) => kindCount(r, "assistant")),
    pair(n, (r) => kindCount(r, "reasoning")),
    pair(n, (r) => kindCount(r, "tool_call")),
    pair(n, (r) => kindCount(r, "todo")),
    pair(n, inactive),
    pair(n, active),
  ]),
);

table(
  "Commit time and stream wall time (ms)",
  ["fixture", "busiest kind", "commit p50", "commit p95", "commit max", "stream ms", "harness transform ms"],
  names.map((n) => [
    n,
    busiestKind(first(n) ? [...groups.get(n).values()].flat() : []) ?? "-",
    pair(n, (r) => commit(r, "p50"), 2),
    pair(n, (r) => commit(r, "p95"), 2),
    pair(n, (r) => commit(r, "max"), 2),
    pair(n, (r) => med(r, (x) => x.streamMs), 0),
    pair(n, (r) => med(r, (x) => x.harnessTransform.totalMs), 1),
  ]),
);

table(
  "Markdown, layout and RPC",
  ["fixture", "md parses", "md parse total ms", "block kind flips", "height decreases", "of which streaming", "highlight RPC", "anim peak", "anim at end"],
  names.map((n) => [
    n,
    pair(n, (r) => med(r, (x) => x.settled.markdown.parses)),
    pair(n, (r) => med(r, (x) => x.settled.markdown.parseMs.total), 2),
    pair(n, (r) => med(r, (x) => x.settled.markdown.formatFlips)),
    pair(n, (r) => med(r, (x) => x.settled.heightDecreases.count)),
    pair(n, (r) => med(r, (x) => x.settled.heightDecreases.whileStreaming)),
    pair(n, (r) => med(r, (x) => x.settled.highlightRpc.count)),
    pair(n, (r) => med(r, (x) => x.settled.animations.peak)),
    pair(n, (r) => med(r, (x) => x.idle.animations.mounted)),
  ]),
);

table(
  "Frames, long tasks, layout shift, heap",
  ["fixture", "dropped-frame ratio", "longest frame ms", "long tasks", "layout shift", "heap before MB", "heap after MB"],
  names.map((n) => [
    n,
    pair(n, (r) => med(r, (x) => x.settled.frames.droppedRatio), 3),
    pair(n, (r) => med(r, (x) => x.settled.frames.longestMs), 0),
    pair(n, (r) => med(r, (x) => x.settled.longTasks.count)),
    pair(n, (r) => med(r, (x) => x.settled.layoutShifts.total), 4),
    pair(n, (r) => mb(med(r, (x) => x.heapBefore)), 1),
    pair(n, (r) => mb(med(r, (x) => x.heapAfter)), 1),
  ]),
);

table(
  "Idle window after settle (1.5 s, nothing streaming)",
  ["fixture", "animations mounted", "frames", "long tasks"],
  names.map((n) => [
    n,
    pair(n, (r) => med(r, (x) => x.idle.animations.mounted)),
    pair(n, (r) => med(r, (x) => x.idle.frames.count)),
    pair(n, (r) => med(r, (x) => x.idle.longTasks.count)),
  ]),
);

// Per-kind commit detail.
const kinds = ["user_message", "assistant", "reasoning", "tool_call", "todo"];
const rows = [];
for (const n of names) {
  for (const host of ["current", "cached"]) {
    const runs = groups.get(n).get(host);
    if (!runs) continue;
    const cells = kinds.map((k) => {
      const p50 = med(runs, (r) => r.settled.commitMs[k]?.p50);
      const p95 = med(runs, (r) => r.settled.commitMs[k]?.p95);
      return p50 === null ? "-" : `${fmt(p50, 2)} / ${fmt(p95, 2)}`;
    });
    rows.push([n, host, ...cells]);
  }
}
table("Commit time per kind, p50 / p95 ms", ["fixture", "host", ...kinds], rows);

const errors = [];
for (const [n, h] of groups)
  for (const [host, runs] of h)
    for (const r of runs) if (r.error || r.errors?.length || r.consoleErrors?.length) errors.push(`${n} ${host} run ${r.run}`);
console.log(`\nRuns with page or console errors: ${errors.length ? errors.join(", ") : "none"}.`);
