"""Builds docs/perf/index.html and its charts from one A/B run.

    python3 docs/perf/build.py <run-dir> <fork-commit>

<run-dir> holds the files `docs/bench/tools/recheck-ab.mjs` writes
(prab-<mode>-<fixture>-r<n>.json) next to the probe dumps they name, modes
`base` (upstream 42b61d8 plus probes) and `fork`. Every figure on the page is
the median of the runs of one build.
"""
import json
import math
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUN = Path(sys.argv[1])
FORK = sys.argv[2]

FIXTURES = [
    ("codeblock-streaming", "代码块流式"),
    ("diff-large", "大 diff"),
    ("history-100", "100 轮历史"),
    ("markdown-long", "长回复"),
    ("mixed-turn", "混合一轮"),
    ("reads-20", "读 20 个文件"),
    ("reasoning-long-prose", "思考散文"),
    ("reasoning-long-sections", "思考分节"),
    ("shell-log-large", "大段终端"),
    ("table-streaming", "表格流式"),
    ("tool-expanded-streaming", "展开的工具"),
]


def load():
    runs = {}
    for path in sorted(RUN.glob("prab-*.json")):
        result = json.loads(path.read_text())
        dump = json.loads((RUN / result["dumpFile"]).read_text())
        snap = dump["snapshot"]
        commits = snap.get("commitMs", {})
        busiest = max((c.get("p95", 0) for c in commits.values()), default=0)
        runs.setdefault((result["fixture"], result["mode"]), []).append(
            {
                "p95": busiest,
                "dropped": snap["frames"]["droppedRatio"],
                "longest": snap["frames"]["longestMs"],
                "longTasks": snap.get("longTasks", {}).get("count", 0),
                "loops": snap.get("animations", {}).get("mounted", 0),
                "renders": sum(snap.get("renders", {}).get("byKind", {}).values()),
                "heapEnd": result["heapEnd"],
                "heapRetained": result["heapRetained"],
            }
        )
    table = {}
    for (fixture, mode), rows in runs.items():
        table[(fixture, mode)] = {
            key: statistics.median(row[key] for row in rows) for key in rows[0]
        } | {"n": len(rows)}
    return table


DATA = load()


def cell(fixture, mode, key):
    return DATA[(fixture, mode)][key]


def change(before, after):
    """Percent saved; positive is better (smaller)."""
    if before == 0:
        return 0.0
    return (before - after) / before * 100


def ms(value):
    return f"{value:.1f}" if value < 100 else f"{value:.0f}"


def arrow_class(before, after, tolerance=0.0):
    if abs(before - after) <= tolerance:
        return "flat"
    return "up" if after < before else "down"


# --- Chart: busiest card p95, log scale -------------------------------------

FONT_CJK = "PingFang SC, Hiragino Sans GB, Noto Sans SC, sans-serif"
FONT_UI = "ui-sans-serif, system-ui, sans-serif"
GHOST, NOW, WORSE, MUTED, INK, GRID, BRASS = (
    "#e7cfc9", "#1e5c4e", "#a33b32", "#5c6e76", "#172226", "#d5e0e4", "#8a6a32",
)
X0, OCTAVE, FLOOR = 132, 53.95, 0.5  # 0.5 ms at the axis, 54 px per doubling


def x_of(value):
    return X0 + OCTAVE * (math.log2(max(value, FLOOR)) - math.log2(FLOOR))


def p95_chart():
    row_h, top = 34, 42
    bottom = top + row_h * len(FIXTURES)
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -8 848 {bottom + 40}" width="848" height="{bottom + 40}" role="img">',
        "<title>Web 生产构建，最忙卡片提交时间 p95，对数刻度。淡色横条是 Beautiful Chat，绿色是本仓库，虚线是 4 毫秒预算。</title>",
        "<style>\n.final { display: none; }\n@media (prefers-reduced-motion: reduce) {\n  .motion { display: none; }\n  .final { display: inline; }\n}\n</style>",
    ]
    for tick in (1, 4, 16, 64, 256):
        x = x_of(tick)
        if tick != 4:
            out.append(f'<line x1="{x:.1f}" y1="28" x2="{x:.1f}" y2="{bottom - 6}" stroke="{GRID}" stroke-width="1"/>')
        out.append(f'<text x="{x:.1f}" y="{bottom + 18}" text-anchor="middle" fill="{MUTED}" font-size="11" font-family="{FONT_UI}">{tick}ms</text>')
    budget = x_of(4)
    out.append(f'<line x1="{budget:.1f}" y1="14" x2="{budget:.1f}" y2="{bottom - 4}" stroke="{BRASS}" stroke-width="1" stroke-dasharray="2 3"/>')
    out.append(f'<text x="{budget:.1f}" y="12" text-anchor="middle" fill="{BRASS}" font-size="11" font-family="{FONT_CJK}">预算</text>')
    for index, (fixture, label) in enumerate(FIXTURES):
        before, after = cell(fixture, "base", "p95"), cell(fixture, "fork", "p95")
        y = top + row_h * index
        wb, wa = x_of(before) - X0, x_of(after) - X0
        tone = NOW if after <= before else WORSE
        out.append(f'<text x="120" y="{y + 10}" text-anchor="end" fill="{INK}" font-size="13" font-family="{FONT_CJK}">{label}</text>')
        out.append(f'<rect x="{X0}" y="{y}" width="{wb:.1f}" height="12" fill="{GHOST}"/>')
        out.append(
            f'<rect class="motion" x="{X0}" y="{y}" width="{wa:.1f}" height="12" fill="{tone}">'
            f'<animate attributeName="width" from="{wb:.1f}" to="{wa:.1f}" begin="{0.045 * index:.3f}s" dur="1.15s" '
            'fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.16 0.84 0.22 1"/></rect>'
        )
        out.append(f'<rect class="final" x="{X0}" y="{y}" width="{wa:.1f}" height="12" fill="{tone}"/>')
        pct = change(before, after)
        mark = (
            f'<polygon fill="{NOW}" points="770,{y + 1} 776,{y + 9} 764,{y + 9}"/>'
            if pct >= 0
            else f'<polygon fill="{WORSE}" points="764,{y + 1} 776,{y + 1} 770,{y + 9}"/>'
        )
        out.append(
            f'<text text-anchor="end" x="752" y="{y + 10}" fill="{MUTED}" font-size="12" font-family="{FONT_UI}">{ms(before)} → {ms(after)}</text>'
            f'{mark}<text x="780" y="{y + 10}" fill="{tone}" font-size="12" font-family="{FONT_UI}">{abs(pct):.0f}%</text>'
        )
    out.append("</svg>")
    return "\n".join(out) + "\n"


