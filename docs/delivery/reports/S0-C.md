# S0-C report: streaming replay for performance baselines

## Result
Done and committed locally on `s0-bench` (e2b9b1f, no push/PR). 11 fixtures generate reproducibly, the `bc-bench` provider plugin is installed in the isolated daemon (`~/.paseo-bench`, :6868) and replays all of them; the stored timeline matches each fixture. Root `npm run typecheck` passes.

## Execution
- Model: claude-sonnet-5-5 (Sonnet 5.5), impl role.
- Start 2026-10-11 09:57 +08, end 10:14 +08.
- Bench daemon already existed (created by S0-A, running 0.11.2 on 127.0.0.1:6868 with `beautiful-chat` installed from /Users/luopeihuan/workspace/rrd/beautiful-chat). I only added/removed/reloaded `bc-bench` there. Main daemon (~/.paseo, 6767) untouched.

## Findings (path:line — change)
- test/fixtures/streams/generate.mts — seeded (per-fixture name) deterministic generator, 11 scenarios, `--check` drift mode, self-validation. `.mts` + no relative imports so Node 24 runs it natively and root `tsc` (`**/*.ts`) ignores it; no root exclude needed.
- test/fixtures/streams/*.jsonl — reads-20, shell-log-large, reasoning-long-sections, reasoning-long-prose, markdown-long, codeblock-streaming, table-streaming, diff-large (5128-line diff), history-100 (110 turns in 6 s), tool-expanded-streaming (61 s), mixed-turn. Schema exactly as specified (meta line, then `{t,item,mode}`).
- test/fixtures/streams/README.md — schema, item semantics, timing model, fixture table, host caps.
- tools/bench-provider/server/provider.ts — direct `ProviderRegistration` (id `bc-bench`); prompt `fixture:<name> speed:<n|max>` / bare name / `list`; replays with drift-corrected timers; text items re-emitted as cumulative snapshots per streaming item id (host diffs them into deltas, see `mapTimelineItem` in plugin-provider.ts); tool_call id = callId; interrupt supported.
- tools/bench-provider/server/fixtures.ts, scripts/set-fixtures-dir.mjs — plugin bundle is `eval`-ed (no `__dirname`), so the fixture dir is baked into git-ignored `server/fixtures-dir.generated.ts` by `npm run setup`; guarded `require` keeps root typecheck green on fresh checkouts; `BC_BENCH_FIXTURES` overrides.
- tools/bench-provider/scripts/verify.mjs — per-fixture agent, wait, read projected timeline via `@getpaseo/client` DaemonClient, compare to the fixture-implied timeline (types, final texts, callId/status/detail, todo).
- tools/bench-provider/README.md — runbook (daemon start/stop, installs from path, run fixtures, verify, connecting desktop/web/iOS/Android).

Host behaviours discovered:
- Daemon truncates shell `detail.output` to the first 64 KiB (`TOOL_CALL_CONTENT_MAX_LENGTH`), so `shell-log-large` is 2852 short TAP lines (65 046 chars) to stay under the cap while still "thousands of lines". A realistic 350 KB log would arrive cut.
- Directory plugin installs run in place and do NOT run manifest `build` steps (npm ci / set-fixtures-dir). `npm run setup` must run before install.
- `paseo run --cwd` registers a new workspace each time; verify.mjs reuses one (I archived 13 duplicate `/tmp/bc-bench-ws` workspaces I had created in the bench home).
- Everything replays as a single provider turn; history-100's user messages are timeline items, not daemon turns.
- Relay pairing is disabled on the bench daemon, so only direct connections are documented.

## Validation (command → outcome)
- `node test/fixtures/streams/generate.mts` → wrote 11 fixtures; `--check` → 11 ok (reproducible).
- `node tools/bench-provider/scripts/verify.mjs` (speed:max) → 11/11 PASS (e.g. mixed-turn 16 items, reads-20 28, history-100 440, diff-large 4, shell-log-large 4).
- `verify.mjs --speed 1 mixed-turn reads-20 table-streaming` → PASS, wall 15.3 s / 6.7 s / 14.2 s vs fixture 11.6 / 6.1 / 13.5 s (real pacing, incl. ~1-3 s agent startup); `--speed 4 tool-expanded-streaming diff-large` → PASS (15.9 s ≈ 61.4/4 + startup).
- `paseo --home ~/.paseo-bench plugin ls` → `bc-bench` running, `beautiful-chat` running; `list` prompt answers with the fixture list.
- Missing generated file: plugin still loads, prompts answer with a "No stream fixtures found" message (not a crash); regenerating restores 11/11 PASS.
- `npm run typecheck` (worktree root, after `npm ci`) → exit 0 with and without `fixtures-dir.generated.ts`; `tools/bench-provider` `npm run typecheck` → exit 0 (also checks generate.mts).

## Remaining
- Desktop app / web dev / simulators were not connected (UI actions); exact steps are in tools/bench-provider/README.md section 6 (Add host → Direct connection 127.0.0.1:6868; `adb reverse` for Android; CORS origin command for the Expo web origin if needed). The UI labels come from Paseo docs, unverified in the app.
- Live arrival timing at the client (60 ms coalescing as seen by a subscriber) was checked via wall-clock only, not via a per-event subscriber trace.
- Left in the bench home: workspace `wks_2aeeca5aba501b35` (/tmp/bc-bench-ws) and the `bc-bench` plugin; no bench agents remain.
- tools/bench-provider/node_modules and root node_modules (from `npm ci`) are git-ignored local installs.
