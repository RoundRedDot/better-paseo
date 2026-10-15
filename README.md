# Better Paseo

**English** | [简体中文](README-zh.md)

A [Paseo](https://paseo.sh) plugin that redraws the chat timeline of every agent Paseo runs,
whichever provider is behind it (Claude Code, Codex, Oh My Pi and the rest): tool calls, reasoning,
replies, prompts, checklists and errors become compact, typed, syntax-aware rows that follow the
active Paseo theme, and on the Web production build the whole timeline renders faster
than Paseo does on its own.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/hero-devices-dark.png">
  <img alt="Better Paseo on desktop and on a phone: a hover preview of a collapsed read, reasoning, shell, read, edit diff, MCP, checklist, Paseo and hub calls, a background job and the reply" src="images/hero-devices-light.png">
</picture>

> Better Paseo is a fork of [ABorakati/beautiful-chat](https://github.com/ABorakati/beautiful-chat),
> continued from `42b61d8` (2026-09-23). It keeps Beautiful Chat's cards except the Eval, Ask,
> Task and approval cards, which current Paseo never feeds a plugin (see
> [Compatibility](#compatibility)). This README describes what the fork adds and how it performs.

## Highlights

- **Faster than no plugin at all.** On the Web production build, 10 of the 11 replay scenarios
  use less main-thread time than Paseo's own timeline, by 14–38%; the large diff is even. All 11
  use 12–91% less than Beautiful Chat. [Charts below](#performance).
- **Memory close to no plugin.** On the Web production build, after a forced GC, the JS heap
  differs from no plugin by −1.4 to +4.0 MB, and a long reply uses 40.8 MB less. Beautiful Chat
  reaches 213.6–242.6 MB on the large diff, the 100-turn history and 20 file reads.
  [Memory comparison below](#memory-comparison).
- **One row per tool call.** Calls start collapsed to a 26pt row with a typed summary, open on a
  press, and stay open or closed across completion, history and remounts.
- **Streaming that does not jump.** Replies are parsed block by block; a half-written code fence
  or table never flips format, and the layout shift of a long streaming reply is 0.
- **Previews without opening.** Hover a collapsed row or a path on desktop, or long-press a
  collapsed row on a phone, to read its content in a scrollable panel. Images open in a full-screen viewer.
- **Follows Paseo.** Fonts, sizes and colours follow the host by default; settings are stored on
  the daemon and shared by desktop, web, iOS and Android. The settings page is in English and
  Simplified Chinese.

## Install

```bash
paseo plugin install RoundRedDot/better-paseo
```

Paseo `>=0.8.0` is required; the plugin is developed and measured against Paseo 0.11.2. On Paseo
0.8–0.10 it works with some compatibility issues, listed under [Compatibility](#compatibility).
Open **Settings → Plugins → Better Paseo** to configure it. Paseo installs plugins from GitHub, so pull a
new version with:

```bash
paseo plugin update better-paseo
```

---

## Performance

Three configurations are compared: **no plugin** (Paseo 0.11.2 draws the timeline), **Beautiful
Chat** `42b61d8`, and **Better Paseo**. The same host probe wraps each timeline row, so native and
plugin rows use the same measurement boundary. Measurements ran on 2026-10-15 on rrd-mac-studio
(Apple M5 Max, 18 cores, 64 GB, macOS 27.0.1), across 11 scripted scenarios. The source matrix
contains 132 Web runs and 120 iOS runs; each displayed Web value is a median of 3 runs, and iOS
values are medians of 2 runs except 6 each for 100-turn history and large shell log. Only results
from this round are comparable. Details and raw reports are in the [benchmark
report](docs/bench/native-vs-fork/README.md).

![Web main-thread time per scenario: no plugin, Beautiful Chat and Better Paseo](docs/perf/readme/web-cpu.en.svg)

The chart shows whole-replay main-thread Task time. Against no plugin, Better Paseo is shorter in 9
of 11 scenarios; 100-turn history is 15% longer (0.854 s vs 0.745 s), while the large diff is even
because both whole replays are under 0.5 s (0.42 s vs 0.35 s). Against Beautiful Chat, 10 scenarios
are shorter and table streaming is even (1.96 s vs 2.17 s, under 10%).

The primary render metric is total row-render work, allRows.sum for one replay. Lower is better.
Per-commit p95 depends on how rows are batched into commits and is not a measure of total work.

| Scenario | No plugin | Beautiful Chat | Better Paseo | vs no plugin | vs Beautiful Chat |
| --- | ---: | ---: | ---: | :--- | :--- |
| Code block streaming | 1,284.0 | 1,304.1 | **280.5** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;78% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;78% |
| Large diff | 33.6 | 562.9 | **21.0** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;38% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;96% |
| 100-turn history | 155.7 | 4,454.5 | **218.9** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;41% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;95% |
| Long reply | 2,044.0 | 3,241.1 | **457.6** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;78% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;86% |
| Mixed turn | 220.7 | 577.0 | **97.8** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;56% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;83% |
| 20 file reads | 148.1 | 957.1 | **109.6** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;26% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;89% |
| Reasoning, prose | 550.5 | 1,031.4 | **154.0** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;72% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;85% |
| Reasoning, sections | 496.2 | 1,342.8 | **135.1** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;73% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;90% |
| Large shell log | 38.5 | 266.9 | **19.5** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;49% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;93% |
| Table streaming | 1,134.0 | 416.8 | **263.9** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;77% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;37% |
| Expanded tool | 60.3 | 932.2 | **109.1** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;81% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;88% |

Against no plugin, Better Paseo has lower total row-render work in 9 scenarios and higher totals for
100-turn history (+41%) and the expanded tool (+81%). Against Beautiful Chat, totals are lower in
all 11 scenarios.

Cumulative layout shift while streaming (lower is better):

| Scenario | No plugin | Beautiful Chat | Better Paseo | vs no plugin | vs Beautiful Chat |
| --- | ---: | ---: | ---: | :--- | :--- |
| Long reply | 0.181 | 0.648 | **0** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;100% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;100% |
| Code block | 0.043 | 0.127 | **0.012** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;73% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;91% |
| Table | 0.051 | 0.040 | **0.011** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;79% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;73% |
| 100-turn history | 0 | 0.208 | **0** | even | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;100% |

### iOS

![iOS total row-render time per replay: no plugin, Beautiful Chat and Better Paseo](docs/perf/readme/ios-commit.en.svg)

The chart and table use total row-render work (allRows.sum) per replay, in milliseconds. The iOS
simulator runs used a development build with a cold start before each run. Most scenario/mode cells
have 2 runs; 100-turn history and large shell log have 6. The 100-turn history set includes
parallel-simulator load exposure: total row work shifted about 3% upward in every mode, so treat its
small differences cautiously. The benchmark report describes the exposure and sample ranges.

A difference under 10% is even. Against no plugin, Better Paseo is lower in 5 scenarios, even in 2
(large diff and 100-turn history), and higher in 4 (20 file reads, both reasoning replays and the
expanded tool). Against Beautiful Chat it is lower in all 11. Per-commit p95 is omitted here because
commit sizes differ; it is not a total-work metric.

| Scenario | No plugin | Beautiful Chat | Better Paseo | vs no plugin | vs Beautiful Chat |
| --- | ---: | ---: | ---: | :--- | :--- |
| Code block streaming | 2,264.5 | 4,503.2 | **709.6** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;69% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;84% |
| Large diff | 58.2 | 5,562.7 | **46.2** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;21% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;99% |
| 100-turn history | 191.9 | 224.6 | **202.1** | even | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;10% |
| Long reply | 5,076.6 | 13,397.1 | **1,510.0** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;70% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;89% |
| Mixed turn | 282.9 | 624.8 | **247.2** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;13% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;60% |
| 20 file reads | 276.1 | 2,622.2 | **305.8** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;11% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;88% |
| Reasoning, prose | 262.4 | 1,465.5 | **321.3** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;22% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;78% |
| Reasoning, sections | 244.5 | 2,438.8 | **283.5** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;16% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;88% |
| Large shell log | 48.1 | 362.8 | **45.1** | even | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;88% |
| Table streaming | 972.1 | 1,164.0 | **563.0** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;42% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;52% |
| Expanded tool | 165.8 | 3,032.6 | **256.6** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;55% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;92% |

<img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp; Green means lower/better; <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp; red means higher/worse. A difference under 10% is even. The additional under-0.5-second rule applies only when comparing whole Web Task replays; iOS uses the 10% rule.

**How it was measured.** A measurement-only patch to Paseo 0.11.2 (`759532509`,
`docs/bench/native-vs-fork/tools/paseo-host-probe.patch`) wraps every timeline row in the same
`React.Profiler`. Web used an instrumented production export (main JS sha256 prefix
`9dd7eab4521434bc`) in headless Chrome 155.0.8059.40 at 1280×900; Playwright reads Chrome DevTools
Protocol metrics around each replay and forces a GC before memory is read. iOS is an iOS 18.6
simulator running the development build `sh.paseo.debug`, cold-launched before every run. Better
Paseo was commit `37bfb60`. Each mode ran against a private daemon with default plugin settings, in
rotating order, and every run asserted which build was on screen. Web: 11 fixtures × 3 modes × 3
runs with 0 page errors. Part of the iOS runs used three simulators at once; the benchmark report
lists which, and the ~3% upward shift that load caused on the 100-turn history. Method, tools and
raw runs: [`docs/bench/native-vs-fork`](docs/bench/native-vs-fork/README.md) (`raw/web-2026-10-15b`,
`raw/ios-2026-10-15b`). Every difference from Beautiful Chat:
[`docs/fork-vs-upstream.md`](docs/fork-vs-upstream.md) (Chinese). The charts are generated from
these runs by `node docs/perf/readme-charts.mjs`; percentages are taken from the medians before
rounding.

### Where the time goes

- **Cards that did not change stop rendering.** Paseo hands every row new `theme` and `data`
  objects on each streamed chunk. Semantic `React.memo` comparisons let unchanged cards skip the
  render; only the newest prompt follows the agent's status. In the 100-turn replay whole-page
  renders fell from 172,327 to 1,319.
- **Replies are parsed incrementally.** `marked` with `remend` lexes block by block; each reply
  caches its finished blocks and repairs only the block still growing. Format flips and height
  regressions while streaming are 0 offline, on Web and on iOS.
- **Code is highlighted once, and only when it is complete.** An unclosed code block requests no
  highlighting; Shiki runs on the daemon (`highlight.tokens`). Collapsed rows do not mount their
  body, so 20 file reads make 0 highlight requests instead of 48.
- **Large output arrives in batches.** Code and terminal panels draw 400 lines, then add the rest in
  batches with a **Show all** control. A 5,000-line diff on iOS went from 2.2 s to 19.8 ms (tool
card
  p50).
- **No decorative loops.** Shadows, frosted glass, glow and breathing animations are gone. Only the
  running dot remains; on Web it is a CSS animation, so it no longer commits its row every frame
  (row commits in a mixed turn: 1,518 → 196). Reduced Motion stills it.
- **No late growth.** A reply that is not revealed word by word draws its text in the same commit
  that delivers it, so Paseo's stick-to-bottom keeps up and the reply does not push the footer
  after the fact.
- **A small client bundle.** Paseo sends the whole client bundle again on every reconnect. Brand
  marks and the Inter face are served by the daemon on demand (`marks.bitmaps`, `fonts.embedded`),
  the embedded Iosevka faces are gone, and the bundle is kept ASCII so Hermes stores it as one-byte
  text.

---

## Memory comparison

Web production build, measured on 2026-10-15: each value is the median of 3 runs after a forced GC.
The table reports JS heap usage, not total app or process memory. Differences are Better Paseo minus
the other mode, calculated before rounding; negative means less memory. All values are in MB.

![JS heap and DOM nodes after a forced GC](docs/perf/readme/web-memory.en.svg)

Compared with no plugin, a long reply uses 41.1 MB less; the other scenarios differ by −2.0 to +5.8
MB, mostly a few MB more, which is the plugin's own resident cost. Compared with Beautiful Chat, the
large diff, the 100-turn history and 20 file reads use 103.6–124.5 MB less, the large shell log 13.2
MB less, and the other scenarios differ by −7.6 to +0.8 MB. Beautiful Chat expands running tools by
default; Better Paseo keeps them collapsed.

| Scenario | No plugin | Beautiful Chat | Better Paseo | vs no plugin | vs Beautiful Chat |
| --- | ---: | ---: | ---: | ---: | ---: |
| Code block streaming | 115.9 | 115.4 | **113.9** | -2.0 | -1.5 |
| Large diff | 108.5 | 216.6 | **113.0** | +4.5 | -103.6 |
| 100-turn history | 116.0 | 239.1 | **120.9** | +4.9 | -118.1 |
| Long reply | 158.4 | 116.7 | **117.3** | -41.1 | +0.6 |
| Mixed turn | 113.6 | 123.3 | **115.7** | +2.2 | -7.6 |
| 20 file reads | 113.0 | 242.5 | **118.0** | +5.0 | -124.5 |
| Reasoning, prose | 110.6 | 114.2 | **113.9** | +3.3 | -0.3 |
| Reasoning, sections | 110.4 | 114.3 | **114.2** | +3.8 | -0.2 |
| Large shell log | 110.3 | 127.4 | **114.2** | +3.9 | -13.2 |
| Table streaming | 114.7 | 114.6 | **115.4** | +0.7 | +0.8 |
| Expanded tool | 112.6 | 124.4 | **118.4** | +5.8 | -6.0 |

Raw measurements: [Web runs](docs/bench/native-vs-fork/raw/web-2026-10-15b).

---

## Features

Everything below is on top of what Beautiful Chat already drew: typed tool cards, Shiki
highlighting, image reads, file reveal and the plugin's own find bar.

![One whole turn, top to bottom](images/thread.png)

### Tool rows

Most cards read the tool detail Paseo hands every plugin, so they work whichever agent made the
call: reads, writes, edits, shell and Git commands, searches, fetches, sub-agents, plans, MCP calls
(in Claude's `mcp__server__tool`, Codex's `server.tool` and Oh My Pi's `server / tool` forms) and
Paseo's own tools. Calls Paseo passes as plain text get a label-and-text card.

Oh My Pi's `hub` tool and its GitHub device calls are matched by name and have cards of their
own; no other agent sends them. On Paseo 0.11, Oh My Pi's `eval` and `ask` calls reach plugins as
plain text and `task` arrives as a sub-agent item. If `ask` also carries structured `questions`
data, it gets a question transcript; otherwise it stays a generic text card.

- Every call starts as one borderless row, 26pt on desktop and 28pt on touch, with a summary built
  for its type: the command, the path and line range, `+4 −2` for an edit, the exit code and
  duration. A press opens the card.
- The open or closed state is kept per call (`agentId:callId`) outside the component, so it
  survives completion, scrolling into history and remounts. On iOS the header stays where it was
  pressed and the content opens below it.
- A failed call shows a one-line error; with **Open failed calls** on, it starts expanded unless
  the reader has already chosen its open or closed state.
- Rows keep the time they first appeared, so parallel reads no longer reorder or change spacing
  when one finishes first.
- Row heads show an icon, a label or both. Long code and terminal output fold to 12 lines.
- **Block text size** changes prose in tool, thought, checklist and notice rows; code, diffs and
  terminal output keep their code font size.
- Paseo's own tools carry the Paseo mark; agent cards and reply footers use the agent's provider
  mark, independently of the selected model.
- Every op of Oh My Pi's `hub` tool has a card: processes, messages and job snapshots. The cards
  report; they carry no buttons, since a plugin cannot restart or cancel anything.
- Across agents, recognized question calls with structured `questions` data render as paginated
  transcripts with choices, recorded answers and status. **Show raw data** reveals the payload;
  the transcript is read-only, and Paseo still handles answers. Questions stay wrapped in previews
  for readability.

![Structured question transcript with recorded answers](docs/images/questions.png)

| Shell and Git | Read |
| --- | --- |
| ![Shell and Git tool calls](docs/images/tool-bash.png) | ![Read tool call](docs/images/tool-read.png) |
| **Edit** | **Hub** (Oh My Pi) |
| ![Edit tool call](docs/images/tool-edit.png) | ![Hub tool calls](docs/images/hub.png) |

<details>
<summary>More cards: MCP, Paseo tools, image read, syntax block, a <code>thinking</code> tool</summary>

![MCP tool call](docs/images/tool-mcp.png)
![Paseo tool call](docs/images/paseo.png)
![Thinking tool call](docs/images/tool-thinking.png)
![Image read](docs/images/tool-image.png)
![Syntax block](docs/images/syntax.png)

</details>

### Reasoning and checklists

- Reasoning is split only on real structure (`**Title**` and headings), not on blank lines. It is
  collapsed by default, and while it streams the row previews the current heading.
- Durations are shown only when this client actually watched the reasoning stream; nothing is
  estimated.
- Checklists show the phase, per-task status, durations, and a blocked task with its reason. A
  progress ring tracks completed tasks and becomes a check when all are done. The header's window
  button opens the live checklist in a panel that stays open as you use the timeline and follows the
  newest list; long titles can wrap there.

![Reasoning trace](docs/images/reasoning.png)
![Checklist](docs/images/tasks.png)
![Live checklist in a floating window](docs/images/checklist-window.png)

### Replies

- Markdown is drawn by the plugin with headings, lists, task lists, quotes, highlighted code blocks
  and local images. Three styles: **Document**, **Compact** and **Terminal**.
- Unlabelled, Markdown and plain-text code fences can open a maximized preview window. Switch
  between rendered Markdown and raw text, copy the source, and use **Wrap lines** in raw-text mode.
  The window stays separate from the compact reply.
- Tables have column rules, a header fill and a rounded frame; cells are a size smaller with tighter
  lines, and column widths account for tabular digits and CJK width.
- Every table has a copy control at its top-left corner. On web and desktop, hovering it (or a
  long press on a touch screen) opens **Copy as Markdown** and **Copy as image**, a picture of the
  table as drawn; a plain press copies the Markdown. On iOS and Android it copies the Markdown.
- On web and desktop, double-click a cell to select its text. On iOS and Android, double-tap a cell;
  the corner menu always offers **Copy selected** and offers **Add to chat** when Paseo provides its
  composer capability.
- Each completed turn has a separate footer under its final reply with Copy and its time, plus the
  provider mark, model, thinking level and observed duration when available. The model name copies
  when pressed and confirms with a toast; completed-turn footers remain during a later run. Turn
  **Plugin markdown for replies** off to restore Paseo's full footer, including its Fork action.
- Every local image in a reply is drawn, not only the first.
- Turn **Plugin markdown for replies** off to hand replies back to Paseo, which draws mermaid
  diagrams and its own images and file links.

| Table copy menu | Selected cell actions |
| --- | --- |
| ![Table copy menu](docs/images/table-copy-menu.png) | ![Selected table cell actions](docs/images/table-selection.png) |

![Document, Compact and Terminal markdown styles](docs/images/markdown-styles.png)
![Maximized Markdown code preview in raw-text mode](docs/images/markdown-preview-window.png)

### Images

- An image read draws the file: dimensions and size from its header, a thumbnail sized to its
  content, and an eye toggle that keeps the header where it was pressed.
- The full-screen viewer zooms with buttons, the wheel or a pinch about the pointer, pans by drag,
  resets on double press, and reveals the file in the file manager. On a phone, a long press on the
  row opens it directly.
- Bytes come from the daemon (`file.image`) the first time a row is opened, previewed or
  long-pressed. PNG, JPEG, GIF, WebP, AVIF, BMP, ICO and SVG are recognised; files over 3 MB report
  their size instead of inlining.
- When multiple read cards point to the same image, each card displays it.

![Two read cards displaying the same image](docs/images/shared-image-cards.png)

### Hover previews

On desktop, resting the pointer on a collapsed tool row, thought row, image or path opens a
scrollable preview after a delay you set (0–10 s). It can wrap lines, show line numbers and
alternating shading, and can be moved, resized or maximized. A checklist can open its live list in a
floating window, and a Markdown code block can open its own maximized preview. When a preview is
following live output, it glides along as the content grows. On a phone, long-press a collapsed row
to open the same preview without covering the top bar or composer.

### Paths, copying and selection

- Paths are relative to the workspace and shortened in the middle, keeping the file name; a
  worktree's main repository is shown by name. Copying always gives the absolute path.
- Copy goes through the host's `copyText` everywhere, so it works on iOS and Android too: hover on
  desktop, long press on touch, or the `⋯` menu. Plain-text code blocks can wrap and have a copy
  button. On iOS a long press in a reply places a cursor and lets you drag a selection.
- Selecting text in a card on web or desktop raises **Copy** and **Add to chat**, which quotes the
  selection in the composer, fenced when it came from code. The bar closes on scroll; if no composer
  is visible, **Add to chat** copies the selection instead.

![Selected text with Copy and Add to chat actions](docs/images/selection-actions.png)

### Prompt bubble

Paseo draws the prompt by default, keeping pasted images and its rewind menu. **Enhanced prompt
bubble** switches eligible prompts to the plugin's bubble: an always-visible copy button and the
turn's token usage. It draws images when it can extract a supported image source; a prompt with an
unrenderable attachment stays with Paseo. Rewind stays wherever the running Paseo provides it.

![Prompt bubble](docs/images/user.png)

### Errors and system messages

- An agent error is drawn as a notice card carrying its message.
- Oh My Pi sends job results, relayed messages and reminders as message text wrapped in tags such
  as `<system-notice>` or `<irc>`, and Paseo files them as replies. With **Plugin markdown for
  replies** on, they are drawn as system cards (a title, chips for agent, status and duration, and
  the rest of the body) instead of raw XML.

Permission requests are not redrawn: Paseo draws them and owns the approve and deny actions.

---

## Settings

**Settings → Plugins → Better Paseo.** A sample turn drawn with the timeline's own components follows
every change: beside the options on a wide desktop window, above them elsewhere. The Read row's
hover preview is drawn open in it. On web and desktop a **Desktop / Mobile** switch draws the same
turn at phone width with iOS styling and the inline-code colour you picked.
Options whose parent is off are dimmed, and **Reset** asks for a second press.

![Settings page with its live preview](docs/images/settings.png)
![Block text size setting with its live preview](docs/images/settings-tools.png)

| Group | Setting | Default | Effect |
| --- | --- | --- | --- |
| General | Language | Follow system | English or 简体中文 for the settings page and toolbar tooltips. Plugins cannot read Paseo's own language. |
| Appearance | Accent colour | Theme | Follow the Paseo theme, or Jade, Violet, Amber or Rose. Only the accent changes. |
| Appearance | Inline code on mobile | Dark grey | Text colour of inline code on iOS and Android: Dark grey, Blue, Violet, Green or Coral. Web keeps its grey chip. |
| Appearance | Interface font | Follow Paseo | Paseo's interface font, Inter (web only, fetched from the daemon) or the system face. |
| Code font | Monospace font | Follow Paseo | Choose Follow Paseo or Custom. Follow Paseo uses, in order: the host's font settings once Paseo shares them; on web and desktop, the monospace font and size from Paseo's Appearance settings; otherwise Paseo's default monospace. On iOS and Android, Custom lists faces the platform ships. |
| Code font | Custom monospace family | Empty | Only used when Monospace font is Custom. Web accepts a family name up to 200 characters and falls back through the monospace stack if unavailable; iOS and Android offer only platform families. |
| Code font | Code font size | Follow Paseo | Or 10–22px; lines are 1.5× the size. Applies to code, diffs, terminals and paths. |
| Tool calls | Block text size | 13px | 9–20px for tool rows, thoughts, checklists and notices. Text inside those blocks grows with it. Code, diffs and terminal output keep the code font size. |
| Tool calls | Row icons and labels | Icon | Icon, label (Bash, Read…) or both at the start of tool and thought rows. |
| Tool calls | Open failed calls | Off | On, a failed call opens to show its error. A call you opened or closed yourself keeps your choice. |
| Tool calls | File paths | Relative | Relative to the workspace, or absolute. Copying always gives the absolute path. |
| Spacing | Tight rows | On | Reduces the gap under a plugin row from 16pt to 4pt when another row follows. Rows Paseo already stacks are left alone. Turn off if rows overlap. |
| Spacing | Tight reply | On | Reduces the gap from 16pt to 4pt when a finished reply is followed by a plugin row, including a checklist. Turn off if they overlap. |
| Messages | Enhanced prompt bubble | Off | Shows the turn's token usage and keeps Copy visible. Readable pasted images are drawn; prompts with other attachments stay with Paseo. Changing it updates existing prompts too. Rewind stays wherever Paseo provides it. |
| Messages | Plugin markdown for replies | On | Off hands replies to Paseo, restoring its full footer and enabling mermaid, host images and Paseo's file links. |
| Messages | Markdown style | Document | Document, Compact or Terminal (body in the code font). |
| Messages | Selection toolbar | On | Web and desktop: Copy and Add to chat on selected text; the bar closes on scroll. |
| Hover previews | Hover previews | On | Preview collapsed rows and paths on desktop hover; long-press a collapsed row on a phone. |
| Hover previews | Delay | 1 s | 0–10 s, saved to tenths of a second, before the desktop preview opens. |
| Hover previews | Wrap lines | On | Wrap long lines in preview panels, including raw text in maximized code previews; turn off to scroll horizontally. |
| Hover previews | Line numbers | Off | Show line numbers beside files, diffs and command output; diffs use the file's own line numbers. |
| Hover previews | Alternating line shading | On | Shade every other line in preview panels. |

**Where settings live.** Preferences are stored by the daemon through the SDK's host-scoped settings
(record `presentation` in `shared/preferences-settings.ts`), so **every client connected to one
daemon shares them**: a change on the desktop shows up on iOS and the other way round. A value one
platform cannot draw is stored as chosen and degraded where it renders (a custom family becomes the
platform monospace on iOS and Android; Inter becomes the system face). On web, `localStorage` is
only a fast-start cache. Until the settings arrive, cards draw with cached or default values and
switch once.

**Settings apply immediately.** Already displayed plugin items re-render as soon as local preference
state changes. The daemon stores the value and syncs it to other connected clients; reloading the chat
is not needed. **Open failed calls** uses the saved per-call choice when there is one, and otherwise
sets the call's initial state.

---

## Finding text

Paseo's chat find (Ctrl/Cmd+F) cannot reveal a row a plugin draws, because the transformed row
carries a different id. Better Paseo therefore takes Ctrl/Cmd+F on desktop and web and opens its own
find bar over the chat. It searches everything rendered, including tool cards and structured
question transcripts: Enter for the next
match, Shift+Enter for the previous, Escape to close. It only sees loaded messages; scroll up to
include older history.

To use Paseo's native find for replies, which also searches unloaded history, turn off **Plugin
markdown for replies** (and **Enhanced prompt bubble** if it is on). Paseo then draws replies and
prompts itself and Ctrl/Cmd+F opens its own find. Tool, reasoning and checklist cards stay with the
plugin.

## Opening files

A file name in a read, write, edit or code block is a link. On desktop it calls the daemon-side
`file.reveal`, which resolves the path against the agent's working directory and shows it in the
file manager: `explorer.exe /select,` on Windows, `open -R` on macOS, `xdg-open <directory>`
elsewhere. On a touch device the same press copies the absolute path instead, since a phone cannot
open the daemon machine's file manager.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Rows overlap, or a reply overlaps the row below | Turn off **Tight rows** or **Tight reply**. |
| A reply needs a mermaid diagram, a host image or Paseo's file links | Turn off **Plugin markdown for replies**. |
| A selected table cell has no **Add to chat** action on a phone | Paseo must provide its optional composer capability; **Copy selected** is always available. |
| A prompt with an attachment should use Paseo's renderer | Turn off **Enhanced prompt bubble**. Attachments the plugin cannot render stay with Paseo automatically. |
| Ctrl/Cmd+F misses old messages | Scroll up to load them, or hand replies back to Paseo as above. |
| Token figures are missing on an old turn | Usage is not stored on timeline items, so only turns this client watched live show it. |
| Nothing changed after pushing a fix | Run `paseo plugin update better-paseo`; Paseo runs the GitHub version. |

## Compatibility

Better Paseo targets Paseo 0.11 and later. It installs and draws the timeline on Paseo 0.8–0.10,
with these known issues:

- Oh My Pi's `eval` and `ask` calls reach plugins under their own names there, not through Paseo
  0.11's plain-text mapping. `eval` stays generic; `ask` gets a question transcript only when its
  input contains a structured `questions` array, and otherwise stays generic too.
- Some features depend on host abilities; see [Waiting on Paseo](#waiting-on-paseo). Host capability
  checks have been verified with 0.11.2.

## Waiting on Paseo

Better Paseo works on released Paseo and probes for newer host abilities, falling back when they are
absent. These host changes are verified in a Paseo fork but not yet released:

- Plugin tool rows spaced like native ones (about 46pt down to 30pt; native is 32pt). Until then
  **Tight rows** reduces the gap from 16pt to 4pt where applicable.
- Paseo sharing its font settings with plugins, so a change in Appearance applies live. Until then
  web and desktop read Paseo's locally stored Appearance settings.
- An optional composer capability for touch table selection, so **Add to chat** can be offered
  beside **Copy selected**. Until then, the corner menu still copies the selected cell.
- Lowering `class` syntax before the bundle runs on Hermes.
- A sticky current prompt and sticky headers on open cards; the plugin side is wired up.

Grouping several calls into one "Read 12 files" row needs a host grouping API, and opening a
5,000-line block on a development-build simulator still takes about 30 s without host-side
virtualised scrolling.

The SDK constraints met while building the plugin, with evidence and workarounds, are listed in
[`docs/plugin-sdk-limitations.md`](docs/plugin-sdk-limitations.md).

## Development

```bash
npm install
npm run typecheck
npm test
npm run check:hermes
paseo plugin reload better-paseo
```

`npm run check:hermes` compiles and runs the client bundle in Hermes, the engine the iOS and Android
apps use; code that works on web can still fail there and drop the whole plugin. The rules it
enforces, the project layout, and how to rebuild the screenshots and charts are in
[`docs/development.md`](docs/development.md).

## License

MIT
