# Better Paseo

**English** | [简体中文](README-zh.md)

A [Paseo](https://paseo.sh) plugin that redraws the chat timeline of every agent Paseo runs,
whichever provider is behind it (Claude Code, Codex, Oh My Pi and the rest): tool calls, reasoning,
replies, prompts, checklists and errors become compact, typed, syntax-aware rows that follow the
active Paseo theme. The performance section compares it with Paseo’s own timeline.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/hero-devices-dark.png">
  <img alt="Better Paseo on desktop and on a phone: a hover preview of a collapsed read, reasoning, shell, read, edit diff, MCP, checklist, Paseo and hub calls, a background job and the reply" src="images/hero-devices-light.png">
</picture>

> Better Paseo is a fork of [ABorakati/beautiful-chat](https://github.com/ABorakati/beautiful-chat),
> continued from `42b61d8` (2026-09-23). It keeps Beautiful Chat's cards except the Eval, Ask,
> Task and approval cards, which current Paseo never feeds a plugin (see
> [Compatibility](#compatibility)). This README describes what the fork adds and how it performs.

## Highlights

- **Measured performance.** Latest main `b9dfae6` has 630 fresh samples; comparisons and A/A variability are disclosed in [Performance](#performance).
- **Measured memory.** The same round records post-GC JS heap and signed MB differences against no plugin. [Memory comparison](#memory-comparison).
- **One row per tool call.** Calls start collapsed to a 26pt row with a typed summary, open on a
  press, and stay open or closed across completion, history and remounts.
- **Block-by-block streaming replies.** Finished Markdown blocks are cached while growing code and tables are repaired. This round’s layout-shift readings are in the [performance comparison](#performance).
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

### Latest main: 630 fresh samples

Rerun on Mac Studio (Apple M5 Max, 18 cores, 64 GB, macOS 27.0.1) on 2026-10-17, pinned to the latest `main`, **`b9dfae6`**. Web/iOS each run 11 scenarios × 5 configurations × 5 repetitions: **550 replays**, plus **80 long-history samples**. Configurations are no plugin, Beautiful Chat `42b61d8`, current main, an independent current-main A/A repeat and parent `2fc6476`. Up to four isolated groups run concurrently, rotating lane placement and configuration order by scenario and repetition; three-mode tables use medians of five primary runs per cell. Display-error groups are N/A. [Full ranges, failures and evidence](docs/bench/2026-10-17-readme/README.md).

![Web main-thread time](docs/perf/readme/web-cpu.en.svg)

Whole-replay main-thread Task time vs no plugin: 9 lower, 2 even, 0 higher; vs Beautiful Chat: 10 lower, 1 even, 0 higher. Under 10%, or both whole Task replays below 0.5 seconds, is even.

The table measures cumulative row-render work (host Profiler allRows.sum, milliseconds), not per-commit p95. Vs no plugin: 9 lower, 0 even, 2 higher.

| Scenario | No plugin | Beautiful Chat | Better Paseo | vs no plugin | vs Beautiful Chat |
| --- | ---: | ---: | ---: | :--- | :--- |
| Code block streaming | 827.8 | 802.4 | **147.1** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;82% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;82% |
| Large diff | 21.9 | 549.8 | **15.9** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;27% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;97% |
| History replay | 164.2 | 4,562.6 | **218.3** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;33% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;95% |
| Long reply | 1,133.3 | 2,093.6 | **236.6** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;79% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;89% |
| Mixed turn | 121.3 | 326.3 | **53.2** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;56% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;84% |
| 20 file reads | 92.2 | 786.6 | **52.1** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;43% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;93% |
| Reasoning, prose | 276.2 | 647.1 | **63.6** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;77% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;90% |
| Reasoning, sections | 281.8 | 989.0 | **60.5** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;79% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;94% |
| Large shell log | 23.7 | 185.8 | **13.7** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;42% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;93% |
| Table streaming | 686.2 | 232.0 | **156.0** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;77% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;33% |
| Growing tool log (defaults) | 37.4 | 559.2 | **51.1** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;37% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;91% |

Modes retain default disclosure: Beautiful Chat opens running tools; Better Paseo keeps them collapsed. `tool-expanded-streaming` performs no expand action and is labelled “Growing tool log (defaults)”; this does not establish expanded-body performance.

### Streaming layout shift

Cumulative layout shift (CLS, lower is better) from the same Web runs, with six decimals. The Task-time 0.5-second rule does not apply; percentages can magnify tiny absolute differences.

| Scenario | No plugin | Beautiful Chat | Better Paseo | vs no plugin | vs Beautiful Chat |
| --- | ---: | ---: | ---: | :--- | :--- |
| Code block streaming | 0.041921 | 0.127708 | **0.011655** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;72% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;91% |
| Large diff | 0.000015 | 0.024003 | **0.000015** | even | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;100% |
| History replay | 0.240602 | 0.088614 | **0.000015** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;100% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;100% |
| Long reply | 0.183334 | 0.646989 | **0.000015** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;100% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;100% |
| Mixed turn | 0.004936 | 0.092846 | **0.026648** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;440% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;71% |
| 20 file reads | 0.001990 | 0.678542 | **0.000777** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;61% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;100% |
| Reasoning, prose | 0.000015 | 0.098084 | **0.000777** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;5230% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;99% |
| Reasoning, sections | 0.000015 | 0.147581 | **0.000777** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;5230% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;99% |
| Large shell log | 0.000015 | 0.021574 | **0.000015** | even | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;100% |
| Table streaming | 0.045675 | 0.039717 | **0.010534** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;77% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;73% |
| Growing tool log (defaults) | 0.000015 | 0.014097 | **0.000015** | even | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;100% |

### iOS

![iOS total row-render work](docs/perf/readme/ios-commit.en.svg)

iPhone 16 Pro / iOS 18.6 development Hermes simulator, cold-launched per sample. Four isolated benchmark simulators, up to four concurrent groups; all Web work completes before iOS starts. Row-render totals are milliseconds; under 10% is even. Vs no plugin: 1 lower, 3 even, 1 higher, 6 unavailable; vs Beautiful Chat: 5 lower, 0 even, 0 higher, 6 unavailable. These are not physical-device frame rates or Release performance.

| Scenario | No plugin | Beautiful Chat | Better Paseo | vs no plugin | vs Beautiful Chat |
| --- | ---: | ---: | ---: | :--- | :--- |
| Code block streaming | 2,321.7 | 4,802.1 | **754.4** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;68% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;84% |
| Large diff | 46.9 | 3,151.1 | **N/A** | N/A | N/A |
| History replay | 198.9 | 260.7 | **N/A** | N/A | N/A |
| Long reply | 5,113.1 | 13,914.4 | **N/A** | N/A | N/A |
| Mixed turn | 267.1 | 647.5 | **N/A** | N/A | N/A |
| 20 file reads | 278.4 | 2,640.9 | **265.8** | even | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;90% |
| Reasoning, prose | 262.3 | 1,477.3 | **259.5** | even | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;82% |
| Reasoning, sections | 241.4 | 2,536.1 | **N/A** | N/A | N/A |
| Large shell log | 47.8 | 369.9 | **55.1** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;15% | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;85% |
| Table streaming | 937.3 | 1,107.7 | **N/A** | N/A | N/A |
| Growing tool log (defaults) | 165.9 | 3,155.4 | **171.9** | even | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;95% |

Green ⬆ is lower; red ⬇ is higher. Percentages use unrounded medians. `history-100` is a fixture name, not 100 actual provider turns; it is labelled “History replay”.

**Method and limits.** Fixed Paseo 0.11.2 / `759532509` with identical host row probes; each lane has a freshly exported production profiling Web build with a recorded hash. Chrome 155.0.8059.40, 1280×900; CDP measures main-thread time, with forced-GC heap/DOM readings after timing. Default feature settings; current-version measurement counters are enabled. Row work excludes whole native layout and app CPU. Raw data records load, CPU idle and memory pressure; admission requires CPU idle ≥15%, memory free ≥10% and pressure level 1; load is recorded without a load-average cutoff. End-resource excursions remain flagged. Actual overlap varies: these are observed medians under this protocol, not fixed-concurrency throughput or stable-speedup claims.

### Parent comparison and A/A variability

Parent is `2fc6476`; current main is `b9dfae6`. Each cell uses five runs and total row-render work in milliseconds. A/A counts the five additional current-version runs whose paired relative difference exceeds 10%; these runs are not pooled into the main table. All unstable pairs are retained; lower medians do not establish stable improvements.

#### Web

| Scenario | Parent ms | Main ms | vs parent | A/A over 10% | Max A/A difference |
| --- | ---: | ---: | ---: | ---: | ---: |
| Code block streaming | 148.0 | 147.1 | -0.61% | 1/5 | 25.97% |
| Large diff | 12.2 | 15.9 | +30.33% | 4/5 | 33.96% |
| History replay | 220.5 | 218.3 | -1.00% | 4/5 | 27.78% |
| Long reply | 243.5 | 236.6 | -2.83% | 3/5 | 24.70% |
| Mixed turn | 58.1 | 53.2 | -8.43% | 3/5 | 34.30% |
| 20 file reads | 60.2 | 52.1 | -13.46% | 5/5 | 36.11% |
| Reasoning, prose | 67.1 | 63.6 | -5.22% | 2/5 | 22.29% |
| Reasoning, sections | 65.6 | 60.5 | -7.77% | 3/5 | 19.36% |
| Large shell log | 11.4 | 13.7 | +20.18% | 2/5 | 57.39% |
| Table streaming | 138.9 | 156.0 | +12.31% | 4/5 | 32.67% |
| Growing tool log (defaults) | 48.2 | 51.1 | +6.02% | 3/5 | 23.44% |

#### iOS

| Scenario | Parent ms | Main ms | vs parent | A/A over 10% | Max A/A difference |
| --- | ---: | ---: | ---: | ---: | ---: |
| Code block streaming | N/A | 754.4 | N/A | N/A | N/A |
| Large diff | 54.1 | N/A | N/A | N/A | N/A |
| History replay | 208.5 | N/A | N/A | N/A | N/A |
| Long reply | 1,490.0 | N/A | N/A | N/A | N/A |
| Mixed turn | 219.8 | N/A | N/A | N/A | N/A |
| 20 file reads | 276.7 | 265.8 | -3.94% | N/A | N/A |
| Reasoning, prose | N/A | 259.5 | N/A | N/A | N/A |
| Reasoning, sections | 222.0 | N/A | N/A | N/A | N/A |
| Large shell log | 50.2 | 55.1 | +9.76% | 3/5 | 20.14% |
| Table streaming | N/A | N/A | N/A | N/A | N/A |
| Growing tool log (defaults) | N/A | 171.9 | N/A | N/A | N/A |


### Long-history loading

The same concurrent-max4 campaign reruns `history-complete-v1`: 40 Web and 40 iOS samples, **80 total**. Each scenario/platform has five current-version A/A pairs and five runs per control. Sources are `b9dfae6` and Beautiful Chat `42b61d8`, with default settings. Both the 810-entry / one-provider-turn and 832-entry / 12-turn inputs retain the 59,427-character reply. The 260 reasoning items use distinct equal-length synthetic tags; this does not establish a fix for the old duplicate-key input.

![Long-history cold-open row work](docs/perf/readme/history-complete-open.en.svg)

#### Web

| Scenario / phase | No plugin | Beautiful Chat | Better Paseo |
| --- | ---: | ---: | ---: |
| 810 entries / 1 turn — Cold-open row work | 98.4 | 1,808.8 | 137.7 |
| 810 entries / 1 turn — First older reveal row work | 11.9 | 531.2 | 10.7 |
| 810 entries / 1 turn — Whole-session return row work | 160.9 | 2,155.7 | 63.8 |
| 832 entries / 12 turns — Cold-open row work | 111.4 | 1,841.7 | 129.7 |
| 832 entries / 12 turns — First older reveal row work | 12.4 | 526.3 | 15.0 |
| 832 entries / 12 turns — Whole-session return row work | 156.1 | 2,167.2 | 63.2 |

#### iOS

| Scenario / phase | No plugin | Beautiful Chat | Better Paseo |
| --- | ---: | ---: | ---: |
| 810 entries / 1 turn — Cold-open row work | 173.6 | 212.9 | N/A |
| 810 entries / 1 turn — First older reveal row work | 182.4 | 13.7 | N/A |
| 810 entries / 1 turn — Whole-session return row work | 315.8 | 402.5 | N/A |
| 832 entries / 12 turns — Cold-open row work | 161.4 | 198.6 | 127.3 |
| 832 entries / 12 turns — First older reveal row work | 182.0 | 47.7 | 160.1 |
| 832 entries / 12 turns — Whole-session return row work | 295.4 | 356.1 | 106.5 |

![Whole-session return row work](docs/perf/readme/history-complete-return.en.svg)

Values are milliseconds. Web older reveal uses a full-height physical wheel from the tail, with no untimed pre-scroll; iOS records preparation before a measured HID drag. Whole-session return proves target unmount before returning through the host pane; it is not independent Markdown-block remount during scrolling. Numeric current-version groups require exact copying before reveal and after return. Any failed attempt makes every phase of its scenario/configuration group N/A; no successful subset is substituted. JS-ready proxies are not first-usable viewport times; reveal/return may render different row sets, so interpret totals with ranges and A/A spread.

[History ranges, A/A and raw evidence](docs/bench/2026-10-17-readme/parallel-v2/history/RESULTS.md)


### Where the time goes

- **Skip unchanged rows.** Semantic theme/data comparisons let unchanged cards skip rendering.
- **Parse replies incrementally.** Finished Markdown blocks are cached; only the growing tail is repaired. Long replies split into blocks that the native host can virtualize; Copy retains the full source.
- **Draw tool bodies on demand.** Collapsed rows do not mount their bodies. Completed code requests daemon highlighting; large code and terminal output render in batches with a Show all control.
- **Reduce continuous animation work.** The Web running dot uses CSS and stops for Reduced Motion; decorative shadows, blur and breathing loops are removed.
- **Send less on reconnect.** Brand marks and Inter are delivered on demand; the client source stays ASCII for Hermes one-byte strings.


---

## Memory comparison

2026-10-17, the same Web production profiling runs, median of five primary post-GC readings. This is JS heap, not total process/app memory. Differences are Better Paseo minus each control, in MB; the 10% even rule does not apply.

![JS heap and DOM nodes](docs/perf/readme/web-memory.en.svg)

| Scenario | No plugin | Beautiful Chat | Better Paseo | vs no plugin | vs Beautiful Chat |
| --- | ---: | ---: | ---: | :--- | :--- |
| Code block streaming | 107.5 | 106.5 | **106.1** | -1.4 | -0.4 |
| Large diff | 98.8 | 204.8 | **103.4** | +4.6 | -101.4 |
| History replay | 105.0 | 232.1 | **109.8** | +4.9 | -122.3 |
| Long reply | 148.9 | 108.1 | **115.7** | -33.2 | +7.6 |
| Mixed turn | 103.9 | 113.8 | **106.2** | +2.4 | -7.5 |
| 20 file reads | 102.6 | 231.7 | **108.2** | +5.5 | -123.5 |
| Reasoning, prose | 98.6 | 102.0 | **102.5** | +3.9 | +0.5 |
| Reasoning, sections | 100.2 | 103.0 | **104.0** | +3.7 | +0.9 |
| Large shell log | 100.4 | 116.5 | **103.9** | +3.6 | -12.6 |
| Table streaming | 103.6 | 104.4 | **105.1** | +1.5 | +0.7 |
| Growing tool log (defaults) | 100.6 | 111.6 | **106.2** | +5.7 | -5.3 |

[Raw Web samples](docs/bench/2026-10-17-readme/parallel-v2/raw/web)

---

## Features

Screenshots refreshed on 2026-10-17 from b9dfae6 using the offline Web showcase. All product screenshots default to light and switch to dark with the reader’s theme; the phone frame is illustrative. Performance versions and conditions are identified above. [Capture manifest](docs/images/screenshots.json).

Everything below is on top of what Beautiful Chat already drew: typed tool cards, Shiki
highlighting, image reads, file reveal and the plugin's own find bar.

<picture><source media="(prefers-color-scheme: dark)" srcset="images/thread-dark.png"><img alt="One whole turn, top to bottom" src="images/thread-light.png"></picture>

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

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/questions-dark.png"><img alt="Structured question transcript with recorded answers" src="docs/images/questions-light.png"></picture>

| Shell and Git | Read |
| --- | --- |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/tool-bash-dark.png"><img alt="Shell and Git tool calls" src="docs/images/tool-bash-light.png"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/tool-read-dark.png"><img alt="Read tool call" src="docs/images/tool-read-light.png"></picture> |
| **Edit** | **Hub** (Oh My Pi) |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/tool-edit-dark.png"><img alt="Edit tool call" src="docs/images/tool-edit-light.png"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/hub-dark.png"><img alt="Hub tool calls" src="docs/images/hub-light.png"></picture> |

<details>
<summary>More cards: MCP, Paseo tools, image read, syntax block, a <code>thinking</code> tool</summary>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/tool-mcp-dark.png"><img alt="MCP tool call" src="docs/images/tool-mcp-light.png"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/paseo-dark.png"><img alt="Paseo tool call" src="docs/images/paseo-light.png"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/tool-thinking-dark.png"><img alt="Thinking tool call" src="docs/images/tool-thinking-light.png"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/tool-image-dark.png"><img alt="Image read" src="docs/images/tool-image-light.png"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/syntax-dark.png"><img alt="Syntax block" src="docs/images/syntax-light.png"></picture>

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

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/reasoning-dark.png"><img alt="Reasoning trace" src="docs/images/reasoning-light.png"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/tasks-dark.png"><img alt="Checklist" src="docs/images/tasks-light.png"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/checklist-window-dark.png"><img alt="Live checklist in a floating window" src="docs/images/checklist-window-light.png"></picture>

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
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/table-copy-menu-dark.png"><img alt="Table copy menu" src="docs/images/table-copy-menu-light.png"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/table-selection-dark.png"><img alt="Selected table cell actions" src="docs/images/table-selection-light.png"></picture> |

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/markdown-styles-dark.png"><img alt="Document, Compact and Terminal markdown styles" src="docs/images/markdown-styles-light.png"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/markdown-preview-window-dark.png"><img alt="Maximized Markdown code preview in raw-text mode" src="docs/images/markdown-preview-window-light.png"></picture>

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

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/shared-image-cards-dark.png"><img alt="Two read cards displaying the same image" src="docs/images/shared-image-cards-light.png"></picture>

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

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/selection-actions-dark.png"><img alt="Selected text with Copy and Add to chat actions" src="docs/images/selection-actions-light.png"></picture>

### Prompt bubble

Paseo draws the prompt by default, keeping pasted images and its rewind menu. **Enhanced prompt
bubble** switches eligible prompts to the plugin's bubble: an always-visible copy button and the
turn's token usage. It draws images when it can extract a supported image source; a prompt with an
unrenderable attachment stays with Paseo. Rewind stays wherever the running Paseo provides it.

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/user-dark.png"><img alt="Prompt bubble" src="docs/images/user-light.png"></picture>

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

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/settings-dark.png"><img alt="Settings page with its live preview" src="docs/images/settings-light.png"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/settings-tools-dark.png"><img alt="Block text size setting with its live preview" src="docs/images/settings-tools-light.png"></picture>

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
| Token figures are missing on an old turn | The latest completed turn can recover usage from the daemon snapshot when its prompt matches. Earlier turns keep usage captured live by this client; usage absent from both sources stays hidden. |
| Grok and Cursor have no elapsed time in the Copy toolbar or turn details | Upstream tool issue: historical timelines from Grok and Cursor lack reliable per-message timestamps. Replayed records can share the same timestamp or differ by only 1 ms, producing a misleading `0s`. Better Paseo hides elapsed time for the `grok` and `cursor` providers until upstream supplies reliable timing. This is based on the provider, not the model name. |
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
