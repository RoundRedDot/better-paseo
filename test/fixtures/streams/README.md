# Stream fixtures

Deterministic recordings of agent streams, used to benchmark Better Paseo's rendering under
identical load on every platform (desktop, web dev, iOS simulator, Android emulator).

Two consumers read them:

- the offline replay harness (slice S0-A) feeds them straight into the client;
- `tools/bench-provider` replays them through a real Paseo daemon, so the same bytes also travel
  the real provider -> daemon -> client path.

The fixtures are **generated**: do not edit the `.jsonl` files by hand.

The additional `history-long-load` loading regression has its own deterministic generator:
`node test/fixtures/streams/generate-history-long-load.mts [--check]`. Its cold-open, older-history
and remount phases are specified in [the loading benchmark](../../../docs/bench/long-history-load/README.md);
replaying it as a stream alone is not that benchmark.

```bash
node test/fixtures/streams/generate.mts            # (re)write every fixture
node test/fixtures/streams/generate.mts --check    # exit 1 if a committed file drifted
node test/fixtures/streams/generate.mts mixed-turn # only the named fixtures
```

`generate.mts` is a single self-contained TypeScript file (Node >= 22.18 runs it natively; `tsx`
works too). Each fixture seeds its own PRNG from its name, so output is byte-for-byte
reproducible. It is `.mts` on purpose: the repo's root `tsc` (`**/*.ts`) does not pick it up;
`tools/bench-provider` type-checks it (`npm run typecheck` there).

## File format

One JSON object per line (JSONL), UTF-8, `\n` separated, trailing newline.

**Line 1 - meta record**

```json
{"kind":"meta","name":"mixed-turn","description":"...","scenario":"..."}
```

`name` equals the file name without `.jsonl`; `scenario` says which performance scenario the
fixture stresses (numbers refer to requirement 16.1).

**Every following line - one timeline event**

```json
{"t":1840,"item":{"type":"assistant_message","text":"Hello "},"mode":"append"}
```

| Field  | Meaning                                                                              |
| ------ | ------------------------------------------------------------------------------------ |
| `t`    | Milliseconds since the stream started. Non-decreasing down the file. The first event is at `t=0`. |
| `item` | An `AgentTimelineItem` from `@getpaseo/protocol` (`agent-types`), exactly as the daemon stores it - no ids. |
| `mode` | `"append"` or `"replace"`, see below.                                                |

End of file = stream complete. There is no end marker; the last event's `t` is the stream
duration. Every fixture starts with a `user_message` event (the prompt that triggers the turn).

### Item semantics

- **`assistant_message`, `reasoning`** - always `mode: "append"`. `text` is a **delta** appended to
  the *current streaming item of that type*. A new item of the same type starts only after an
  event of a different type (another text type, a `tool_call`, a `todo`, a `user_message`)
  intervened. Deltas are never empty.
- **`tool_call`** - always `mode: "replace"`, keyed by `callId`. The first event for a `callId`
  creates the card (`status: "running"`); later events with the same `callId` replace its whole
  content (more `detail.output`, or `status: "completed"` / `"failed"`, in which case
  `error` is set). Updates for different `callId`s can interleave (parallel tools). Every call
  that starts also finishes before the file ends.
- **`user_message`, `todo`** - one-shot, `mode: "append"` (a new timeline item each time). A
  `todo` event carries the full list; a later one is a newer snapshot, not a delta.
- Tool detail shapes used: `read` (`filePath`, `content`), `shell` (`command`, `cwd`, `output`,
  `exitCode`), `edit` (`filePath`, `unifiedDiff`), `search` (`query`, `toolName`, `content`).

### Timing model

The daemon coalesces provider deltas into roughly 60 ms windows, so prose is emitted one delta
per ~60 ms (jitter +-15 ms, the odd 80-420 ms stall) with sizes from a handful to ~140
characters, cut mostly on word boundaries and sometimes mid-token. The exceptions are
`codeblock-streaming` (1-4 characters every 8-22 ms, a deliberate worst case) and `history-100`
(1-3 ms between deltas: history is delivered fast).

## Fixtures

| Fixture | Events | Duration | Size | What it stresses |
| --- | ---: | ---: | ---: | --- |
| `reads-20` | 65 | 6.1 s | 165 KiB | 24 consecutive Read calls (groups of 1-4 in parallel) with 90-260 line TypeScript contents |
| `shell-log-large` | 10 | 10.4 s | 68 KiB | one Bash call, running then completed with 2852 lines of TAP output |
| `reasoning-long-sections` | 169 | 13.7 s | 19 KiB | Codex-style reasoning: 19 paragraphs, each opening with a standalone `**Title**` line |
| `reasoning-long-prose` | 197 | 16.2 s | 22 KiB | Claude-style reasoning: 11 untitled prose paragraphs |
| `markdown-long` | 510 | 38.5 s | 60 KiB | ~23 KiB reply: headings, nested lists, nested quotes, links, inline code, task lists, rules |
| `codeblock-streaming` | 989 | 15.3 s | 74 KiB | six fenced blocks (ts, python, bash, json, diff, rust) streamed 1-4 chars at a time |
| `table-streaming` | 176 | 13.5 s | 15 KiB | three GFM tables streamed row by row; each header sits alone 380-700 ms before its delimiter row |
| `diff-large` | 10 | 2.2 s | 234 KiB | one Edit with a 5128-line unified diff (180 hunks) |
| `history-100` | 781 | 6.1 s | 342 KiB | 110 turns (user, optional reasoning, 0-3 tools, markdown answer) delivered in ~6 s |
| `tool-expanded-streaming` | 101 | 61.4 s | 1.8 MiB | one Bash call running ~60 s; ~96 replace-updates carry the growing output (to ~360 lines) |
| `mixed-turn` | 59 | 11.6 s | 15 KiB | a realistic turn: sectioned reasoning, todo, grep, reads, edit, failing then passing test run, markdown summary |

(Event counts exclude the meta line.) File contents, logs and prose are synthesized from fixed
vocabularies - they look like code and logs but reference no real project.

## Host behaviour worth knowing

Measured while replaying through Paseo 0.11.2 (see `tools/bench-provider`):

- **Shell output is capped at 64 KiB** by the daemon (`TOOL_CALL_CONTENT_MAX_LENGTH`; the first
  65 536 characters are kept). `shell-log-large` is therefore sized just under the cap with
  short lines. A larger log would arrive truncated, so it would not be a larger render load.
- Read back through the daemon's *projected* timeline, consecutive deltas of one streaming item
  are merged into a single entry, and a `tool_call` appears once with its latest state.
- `history-100` is one provider turn: the `user_message` events inside it are timeline items,
  not new daemon turns.
