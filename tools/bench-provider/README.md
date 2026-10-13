# bench-provider

**Dev-only** Paseo plugin (`id: bc-bench`) that registers an agent provider, *BC Bench Replay*.
Instead of calling a model it replays one of the recorded streams in
[`test/fixtures/streams`](../../test/fixtures/streams/README.md) through the real
provider -> daemon -> client path, with the recorded timing. Every client (Paseo desktop, web dev
build, iOS simulator, Android emulator) therefore renders the exact same stream, which is what
the Better Paseo performance baselines need.

It is never shipped with Better Paseo: it has its own `package.json`, is not referenced from the
root package, and is installed only into an isolated bench daemon.

Everything below uses an isolated daemon home, `~/.paseo-bench`, port `6868`. **Never** point
these commands at `~/.paseo` (port 6767), the daily-driver daemon.

```bash
export H=~/.paseo-bench          # used throughout; always pass --home "$H"
```

## 1. The isolated daemon

Check first - another worker may already have created it, and it must never be deleted or reset:

```bash
paseo --home "$H" daemon status          # running? listening on 127.0.0.1:6868?
```

If `~/.paseo-bench` does not exist yet:

```bash
paseo --home "$H" daemon config set daemon.listen 127.0.0.1:6868
paseo --home "$H" daemon start
```

Day to day:

```bash
paseo --home "$H" daemon status
paseo --home "$H" daemon stop
paseo --home "$H" daemon start
paseo --home "$H" daemon reload          # re-read config.json (runtime-safe settings only)
tail -f "$H/daemon.log"
paseo --home "$H" plugin ls              # what is installed in the bench daemon
```

The `--home` flag selects the daemon; every `paseo` command in this file must carry it.

## 2. Install bench-provider

Directory plugins are loaded **in place**, so the worktree path you install from is the code that
runs.

```bash
cd tools/bench-provider
npm ci                                              # SDK 0.11.2 + type deps
node ../../test/fixtures/streams/generate.mts       # only if the *.jsonl files are missing
npm run setup                                       # bake the fixture directory in (see below)
paseo --home "$H" plugin install "$PWD"
paseo --home "$H" plugin ls bc-bench                # status: running
```

The daemon evaluates the plugin bundle without `__dirname`, so `npm run setup`
(`scripts/set-fixtures-dir.mjs`) writes the absolute path of `test/fixtures/streams` into the
git-ignored `server/fixtures-dir.generated.ts`. A directory install does not run build steps, so
run it *before* installing, and again (plus `plugin reload bc-bench`) if you move the checkout.
Without it the provider still loads but answers every prompt with a "No stream fixtures found"
message. `BC_BENCH_FIXTURES=<dir>` in the daemon's environment overrides the directory.

After editing `server/*.ts`:

```bash
paseo --home "$H" plugin reload bc-bench
paseo --home "$H" plugin logs bc-bench              # compile/runtime errors
```

Remove it with `paseo --home "$H" plugin remove bc-bench`. Touch no other plugin in the bench
daemon: the `better-paseo` plugin there belongs to whoever is measuring the UI.

## 3. Install a Better Paseo build into the bench daemon

Better Paseo is also a directory plugin; install the checkout you want to measure (its manifest
build runs `npm ci --include=dev`):

```bash
paseo --home "$H" plugin install /path/to/better-paseo    # e.g. a worktree
paseo --home "$H" plugin reload better-paseo              # after changing its code
```

Only one `better-paseo` plugin can be installed per daemon, so to measure another build point
the plugin at the new path (`plugin remove better-paseo`, then install again) - coordinate with
whoever else uses the bench daemon.

## 4. Run a fixture

The prompt selects the fixture and the speed:

| Prompt | Effect |
| --- | --- |
| `fixture:markdown-long speed:1` | replay at recorded timing (`speed` defaults to 1) |
| `fixture:history-100 speed:4` | 4x faster; `speed:max` replays with no delays |
| `markdown-long` | a bare fixture name works too |
| `list` (or empty) | the assistant answers with the available fixtures |

From the CLI (`--cwd` must be a directory; a throwaway one is fine and keeps the bench off real
projects):

```bash
mkdir -p /tmp/bc-bench-ws
paseo --home "$H" run -d --provider bc-bench --cwd /tmp/bc-bench-ws --title "markdown-long" "fixture:markdown-long speed:1"
paseo --home "$H" send <agent-id> "fixture:table-streaming speed:1"     # another run in the same chat
paseo --home "$H" wait <agent-id>
paseo --home "$H" logs <agent-id>
paseo --home "$H" delete <agent-id>
```

From a Paseo client connected to the bench daemon (section 6): create an agent, choose the provider
**BC Bench Replay**, and send `fixture:<name> speed:1`.

