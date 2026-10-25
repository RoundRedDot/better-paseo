# Better Paseo

**English** | [简体中文](README-zh.md)

A [Paseo](https://paseo.sh) plugin that redraws the chat timeline of every agent Paseo runs,
whichever provider is behind it (Claude Code, Codex, Oh My Pi and the rest): tool calls, reasoning,
replies, prompts, checklists and errors become compact, typed, syntax-aware rows that follow the
active Paseo theme. It adds a **Tasks** board that lays out every agent on the host in lanes by state,
and it is drawn for the device in your hand: a phone gets a details drawer you can pinch and a
one-lane board you swipe through, an iPad gets floating and side panels and a board with a details
sidebar or sheet. The performance section compares the timeline with Paseo's own.

https://github.com/user-attachments/assets/2b16b0a5-8567-4f3e-8fbd-4a594c74d2da

<sub>No player in the GitHub app? [Open the timeline video](https://github.com/RoundRedDot/better-paseo/releases/download/promo-v13/better-paseo-promo-v13-timeline-web.mp4).</sub>

https://github.com/user-attachments/assets/3ddf3024-c67a-4690-a3a9-d01348b034df

<sub>No player in the GitHub app? [Open the tasks video](https://github.com/RoundRedDot/better-paseo/releases/download/promo-v13/better-paseo-promo-v13-tasks-web.mp4).</sub>

<img alt="Better Paseo, a Paseo plugin: a clear, fast chat timeline on a desktop window and a phone" src="images/hero-cover.png">

<picture><source media="(prefers-color-scheme: dark)" srcset="images/tasks-board-dark.png"><img alt="The Tasks board: every agent in lanes by state, with a card's subtasks, properties and usage in the details sidebar" src="images/tasks-board-light.png"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="images/timeline-dark.png"><img alt="A chat timeline of compact tool rows and a checklist, with an edit's diff open in the block details side panel" src="images/timeline-light.png"></picture>

> Better Paseo is a fork of [ABorakati/beautiful-chat](https://github.com/ABorakati/beautiful-chat),
> continued from `42b61d8` (2026-09-23). It keeps Beautiful Chat's cards except the Eval, Ask,
> Task and approval cards, which current Paseo never feeds a plugin (see
> [Compatibility](#compatibility)). This README describes what the fork adds and how it performs.

## Highlights

- **Made for phones and iPad.** A tap on a row opens it in a bottom drawer on a phone, where two
  fingers set the text size, and in a floating or side panel on an iPad. The Tasks board shows one
  lane at a time on a phone and lanes with a details sidebar, panel or sheet on a tablet. See
  [Phones and iPad](#phones-and-ipad).

- **Measured performance.** Against Paseo 0.12.0, the 220 serial Web and iOS replays (five runs per cell) show 80% less Web main-thread time on the long reply. Details in [Performance](#performance).

- **One row per tool call.** Calls start collapsed to a 26pt row with a typed summary and stay
  open or closed across completion, history and remounts.
- **An icon for every tool.** Shell rows draw the program they run (101 icons for 209 programs,
  from `python` to `kubectl`), MCP rows the service they call (75 services, from Linear to Feishu)
  and other calls their kind. See [Tool icons](#tool-icons).
- **Block details.** Read any tool, thought, checklist or code block in a panel, step through the
  turn's blocks from its header, and follow a streaming block's tail. See
  [Block details](#block-details).
- **Block-by-block streaming replies.** Finished Markdown blocks are cached while growing code and
  tables are repaired.
- **Tasks board.** Every agent on the host by state (needs input, running, to review, done and
  archived), with Paseo's label colours and project icons, Stop, Mark as read, Archive and
  permission buttons on the card, and a details view with the running turn's clock and tokens, the
  first prompt, the last reply, subtasks and usage. See [Tasks board](#tasks-board).
- **Follows Paseo.** Fonts, sizes, colours and language follow the host by default; settings are
  stored on the daemon and shared by desktop, web, iOS and Android.
- **Light on reconnect.** The client ships minified and the Tasks board loads only when it is on,
  so the plugin catalog Paseo sends on every reconnect fell from 1,977 KB to 722 KB (measured on a
  Paseo 0.12 daemon when the change landed, 2026-10-23).

- **Measured memory.** Across the Web scenarios, Better Paseo uses 5.1–14.2 MB more post-GC JavaScript heap than no plugin. See [Memory comparison](#memory-comparison).

## Install

```bash
paseo plugin install RoundRedDot/better-paseo
```

Paseo `>=0.8.0` is required; the plugin is developed and measured against Paseo 0.12.0. On Paseo
0.8–0.10 it works with some compatibility issues, listed under [Compatibility](#compatibility).
Open **Settings → Plugins → Better Paseo** (the page is titled **Settings**) to
configure it. Paseo installs plugins from GitHub and builds the client on install, so pull a new
version with:

```bash
paseo plugin update better-paseo        # reviews the update and asks
paseo plugin update better-paseo --yes  # applies it without asking
```

---

## Phones and iPad

Paseo runs the same plugin on desktop, web, iOS and Android. Better Paseo does not scale a desktop
layout down; each surface picks its form from the device and the room it has.

**Finger or pointer.** The plugin asks the device, not the platform name, because Electron and
phone Safari both report "web". On web a fine pointer that can hover counts as a pointer and a
coarse one as touch; a laptop with a touch screen counts as both. On iOS and Android every screen
is touch, and the first time a trackpad or mouse hovers a row (an iPad with a Magic Keyboard), the
plugin treats that session as having a pointer as well.

| | Phone | iPad and Android tablets | Desktop and web |
| --- | --- | --- | --- |
| Tool rows | 28pt, 44pt press target | 26pt, 44pt press target | 26pt |
| Press a row | opens its [details](#block-details); the icon at the row's start expands it | same; with a trackpad a click expands it | expands it; details from the hover preview or row menu |
| Long press or right-click | row menu: copies, view image, open details, expand | same | right-click opens the row menu |
| Block details | bottom drawer with pinch-to-size text | floating panel up to 760pt, or a side panel on a wide screen | floating or side panel; a drawer in a narrow window |
| Tasks board | one lane at a time, swiped or picked from tabs with lane counts; a tap opens a details sheet | lanes side by side, each card's buttons always shown; details in a sidebar, floating panel or bottom sheet by board width | as a tablet, with the buttons on hover, a right-click menu, double-click and keyboard |
| Hover previews | long-press preview when block details are off | same | hover any collapsed row or path |

### On a phone

- **Rows that fit a thumb.** Tool rows are 28pt in Paseo's compact layout, with summaries cut for
  the narrower column; each row's press target extends to 44pt. A tap opens the row's details, a
  tap on its icon expands it in place, and the header stays where you pressed it while the body
  opens below.
- **A drawer you can pinch.** Block details rise as a bottom drawer that fits its content (up to
  58% of the screen) and pulls up to full height from its handle. Pinch the body with two fingers
  to make the text smaller or larger, from 4pt below the timeline's body size to 10pt above it;
  prose and code change together, the line under your fingers stays put, and a **Text size**
  badge with **Reset** shows while you pinch. The size is saved on the daemon, so every phone on
  that host reads with it. Swipe the header sideways to step to the previous or next block.
- **Sideways, where the screen turns.** Paseo's iOS and Android apps keep a phone in portrait
  (`orientation: "portrait"` in Paseo 0.12's app config). In a phone browser turned sideways, or any
  window at least 600pt wide and under 500pt tall, the details move to a 400pt side panel so the
  timeline stays readable beside them.
- **Selection by touch.** On iOS a long press in a reply places a cursor and drags a selection.
  In a table, double-tap a cell to select it, or hold a cell and drag across rows and columns to
  select a block of cells; the copy menu appears when you lift.
- **Images.** The full-screen viewer pinches about your fingers from a quarter to eight times,
  pans when zoomed, resets on a double tap and closes on a drag up or down. Its file button reads
  **Copy path** and copies the file's absolute path, since the file lives on the daemon's machine.
- **Tasks in one hand.** The board shows one lane at a time under tabs with each lane's count
  (Input, Running, Review, Done and, while the archived lane is on, Archived); swipe or tap to
  switch. The lanes are native pages, so past the first lane a sideways swipe changes lane instead
  of opening Paseo's agent list. A card ends in its buttons, with Open last at the right. A tap opens
  a details sheet that steps through the lane's cards, with Open or Open to answer and Stop or
  Archive, or Deny and Allow, pinned at the bottom; Stop asks in the system dialog first. The header
  keeps search and the archived-lane switch plus Filters; the filter sheet holds the empty-groups
  and subtasks switches, agents, labels, the done window and the sort, and ends with the workspaces
  under a search field. Reset and "Show N tasks" stay pinned at its foot.

| Timeline | Block details drawer, mid-pinch | Tasks board |
| --- | --- | --- |
| <picture><source media="(prefers-color-scheme: dark)" srcset="images/mobile-timeline-dark.png"><img width="260" alt="iPhone: a timeline of compact tool rows, a finished three-item checklist, a reply with a code block and the turn footer, above Paseo's composer" src="images/mobile-timeline-light.png"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="images/mobile-details-drawer-dark.png"><img width="260" alt="iPhone: an edit's diff in the block details drawer at the bottom of the screen, mid-pinch, with the Text size 19 and Reset badge over the code" src="images/mobile-details-drawer-light.png"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="images/mobile-tasks-dark.png"><img width="260" alt="iPhone: the Tasks board with lane tabs and counts, showing the Input lane's two cards, each with Allow, Deny, Stop and Open tab" src="images/mobile-tasks-light.png"></picture> |
| **A running card's details** | **A waiting card's details** | **Filters** |
| <picture><source media="(prefers-color-scheme: dark)" srcset="images/mobile-tasks-sheet-dark.png"><img width="260" alt="iPhone: a running card's details sheet with the Running 2 of 5 stepper, the turn timer and context, and Stop and Open tab pinned at the bottom" src="images/mobile-tasks-sheet-light.png"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="images/mobile-tasks-sheet-input-dark.png"><img width="260" alt="iPhone: a waiting card's details sheet showing the command it asks to run, with Deny, Allow and Open tab pinned at the bottom" src="images/mobile-tasks-sheet-input-light.png"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="images/mobile-tasks-filters-dark.png"><img width="260" alt="iPhone: the Tasks filter sheet with the Show subtasks switch, agent and label choices with counts, and Reset and Show 4 tasks at the bottom" src="images/mobile-tasks-filters-light.png"></picture> |

### On iPad

- **Panels instead of a drawer.** From 600pt wide the details open as a floating panel centred over
  the chat, up to 760pt wide; from 960pt, when the chat keeps at least 400pt beside it, as a side
  panel 36% of the window wide (420–640pt). On the simulator an 11-inch iPad gets the floating panel
  in portrait and the side panel in landscape, and a 13-inch iPad gets the side panel already in
  portrait; by the same thresholds a Split View window under 600pt falls back to the drawer. Paseo hands plugins only full-screen modals on
  iOS and Android, so a tap outside the panel closes it (see
  [What a plugin cannot do](#what-a-plugin-cannot-do)).
- **Touch sizes, then pointer sizes.** The details header is 52pt with 36pt buttons and the toolbar
  44pt while you use your fingers. Once a trackpad hovers a row, they shrink to the desktop's 44pt
  and 36pt, a click expands a row in place, and the row's hover actions appear; long press still
  works.
- **A board that keeps its lanes.** The Tasks board keeps the desktop layout on a tablet. With no
  hover to reveal them, every card shows its buttons in a row under its timer: Stop, Mark as read or
  Archive, then Open at the right; a subtask with an openable parent also has Open parent; Stop asks
  in the system dialog. A tap chooses a card for the details. Where the details go depends on the
  board's width: a sidebar beside
  the lanes from 1,020pt (a 13-inch iPad in landscape), a floating panel over them from 784pt, and
  under 760pt (an 11- or 13-inch iPad in portrait with Paseo's sidebar open) a bottom sheet that
  leaves the lanes live. The sheet
  opens at half height, pulls to full, and lays the card out in two columns from 640pt. Below 760pt
  the board's header keeps search and the archived-lane switch, and folds the empty-groups switch,
  filters, done window, sort, subtasks switch and lane width into a sheet; the lanes keep their
  width and scroll sideways, from their headers and the gaps between cards as well as from the
  cards.

| 11-inch, portrait: floating panel | 11-inch, landscape: side panel |
| --- | --- |
| <picture><source media="(prefers-color-scheme: dark)" srcset="images/ipad-details-floating-dark.png"><img width="300" alt="11-inch iPad in portrait: an edit's diff in the block details floating panel, centred over the timeline and Paseo's sidebar" src="images/ipad-details-floating-light.png"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="images/ipad-details-side-dark.png"><img width="440" alt="11-inch iPad in landscape: Paseo's sidebar, the timeline, and an edit's diff in the block details side panel on the right" src="images/ipad-details-side-light.png"></picture> |

| 13-inch, landscape: Tasks with the details sidebar | 13-inch, portrait: Tasks with the details sheet |
| --- | --- |
| <picture><source media="(prefers-color-scheme: dark)" srcset="images/ipad-tasks-dark.png"><img width="440" alt="13-inch iPad in landscape: the Tasks board's filter bar and lanes, with a waiting card's details in the sidebar on the right" src="images/ipad-tasks-light.png"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="images/ipad-tasks-sheet-dark.png"><img width="300" alt="13-inch iPad in portrait: the Tasks board's lanes above a two-column bottom sheet with a waiting card's details" src="images/ipad-tasks-sheet-light.png"></picture> |

Keyboard shortcuts, the desktop hover preview, Command-click table ranges, and the board's
double-click and right-click menu are web and desktop only; an iPad with a keyboard does not get
them.

---

## Performance

### Web

Measured on 2026-10-23 on a Mac Studio with an Apple M5 Max, 18 cores, 64 GB and macOS 27.0.1, against Paseo 0.12.0 and its react-native-enriched-markdown reply renderer. The tested Better Paseo revision was f2f64009, built through the plugin install flow; the running minified bundle was verified. Web and iOS each covered 11 scenarios × 2 configurations (no plugin and Better Paseo) × 5 runs: 110 per platform, 220 total, serially with configuration order rotated by scenario. The clean bench daemon held one workspace and one active agent; one-minute load at run completion ranged from 13 to 29 (median 16). Web used Chrome 155.0.8059.85 at 1280×900. Tasks and Block details were enabled by default. Later UI commits 466b149d (touch viewer file action) and 7f857477 (localized viewer labels), and 7c781aa2, 7e8d412f and 925f4871 (Tasks parent navigation and subagent cards), do not change the measured timeline scenarios. The later timeline commits 9607e789 ("perf(details): defer inactive timeline details work") and d4f68108 ("perf(details): mount row markers only after selection") were checked separately across 11 scenarios with no slowdown; history replay was effectively flat at 0.896 versus 0.887 seconds on Web and 2.78 versus 2.77 seconds on iOS. The tables remain the 220-run results for f2f64009, not measurements of those later commits.

![Web main-thread time](docs/perf/readme/web-cpu.en.svg)

Whole-replay main-thread Task time versus no plugin: 9 lower, 1 even and 1 higher. A change under 10% is even; if both whole-replay times are below 0.5 seconds, it is also even. On the long reply, Task time was 15.617 seconds without the plugin and 3.153 seconds with Better Paseo, an 80% reduction.

| Scenario | No plugin | Better Paseo | vs no plugin |
| --- | ---: | ---: | :--- |
| Code block streaming | 3.714 | **1.401** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;62% |
| Large diff | 0.272 | **0.250** | even |
| History replay | 0.701 | **0.975** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;39% |
| Long reply | 15.617 | **3.153** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;80% |
| Mixed turn | 1.009 | **0.785** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;22% |
| 20 file reads | 0.778 | **0.640** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;18% |
| Reasoning, prose | 1.584 | **1.007** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;36% |
| Reasoning, sections | 1.419 | **0.888** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;37% |
| Large shell log | 0.613 | **0.423** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;31% |
| Table streaming | 2.242 | **1.012** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;55% |
| Growing tool log | 1.075 | **0.906** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;16% |

Total timeline-row render time (host Profiler allRows.sum, milliseconds), versus no plugin: 9 lower, 0 even and 2 higher.

| Scenario | No plugin | Better Paseo | vs no plugin |
| --- | ---: | ---: | :--- |
| Code block streaming | 1,491.6 | **123.2** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;92% |
| Large diff | 17.8 | **13.1** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;26% |
| History replay | 164.8 | **260.6** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;58% |
| Long reply | 9,733.0 | **238.1** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;98% |
| Mixed turn | 117.6 | **50.4** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;57% |
| 20 file reads | 79.3 | **56.5** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;29% |
| Reasoning, prose | 325.8 | **71.9** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;78% |
| Reasoning, sections | 294.4 | **68.5** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;77% |
| Large shell log | 18.4 | **11.4** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;38% |
| Table streaming | 832.7 | **78.1** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;91% |
| Growing tool log | 32.4 | **52.0** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;60% |

### Streaming layout shift

Cumulative layout shift (CLS) for the same Web runs; lower is better and values are shown to six decimal places. The 0.5-second rule does not apply. Percentages can magnify tiny baselines, so read the absolute values too; values below 0.002 are generally hard to see. Versus no plugin: 3 lower, 3 even and 5 higher.

| Scenario | No plugin | Better Paseo | vs no plugin |
| --- | ---: | ---: | :--- |
| Code block streaming | 0.001333 | **0.030847** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;2214% |
| Large diff | 0.000015 | **0.000015** | even |
| History replay | 0.107329 | **0.008503** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;92% |
| Long reply | 0.054866 | **0.000015** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;100% |
| Mixed turn | 0.002791 | **0.026655** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;855% |
| 20 file reads | 0.000015 | **0.000793** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;5335% |
| Reasoning, prose | 0.000015 | **0.000778** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;5235% |
| Reasoning, sections | 0.000015 | **0.000778** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;5235% |
| Large shell log | 0.000015 | **0.000015** | even |
| Table streaming | 0.046049 | **0.016243** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;65% |
| Growing tool log | 0.000015 | **0.000015** | even |

### iOS

Paseo 0.12.0 Release simulator build on an iPhone 17 Pro / iOS 26.5 simulator, cold-launched for every sample, with the React profiling renderer for the row probe. Paseo 0.12 lays out Markdown on native threads, so the main iOS metric is whole-app-process CPU time over the replay. These simulator measurements do not establish physical-device performance.

![iOS app CPU time](docs/perf/readme/ios-cpu.en.svg)

Whole-app CPU time versus no plugin: 3 lower, 7 even and 1 higher. On the long reply, the host used 30.64 seconds and Better Paseo 8.16 seconds (73% less). The frame probe recorded medians of 1,253 dropped frames on the host and 12 with Better Paseo; the longest frames were 388 ms and 78 ms.

| Scenario | No plugin | Better Paseo | vs no plugin |
| --- | ---: | ---: | :--- |
| Code block streaming | 3.54 | **3.27** | even |
| Large diff | 0.40 | **0.43** | even |
| History replay | 1.96 | **2.19** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;12% |
| Long reply | 30.64 | **8.16** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;73% |
| Mixed turn | 1.47 | **1.37** | even |
| 20 file reads | 1.24 | **1.34** | even |
| Reasoning, prose | 2.46 | **2.31** | even |
| Reasoning, sections | 2.17 | **1.99** | even |
| Large shell log | 0.83 | **0.68** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;18% |
| Table streaming | 2.19 | **2.17** | even |
| Growing tool log | 1.86 | **1.67** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;10% |

JavaScript timeline-row render time (host Profiler allRows.sum, milliseconds), versus no plugin: 3 lower, 0 even and 8 higher. Paseo performs Markdown layout on native threads, so this JavaScript-only probe does not represent total app CPU.

| Scenario | No plugin | Better Paseo | vs no plugin |
| --- | ---: | ---: | :--- |
| Code block streaming | 584.8 | **317.0** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;46% |
| Large diff | 9.8 | **41.9** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;329% |
| History replay | 47.2 | **115.4** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;145% |
| Long reply | 19,925.6 | **704.1** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;96% |
| Mixed turn | 82.5 | **131.4** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;59% |
| 20 file reads | 97.1 | **152.7** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;57% |
| Reasoning, prose | 127.6 | **174.2** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;37% |
| Reasoning, sections | 115.0 | **158.7** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;38% |
| Large shell log | 10.1 | **39.4** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;290% |
| Table streaming | 289.6 | **186.8** | <img src="docs/perf/readme/arrow-up.svg" width="11" height="13" alt="better">&ensp;35% |
| Growing tool log | 71.1 | **124.3** | <img src="docs/perf/readme/arrow-down.svg" width="11" height="13" alt="worse">&ensp;75% |

Green ⬆ is lower; red ⬇ is higher. Percentages use unrounded medians. `history-100` is a fixture name, not 100 actual provider turns; it is labelled “History replay”. `tool-expanded-streaming` performs no expand action and is labelled “Growing tool log”.

**Method and limits.** Web main-thread time is CDP TaskDuration for a whole replay; the row table is the sum of the host React Profiler row timings. iOS app CPU covers the whole process, including native threads; iOS row timings cover JavaScript work only. Every table uses the median of five runs per cell; percentage changes use unrounded medians. Changes under 10% are even; for whole Web replays, both sides below 0.5 seconds are also even. CLS has no 0.5-second floor; use its six-decimal absolute values because percentages can grow around near-zero baselines. The comparison with Beautiful Chat 42b61d8 was measured on Paseo 0.11.2 and was not repeated on 0.12. Tasks and Block details were on by default. Separate A/B runs show Tasks increased Web history-replay main-thread time from 0.885 to 0.941 seconds (+6%), and increased JS heap by about 1.3–2.1 MB across the paired fixtures; iOS history-replay app CPU changed about 2%. Turning Block details off reduced iOS JavaScript row time by 12–17% in three fixtures, while app CPU changed only about 2–4%. One known source of history-replay overhead is that each host agent update supplies a fresh `features` array even when it is unchanged, making the whole agent view and row-render callbacks render again whether Tasks is on or off; reported upstream as [getpaseo/paseo#7773](https://github.com/getpaseo/paseo/issues/7773) with a fix in [#7774](https://github.com/getpaseo/paseo/pull/7774).

### Where the time goes

- **Skip unchanged rows.** Semantic theme/data comparisons let unchanged cards skip rendering.
- **Parse replies incrementally.** Finished Markdown blocks are cached; only the growing tail is
  repaired. Long replies split into blocks that the native host can virtualize; Copy retains the
  full source.
- **Draw tool bodies on demand.** Collapsed rows do not mount their bodies. Completed code requests
  daemon highlighting; large code and terminal output render in batches with a Show all control.
- **Reduce continuous animation work.** The Web running dot uses CSS and stops for Reduced Motion;
  decorative shadows, blur and breathing loops are removed.
- **Send less on reconnect.** Paseo sends every plugin's client bundle again each time an app
  reconnects, and behind the relay a phone decrypts it in JavaScript. The install step minifies the
  client, and the Tasks board, its sidebar entry and its settings tab are a separate 304 KB chunk
  fetched once per app launch while the board is on and never while it is off: the catalog on a
  Paseo 0.12 daemon fell from 1,977 KB to 722 KB. Brand marks and Inter are delivered on demand,
  and the client source stays ASCII for Hermes one-byte strings.

---

## Memory comparison

2026-10-23 Web production-profiling runs; each value is the median of five post-GC readings, from the same replay matrix as the main-thread table. This is JavaScript heap, not total process or app memory. Differences are Better Paseo minus no plugin, in MB; the 10% even rule does not apply. Better Paseo used 5.1–14.2 MB more heap across the listed scenarios.

![Web JavaScript heap and DOM nodes](docs/perf/readme/web-memory.en.svg)

| Scenario | No plugin | Better Paseo | Difference |
| --- | ---: | ---: | ---: |
| Code block streaming | 83.1 | **88.2** | +5.1 |
| Large diff | 76.9 | **85.8** | +8.9 |
| History replay | 83.6 | **97.4** | +13.8 |
| Long reply | 82.5 | **96.7** | +14.2 |
| Mixed turn | 79.6 | **89.4** | +9.8 |
| 20 file reads | 80.1 | **91.5** | +11.4 |
| Reasoning, prose | 78.5 | **86.5** | +8.1 |
| Reasoning, sections | 78.0 | **86.4** | +8.4 |
| Large shell log | 77.9 | **86.5** | +8.6 |
| Table streaming | 79.1 | **88.3** | +9.2 |
| Growing tool log | 79.8 | **90.9** | +11.0 |

Raw Web samples from this round are kept in the local, git-ignored docs/bench/2026-10-23-paseo-012-f2f64009 archive; they are not stored in git.

---

## Timeline

Screenshots taken on 2026-10-23 from the code at `f2f64009`. The manifest records `118f5903`, this
README's branch, whose `client`, `server` and `shared` are identical to `f2f64009`. Card and setting
screenshots come from the offline Web showcase; the desktop title shots from Paseo 0.12.0 on the
web; the phone and iPad shots from Paseo 0.12 Release builds on iOS 26.5 simulators (iPhone 17
Pro, 11-inch and 13-inch iPad). All data is sample fixture data. Every screenshot defaults to light
and switches to dark with the reader's theme. Performance versions and conditions are identified
above. [Capture manifest](docs/images/screenshots.json).

Everything below is on top of what Beautiful Chat already drew: typed tool cards, Shiki
highlighting, image reads, opening files and the plugin's own find bar.

<picture><source media="(prefers-color-scheme: dark)" srcset="images/thread-dark.png"><img alt="One whole turn, top to bottom" src="images/thread-light.png"></picture>

### Tool rows

Most cards read the tool detail Paseo hands every plugin, so they work whichever agent made the
call: reads, writes, edits, shell and Git commands, searches, fetches, sub-agents, plans, MCP calls
(in Claude's `mcp__server__tool`, Codex's `server.tool` and Oh My Pi's `server / tool` forms) and
Paseo's own tools. Calls Paseo passes as plain text get a label-and-text card.

Oh My Pi's `hub` tool and its GitHub device calls are matched by name and have cards of their
own; no other agent sends them. On Paseo 0.11 and later, Oh My Pi's `eval` and `ask` calls reach
plugins as plain text and `task` arrives as a sub-agent item. If `ask` also carries structured
`questions` data, it gets a question transcript; otherwise it stays a generic text card.

- Every call starts as one borderless row with a summary built for its type: the command, the path
  and line range, `+4 −2` for an edit, the exit code and duration. The row is 26pt, 28pt in
  Paseo's compact phone layout, and grows with **Block text size**. With a pointer a click expands
  the card in place; on a touch screen a tap opens its [details](#block-details), and a tap on the
  icon at the row's start expands it.
- The open or closed state is kept per call (`agentId:callId`) outside the component, so it
  survives completion, scrolling into history and remounts. On iOS and Android the header stays
  where it was pressed and the content opens below it.
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
- When a background sub-agent from an earlier turn keeps reporting, Paseo 0.12 can append a second
  copy of a tool row; the plugin hides such copies (see
  [Paseo issues the plugin works around](#paseo-issues-the-plugin-works-around)).

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

### Tool icons

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/tool-icons-dark.png"><img alt="Every icon a tool row can draw: four real shell rows and four MCP and agent rows on top, then 16 tool kinds, 101 shell program icons and 75 MCP services, grouped by what they are for" src="docs/images/tool-icons-light.png"></picture>

<sub>Captured on 2026-10-25 from `2490d376` in the offline Web showcase, at 2x. Every icon in it comes
from the plugin's own lookups, so a name the plugin does not know would fail the capture.</sub>

The icon at the start of a tool row says what the call works on, not only which tool made it:

- **Shell commands draw the program they run**: 101 icons for 209 programs, from `python` and
  `cargo` to `kubectl`, `xcrun simctl` and `ffmpeg`. The plugin reads past shell setup and wrappers
  (`cd app &&`, `sudo`, `env`, `FOO=1`), drops version suffixes and `.exe` (`python3.12` is
  `python`, `pip3` is `pip`), and a runner draws the program it fetches when that one has an icon
  (`npx playwright test` draws Playwright). Coding agents started from the shell (`claude`,
  `codex`, `gemini` and the rest) draw the same provider mark as their agent rows. A program it
  does not know keeps the terminal icon.
- **MCP calls draw the service they call**: 75 services, matched by the server's name with case and
  separators dropped, so Claude's connectors (`claude_ai_Google_Calendar`), local servers
  (`linear-server`, `mcp-server-git`) and the Codex and Oh My Pi forms all match. Atlassian's
  server draws Confluence for its `confluence_*` tools and Jira for the rest. An unknown server
  keeps the plug.
- **Everything else draws its kind**: shell, read, edit and write, search, fetch, Git, GitHub,
  sub-agent, MCP, plan, thinking, question, Oh My Pi's hub, Paseo, plain text and a wrench for the
  rest.
- Brand marks are line drawings in the row's icon colour, matched to the 1.5 stroke of Paseo's own Lucide
  icons, so a turn that mixes tools still reads as one icon set. The daemon serves each mark the
  first time a row needs it, so their image data stays out of the client bundle Paseo resends on
  every reconnect.
- **Row icons and labels** in settings shows the icon, the tool's label or both.

<details>
<summary>All 209 shell programs and their icons</summary>

| Group | Icon | Programs |
| --- | --- | --- |
| Languages and runtimes | Python mark | `python` `pip` `uv` `uvx` `poetry` `pytest` `ipython` `conda` `pipx` `ruff` `mypy` |
|  | Node.js mark | `node` |
|  | Deno mark | `deno` |
|  | Bun mark | `bun` `bunx` |
|  | TypeScript mark | `tsc` `tsx` `ts-node` |
|  | Lucide `Coffee` | `java` `javac` `jar` `mvn` `mvnw` `gradle` `gradlew` |
|  | Kotlin mark | `kotlin` `kotlinc` |
|  | Go mark | `go` `gofmt` |
|  | Rust mark | `cargo` `rustc` `rustup` |
|  | Lucide `Gem` | `ruby` `gem` `bundle` `bundler` `rake` `rails` `irb` |
|  | PHP mark | `php` `composer` |
|  | Swift mark | `swift` `swiftc` |
|  | C++ mark | `gcc` `g++` `clang` `clang++` `cmake` |
|  | C# mark | `dotnet` |
|  | Flutter mark | `flutter` `dart` |
|  | PowerShell mark | `pwsh` `powershell` |
| Packages and build | npm mark | `npm` `npx` |
|  | pnpm mark | `pnpm` `pnpx` |
|  | Yarn mark | `yarn` |
|  | Lucide `Beer` | `brew` |
|  | Lucide `Hammer` | `make` |
|  | Vite mark | `vite` |
|  | webpack mark | `webpack` `webpack-cli` |
|  | Turborepo mark | `turbo` |
| Front end and frameworks | ESLint mark | `eslint` |
|  | Prettier mark | `prettier` |
|  | Next.js mark | `next` |
|  | Nuxt mark | `nuxt` `nuxi` |
|  | Angular mark | `ng` |
|  | Astro mark | `astro` |
|  | Svelte mark | `sv` `svelte-kit` |
|  | Vue mark | `vue` |
|  | Tailwind CSS mark | `tailwindcss` |
|  | React Native mark | `react-native` |
|  | Expo mark | `expo` `eas` |
|  | Lucide `Atom` | `electron` `electron-builder` `electron-forge` |
|  | Django mark | `django-admin` |
|  | Laravel mark | `laravel` |
|  | Jupyter mark | `jupyter` `jupyter-lab` `jupyter-notebook` |
| Tests and browsers | Vitest mark | `vitest` |
|  | Lucide `FlaskConical` | `jest` `mocha` |
|  | Playwright mark | `playwright` |
|  | Puppeteer mark | `puppeteer` |
|  | Cypress mark | `cypress` |
|  | Storybook mark | `storybook` |
|  | Chrome mark | `google-chrome` `google-chrome-stable` `chrome` `chromium` `chromium-browser` |
|  | Postman mark | `postman` `newman` |
| Apple and Android | Apple mark | `xcodebuild` `xcrun` `pod` |
|  | Lucide `Smartphone` | `simctl` `serve-sim` `ios-deploy` |
|  | Android mark | `adb` `emulator` `avdmanager` `sdkmanager` |
| Cloud and deploy | AWS mark | `aws` |
|  | Google Cloud mark | `gcloud` `gsutil` |
|  | Azure mark | `az` |
|  | Vercel mark | `vercel` |
|  | Cloudflare mark | `wrangler` |
|  | Supabase mark | `supabase` |
|  | Firebase mark | `firebase` |
|  | Netlify mark | `netlify` `ntl` |
|  | Heroku mark | `heroku` |
|  | Stripe mark | `stripe` |
| Containers and infrastructure | Docker mark | `docker` `docker-compose` |
|  | Lucide `Container` | `podman` `podman-compose` |
|  | Lucide `ShipWheel` | `kubectl` `helm` `minikube` `kind` `k9s` |
|  | Terraform mark | `terraform` |
|  | Ansible mark | `ansible` `ansible-playbook` `ansible-galaxy` `ansible-vault` `ansible-inventory` |
|  | Nginx mark | `nginx` |
|  | Lucide `Server` | `ssh` `scp` `sftp` `rsync` `mosh` |
| Data | PostgreSQL mark | `psql` `pg_dump` `pg_restore` |
|  | MySQL mark | `mysql` `mysqldump` |
|  | MongoDB mark | `mongosh` `mongo` |
|  | Lucide `Feather` | `sqlite` |
|  | Redis mark | `redis-cli` `redis-server` |
|  | Kafka mark | `kcat` `kafkacat` `kafka-topics.sh` `kafka-console-consumer.sh` `kafka-console-producer.sh` |
|  | Prisma mark | `prisma` |
| CI and monitoring | Jenkins mark | `jenkins` `jenkins-cli` |
|  | CircleCI mark | `circleci` |
|  | SonarQube mark | `sonar-scanner` |
|  | Grafana mark | `grafana` `grafana-cli` |
|  | Prometheus mark | `prometheus` `promtool` |
|  | Lucide `Dog` | `datadog-ci` |
|  | Jira mark | `jira` |
| Code hosting, agents and editors | GitHub mark | `gh` |
|  | GitLab mark | `glab` |
|  | Paseo mark | `paseo` |
|  | Claude provider mark | `claude` |
|  | Codex provider mark | `codex` |
|  | Gemini provider mark | `gemini` |
|  | OpenCode provider mark | `opencode` |
|  | Cursor provider mark | `cursor-agent` |
|  | Copilot provider mark | `copilot` |
|  | Ollama provider mark | `ollama` |
|  | Oh My Pi provider mark | `omp` |
|  | VS Code mark | `code` |
|  | Vim mark | `vim` `vi` `gvim` |
| Utilities | Lucide `Globe` | `curl` `wget` `http` `xh` |
|  | Lucide `Search` | `rg` `grep` `find` `fd` `ag` |
|  | Lucide `Braces` | `jq` `yq` |
|  | Lucide `FileDiff` | `diff` `colordiff` `difft` |
|  | Lucide `Archive` | `tar` `zip` `unzip` `gzip` `gunzip` `7z` `xz` |
|  | Lucide `Clapperboard` | `ffmpeg` `ffprobe` |
|  | Lucide `ExternalLink` | `open` `xdg-open` |

</details>

<details>
<summary>All 75 MCP services and their icons</summary>

The name is lower-cased and stripped of everything but letters and digits before it is matched,
so `Google_Calendar`, `google-calendar` and `googlecalendar` are the same name. A name matches
when it contains the listed word; a word with `*` only matches at the start, and Git and Time match
only their whole names, so `github` and `timeline` stay out.

| Group | Service | Icon | Server names it matches |
| --- | --- | --- | --- |
| Code and CI | GitHub | GitHub mark | `github` |
|  | GitLab | GitLab mark | `gitlab` |
|  | Git | Lucide `GitBranch` | `git`, `mcp-server-git`, `git-mcp` |
|  | Gitee | Gitee mark | `gitee` |
|  | Bitbucket | Bitbucket mark | `bitbucket` |
|  | Jenkins | Jenkins mark | `jenkins` |
|  | CircleCI | CircleCI mark | `circleci` |
|  | SonarQube | SonarQube mark | `sonar` |
|  | Ansible | Ansible mark | `ansible` |
| Work and docs | Linear | Linear mark | `linear` |
|  | Jira | Jira mark | `jira`, `atlassian` |
|  | Confluence | Confluence mark | `confluence`; Atlassian tools named `confluence_*` |
|  | Notion | Notion mark | `notion` |
|  | Trello | Trello mark | `trello` |
|  | Asana | Asana mark | `asana` |
|  | Airtable | Airtable mark | `airtable` |
|  | Figma | Figma mark | `figma` |
|  | Sentry | Sentry mark | `sentry` |
| Chat and mail | Slack | Slack mark | `slack` |
|  | Feishu / Lark | Feishu mark | `feishu`, `lark` |
|  | DingTalk | DingTalk mark | `dingtalk`, `dingding` |
|  | WeCom | WeCom mark | `wecom`, `wework`, `wechatwork`, `qywx` |
|  | Microsoft Teams | Teams mark | `teams` |
|  | Discord | Discord mark | `discord` |
|  | Telegram | Telegram mark | `telegram` |
|  | Gmail | Gmail mark | `gmail` |
|  | Zapier | Zapier mark | `zapier` |
| Google | Google Calendar | Google Calendar mark | `googlecalendar`, `gcal` |
|  | Google Drive | Google Drive mark | `googledrive`, `gdrive` |
|  | Google Maps | Google Maps mark | `googlemaps`, `gmaps` |
|  | YouTube | YouTube mark | `youtube` |
| Browsers and devices | Chrome | Chrome mark | `chrome` |
|  | Playwright | Playwright mark | `playwright` |
|  | Puppeteer | Puppeteer mark | `puppeteer` |
|  | Browserbase, browser-use | Lucide `AppWindow` | `browserbase`, `browseruse`, `browsermcp`, `browsertools` |
|  | iOS Simulator | Lucide `Smartphone` | `iossimulator`, `simulator`, `simctl`, `servesim`, `mobile*` |
|  | Xcode | Apple mark | `xcode` |
|  | Android | Android mark | `android`, `adb` |
|  | Computer use | Lucide `MousePointer2` | `computeruse`, `cuadriver` |
|  | Desktop Commander | Lucide `SquareTerminal` | `desktopcommander` |
| Cloud and data | AWS | AWS mark | `aws`, `bedrock` |
|  | Docker | Docker mark | `docker` |
|  | Kubernetes | Lucide `ShipWheel` | `kubernetes`, `k8s`, `kubectl` |
|  | Terraform | Terraform mark | `terraform` |
|  | Vercel | Vercel mark | `vercel` |
|  | Cloudflare | Cloudflare mark | `cloudflare` |
|  | Supabase | Supabase mark | `supabase` |
|  | Firebase | Firebase mark | `firebase` |
|  | Netlify | Netlify mark | `netlify` |
|  | Heroku | Heroku mark | `heroku` |
|  | Stripe | Stripe mark | `stripe` |
|  | PostgreSQL | PostgreSQL mark | `postgres` |
|  | MySQL | MySQL mark | `mysql` |
|  | MongoDB | MongoDB mark | `mongo` |
|  | SQLite | Lucide `Feather` | `sqlite` |
|  | Redis | Redis mark | `redis` |
|  | Kafka | Kafka mark | `kafka` |
|  | Elastic | Elastic mark | `elastic`, `kibana` |
| Monitoring | Grafana | Grafana mark | `grafana` |
|  | Prometheus | Prometheus mark | `prometheus` |
|  | Datadog | Lucide `Dog` | `datadog` |
|  | Postman | Postman mark | `postman` |
| Search and utilities | Brave Search | Brave mark | `brave` |
|  | Perplexity | Perplexity mark | `perplexity` |
|  | Tavily, Serper, SearXNG, Kagi, Exa | Lucide `Search` | `tavily`, `serper`, `searxng`, `kagi`, `exa*` |
|  | Fetch, Firecrawl | Lucide `Globe` | `fetch`, `firecrawl` |
|  | Context7 | Lucide `LibraryBig` | `context7` |
|  | Memory | Lucide `BrainCircuit` | `memory` |
|  | Sequential Thinking | Lucide `Lightbulb` | `sequentialthinking` |
|  | Time | Lucide `Clock` | `time`, `mcp-server-time`, `time-mcp` |
|  | Filesystem | Lucide `FolderOpen` | `filesystem` |
|  | EverArt | Lucide `Palette` | `everart` |
|  | Everything | Lucide `Blocks` | `everything` |
|  | OpenAI | OpenAI mark | `openai` |
|  | Paseo | Paseo mark | `paseo*` |

</details>

<details>
<summary>The 16 tool kinds</summary>

| Kind | Icon |
| --- | --- |
| Shell (`bash`, `shell`) | Lucide `SquareTerminal`, or the program's icon |
| Read | Lucide `FileText` |
| Edit, Write | Lucide `Pencil` |
| Search | Lucide `Search` |
| Fetch | Lucide `Globe` |
| Git, worktree setup | Lucide `GitBranch` |
| GitHub | GitHub mark |
| Sub-agent | Lucide `Bot`, or the agent's provider mark on agent rows |
| MCP | Lucide `Plug`, or the service's icon |
| Plan | Lucide `ListChecks` |
| Thinking | Lucide `Lightbulb` |
| Question | Lucide `MessageCircleQuestion` |
| Hub (Oh My Pi) | Lucide `Radio` |
| Paseo | Paseo mark |
| Plain text | Lucide `MessageSquare` |
| Anything else | Lucide `Wrench` |

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
- On web and desktop, double-click a cell to select its text. On iOS and Android, double-tap a cell.
  To select a block of cells, hold a cell and drag across rows and columns; with a mouse, dragging
  from one cell into another works too. On web and desktop, hold Command (Ctrl on Windows and
  Linux) and press or drag across cells to add another range without dropping the ones already
  selected; every range then takes the columns of the one drawn last. The menu appears on release:
  one cell copies its text, several copy a Markdown table of the selected rows and columns, in table
  order, under their header. The corner menu always offers
  **Copy selected**, and **Add to chat** where Paseo lets the plugin write into the composer.
- Each completed turn has a footer under its final reply with Copy and its time, plus the provider
  mark, model, thinking level and observed duration when available. Hover or long-press it for a
  **Turn details** table: agent, model, thinking level, start, end, elapsed time and input, cached
  and output tokens. The model name copies when pressed and confirms with a toast; completed-turn
  footers remain during a later run. Turn **Plugin markdown for replies** off to restore Paseo's
  full footer, including its Fork action.
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
- The full-screen viewer zooms from 0.25× to 8× with buttons, the wheel or a pinch about the
  pointer, pans by drag, resets on double press, and closes on a drag up or down, the backdrop,
  Esc or Android's back button. The viewer's file button opens the image in its default app on a
  desktop, on the daemon's machine (**Open in default app**, see [Opening files](#opening-files)); on
  a touch device it reads **Copy path** and copies the file's absolute path instead, since the file
  lives on the daemon's machine. The same holds for every image the viewer opens, from a read card
  or from a reply. On desktop and web, hover a toolbar button to see its name; viewer button names
  follow the plugin's language setting.
- On a touch device, a tap on an image row opens the viewer. A long press on the image card's
  header opens it on iOS and Android.
- Bytes come from the daemon (`file.image`) the first time a row is opened, previewed or
  long-pressed. PNG, JPEG, GIF, WebP, AVIF, BMP, ICO and SVG are recognised; files over 3 MB report
  their size instead of inlining.
- When multiple read cards point to the same image, each card displays it.

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/shared-image-cards-dark.png"><img alt="Two read cards displaying the same image" src="docs/images/shared-image-cards-light.png"></picture>

### Hover previews

On desktop and web, resting the pointer on a collapsed tool row, thought row, image or path opens
a scrollable preview after a delay you set (0–10 s). It can wrap lines, show line numbers and
alternating shading, and can be moved, resized or maximized. A checklist can open its live list in a
floating window, and a Markdown code block can open its own maximized preview. When a preview is
following live output, it glides along as the content grows. With block details on, the preview's
header gains **Open in panel**. With block details off, long-press a collapsed row on a phone or
tablet to open the same preview between Paseo's top bar and composer, where it can be dragged,
resized and its text selected.

### Paths, copying and selection

- Paths are relative to the workspace and shortened in the middle, keeping the file name; a
  worktree's main repository is shown by name. Copying always gives the absolute path.
- Copy goes through the host's `copyText` everywhere, so it works on iOS and Android too: hover on
  desktop, the row menu on touch (long press), or the `⋯` menu. Plain-text code blocks can wrap and
  have a copy button.
- Selecting text in a card on web or desktop raises **Copy** and **Add to chat**, which quotes the
  selection in the composer, fenced when it came from code. The bar closes on scroll; if no composer
  is visible, **Add to chat** copies the selection instead.

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/selection-actions-dark.png"><img alt="Selected text with Copy and Add to chat actions" src="docs/images/selection-actions-light.png"></picture>

### Prompt bubble

Paseo draws the prompt by default, keeping pasted images and its rewind menu. **Enhanced prompt
bubble** switches eligible prompts to the plugin's bubble: an always-visible copy button and, for
the newest prompt while this client watches its turn, the turn's token usage. It draws images when
it can extract a supported image source; a prompt with an attachment it cannot render stays with
Paseo. Released Paseo does not hand plugins its rewind menu, so the plugin's bubble has none (see
[What a plugin cannot do](#what-a-plugin-cannot-do)).

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/user-dark.png"><img alt="Prompt bubble" src="docs/images/user-light.png"></picture>

### Errors and system messages

- An agent error is drawn as a notice card carrying its message.
- Oh My Pi sends job results, relayed messages and reminders as message text wrapped in tags such
  as `<system-notice>` or `<irc>`, and Paseo files them as replies. With **Plugin markdown for
  replies** on, they are drawn as system cards (a title, chips for agent, status and duration, and
  the rest of the body) instead of raw XML.

Paseo still draws native permission prompts and owns their approve and deny actions. Agent-operation
cards can also show a child's pending permission or structured questions read-only; answer them in
that agent's chat.

### Language

With **Language** on **Follow Paseo**, the plugin uses the language set in Paseo, or the device's
when Paseo follows the system; English and Simplified Chinese are drawn. That covers the settings
page, the Tasks board and the timeline's own words: tooltips, copy menus and toasts, the details
panel, the thought row's verb and step count, the reply footer and its turn details, question
transcripts, status words and image-viewer button names. Other accessibility labels and everything
the agent wrote stay as they are.

---

## Block details

A block's details open from its row: a tap on a touch screen; on desktop and web, **Open in
panel** in the hover preview or **Open details** in the row menu (right-click). Tool, thought,
activity, checklist and code block rows open them; an image row opens the image viewer instead.
A second tap on the open row closes the panel.

The form follows the window, and changes once the window has held its new size for a moment,
keeping the block, its scroll position and wrap:

| Window | Form |
| --- | --- |
| under 600pt wide | bottom drawer with a scrim, full width |
| at least 600pt wide and under 500pt tall (a phone browser turned sideways; Paseo's apps keep phones in portrait) | side panel, 400pt |
| 600–960pt, or wider when a side panel does not fit | floating panel centred over the chat, up to 760pt |
| from 960pt, when the chat keeps at least 400pt beside it | side panel on the right, 36% of the window (420–640pt) |

Each change has a 16pt margin, so a window resized around a threshold does not flip back and
forth. On web the floating and side panels are not modal: the rows behind stay live, and the side
panel's left edge drags its width. On iOS and Android every form is a modal; the floating and side
panels close on a tap outside them, and Android's back button closes any form.

- **Header.** The row's icon, a title that grows to four lines, the block's status, duration and
  place in the turn, and previous, next and close. On a touch screen, swipe the header to step
  between blocks; at the oldest loaded block a swipe back asks for older rows. The timeline scrolls
  the open row into view and marks it.
- **Toolbar.** Wrap, the content's own controls (the pager of a merged row or a question, render
  or raw), the tool's copy actions and full screen. Copies that do not fit fold into **More**; the
  first stays visible. A streaming block follows its tail, with a **Back to latest · N new lines**
  pill once you scroll up.
- **Drawer.** Its height fits the content, up to 58% of the screen, and a running block grows it
  up to that cap. Tap the handle to switch between fit and full height; drag the handle or the
  header, or pull down once the body is at its top. A drag down from fit closes it, and a quick
  flick down from full height closes it too.
- **Pinch to size the text (iOS and Android, drawer only).** Two fingers on the body set the text
  size from 4pt smaller to 10pt larger than the timeline's body text; prose and code move by the
  same step and the header and toolbar keep their size. The line under your fingers stays under
  them, and a **Text size** badge with **Reset** shows while you pinch and for two seconds after.
  The size is saved on the daemon when you lift your fingers, so every phone connected to it reads
  with the same size; it has no control on the settings page, and resetting all settings clears
  it. On a very long body the text is laid out once when the fingers lift rather than live.
- **Prose size.** In the drawer, block prose reads at the timeline's body size; rows, previews and
  the other forms keep **Block text size**.
- **Row menu.** A long press, or a right-click, opens the row's menu: the tool's copies first, then
  view image, open details and expand or collapse in the timeline.
- **Keys (web and desktop).** ← and → step blocks, `[` and `]` page a merged row, W wraps, R
  renders, F goes full screen, Cmd/Ctrl+C copies the main content when no text is selected, and Esc
  closes.
- Turn **Block details panel** off to go back to tap-to-expand and the long-press preview on touch
  screens.

---

## Tasks board

**Tasks** sits in the sidebar's top group (counting needs input · running · to review) and in the
Command Center. It opens a board of every agent on the host in lanes, sorted the way the sidebar's
workspace status sorts them: **needs input** (oldest wait first), **running** (longest first),
**to review** (finished unread, or failed), **done** (last 24 hours by default, 50 at a time) and
**archived** (archived agents, and those of archived workspaces, in the same window). A parent
whose own turn has ended stays in running while a subtask still runs or waits, timed by their work;
a failed parent stays in to review.

The board is on by default. Its switch heads both tabs of the settings page, and the Tasks tab
follows it with a live preview of the board. Turned off, there is no sidebar entry or Command Center item, no agent
subscription, and the board's code is not fetched. Its options are listed under
[Tasks board settings](#tasks-board-settings).

### Cards

- A card reads top to bottom: "project › workspace" with Paseo's project icon (its image, or the
  initial on the project's colour) and, on a subtask, a link to its parent, tagged when the parent
  is archived; the status mark and title, with the context ring at the top right while a turn
  runs; then pills: one agent pill (the provider's mark, the model and the thinking level), the
  branch with its ahead count in green, behind in orange and a dot for uncommitted changes, the
  folder or path, labels led by a tag in Paseo's label colour, and the linked PR. Model, branch,
  folder and path copy on a press. The footer holds the timer (a running turn's start, then how
  long it has run) and the card's buttons. Which fields show is set by **Card density**.
- Label colours follow Paseo's label definitions, and project icons are the ones Paseo shows in its
  sidebar. On Paseo 0.12 the plugin's server reads both from the daemon itself; see
  [What a plugin cannot do](#what-a-plugin-cannot-do).
- The status marks are Paseo's own sidebar marks. A failed card is tinted red. The timer of a
  finished turn comes from the turn's recorded end, so opening an old agent's tab does not stretch
  it, and a Claude turn that ended on an error (a session limit, an invalid key) counts as failed.
- **Open** opens the agent's tab; a question request reads **Open to answer**. On desktop and web it
  appears with the card's other buttons when the pointer rests on the card, and a double-click opens
  the tab too; on a tablet the buttons always show in a row under the timer, and on a phone Open ends
  the action bar. A subtask card adds **Open parent** beside Open when Paseo can open the parent tab;
  its parent link remains above. A parent carries a subtask pill with a count per status; pressing
  it lists the children on the card, and a press on
  a child's row reveals and flashes that child's card.
- **Stop**, behind a Power icon, leads the buttons. With **Confirm before stopping** on, it asks
  for a second press on web and in the system dialog on iOS and Android. A parent can stop alone or
  with its running children. On a waiting desktop card Stop moves to the menu and the details,
  leaving the footer to the request: tool, plan and mode requests can be allowed or denied on the
  card; a structured question request shows its prompt text in the card summary and opens the tab to
  answer.
- **Mark as read** takes Stop's place on a card in to review, finished or failed, in the unread
  green. It clears the agent's attention in Paseo and moves the card to done until the next
  prompt, unless a turn or sub-agent fails after it.
- **Archive** on a done card archives the agent, as Paseo's own Archive does. An archived task has
  **Unarchive** where Open was, because Paseo cannot keep an archived agent's tab open for a plugin;
  Open returns once the task is back.
- On desktop and web a right-click opens the card's menu: open the tab; copy its session ID,
  title, workspace or project; Stop, Mark as read, Archive or Unarchive as the card allows.
- Sub-agents a provider runs itself (Claude Code's Agent tool) get read-only cards with dashed
  borders: in running while they work and in to review after they fail, with the parent's project
  and labels. They have no Stop, Mark as read or Archive; Open opens the parent's tab, where Paseo
  lists them. A failure since the parent's latest prompt also moves a finished parent to to
  review.
- Cards slide between lanes rather than jump, also when a filter changes; lanes ease as they
  collapse, expand or change width, and a lane's count rolls to its new value. Reduced Motion
  turns these off.

### Filters, sort and keys

- Filter by project, workspace, agent and label. The project and workspace menus have a search
  field, each project shows its folder under its name, and picking a project picks all its
  workspaces. The search box matches titles and project, workspace and branch names. Several picks
  of one filter fold into one chip ("2 projects and 1 workspace selected") led by the filter's
  icon. When the filters leave out some of a lane's cards, a line under the lane says how many and
  which filters.
- The bar ends with the done window (24h, 7d, ∞), switches for subtasks, the archived lane and
  groups with no active tasks, the sort and the lane width; a pointer resting on a control shows
  what it does. With subtasks hidden, a subtask folds into its parent's card, but running, waiting
  and failed ones keep their own card unless the parent's card is in the same lane. Sort by
  workspace, project, branch, folder, title, created, updated, context or duration; the sort covers
  the cards already loaded.
- Keys on desktop and web: J/K or ↑/↓ within a lane, H/L or ←/→ across lanes, Enter opens the
  focused card's tab, / searches, I toggles the sidebar, Esc backs out one layer at a time.

### Card details

A click or tap on a card opens it in the details. With no card chosen, the sidebar shows the lanes'
counts after the filters, with the filters summed up beside the total, and groups the board by
agent, project, workspace and label with their counts; a click on a group filters by it.

The header carries the status, title, model, thinking level, mode and labels, and the actions:
Open (or Open to answer for a question, first on desktop and last on touch), Stop, and Archive or
Unarchive. Then comes what the card needs first: the running turn (its clock ticking each second,
the session's total tokens with
the cached share for Claude Code and Codex, and the context), the pending permission, the error of
a failed run, or a summary of the last turn's time, cost and tokens. Then, with a waiting or failed
card putting Properties first:

- **First prompt** and the agent's **Last reply**, drawn as Markdown, each with Copy; a long
  one folds to four lines until you open it.
- **Subtasks**, drawn like Paseo 0.12's subagent rows: the agent's mark with the status on its
  corner (a green check for a finished child, an archive mark for an archived one), the title over
  model, thinking, mode and context, and counts per status above them. Ten show until the count line
  opens the rest.
- **Properties**: project with its icon, workspace and its kind; branch with ahead, behind and
  uncommitted changes; directory; PR; parent. Branch names and paths copy from their row; long
  paths fold their middle. An archived parent is tagged and offers **Unarchive**.
- **Usage**: context, a token mix chart, total cost and the last turn's time.
- **Activity**: created, last message, turn started or waiting, and the last update or failure.

### By screen size

| Board | Where the details go | Header |
| --- | --- | --- |
| Phone (Paseo's compact layout) | a sheet over the board that steps to the previous and next card of its lane, with Open or Open to answer and Stop or Archive, or the permission buttons, pinned at thumb height | one lane at a time behind tabs with lane counts; search and the archived-lane switch; the empty-groups switch and filters in a sheet |
| From 1,020pt | a sidebar beside the lanes; on desktop and web its edge drags its width, live | full filter bar |
| 784–1,020pt | a floating panel over the lanes, brought in by a card or the sidebar switch and put away by a click on blank lanes or Esc | full filter bar |
| Under 760pt (a foldable, a portrait tablet with Paseo's sidebar open) | a non-modal bottom sheet: half height, full from its handle, closed by a drag down, a click on blank lanes, the close button or Esc; two columns from 640pt | one row: search and the archived-lane switch, plus a sheet with empty-groups, filters, sort, subtasks, done window and lane width |

Each form holds for 24pt past its edge, so a board resized across a threshold does not flip back
and forth. On a tablet or desktop board too narrow for its lanes, the lanes keep their width and
scroll sideways. On a phone a card draws a shorter set of fields (status, title, agent pill, timer
and buttons always; project, workspace, branch, the first label and subtasks as set; the context
ring above 80%; the folder, path, Git status, PR and project icon only in the details), with larger
type and targets, and **Use minimal cards on phones** trims it further.

If the app reconnects while the board is open, it comes back with its cards, lane and filters
instead of starting over.

<picture><source media="(prefers-color-scheme: dark)" srcset="images/ipad-tasks-filters-dark.png"><img width="420" alt="11-inch iPad in portrait: a narrow Tasks board whose one-row header opened the filters, with subtasks, agents, labels, done range, lane width and sort" src="images/ipad-tasks-filters-light.png"></picture>

---

## Settings

**Settings → Plugins → Better Paseo**, page **Settings**. The page has two tabs,
**Chat presentation** and **Tasks board**; the switch that turns the board on sits at the top of
both. On the chat tab a sample turn drawn with the timeline's own components follows every change:
beside the options on a wide window, above them elsewhere. The Read row's hover preview is drawn
open in it. On web and desktop a **Desktop / Mobile** switch draws the same turn at phone width
with iOS styling and the inline-code colour you picked. Options whose parent is off are dimmed,
options a platform cannot use are hidden there, and **Reset** asks for a second press.

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/settings-dark.png"><img alt="Settings page with its live preview" src="docs/images/settings-light.png"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/settings-tools-dark.png"><img alt="Block text size setting with its live preview" src="docs/images/settings-tools-light.png"></picture>

| Group | Setting | Default | Effect |
| --- | --- | --- | --- |
| General | Language | Follow Paseo | English or 简体中文 for the settings page, the Tasks board and the timeline's own words. Follow Paseo uses Paseo's language, or the device's when Paseo follows the system. |
| Appearance | Accent colour | Theme | Follow the Paseo theme, or Jade, Violet, Amber or Rose. Only the accent changes. |
| Appearance | Interface font | Follow Paseo | Paseo's interface font, Inter (web only, fetched from the daemon) or the system face. |
| Appearance | Inline code on mobile | Dark grey | Text colour of inline code on iOS and Android: Dark grey, Blue, Violet, Green or Coral. Web keeps its grey chip. |
| Code font | Monospace font | Follow Paseo | Choose Follow Paseo or Custom. Follow Paseo uses, in order: the host's font settings once Paseo shares them; on web and desktop, the monospace font and size from Paseo's Appearance settings; otherwise Paseo's default monospace. On iOS and Android, Custom lists faces the platform ships. |
| Code font | Custom monospace family | Empty | Only used when Monospace font is Custom. Web accepts a family name up to 200 characters and falls back through the monospace stack if unavailable; iOS and Android offer only platform families. |
| Code font | Code font size | Follow Paseo | Or 10–22px; lines are 1.5× the size. Applies to code, diffs, terminals and paths. |
| Tool calls | Block text size | 13px | 9–20px for tool rows, thoughts, checklists and notices. Text inside those blocks grows with it. Code, diffs and terminal output keep the code font size. |
| Tool calls | Row icons and labels | Icon | Icon, label (Bash, Read…) or both at the start of tool and thought rows. |
| Tool calls | File paths | Relative | Relative to the workspace, or absolute. Copying always gives the absolute path. |
| Tool calls | Open failed calls | Off | On, a failed call opens to show its error. A call you opened or closed yourself keeps your choice. |
| Spacing | Tight rows | On | Reduces the gap under a plugin row from 16pt to 4pt when another row follows. Rows Paseo already stacks are left alone. Turn off if rows overlap. |
| Spacing | Tight reply | On | Reduces the gap from 16pt to 4pt when a finished reply is followed by a plugin row, including a checklist. Turn off if they overlap. |
| Messages | Enhanced prompt bubble | Off | Keeps Copy visible and shows the newest turn's token usage. Readable pasted images are drawn; prompts with other attachments stay with Paseo. Changing it updates existing prompts too. |
| Messages | Plugin markdown for replies | On | Off hands replies to Paseo, restoring its full footer and enabling mermaid, host images and Paseo's file links. |
| Messages | Markdown style | Document | Document, Compact or Terminal (body in the code font). |
| Messages | Selection toolbar | On | Web and desktop: Copy and Add to chat on selected text; the bar closes on scroll. |
| Hover previews | Hover previews | On | Preview collapsed rows and paths on desktop hover; with block details off, long-press a collapsed row on a touch screen. |
| Hover previews | Block details panel (preview) | On | On a touch screen a tap opens a row's [details](#block-details) in a drawer or panel, and a long press shows the row's actions; on desktop the hover preview and right-click menu open the panel. Off, a tap expands the row and a long press previews it. |
| Hover previews | Delay | 1 s | 0–10 s, saved to tenths of a second, before the desktop preview opens. Web and desktop only. |
| Hover previews | Wrap lines | On | Wrap long lines in preview panels, including raw text in maximized code previews; turn off to scroll horizontally. |
| Hover previews | Line numbers | On | Show line numbers beside files, diffs and command output; diffs use the file's own line numbers. |
| Hover previews | Alternating line shading | On | Shade every other line in preview panels. |

The drawer's pinch text size is stored with these settings but has no row here; pinch the drawer
to change it, and **Reset** clears it.

**Where settings live.** Preferences are stored by the daemon through the SDK's host-scoped settings
(record `presentation` in `shared/preferences-settings.ts`), so **every client connected to one
daemon shares them**: a change on the desktop shows up on iOS and the other way round. A value one
platform cannot draw is stored as chosen and degraded where it renders (a custom family becomes the
platform monospace on iOS and Android; Inter becomes the system face). On web, `localStorage` is
only a fast-start cache. The plugin asks the daemon for them as it loads, so the first rows
usually already use them; if they arrive later, rows draw with the cached value on web or the
defaults on iOS and Android, and switch once.

**Settings apply immediately.** Already displayed plugin items re-render as soon as local preference
state changes. The daemon stores the value and syncs it to other connected clients; reloading the chat
is not needed. **Open failed calls** uses the saved per-call choice when there is one, and otherwise
sets the call's initial state.

### Tasks board settings

The **Tasks board** tab draws sample agents in every lane and redraws them as each option changes;
on a wide page a **Desktop / Mobile** switch draws the board as a phone would. The record is
`tasks` in `shared/tasks-settings.ts`, stored and shared the same way as the chat settings above.

| Group | Setting | Default | Effect |
| --- | --- | --- | --- |
| Tasks board | Enable the Tasks board | On | Adds Tasks to the sidebar and the Command Center. Off, there is no entry, no agent subscription, and the board's code is not fetched. |
| Tasks board | Show the archived lane | On | A lane after Done with archived tasks and those of archived workspaces, in the done window. Also a switch on the board's toolbar. Off, the board asks the daemon for no archived agent. |
| Cards | Card density | Standard | Minimal, Standard or Full sets every field switch at once; editing one switch makes it Custom. |
| Cards | Fields | Standard's set | Agent brand mark, model, thinking level, project, project icon, workspace name, branch, Git status, folder, full path, labels, linked PR, timer, context usage ring and subtask summary. Standard leaves Git status, full path and linked PR off; Minimal keeps model, thinking and the timer. |
| Cards | Labels shown | 2 | 1, 2, 3 or all before the rest fold into +N. |
| Board | Done lane window | Last 24 hours | Last 24 hours, last 7 days or all, for Done and Archived. The board's own window control changes only that board. |
| Board | Lane width | Default | Narrow (260–280pt), Default (300–340pt) or Wide (340–400pt) on desktop, web and tablets, the same choice as the board's lane width menu; a board too narrow for them scrolls the lanes sideways. Phones show one lane at a time and hide this option. |
| Board | Show subtasks | On | Off, subtasks fold into their parent's card; running, waiting and failed ones keep their own card unless the parent's card is in the same lane. The toolbar switch changes only that board. |
| Board | Show groups with no active tasks | On | The filters and the sidebar list every agent, project, workspace and label in Paseo, with 0 where none is active. Also a switch on the toolbar. |
| Board | Confirm before stopping | On | Stop asks for a second press on web, and in the system dialog on iOS and Android. |
| Sidebar | Sidebar entry count | Needs input · Running · Review | Or needs input only, or hidden. |
| Phone | Use minimal cards on phones | Off | On, phones draw the Minimal card whatever the density. |
| Reset | Restore the Tasks defaults | — | Puts every Tasks option back; the board stays on or off. Asks for confirmation. |

---

## Finding text

Paseo's chat find (Ctrl/Cmd+F) cannot reveal a row a plugin draws. Better Paseo therefore takes
Ctrl/Cmd+F on desktop and web and opens its own find bar over the chat. It searches everything
rendered, including tool cards and structured question transcripts: Enter for the next match,
Shift+Enter for the previous, Escape to close. It only sees loaded messages; scroll up to include
older history.

To use Paseo's native find for replies, which also searches unloaded history, turn off **Plugin
markdown for replies** (and **Enhanced prompt bubble** if it is on). Paseo then draws replies and
prompts itself and Ctrl/Cmd+F opens its own find. Tool, reasoning and checklist cards stay with the
plugin.

## Opening files

A file name in a read, write, edit or code block is a link. On desktop it asks the daemon to open
the path, resolved against the agent's working directory, on the daemon's machine:

- **macOS:** `open` shows a file in its default app and a folder in Finder. An app, a script, an
  installer or any file with an execute bit is only revealed in Finder (`open -R`), so a press
  never runs it.
- **Windows:** Explorer selects the file, or opens the folder.
- **Other systems:** `xdg-open` opens the file's directory, or the folder itself.

On a touch device the same press copies the absolute path, with a toast, since a phone cannot reach
the daemon machine's screen. Paseo's own file panel is out of reach for now; see
[What a plugin cannot do](#what-a-plugin-cannot-do).

---

## What a plugin cannot do

Better Paseo draws only what the Paseo plugin SDK lets a plugin draw. The items below are things
you might expect that it cannot do, or does only by going around the SDK, on released Paseo (checked against `@getpaseo/plugin` 0.12.0
and 0.13.0-beta.1 on 2026-10-23), what it does instead, and the upstream change each one waits
for. Upstream states are as of the same date.

### In the timeline

| Cannot | Instead | Waiting on |
| --- | --- | --- |
| Open a pressed file in Paseo's file panel. Plugins get no navigation to a file; 0.13 lets a plugin add a file viewer, but still not open a file. | Desktop opens it in its default app or reveals it in Finder or Explorer; touch copies the path ([Opening files](#opening-files)). | [getpaseo/paseo#7318](https://github.com/getpaseo/paseo/pull/7318), open |
| Show the images pasted into a prompt. Paseo strips them from the item a plugin receives. | **Enhanced prompt bubble** is off by default, so Paseo keeps the prompt and its images; when on, a prompt with an attachment the plugin cannot draw stays with Paseo. | [#6736](https://github.com/getpaseo/paseo/pull/6736), open draft |
| Offer Paseo's rewind menu on the plugin's prompt bubble, or its Fork action on the plugin's reply footer. A plugin replaces a row whole and cannot borrow the host's menus. | Turn **Enhanced prompt bubble** off for rewind, **Plugin markdown for replies** off for Fork. | [#6677](https://github.com/getpaseo/paseo/pull/6677) (rewind), [#7462](https://github.com/getpaseo/paseo/pull/7462) (fork), open |
| Let Paseo's Ctrl/Cmd+F reveal a row the plugin drew. | The plugin's own find bar, over loaded messages ([Finding text](#finding-text)). | nothing filed |
| Space its rows like Paseo's native tool rows. Paseo puts a 16pt gap under each plugin row. | **Tight rows** and **Tight reply** take most of it back where it is safe. | [#6602](https://github.com/getpaseo/paseo/pull/6602), open |
| Follow a font change in Paseo's Appearance settings live. Paseo does not share its font settings with plugins. | Web and desktop read the font Paseo saved on that computer; iOS and Android use the system monospace at 12px under Follow Paseo. | not proposed upstream yet |
| Offer **Add to chat** for a table selection on iOS and Android. Plugins cannot write into Paseo's composer. | **Copy selected**. On web the plugin inserts the text into the composer itself. | not proposed upstream yet |
| Pin the current prompt, or an open card's header, to the top while you scroll. | The plugin side is ready and turns on once Paseo offers it. | not proposed upstream yet |
| Group several calls into one "Read 12 files" row. Paseo folds runs of calls under its Summary tool-call display, but skips plugin rows. | Rows stay one per call. | [Discussion #7687](https://github.com/getpaseo/paseo/discussions/7687), open |
| Scroll a 5,000-line block quickly (about 30 s to open on a development-build simulator). | Long output folds to 12 lines and renders in batches. | no host API |
| Show token figures for turns from before the plugin was installed. Paseo keeps usage only on live events. | The plugin's server records every turn's start, end, error and usage from the moment it runs, so turns since then show figures on any client. | [#7000](https://github.com/getpaseo/paseo/pull/7000) (turn timing), open |
| Leave the timeline usable behind the details panel on iOS and Android. A plugin overlay there is a full-screen modal. | The floating and side panels close on a tap outside; on web they are not modal. | nothing filed |

### On the Tasks board

Several board features have no plugin API yet. They work on released Paseo 0.12 because the
plugin's server goes around the SDK: it runs Paseo's CLI on the daemon's machine, or opens its own
connection to the daemon through the client modules Paseo installs. These are stopgaps; each
switches to an official API once Paseo has one.

| Feature | How it works today | Waiting on |
| --- | --- | --- |
| Label colours and project icons | The plugin's server reads the label definitions and project icons from the daemon (`tasks.labels`, `tasks.project-icons`). The board asks the plugin API first, so on a Paseo that exposes them it uses the official calls by itself. If neither answers, labels take a colour picked by their name and projects a generated initial. | [#7482](https://github.com/getpaseo/paseo/pull/7482), open ([Discussion #7481](https://github.com/getpaseo/paseo/discussions/7481)) |
| Stop | Runs `paseo agent stop`; hidden where the CLI is not found. | nothing filed |
| Unarchive | Runs `paseo agent reload`; hidden where the CLI is not found. | nothing filed |
| Mark as read | Clears the agent's attention over the server's own daemon connection; hidden where that connection is unavailable. | [#7647](https://github.com/getpaseo/paseo/pull/7647) (a CLI command), open |
| Provider sub-agent cards | The server reads a session's sub-agents from the daemon and follows their updates; without the connection the board shows none. | nothing filed |

Archive needs no workaround: it uses the plugin API.

| Cannot | Instead | Waiting on |
| --- | --- | --- |
| Open an archived task's tab. A plugin cannot pin the tab it opens, so Paseo drops an archived agent's tab and shows another of that workspace. | An archived task shows **Unarchive** where Open was; once it is back, Open works. Tasks of an archived workspace keep Open. | [#6382](https://github.com/getpaseo/paseo/pull/6382), open draft |

### Everywhere

| Cannot | Instead | Waiting on |
| --- | --- | --- |
| Keep a plugin screen while the phone is disconnected. Paseo removes every plugin when the connection drops and sends all their bundles again on reconnect, so an open board shows "This plugin surface is unavailable." until it is back. | The board returns with its cards, lane and filters; the bundle is minified and the board loads on demand, so the catalog fell from 1,977 KB to 722 KB (measured on a Paseo 0.12 daemon when the change landed). | [#7088](https://github.com/getpaseo/paseo/issues/7088) (issue), [#6731](https://github.com/getpaseo/paseo/pull/6731), [#6732](https://github.com/getpaseo/paseo/pull/6732), open |
| Keep a setting per device. Plugin settings are host-wide only. | Every client of a daemon shares one set, the drawer's pinch size included. | nothing filed |

The SDK constraints met while building the plugin, with evidence and workarounds, are listed for
developers in [`docs/plugin-sdk-limitations.md`](docs/plugin-sdk-limitations.md).

### Paseo issues the plugin works around

| Issue | What the plugin does | Fix |
| --- | --- | --- |
| A background sub-agent from an earlier turn makes Paseo 0.12 draw a later tool call twice. | Hides the copies and the gap they leave. | [#7541](https://github.com/getpaseo/paseo/issues/7541) / [#7543](https://github.com/getpaseo/paseo/pull/7543), open |
| A Claude turn that hits the session limit (or an invalid key) ends as a normal reply, and the agent looks done. | The Tasks board files it under to review as failed, with its error. | [#7636](https://github.com/getpaseo/paseo/issues/7636) / [#7637](https://github.com/getpaseo/paseo/pull/7637), open |
| Grok and Cursor histories reload without per-message times. | Hides an elapsed time under one second for those providers; live turns keep theirs. | provider-side |

### Compatibility

Better Paseo is developed and measured against Paseo 0.12.0 and installs on Paseo 0.8 and later.

- **Paseo 0.8–0.10.** The timeline draws. Oh My Pi's `eval` and `ask` calls reach plugins under
  their own names there, not through Paseo 0.11's plain-text mapping: `eval` stays generic, and
  `ask` gets a question transcript only when its input contains a structured `questions` array.
- **Paseo 0.13 beta.** 0.13 drops the paced reveal plugins used for streaming text, so live replies
  and thoughts are drawn whole as they arrive instead of revealed smoothly.
  [#7571](https://github.com/getpaseo/paseo/pull/7571) (open) would restore it.

---

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Rows overlap, or a reply overlaps the row below | Turn off **Tight rows** or **Tight reply**. |
| A reply needs a mermaid diagram, a host image or Paseo's file links | Turn off **Plugin markdown for replies**. |
| A selected table cell has no **Add to chat** action on a phone | Paseo does not yet let plugins write into the composer; **Copy selected** is always available. |
| A prompt with an attachment should use Paseo's renderer | Turn off **Enhanced prompt bubble**. Attachments the plugin cannot render stay with Paseo automatically. |
| Ctrl/Cmd+F misses old messages | Scroll up to load them, or hand replies back to Paseo as above. |
| Token figures are missing on an old turn | The plugin's server records usage for every completed turn from when it was installed; turns before that, failed or cancelled turns, and turns whose provider reported no figures have none. The latest turn can also recover usage from the daemon's snapshot. |
| Pinched text in the drawer is too large or small on another phone | The size is shared by every client of the daemon; pinch again, or press **Reset** on the badge. |
| Grok and Cursor replayed turns have no elapsed time in the Copy toolbar or turn details | Upstream tool issue: when the daemon reloads a Grok or Cursor history, the records carry no per-message timestamps, so every replayed record shares the load time or differs by 1 ms, producing a misleading `0s`. Better Paseo hides an elapsed time under one second for the `grok` and `cursor` providers; turns they run live keep their elapsed time. This is based on the provider, not the model name. |
| A phone shows "This plugin surface is unavailable." | The app lost its connection; the screen returns when it reconnects ([#7088](https://github.com/getpaseo/paseo/issues/7088)). |
| Nothing changed after pushing a fix | Run `paseo plugin update better-paseo`; Paseo runs the GitHub version. |

## Development

```bash
npm install
npm run typecheck
npm test
npm run check:hermes
npm run build:client
paseo plugin reload better-paseo
```

`npm run check:hermes` compiles and runs the client bundle in Hermes, the engine the iOS and Android
apps use, both as written and as the minified install build with its Tasks chunk; code that works
on web can still fail there and drop the whole plugin. `npm run build:client` prints the sizes of
the install build. The rules the check enforces, the project layout, and how to rebuild the
screenshots and charts are in [`docs/development.md`](docs/development.md).

## License

MIT
