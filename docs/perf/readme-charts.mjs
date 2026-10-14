// Charts for README.md and README-zh.md, one English and one Chinese copy of each.
//   node docs/perf/readme-charts.mjs
// Reads the raw runs under docs/bench/native-vs-fork/raw and writes docs/perf/readme/*.svg:
//   web-cpu.<lang>.svg     Web main-thread task time, no plugin / Beautiful Chat 42b61d8 / Better Paseo
//   web-memory.<lang>.svg  JS heap and DOM nodes after a forced GC, the scenarios that differ most
//   ios-commit.<lang>.svg  iOS total row-render time (median of allRows.sum), no plugin / Beautiful Chat 42b61d8 / Better Paseo
// The iOS axis is clipped so no-plugin and Better Paseo stay readable. Beautiful Chat's
// multi-second totals, and a long reply, keep the real number as the bar label.
// Every figure is the median of the runs of one mode. The charts carry their own white card,
// so they stay legible on GitHub's dark theme.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, "../bench/native-vs-fork/raw");
const OUT = path.join(HERE, "readme");

const SCENARIOS = [
  ["codeblock-streaming", "Code block streaming", "代码块流式"],
  ["diff-large", "Large diff", "大 diff"],
  ["history-100", "100-turn history", "100 轮历史"],
  ["markdown-long", "Long reply", "长回复"],
  ["mixed-turn", "Mixed turn", "混合一轮"],
  ["reads-20", "20 file reads", "读 20 个文件"],
  ["reasoning-long-prose", "Reasoning, prose", "思考散文"],
  ["reasoning-long-sections", "Reasoning, sections", "思考分节"],
  ["shell-log-large", "Large shell log", "大段终端"],
  ["table-streaming", "Table streaming", "表格流式"],
  ["tool-expanded-streaming", "Expanded tool", "展开的工具"],
];
const MEMORY_SCENARIOS = ["diff-large", "history-100", "markdown-long", "reads-20", "shell-log-large", "tool-expanded-streaming"];
// Above this, an iOS bar is clipped and the label keeps the real total. 2,000 ms keeps
// every Better Paseo bar on scale (the long reply is 1,833 ms) and every no-plugin bar
// except the code block (2,301 ms) and the long reply (5,075 ms). Those two stay longer
// than the Better Paseo bar; the label is the real total.
const IOS_AXIS_MS = 2000;

const TEXT = {
  en: {
    font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    native: "No plugin (Paseo 0.11.2)",
    upstream: "Beautiful Chat 42b61d8",
    fork: "Better Paseo",
    vsNative: "vs no plugin",
    vsUpstream: "vs Beautiful Chat",
    even: "even",
    cpuTitle: "Web: main-thread time for a whole replay (seconds, lower is better)",
    cpuNote: "Web production build, same session, 3 runs per mode, median, 2026-10-14. Green ⬆ is better than the baseline, red ⬇ is worse.",
    memTitle: "Web: memory after a forced GC (lower is better)",
    memNote: "Same runs as the main-thread chart, 2026-10-14. DOM nodes on a log scale.",
    heap: "JS heap (MB)",
    dom: "DOM nodes",
    iosTitle: "iOS: total row-render time per replay (ms, lower is better)",
    iosNote: [
      "iOS 18.6 simulator, development build, cold start, median, 2026-10-14. 2 runs; 6 for history and the large shell log.",
      `Total row-render time. Bars past ${IOS_AXIS_MS.toLocaleString("en-US")} ms are clipped; the label is the real total. Green ⬆ better, red ⬇ worse.`,
    ],
  },
  zh: {
    font: "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
    native: "不开插件（Paseo 0.11.2）",
    upstream: "Beautiful Chat 42b61d8",
    fork: "Better Paseo",
    vsNative: "对比不开插件",
    vsUpstream: "对比 Beautiful Chat",
    even: "持平",
    cpuTitle: "Web：整段回放的主线程时间（秒，越短越好）",
    cpuNote: "Web 生产构建，同一次会话交替运行，每种模式 3 次取中位数，2026-10-14。绿色 ⬆ 表示比基线好，红色 ⬇ 表示比基线差。",
    memTitle: "Web：强制 GC 后的内存（越低越好）",
    memNote: "与主线程时间同一批跑次，2026-10-14。DOM 节点为对数刻度。",
    heap: "JS 堆（MB）",
    dom: "DOM 节点",
    iosTitle: "iOS：每次回放的行渲染总量（毫秒，越短越好）",
    iosNote: [
      "iOS 18.6 模拟器开发版，每次冷启动，中位数，2026-10-14。多数 2 次，100 轮历史和大段终端 6 次。",
      `行渲染总量。超过 ${IOS_AXIS_MS} ms 的条被截断，数字是真实总量。绿色 ⬆ 更好，红色 ⬇ 更差。`,
    ],
  },
};