The fixture's own first `user_message` replaces the prompt in the timeline (it is stamped with the
prompt's `clientMessageId`, so the client does not show a duplicate). Everything runs as a single
provider turn; `session.interrupt` stops a replay.

Fixtures (details in the fixtures README): `reads-20`, `shell-log-large`,
`reasoning-long-sections`, `reasoning-long-prose`, `markdown-long`, `codeblock-streaming`,
`table-streaming`, `diff-large`, `history-100`, `tool-expanded-streaming`, `mixed-turn`.

### Verify the replays

`scripts/verify.mjs` creates one agent per fixture, waits for the turn to finish, reads the
projected timeline back through the daemon API and compares it with the timeline the fixture
implies (merged text deltas, one entry per `callId`, final tool state, todo lists):

```bash
node scripts/verify.mjs                        # all fixtures at speed:max
node scripts/verify.mjs --speed 1 mixed-turn   # real timing; also checks the wall clock
node scripts/verify.mjs --keep reads-20        # keep the agents to look at them in the UI
```

Options: `--home`, `--port`, `--speed`, `--keep`. It reuses one workspace for `/tmp/bc-bench-ws`
and deletes the agents it creates unless `--keep` is given. It exits 1 on any mismatch.

## 5. Host caps you will meet

- The daemon keeps only the first 64 KiB of a shell tool's `output`; `shell-log-large` is sized
  to sit just under it.
- The projected timeline merges consecutive deltas, so counting stored items does not count
  stream events.
- The provider emits cumulative text per streaming item; the host turns that into deltas.

## 6. Point a Paseo client at the bench daemon (without touching `~/.paseo`)

The bench daemon listens only on `127.0.0.1:6868` and has relay pairing disabled (`paseo ... daemon
pair` reports that), so connect with a *direct connection*. Adding a host only adds an entry to
that client's host list; it does not change, restart or reconfigure the main daemon on 6767, so the
main host stays as it is. These are UI actions in a running app and were documented, not
performed, by the slice that wrote this file.

### Paseo desktop (`/Applications/Paseo.app`, Electron)

1. Open the app (it keeps managing its own daemon on 6767; leave that as is).
2. **Settings -> Add host -> Direct connection**.
3. Host `127.0.0.1`, Port `6868`, *Use SSL* off, no password. Connect.
4. Select the new host in the host switcher before creating agents, so work goes to the bench daemon and not the main one.
5. Check: the new-agent provider list for that host should contain **BC Bench Replay**
   (`paseo --home "$H" provider ls` shows `bc-bench` from the CLI side).

Remove the host again from the same settings screen when done; it only deletes the saved entry.

### Web dev build (Expo web, from the paseo repo)

```bash
cd <paseo checkout>/packages/app && npm run web      # expo start --web, usually http://localhost:8081
```

Open that URL and add the host exactly as above (**Settings -> Add host -> Direct connection**,
`127.0.0.1` / `6868`). The browser sends `Origin: http://localhost:8081`; the bench daemon already
allows its own `localhost:6868`/`127.0.0.1:6868` origins and `https://app.paseo.sh`. If the
connection is refused with a CORS/origin error, add the dev origin to the *bench* daemon only:

```bash
paseo --home "$H" daemon config set daemon.cors.allowedOrigins '["https://app.paseo.sh","http://localhost:8081"]'
paseo --home "$H" daemon reload                       # CORS origins are runtime-safe
```

(Check the current list first with `paseo --home "$H" daemon config get daemon.cors`, and keep
existing entries - this is a replace, not an append.) Alternatively serve the bundled web UI from
the bench daemon itself: `daemon config set features.webUi.enabled true`, restart the bench
daemon, open `http://127.0.0.1:6868/` - same-origin, no Add-host step, but it runs the web build
shipped with the daemon rather than your dev build.

### iOS simulator

The simulator shares the Mac's network, so add the host as `127.0.0.1` / `6868` in the simulator
app.

### Android emulator

`127.0.0.1` inside the emulator is the emulator itself. Forward the port and use localhost:

```bash
adb reverse tcp:6868 tcp:6868
```

then add the host as `127.0.0.1` / `6868` in the emulator app.

## 7. Layout

```
tools/bench-provider/
  paseo-plugin.json        manifest (id bc-bench; build: npm ci)
  index.server.ts          registers the provider
  server/provider.ts       prompt parsing, session lifecycle, replay engine
  server/fixtures.ts       JSONL loader / fixture directory resolution
  scripts/set-fixtures-dir.mjs   writes server/fixtures-dir.generated.ts (git-ignored)
  scripts/verify.mjs       replay every fixture and compare the stored timeline
```

`npm run typecheck` here also type-checks the fixture generator.
