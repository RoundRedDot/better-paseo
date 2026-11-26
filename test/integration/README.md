# Integration tests

These tests run the Tasks board's data layer (`client/tasks/data`) against a
real Paseo daemon through the real `@getpaseo/client`, instead of the fake in
`test/unit/helpers/fake-paseo.ts`. They exist because a fake only enforces
what its author knew: on 2026-11-15 the board read the first page of the
workspace list as the whole list, the fake returned every workspace on one
page, and every unit test passed while the main checkout's tasks sat in the
archived lane (232 workspaces, 200 per page).

```bash
npm run test:integration
```

They need Paseo installed (`/Applications/Paseo.app`, or `PASEO_BIN` pointing
at a `paseo` CLI). Without it every suite skips. They are not part of
`npm test` or CI.

Each suite starts its own daemon on a temporary home and a free port and
deletes it afterwards. They never touch `~/.paseo` or port 6767.

| Suite | What it covers |
| --- | --- |
| `chat-fork.test.ts` | Creates both kinds of chat fork with a test provider, checks the selected reply's history boundary, and replays the creation request. |
| `lanes-seeded.test.ts` | Stored agent records in every lane state, 205 workspaces and 230 old unread agents (more than one page each). Compares every card with `helpers/lane-oracle.ts`, then again after a daemon restart and reconnect, and after a refresh. |
| `lanes-live.test.ts` | Real turns from the test provider in `lane-provider/`: running, needs input, failed, stopped, read on another device, archived, an archived workspace, a parent waiting on its subtask, many tasks at once. Each card's lane is recorded render by render, so a card that passes through a wrong lane fails even if it ends in the right one. |
| `steps-pill.test.ts` | The Agent steps pill's agent list (`watchAgentPills`): the daemon takes the request as sent, an existing agent gets its pill from the first page, a new one (also in a background workspace) while its first turn still runs. |
| `translation-helper.test.ts` | Runs translation through an ordinary helper using a synthetic provider on a private daemon. Covers the conversation model, the configured model, the prompt sent to the provider, and helper cleanup. |
| `lane-audit.test.ts` | The same oracle comparison on any daemon given by `BP_LANE_AUDIT_HOST`, for a copy of real data (below). Skipped without it. |

`helpers/lane-oracle.ts` works out each agent's lane from the daemon's raw
records only. Keep it independent of `client/tasks/data`: a test that compares
the board with its own logic proves nothing.

## Auditing a copy of real data

Never point the audit at the daily daemon: the board reads parents and lists
by id, and loading a stored agent bumps its `updatedAt`. Copy the records to a
private home instead:

```bash
H=/tmp/bp-lane-audit/home
mkdir -p "$H" && rsync -a ~/.paseo/agents ~/.paseo/projects "$H"/
echo '{ "version": 1, "daemon": { "listen": "127.0.0.1:6918", "mcp": { "injectIntoAgents": false } } }' > "$H/config.json"
env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD paseo daemon start --home "$H"
BP_LANE_AUDIT_HOST=127.0.0.1:6918 npx vitest run -c vitest.integration.config.ts test/integration/lane-audit.test.ts
env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD paseo daemon stop --home "$H" && rm -rf /tmp/bp-lane-audit
```

Read and unread marks, the turn ledger and provider subagents come from the
plugin server, which the private daemons do not run; those are covered by the
unit tests.