const COLOUR = { native: "#9fadb3", upstream: "#d99a2b", fork: "#1e6b57" };
const INK = "#1f2a2e";
const MUTED = "#61727a";
const GRID = "#e3eaed";
const GOOD = "#1e6b57";
const BAD = "#b0392f";

// File names are <platform>-<mode>-<fixture>-r<rep>.json. Several directories may be
// given: a fixture found in a later one replaces the earlier runs of that fixture.
function load(dirs) {
  let runs = [];
  for (const dir of dirs) {
    const next = readdirSync(path.join(RAW, dir))
      .filter((file) => file.endsWith(".json"))
      .map((file) => {
        const [, mode, ...rest] = file.replace(/\.json$/, "").split("-");
        rest.pop();
        return { mode, fixture: rest.join("-"), data: JSON.parse(readFileSync(path.join(RAW, dir, file), "utf8")) };
      });
    const replaced = new Set(next.map((run) => run.fixture));
    runs = [...runs.filter((run) => !replaced.has(run.fixture)), ...next];
  }
  return (fixture, mode, get) => {
    const values = runs.filter((run) => run.fixture === fixture && run.mode === mode).map((run) => get(run.data)).sort((a, b) => a - b);
    if (values.length === 0) throw new Error(`no runs for ${mode} ${fixture}`);
    const mid = Math.floor(values.length / 2);
    return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  };
}

const web = load(["web-2026-10-14"]);
const ios = load(["ios-2026-10-14"]);
const task = (run) => run.cdp.delta.TaskDuration;
const heap = (run) => run.cdp.jsHeapUsedMB;
const nodes = (run) => run.cdp.nodes;
const rowSum = (run) => (run.probe ?? run).allRows.sum;

const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const textEl = (x, y, content, { size = 12, fill = INK, anchor = "start", weight = 400, font }) =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" fill="${fill}" font-size="${size}" font-weight="${weight}" font-family="${font}">${escape(content)}</text>`;
const rect = (x, y, w, h, fill) => `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(w, 1).toFixed(1)}" height="${h}" rx="2" fill="${fill}"/>`;

