# S0-A report

## Result
Done. Dependencies bumped, probes and replay harness in place, no visual or behavioral change. Branch `s0-infra`, 3 local commits (f2103a2, ac874f7, d139fe1) on top of 42b61d8. Details: `docs/bench/S0-A-infra.md`.

## Execution
Model: claude-sonnet-5-5 (medium). Start 2026-10-11 09:56 +08, end about 10:15 +08.

## Findings (path:line — change)
- package.json — `@getpaseo/plugin` 0.11.2 (no source changes needed for typecheck); runtime `marked@18.1.0`, `remend@1.4.0`; dev `vitest`; scripts `test`, `replay`. `paseo-plugin.json` untouched (`>=0.8.0`).
- .showcase/package.json (+ .npmrc legacy-peer-deps) — esbuild, playwright-core, react-dom, react-native-web, lucide-react live here, NOT in the root package, so the daemon's `npm ci --include=dev` stays light (root adds only vitest). These web deps were missing from the repo before (the README build assumed them).
- client/debug/store.ts — pure aggregation (Series p50/p95, flips, height decreases, frames, animations).
- client/debug/perf.ts — guard `if (!on) return` in every probe; `probeCard` returns a frozen shared object when off (no allocation, no hooks). `__bcPerf.enable/disable/snapshot/reset/report`; rAF frame meter; web `longtask`/`layout-shift` observers.
- client/preferences.ts — hidden `debugPerf` (default false, not in settings page).
- client/live-renderers.tsx — `probeCard` + `onLayout` + commit-effect node in the 5 card renderers; client/components/markdown/markdown-view.tsx — `probeMarkdown`, optional `probeId`; client/highlight.ts — `probeHighlightRpc`; breathe.tsx / pulse-dot.tsx / motion.tsx (Glow) — `probeAnimationLoop`.
- client/debug/bundle-probe.ts + index.client.tsx — `Lexer` + `remend` import reached behind `debugPerf`.
- .showcase/replay.tsx, replay-core.ts, replay.html, tools/replay.mjs, fixtures-smoke/*.jsonl — headless replay on local Chrome (no download).
- .showcase/tools/bundle-size.mjs, bundle-probe-run.mjs, shots.mjs — host-setting bundle size, node run of the bundled probe, screenshot parity.
- .showcase/shims/plugin-client.tsx — `usePaseo` returns `agents.ref().refresh`, `useRpc` returns a stable stub (harness only).
- test/unit/* — perf store, probes (inert when off / counting when on), replay-core, parseMarkdown characterization (unclosed fence -> `plain`, closed -> `code`).

## Validation
- `npm run typecheck` -> pass. `npm test` -> 4 files, 24 tests pass.
- Bundle size (host esbuild settings): baseline 650,199 B / 287,117 gz; +probes 662,996 B; +marked+remend 748,479 B / 313,952 gz (+98,280 B raw total, +85,483 B for the two libraries). Both libraries present in metafile.
- Isolated daemon `~/.paseo-bench` (0.11.2, :6868, created by S0-C before me): installed worktree as `bc-s0-infra` -> `plugin ls` running, no ERROR; `plugin logs`: Loading plugin / Plugin ready; daemon log "Loaded plugin". Removed my entry afterwards; S0-C's `beautiful-chat` entry (main checkout path) untouched. Node run of the host-bundled probe: Lexer tokens `heading,space,code,space,list`, remend `some **unfinished bold**`.
- `npm run replay -- --speed 1` -> both smoke fixtures run, 0 page errors, snapshots in `.showcase/out/`. Markdown fixture: user_message 109 renders for 109 events, 105 parses, 3 format flips, 1 highlight RPC. Bash fixture: 2 `Breathe` loops still mounted when idle, 1 height decrease. `--host cached`: user_message 1 render (shows H4 effect).
- Showcase parity: `.showcase/tools/shots.mjs` on 42b61d8 vs this branch, 21 `#shot-*` PNGs byte-identical (rAF frozen; base-vs-base was stable too).
- `npm ci --include=dev --dry-run` ok.

## Remaining
- Real fixtures from S0-C: parent follow-up to run the full baseline (`npm run replay -- --fixtures <dir> --speed 1`, 3 runs median per plan §3.2); `--out` per run.
- Overlap: `~/.paseo-bench` already held `beautiful-chat` -> main checkout path, so I used id `bc-s0-infra` and removed it; no change to S0-C's entries. Its `beautiful-chat` plugin still runs the main-repo code, not this branch.
- Not simulated in replay: host reveal cadence for reasoning (`useRevealedText` returns full text), host-native rows (placeholder text), iOS/Android. Assistant item has no `phase` field, so its height decreases show `streaming: null`.
- The daemon only compiles the client; actually evaluating it in the Paseo app was not done (no app session used).
- Commits carry the required Co-Authored-By line; nothing pushed.

---

# Follow-up: stable keys and offline baseline (commit f228130)

## Result
Done. Reasoning and assistant items are keyed by a stable hash; full offline baseline (11 fixtures x current/cached x 3 runs, medians) is in `docs/bench/baseline-showcase.md`, raw runs in `docs/bench/raw/` (66 snapshots, 0.6 MB, all kept).

## Execution
Same model (claude-sonnet-5-5). Baseline runs took about 45 min wall time (sequential, one Chrome at a time).

## Findings (path:line — change)
- client/debug/perf.ts — `textItemKey(kind, text)`: FNV-1a of the first 80 characters; a text that extends an earlier one of the same kind keeps its key (so a thought shorter than 80 chars does not split when it grows); empty text -> kind; returns "" when probes are off. live-renderers.tsx uses it for reasoning and assistant; tool_call stays keyed by callId. Unit tests added.
- .showcase/replay.tsx — host-row spy (active vs non-active row renders), heap before/after after `gc()`; `.showcase/tools/replay.mjs` — `--speeds name=speed,...`, `--runs N`, `--fixtures dir` (read in place from s0-bench, nothing copied), Chrome launched with `--expose-gc --enable-precise-memory-info`; `.showcase/tools/baseline-report.mjs` — medians into tables.
- docs/bench/baseline-showcase.md, docs/bench/raw/*.json.

## Validation
- `npm run typecheck` pass; `npm test` 4 files, 26 tests pass; smoke replay still runs.
- Baseline: 0 page/console errors in 66 runs. Speeds: 1 everywhere except history-100 = 0 (max), tool-expanded-streaming = 4. Environment: Apple M5 Pro, macOS 27.0.1, Chrome 155.0.8059.40 headless, React 19.1.0 production.

## Top findings
1. Current host: every chunk re-renders every card (non-active renders: reads-20 999, mixed-turn 543, history-100 170,640 -> all 0 with host caching).
2. Many-card scenarios dominated by fan-out: reads-20 tool commit p95 52.9 ms (2.3/5.4 cached), 12 long tasks; history-100 as live head 638 long tasks, 115 s vs 18 s.
3. Single long text (markdown-long, codeblock-streaming): host-mode independent; whole-message re-parse per chunk (509 / 988 parses), commit p95 8.2 ms.
4. Format flips: codeblock-streaming 10, table-streaming 6, history-100 25; highlight RPC already 1 per closed block (6).
5. Loops never released: reads-20 ends with 72 mounted, history-100 414, mixed-turn 21; Markdown/reasoning-only fixtures end at 0.
6. diff-large: 4 long tasks, tool commit up to 439 ms, heap 109 MB; not helped by host caching.

## Remaining / caveats
- history-100 `current` is a worst case (host memoises finished rows); only the host-mode contrast is meaningful there.
- Not measured: iOS/Android, the real Paseo app (host reveal cadence for reasoning not simulated), assistant-card streaming height decreases (no phase on that card, so the streaming column is 0 by construction).
- Layout-shift totals are identical across host modes (card layout, not host re-renders).
- Did not touch the s0-bench worktree; nothing pushed.

---

# Real-host baseline (follow-up 2; commits on s0-infra up to the "real-host iOS baseline" commit)

## Result
Partly done. iOS Simulator (dev build): 11/11 fixtures measured, H0 gap measured with screenshots, tables in `docs/bench/baseline-host.md`, raw in `docs/bench/raw-host/`. **Desktop (Paseo.app production) is BLOCKED and not measured.**

## Execution
Same model (claude-sonnet-5-5). About 1 h wall time (10:48-11:25 +08).

## Findings (path:line — change)
- shared/perf-rpc.ts, server/perf-dump.ts, index.server.ts — RPC `debug.perf.dump` writing `/tmp/bc-perf/<platform>-<label>-<ts>.json` (unit tested); client/debug/perf-command.ts + index.client.tsx — `/bc-perf on|off|reset|dump [label]`, inert unless typed.
- client/debug/store.ts — classes replaced by closures; index.client.tsx — bundle-probe import removed (file and node probe runner deleted).
- **Native Hermes cannot load the plugin with `marked@18.1.0` bundled** (`right operand of 'in' is not an object`; `remend` alone is fine) **or with `class` in client code** (`Cannot read property 'prototype' of undefined`). The earlier S0-A "bundling smoke test" only proved daemon compile + Node run; corrected in docs/bench/S0-A-infra.md. D4 (marked) needs a native-safe path before S2. `marked`/`remend` remain in package.json, unused.
- .showcase/tools/host-report.mjs — tables from raw-host dumps next to offline medians.
- Bench daemon: `beautiful-chat` reinstalled from this worktree; `bc-bench` re-pointed to `/Users/luopeihuan/workspace/rrd/beautiful-chat/tools/bench-provider` (npm ci + npm run setup run first), so the s0-bench worktree is no longer referenced. (My test agents: perf-* in the bench daemon, each created its own `master` workspace under /tmp/bc-orchestrate/s0d-project.)

## Validation
- typecheck pass; 29 unit tests pass.
- iOS: plugin status running in the app after the fixes; `/bc-perf dump` produced files for all 11 fixtures (history-100 rerun after a mic-permission dialog interrupted the first attempt).
- Main daemon `~/.paseo` and Paseo.app untouched (host list unchanged: nothing was added).

## Key results
- Real host does **not** reproduce "every chunk re-renders all live rows": unchanged user card rendered 4-8 times per fixture (offline current 11-43,831; cached 1-110). Fan-out finding should drop in priority. Per-active-card commit cost is what dominates on iOS dev build: markdown-long assistant p50/p95 35.5/69 ms, reads-20 tool cards 152/447 ms, diff-large tool card 2.2/4.5 s (UI frozen for seconds), shell-log-large 234/299 ms; dropped frames 12-48% in text fixtures.
- Loops not released: reads-20 ends with 33, history-100 35, mixed-turn 13.
- H0: plugin tool rows have a **24 pt** gap (card 30 pt, pitch 54 pt); host native read rows pitch 32 pt with no gap -> +22 pt per row, ~528 pt over 24 reads (plan estimated 16 px/gap). Screenshots in docs/bench/raw-host/.

## Remaining / why blocked
- Desktop: the cua-driver skill says Claude Code must use the built-in `computer-use` MCP and must not fall back to cua-driver; `computer-use` is not loaded here. To unblock: enable it in /mcp (or explicitly allow the cua-driver MCP) and re-run; the `/bc-perf` flow and README section 6 are ready.
- iOS numbers are 1 run, simulator, dev build: relative only. Not measurable on RN: long tasks, layout shift, JS heap, non-active-render counts.
- iOS simulator left on the plugin-on state with the app connected to the bench daemon; its keyboard prefs got `AppleKeyboards=en_US` written (no effect on the pinyin IME).

---

# Desktop proxy baseline (follow-up 3)

## Result
Done. Production web build of Paseo 0.11.2 served locally, driven by playwright-core in local Chrome 155.0.8059.40 against the bench daemon; 11/11 fixtures with `/bc-perf` (1 run each, speeds as offline), H0 measured on web, tables and comparison in `docs/bench/baseline-host.md`, raw in `docs/bench/raw-host/web-*.json` plus screenshots. Paseo.app was never touched.

## Execution
Same model. About 40 min (11:15-11:50 +08).

## Findings
- Build: `CI=1 TMPDIR=/tmp/bc-tmp npx expo export --platform web --output-dir /tmp/bc-web-dist` (paseo packages/app, no tracked file changed, no npm ci). First attempt failed: Metro's shared default cache held another worker's worktree paths (`.../luoph/paseo/.worktrees/ios12-legacy-web/.../lucide-react-native/dist/esm/context.mjs` unresolved); private TMPDIR fixed it.
- Disclosure: before I blocked it, one exploratory page load of the web app probed `ws://localhost:6767` (its default local daemon) and got HTTP 403 (origin not allowed); no state changed on the main daemon. All later runs block that socket with `routeWebSocket`.
- Bench daemon CORS temporarily allowed `http://127.0.0.1:8090` / `localhost:8090` (runtime reload), restored to `["https://app.paseo.sh"]`; static server stopped.
- Web vs iOS vs offline: unchanged user card renders 6-8 times on single-turn fixtures (not per chunk); in `history-100` (many live rows) it renders 4,332 times (~39 per card) vs 43,831 offline-current / 110 cached. `strategy-web.tsx` hands `items={segments.liveHead}` (new array every chunk) to memoised `StreamRowContent`, consistent with fan-out when several rows are live. So the finding is real only for many live rows, not for a normal single turn.
- Web costs: `markdown-long` assistant commit p50/p95 9.4/16.3 ms; `reads-20` tool cards 13.3/230 ms (48 highlight RPCs, 15 long tasks, 72 loops mounted at end); `diff-large` tool card ~202 ms, 6 long tasks, heap 349 MB; layout shift 0.639 on `markdown-long`; `history-100`: 73 long tasks, 327 loops, 21 flips.
- H0 on web: plugin cards 38 px with a 16 px gap (pitch 54); host-native reads 32 px, no gap (pitch 32) -> +22 px per row, plan's 16 px estimate confirmed. Screenshots in docs/bench/raw-host/.
- New tools: .showcase/tools/web-bench.mjs, web-h0.mjs; host-report.mjs takes `web`.

## Cleanup
Archived my 30 `perf-*` agents and their 30 `master` workspaces under /tmp/bc-orchestrate/s0d-project (mapping read from the agents' stored JSON so only mine were archived). Remaining workspaces: bc-bench-ws, S0-D's wks_c76ea0b06eba9112, S1's wks_bdef20448016e0cb. Other workers' agents (S0-D control/code only/codeblock, s1-mono-check) untouched.

## Validation
typecheck pass; 29 unit tests pass; every web fixture dumped; `git status` in /Users/luopeihuan/workspace/rrd/paseo clean.

## Remaining
Single runs (no medians); headless Chrome is not Electron; web dev numbers not compared. `/tmp/bc-web-dist`, `/tmp/bc-web-profile`, `/tmp/bc-tmp` left in /tmp for reuse.

---

# V1 final verification (main 81ce36b; worktree s0-infra fast-forwarded, commits 43f48b3 and the one after)

## Summary
Report: `docs/bench/final-report.md` (+ `raw-final/`, `raw-host-final/`, `raw-ab/`, `raw-v1/`, `docs/bench/tools/`). No plugin code changed. typecheck, 573 tests and `npm run check:hermes` pass on main; plugin loads and renders on iOS sim and web.
- Offline (11 fixtures x current/cached x 3 runs, medians): unchanged-card renders 990 -> 1, history-100 non-active plugin renders 171,382 -> 374, commit p95 of the busiest card 52.9 -> 1.0 ms (reads-20), loops at end 414 -> 0, long tasks 638 -> 0, md.finalRerender 0, flips 10/6/25 -> 0.
- Web production build (1 run): commit p95 1.3-2.2 ms in 10 of 11 fixtures (was 2-230), dropped frames 0.1-0.5% (was up to 15%), heap down on tool-heavy fixtures, layout shift down on reasoning/mixed.
- iOS dev sim (1 run): tool cards 2-6x faster in the paired A/B; diff-large tool card 2,170 -> 20 ms p50; absolute numbers still above 4 ms (dev build).
- Budget table (plan 3.2): pass for finished-block re-renders (0), highlight RPC (1 per block), commit p95 (web, 10/11), dropped frames (web/offline), non-active renders (single-turn). Fail/partial: history-100 fan-out and 4 ms p95, format flips on real hosts (web markdown-long 1, history-100 12; iOS history-100 3), height decreases while streaming (18 px per fence close in codeblock-streaming), 1 long task in reads-20.
- User-message anomaly on iOS (paired A/B, 4 runs each, mixed-turn): real but 1.5x not 2x (p50 18.0 -> 26.6 ms, total 92 -> 106 ms, first mount unchanged); all other kinds 2-6x faster; absent offline and on web. Most likely cause (hypothesis, not isolated): the user card is the settings "leader" in PreferenceSyncSlot (runs useSettings + sync subscription). Confirm by timing the leader separately.
- Functional walk-through (requirement 16.1 numbering 1-15 and 16.3): pass for 1-7, 9, 10, 14 (web), 15 (iOS); 8 partial; 11 requires H2a/H2b; 12 requires H1 (settings page says so, fallback works); 13 not verified end to end. iOS selection in Markdown and tool output, code-block Copy, path press (copies full absolute path, "Copied" toast), row-header long-press, horizontal scroll of code and tables all verified on the simulator; web Reduced Motion verified (dot pulses 0.4-1.0, static 1.0 under reduce), mono font Custom (Menlo) verified.

## Defects (severity-ranked)
1. D3 Medium: user-prompt card re-renders 6,144 times for 110 cards in web history-100 (selector returning a new object defeats the memo); pre-existing.
2. D1 Medium: ASSISTANT_REVEAL multiplies assistant renders/parses on web slow streams (markdown-long 774 -> 2,506 renders, 385 -> 2,106 parses).
3. D4 Low-Medium: each closing code fence shrinks the card 18 px (6/6 in codeblock-streaming).
4. D5 Low: format flips on real hosts (web markdown-long 1, history-100 12; iOS history-100 3).
5. D6 Low: iOS user card +48% p50 (see above). D7 Low: layout shift still 0.59 on long Markdown (web). D8/D9 Info: H0 gap 16 px/pt remains; shell log mounts all 2,852 lines.

## Not verified
Paseo.app Electron (not automated), Android, iPad pointer, Reduced Motion on iOS, workspace switch end to end (harness limitation), workspace-relative paths (fixture paths lie outside the agent cwd; unit-tested only), file reveal click (would open Finder), sticky headers and Paseo-font inheritance (need H2a/H2b/H1).

## Cleanup
bc-final and bc-base removed (their plugin-settings dirs too), beautiful-chat re-enabled as before, CORS restored to ["https://app.paseo.sh"], static server on :8090 stopped, all my perf-* agents archived with their workspaces (other workers' agents/workspaces untouched), main daemon and Paseo.app untouched. Side effect to know: the bench-daemon web host profile lives in /tmp/bc-web-profile; the simulator's keyboard preference was set to en_US earlier.