# --- Page --------------------------------------------------------------------


# Differences inside run-to-run noise read as equal: one 60 Hz frame, a tenth
# of a percentage point of dropped frames, and 1 MB of heap (the heap before
# each run drifts 102-106 MB across a session).
FRAME_EQUAL, DROPPED_EQUAL, HEAP_EQUAL = 17, 0.001, 1.0


def pair(before, after, fmt, cls):
    return f'<td class="num {cls}">{fmt(before)} → {fmt(after)}</td>'


def rows_p95():
    lines = []
    for fixture, label in FIXTURES:
        before, after = cell(fixture, "base", "p95"), cell(fixture, "fork", "p95")
        cls = arrow_class(before, after)
        over = ' class="over"' if after > 4 else ""
        lines.append(
            f'<tr{over}><td>{label}</td><td class="num before">{ms(before)}</td><td class="num after">{ms(after)}</td>'
            f'<td class="num {cls}">{abs(change(before, after)):.0f}%</td></tr>'
        )
    return "\n          ".join(lines)


def rows_frames():
    lines = []
    for fixture, label in FIXTURES:
        b, f = DATA[(fixture, "base")], DATA[(fixture, "fork")]
        lines.append(
            f"<tr><td>{label}</td>"
            + pair(b["dropped"] * 100, f["dropped"] * 100, lambda v: f"{v:.1f}%", arrow_class(b["dropped"], f["dropped"], DROPPED_EQUAL))
            + pair(b["longest"], f["longest"], lambda v: f"{v:.0f}", arrow_class(b["longest"], f["longest"], FRAME_EQUAL))
            + pair(b["longTasks"], f["longTasks"], lambda v: f"{v:.0f}", arrow_class(b["longTasks"], f["longTasks"]))
            + pair(b["loops"], f["loops"], lambda v: f"{v:.0f}", arrow_class(b["loops"], f["loops"]))
            + "</tr>"
        )
    return "\n          ".join(lines)


def rows_memory():
    lines = []
    for fixture, label in FIXTURES:
        b, f = DATA[(fixture, "base")], DATA[(fixture, "fork")]
        lines.append(
            f"<tr><td>{label}</td>"
            + pair(b["heapEnd"], f["heapEnd"], lambda v: f"{v:.1f}", arrow_class(b["heapEnd"], f["heapEnd"], HEAP_EQUAL))
            + pair(b["heapRetained"], f["heapRetained"], lambda v: f"{v:.1f}", arrow_class(b["heapRetained"], f["heapRetained"], HEAP_EQUAL))
            + pair(b["renders"], f["renders"], lambda v: f"{v:,.0f}", arrow_class(b["renders"], f["renders"]))
            + "</tr>"
        )
    return "\n          ".join(lines)


within = sum(1 for fixture, _ in FIXTURES if cell(fixture, "fork", "p95") <= 4)
faster = sum(1 for fixture, _ in FIXTURES if cell(fixture, "fork", "p95") < cell(fixture, "base", "p95"))
runs = min(DATA[(fixture, mode)]["n"] for fixture, _ in FIXTURES for mode in ("base", "fork"))

template = (HERE / "index.template.html").read_text()
page = (
    template.replace("{{FORK}}", FORK)
    .replace("{{RUNS}}", str(runs))
    .replace("{{WITHIN}}", str(within))
    .replace("{{FASTER}}", str(faster))
    .replace("{{COUNT}}", str(len(FIXTURES)))
    .replace("{{ROWS_P95}}", rows_p95())
    .replace("{{ROWS_FRAMES}}", rows_frames())
    .replace("{{ROWS_MEMORY}}", rows_memory())
)
(HERE / "index.html").write_text(page)
(HERE / "web-commit-p95.svg").write_text(p95_chart())
print(json.dumps({f"{fx}/{m}": v for (fx, m), v in sorted(DATA.items())}, ensure_ascii=False, indent=1))