function card(width, height, body, title) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">`,
    `<title>${escape(title)}</title>`,
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="#ffffff" stroke="#d8e1e5"/>`,
    ...body,
    "</svg>",
    "",
  ].join("\n");
}

function legend(x, y, entries, font) {
  const parts = [];
  let cursor = x;
  for (const [mode, label] of entries) {
    parts.push(rect(cursor, y - 9, 12, 10, COLOUR[mode]));
    parts.push(textEl(cursor + 18, y, label, { size: 12, fill: INK, font }));
    cursor += 30 + label.length * (/[一-鿿]/.test(label) ? 12 : 6.6);
  }
  return parts;
}

// The saving against a baseline, as the docs count it: under a tenth, or a whole replay
// under half a second on both sides, is even. A green up-arrow is a saving, a red
// down-arrow a regression.
function delta(base, fork, t, { floor = 0 } = {}) {
  const change = (base - fork) / base;
  if (Math.abs(change) < 0.1 || Math.max(base, fork) < floor) return { label: t.even, fill: MUTED, arrow: null };
  const label = `${Math.round(Math.abs(change) * 100)}%`;
  return change > 0 ? { label, fill: GOOD, arrow: "up" } : { label, fill: BAD, arrow: "down" };
}

// A solid arrow with a shaft, 11 wide and 13 tall, its box's top-left at (x, y):
// up for a saving, down for a regression. The README tables use the same shape.
function arrowPath(direction, x, y) {
  const up = [[5.5, 0], [11, 6.5], [7.5, 6.5], [7.5, 13], [3.5, 13], [3.5, 6.5], [0, 6.5]];
  const points = direction === "up" ? up : up.map(([px, py]) => [px, 13 - py]);
  return `M${points.map(([px, py]) => `${(x + px).toFixed(1)},${(y + py).toFixed(1)}`).join(" L")} Z`;
}

// The delta in a column ending at `x`: the arrow at a fixed place, a 6pt gap, then the
// percentage, so every row keeps the same gap. "Even" carries no arrow.
function deltaEl(x, baseline, d, font) {
  const left = x - 50;
  if (!d.arrow) return textEl(left, baseline, d.label, { size: 12.5, fill: d.fill, weight: 600, font });
  return [
    `<path fill="${d.fill}" d="${arrowPath(d.arrow, left, baseline - 11)}"/>`,
    textEl(left + 17, baseline, d.label, { size: 12.5, fill: d.fill, weight: 600, font }),
  ].join("");
}

function groupedChart({ t, lang, modes, get, max, ticks, unit, digits, title, note, deltas, floor, bar = 8 }) {
  const WIDTH = 900;
  const LABEL = 170;
  const X0 = 180;
  const PLOT = deltas.length === 2 ? 470 : 560;
  const ROW = modes.length * (bar + 2) + 14;
  const noteLines = Array.isArray(note) ? note : [note];
  const legendY = 58 + noteLines.length * 16;
  const TOP = legendY + 14;
  const height = TOP + SCENARIOS.length * ROW + 40;
  const x = (v) => X0 + (Math.min(v, max) / max) * PLOT;
  const font = t.font;
  const body = [
    textEl(24, 32, title, { size: 15, weight: 600, font }),
    ...noteLines.map((line, index) => textEl(24, 52 + index * 16, line, { size: 11.5, fill: MUTED, font })),
    ...legend(24, legendY, modes.map((mode) => [mode, t[mode]]), font),
  ];
  const columns = deltas.map((_, index) => WIDTH - 24 - (deltas.length - 1 - index) * 116);
  deltas.forEach(([, label], index) => body.push(textEl(columns[index], legendY, label, { size: 11, fill: MUTED, anchor: "end", font })));
  const bottom = TOP + SCENARIOS.length * ROW - 6;
  for (const tick of ticks) {
    body.push(`<line x1="${x(tick).toFixed(1)}" y1="${TOP - 6}" x2="${x(tick).toFixed(1)}" y2="${bottom}" stroke="${GRID}" stroke-width="1"/>`);
    body.push(textEl(x(tick), bottom + 18, `${tick}${unit}`, { size: 11, fill: MUTED, anchor: "middle", font }));
  }
  const rows = [];
  SCENARIOS.forEach(([fixture, en, zh], index) => {
    const top = TOP + index * ROW;
    const values = Object.fromEntries(modes.map((mode) => [mode, get(fixture, mode)]));
    const middle = top + (modes.length * (bar + 2) - 2) / 2;
    body.push(textEl(LABEL, middle + 4.5, lang === "zh" ? zh : en, { size: 12.5, anchor: "end", font }));
    modes.forEach((mode, slot) => {
      const y = top + slot * (bar + 2);
      const value = values[mode];
      body.push(rect(X0, y, x(value) - X0, bar, COLOUR[mode]));
      const isFork = mode === "fork";
      body.push(textEl(x(value) + 5, y + bar - 0.5, value.toFixed(digits), { size: isFork ? 10.5 : 10, fill: isFork ? COLOUR.fork : MUTED, weight: isFork ? 600 : 400, font }));
    });
    deltas.forEach(([base], col) => {
      const d = delta(values[base], values.fork, t, { floor });
      body.push(deltaEl(columns[col], middle + 4.5, d, font));
    });
    rows.push([fixture, ...modes.map((mode) => values[mode].toFixed(digits))].join("\t"));
  });
  return { svg: card(WIDTH, height, body, title), rows };
}

function memoryChart(t) {
  const WIDTH = 900;
  const font = t.font;
  const modes = ["native", "upstream", "fork"];
  const bar = 8;
  const ROW = modes.length * (bar + 2) + 14;
  const TOP = 104;
  const height = TOP + MEMORY_SCENARIOS.length * ROW + 40;
  const LABEL = 170;
  const panels = [
    { x0: 180, width: 300, title: t.heap, get: heap, scale: (v) => v / 300, ticks: [0, 100, 200, 300], tick: (v) => `${v}`, fmt: (v) => v.toFixed(0) },
    {
      x0: 560,
      width: 300,
      title: t.dom,
      get: nodes,
      scale: (v) => (Math.log10(v) - Math.log10(500)) / (Math.log10(100000) - Math.log10(500)),
      ticks: [1000, 10000, 100000],
      tick: (v) => (v >= 1000 ? `${v / 1000}k` : `${v}`),
      fmt: (v) => Math.round(v).toLocaleString("en-US"),
    },
  ];
  const body = [
    textEl(24, 32, t.memTitle, { size: 15, weight: 600, font }),
    textEl(24, 52, t.memNote, { size: 11.5, fill: MUTED, font }),
    ...legend(24, 74, modes.map((mode) => [mode, t[mode]]), font),
  ];
  const bottom = TOP + MEMORY_SCENARIOS.length * ROW - 6;
  for (const panel of panels) {
    body.push(textEl(panel.x0, TOP - 12, panel.title, { size: 12, weight: 600, fill: INK, font }));
    for (const tick of panel.ticks) {
      const tx = panel.x0 + panel.scale(tick) * panel.width;
      body.push(`<line x1="${tx.toFixed(1)}" y1="${TOP - 6}" x2="${tx.toFixed(1)}" y2="${bottom}" stroke="${GRID}" stroke-width="1"/>`);
      body.push(textEl(tx, bottom + 18, panel.tick(tick), { size: 11, fill: MUTED, anchor: "middle", font }));
    }
  }
  const rows = [];
  MEMORY_SCENARIOS.forEach((fixture, index) => {
    const [, en, zh] = SCENARIOS.find(([id]) => id === fixture);
    const top = TOP + index * ROW;
    const middle = top + (modes.length * (bar + 2) - 2) / 2;
    body.push(textEl(LABEL, middle + 4.5, t === TEXT.zh ? zh : en, { size: 12.5, anchor: "end", font }));
    const line = [fixture];
    for (const panel of panels) {
      modes.forEach((mode, slot) => {
        const y = top + slot * (bar + 2);
        const value = web(fixture, mode, panel.get);
        const w = Math.max(0, Math.min(1, panel.scale(value))) * panel.width;
        body.push(rect(panel.x0, y, w, bar, COLOUR[mode]));
        const isFork = mode === "fork";
        body.push(textEl(panel.x0 + w + 5, y + bar - 0.5, panel.fmt(value), { size: isFork ? 10.5 : 10, fill: isFork ? COLOUR.fork : MUTED, weight: isFork ? 600 : 400, font }));
        line.push(panel.fmt(value));
      });
    }
    rows.push(line.join("\t"));
  });
  return { svg: card(WIDTH, height, body, t.memTitle), rows };
}

mkdirSync(OUT, { recursive: true });
// The arrows the README tables put before a percentage.
for (const [direction, fill] of [["up", GOOD], ["down", BAD]]) {
  writeFileSync(
    path.join(OUT, `arrow-${direction}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 11 13" width="11" height="13"><path fill="${fill}" d="${arrowPath(direction, 0, 0)}"/></svg>\n`,
  );
}
for (const lang of ["en", "zh"]) {
  const t = TEXT[lang];
  const charts = {
    "web-cpu": groupedChart({
      t,
      lang,
      modes: ["native", "upstream", "fork"],
      get: (fixture, mode) => web(fixture, mode, task),
      max: 9,
      ticks: [0, 3, 6, 9],
      unit: "s",
      digits: 2,
      title: t.cpuTitle,
      note: t.cpuNote,
      deltas: [["native", t.vsNative], ["upstream", t.vsUpstream]],
      floor: 0.5,
    }),
    "web-memory": memoryChart(t),
    "ios-commit": groupedChart({
      t,
      lang,
      modes: ["native", "upstream", "fork"],
      get: (fixture, mode) => ios(fixture, mode, rowSum),
      max: IOS_AXIS_MS,
      ticks: [0, 500, 1000, 1500, IOS_AXIS_MS],
      unit: "ms",
      digits: 1,
      title: t.iosTitle,
      note: t.iosNote,
      deltas: [["native", t.vsNative], ["upstream", t.vsUpstream]],
      // Millisecond totals: only the 10% clause. The Web chart's half-second floor stays off.
    }),
  };
  for (const [name, chart] of Object.entries(charts)) {
    writeFileSync(path.join(OUT, `${name}.${lang}.svg`), chart.svg);
    if (lang === "en") console.log(`# ${name}\n${chart.rows.join("\n")}`);
  }
}
