# Plugin SDK limitations found while building Better Paseo

First measured against `@getpaseo/plugin` 0.8.0 and the Paseo 0.8.0 desktop build; entries 15–18
were added on 2026-10-20 while planning a Tasks board. Every entry was re-checked on 2026-10-23
against `@getpaseo/plugin` 0.12.0 and 0.13.0-beta.1 and Paseo `origin/main`. Each entry names the
evidence and the workaround this plugin uses; the user-facing summary is the README's
[What a plugin cannot do](../README.md#what-a-plugin-cannot-do).

1. **No file navigation.** Timeline renderer props are exactly `{agentId, theme, host, layout,
   timestamp, item}`, with no `navigation`. Navigation exists only on screens and panels:
   `navigation.openAgent`, `navigation.openWorkspace` and `navigation.openBrowser` (Electron only);
   the client context adds `openScreen`, `openSettings` and `openPanel`, and `openExternalUrl` opens
   only HTTP(S) URLs. 0.13 adds `addFilePanel` to view a file of some extensions inside the file tab,
   but no call to open one. The host's own file tab target (`{kind:"file", path}`, reachable in-app
   through `?open=file:<path>`) is not exposed, and the `paseo://` scheme only carries agent deep
   links. Proposed upstream as [getpaseo/paseo#7318](https://github.com/getpaseo/paseo/pull/7318)
   (open). Workaround: the daemon-side `file.reveal` RPC (`server/open-path.ts`), which opens a file
   in its default app on macOS (revealing in Finder anything that would launch), selects it in
   Explorer on Windows, and opens its folder elsewhere; touch devices copy the path instead.
2. **Transformers see a stripped item.** The app maps its stream item to the plugin item before any
   transformer runs, and a user message keeps only `text`, `messageId`, and `clientMessageId`. Pasted
   images never reach plugin code, and the daemon timeline row stores the same item, so a server RPC
   cannot recover them either. Workaround: **Enhanced prompt bubble** is off by default, so the host
   keeps the prompt and its pasted images. Turning the setting on replaces that bubble.
3. **Interception is all or nothing.** A transformer replaces the host item completely. There is no
   way to decorate an item or keep host affordances that the plugin does not reimplement. Returning
   `undefined` is the only opt-out.
4. **Transform results are cached per item.** Paseo runs a transformer once per item and keeps the
   result until a transformer is added or removed. Workaround: the transformers that read a
   preference are registered again when it changes (`client/state/follow-preference.ts`), so items
   already on screen are projected anew; renderers read preferences live; and the plugin reads the
   stored record while it loads, so the first projection already uses it.
5. **Renderers get no workspace.** Props carry `agentId` only, so `cwd` and `workspaceId` need a
   second lookup through `useAgent`.
6. **Token usage is live-only.** Usage is not persisted on timeline items; it arrives only on live
   `turn_completed` / `usage_updated` events and the handle's `lastUsage`. Workaround: the plugin
   server records each turn's start, end, error and usage as it ends (`server/turn-usage.ts`, read
   through the `turns.usage` and `turns.last` RPCs), so turns since the plugin was installed show
   figures on any client; the Tasks board reads Claude Code and Codex session totals from their
   session files (`tasks.session-tokens`). Persisted turn timing is proposed upstream as
   [#7000](https://github.com/getpaseo/paseo/pull/7000) (open).
7. **RPC names are validated late.** The host requires `^[a-z][a-z0-9._-]*$`. A camelCase name such
   as `revealPath` typechecks, then fails the whole plugin at install or reload with
   `Invalid plugin RPC method`.
8. **The React Native runtime module is a stub in the package.** `@getpaseo/plugin/client/react-native`
   ships as `export {}`; the host injects the implementations. Bundling or testing plugin UI outside
   Paseo needs a shim, which is what `.showcase/shims` provides. In 0.13 the stub is
   `@getpaseo/plugin/client/ui`, and `client/react-native` is a deprecated re-export that no longer
   carries `useRevealedText` (`client/ui/use-revealed-text.ts` falls back to drawing text whole;
   [#7571](https://github.com/getpaseo/paseo/pull/7571), open, would keep it).
9. **The theme carries eleven colours.** `PluginTheme` exposes `surface0`–`surface2`, `border`,
   `foreground`, `foregroundMuted`, `accent`, `accentForeground`, and three status colours. Every
   other surface, including code backgrounds and diff tints, must be derived with alpha; that is what
   `client/components/theme-tokens.ts` exists for.
10. **No CSS escape hatch.** React Native styles drop unknown keys, so `backdrop-filter` cannot be
    set through the style API. The plugin does not draw frosted glass.
11. **No font registration.** Faces are embedded as data URIs in an injected `@font-face` rule
    (web only). The bytes stay on the daemon and arrive through the `fonts.embedded` RPC the first
    time a reader picks Inter, because the host sends the whole client bundle again on
    every reconnect. Paseo forces its UI font on every node not under `data-pmono`; the plugin marks
    only monospace regions with it, so interface text follows the host font, and leaves the
    interface `fontFamily` unset for "Follow Paseo", since React Native Web writes non-StyleSheet
    styles inline and an inline family would beat the host rule.
12. **A closed module allowlist, and no SVG renderer.** Plugin client code may import only
    `react`, `react/jsx-runtime`, `react-native`, `@tanstack/react-query`, `zod`,
    `@getpaseo/plugin`, `@getpaseo/plugin/client`, `@getpaseo/plugin/client/react-native`, and
    `@getpaseo/plugin/client/ui`. Anything else throws
    `Module "x" is not available in plugin client code` when the bundle loads, so
    `react-native-svg` and `lucide-react-native` are out of reach. Lucide icons still work,
    because the host renders them: `Icon` from `@getpaseo/plugin/client/react-native` takes any
    Lucide name. Brand marks are not in Lucide, and React Native's `<Image>` decodes PNG, JPEG,
    GIF, and WebP but never SVG, so a data-URI SVG renders on web and stays blank on iOS and
    Android. Those marks are PNG rasters in `server/mark-bitmaps.ts`, which the `marks.bitmaps`
    RPC hands out by id as rows draw them; the client keeps only the ids.
13. **Settings are host-scoped only.** `defineSettings` rejects any scope other than `host`, so
    per-workspace, per-agent or per-client presentation settings are impossible. This plugin stores
    its preferences in that host scope (shared by all clients of the daemon); only the hidden
    `debugPerf` probe flag stays per client.
14. **Paseo's chat find cannot reach replaced rows.** Paseo 0.9.1 found a match by its original
    message id and waited for a row carrying that id; Paseo 0.12 matches items of kind
    `<role>_message` by their timeline position (`agent-stream/chat-find/model.ts`). A transformed
    row is of kind `plugin` and carries `<pluginId>/<itemId>`, so either way Ctrl+F on a styled
    prompt or reply never reveals the match.
    Workaround: the plugin's own find bar, described in [Finding text](../README.md#finding-text).
15. **No way to stop, mark read or unarchive an agent.** The `PaseoApi` agent handle offers `send`,
    `respondToPermission`, `run`, `waitForFinish`, `archive` and `detach`, but no cancel, unarchive
    or mark read; `DaemonClient.cancelAgent` exists and is not exposed, on `main` either.
    `send()` would interrupt the turn, but only by posting another message. Workaround: the Tasks
    board's Stop calls the plugin RPC `tasks.stop`, whose server side runs `paseo agent stop <id>`
    (`server/tasks/register.ts`). The plugin process inherits `PASEO_CLI`
    (`/Applications/Paseo.app/Contents/Resources/bin/paseo`) and `PASEO_HOME`, falling back to
    `paseo` on `PATH`, and it runs on the daemon's machine, so it stops the right agent for remote
    hosts too. Unarchive (`tasks.unarchive`) runs `paseo agent inspect`, then `paseo agent reload`,
    through the same CLI and is hidden with Stop when the CLI is missing. Mark read (`tasks.read`)
    has no CLI either: the server opens its own `DaemonClient` with `connectHostDaemon`
    (`server/tasks/provider-subagents.ts`), which loads the host's internal
    `@getpaseo/client/internal/daemon-client` and `@getpaseo/server/daemon-control` modules, and
    calls `clearAgentAttention`; it is hidden when those modules do not resolve. A mark-read CLI
    command is proposed upstream as [#7647](https://github.com/getpaseo/paseo/pull/7647) (open).
    Archive needs no workaround (`paseo.agents.ref(id).archive()`).
16. **Workspace label colours and project icons are out of reach.** Workspace descriptors carry
    their `projectId` and the names of their assigned `labels`, nothing more. The colours live in the
    label definitions (`DaemonClient.listWorkspaceLabels` / `observeWorkspaceLabels`) and the icon
    comes from `DaemonClient.getProjectIcon`; neither is on `PaseoApi`. Proposed upstream as
    [getpaseo/paseo#7482](https://github.com/getpaseo/paseo/pull/7482) (Discussion
    [#7481](https://github.com/getpaseo/paseo/discussions/7481)), which adds
    `workspaces.listLabels()` and `projects.icon()` (open). Workaround until it ships: the board
    feature-detects those two calls (`client/tasks/data/index.ts`) and otherwise asks the plugin
    RPCs `tasks.labels` and `tasks.project-icons`, whose server side calls `listWorkspaceLabels` and
    `getProjectIcon` over the same `connectHostDaemon` connection as Mark read
    (`server/tasks/register.ts`). Once #7482 ships, the API is used with no plugin change. With
    neither, labels take a stand-in colour picked by their name (`client/tasks/label-colors.ts`)
    and projects a generated initial.
17. **Paseo's status-dot colours are not in the theme (kept as copies by choice).** The sidebar's
    running ring, needs-input alert and attention dot use a separate `statusDot*` band (light
    `#268ae0` / `#b37824` / `#299f51` / `#f12e2f`, dark `#5caaf6` / `#db932e` / `#35c264` /
    `#f7796d`). `PluginTheme`'s `statusWarning`, `statusSuccess` and `statusDanger` only approximate
    three of them, and the running blue has no counterpart at all; `accent` is not reliably blue.
    The board carries copies of both sets (`client/tasks/cards/tokens.ts`) and picks one by the
    luminance of `surface0`; text uses the theme's status colours. This is a design decision rather
    than a gap to close: the board does not need these colours from the host, so no upstream change
    is planned.
18. **No list hook for agents.** `useAgent` and `useWorkspace` read host state by id, so a view
    across workspaces has to call `paseo.agents.list({ subscribe: {} })`. Every entry is a full
    snapshot (`availableModes`, `features`, permissions), and a daemon with 340 unarchived agents
    sends all of them again after each reconnect. Workaround: subscribe to active statuses only and
    page finished agents when the view is open.
19. **No provider sub-agents on `PaseoApi`.** The sub-agents a provider runs inside a session
    (Claude Code's Agent tool, Codex's) are not Paseo agents, and `PaseoApi` can neither list them
    nor read their timeline. Workaround: the server seeds them with `listProviderSubagents` over the
    `connectHostDaemon` connection, follows `agent.provider_subagents.update` through
    `paseo.observeEvents`, and serves them as `tasks.subagents` and `tasks.subagent-timeline`
    (`server/tasks/provider-subagents.ts`); the board draws them as read-only cards.
20. **`openAgent` cannot pin a tab.** The host forwards only `{serverId, agentId}`, so a tab opened
    for an archived agent is dropped at once and Paseo shows another tab of that workspace.
    Workaround: Open tab is hidden on an archived task, with Unarchive in its place
    (`client/tasks/model.ts`). Proposed upstream as
    [#6382](https://github.com/getpaseo/paseo/pull/6382) (draft).
21. **No confirm dialog.** The SDK has no way to ask the user a yes-or-no question. Workaround:
    React Native's `Alert` on iOS and Android, Electron's undocumented
    `window.paseoDesktop.dialog.ask` on desktop, and `confirm()` in a browser
    (`client/components/confirm-dialog.ts`).
