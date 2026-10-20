# Plugin SDK limitations found while building Better Paseo

Measured against `@getpaseo/plugin` 0.8.0 and the Paseo 0.8.0 desktop build; entries 15–18 were
checked on 2026-10-20 against `@getpaseo/plugin` 0.11.2 and the Paseo 0.12.0 desktop build while
planning a Tasks board. Each entry names the evidence and the workaround this plugin uses or plans.

1. **No file navigation.** Timeline renderer props are exactly `{agentId, theme, host, layout,
timestamp, item}`, and plugin navigation offers only `openSettings`, `openSurface`,
   `openWorkspacePanel`, `openAgentPanel`, `openAgent`, and `openWorkspace`. The host's own file tab
   target (`{kind:"file", path}`, reachable in-app through `?open=file:<path>`) is not exposed, and
   the `paseo://` scheme only carries agent deep links. Workaround: a daemon-side RPC that reveals
   the path in the operating system's file manager.
2. **Transformers see a stripped item.** The app maps its stream item to the plugin item before any
   transformer runs, and a user message keeps only `text`, `messageId`, and `clientMessageId`. Pasted
   images never reach plugin code, and the daemon timeline row stores the same item, so a server RPC
   cannot recover them either. Workaround: **Enhanced prompt bubble** is off by default, so the host
   keeps the prompt and its pasted images. Turning the setting on replaces that bubble.
3. **Interception is all or nothing.** A transformer replaces the host item completely. There is no
   way to decorate an item or keep host affordances that the plugin does not reimplement. Returning
   `undefined` is the only opt-out.
4. **Transform results are cached per item.** Changing a preference does not re-run transformers for
   items already on screen. New items follow the change; existing ones need a reload.
5. **Renderers get no workspace.** Props carry `agentId` only, so `cwd` and `workspaceId` need a
   second lookup through `useAgent`.
6. **Token usage is live-only.** Usage is not persisted on timeline items, so a turn this client did
   not observe live shows no figures.
7. **RPC names are validated late.** The host requires `^[a-z][a-z0-9._-]*$`. A camelCase name such
   as `revealPath` typechecks, then fails the whole plugin at install or reload with
   `Invalid plugin RPC method`.
8. **The React Native runtime module is a stub in the package.** `@getpaseo/plugin/client/react-native`
   ships as `export {}`; the host injects the implementations. Bundling or testing plugin UI outside
   Paseo needs a shim, which is what `.showcase/shims` provides.
9. **The theme carries six colours.** `PluginTheme` exposes `surface0`–`surface2`, `border`,
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
14. **Paseo's chat find cannot reach replaced rows.** Paseo 0.9.1 finds a match by its original
    message id, then waits for a row carrying that id. A transformed row always carries
    `<pluginId>/<itemId>` instead, so Ctrl+F on a styled prompt or reply never reveals the match.
    Workaround: the plugin's own find bar, described in [Finding text](../README.md#finding-text).
15. **No way to stop an agent.** The `PaseoApi` agent handle offers `send`, `run`, `archive` and
    `detach`, but no cancel; `DaemonClient.cancelAgent` exists and is not exposed, on `main` either.
    `send()` would interrupt the turn, but only by posting another message. Planned workaround: a
    plugin RPC on the server side runs `paseo agent stop <id>`. The plugin process inherits
    `PASEO_CLI` (`/Applications/Paseo.app/Contents/Resources/bin/paseo`) and `PASEO_HOME`, and it runs
    on the daemon's machine, so it stops the right agent for remote hosts too.
16. **Workspace label colours and project icons are out of reach.** Workspace descriptors carry
    their `projectId` and the names of their assigned `labels`, nothing more. The colours live in the
    label definitions (`DaemonClient.listWorkspaceLabels` / `observeWorkspaceLabels`) and the icon
    comes from `DaemonClient.getProjectIcon`; neither is on `PaseoApi`. Proposed upstream as
    [getpaseo/paseo#7482](https://github.com/getpaseo/paseo/pull/7482) (Discussion
    [#7481](https://github.com/getpaseo/paseo/discussions/7481)), which adds
    `workspaces.listLabels()` and `projects.icon()`. Until it ships: neutral label dots and letter
    avatars, chosen by feature detection.
17. **Paseo's status-dot colours are not in the theme.** The sidebar's running ring, needs-input
    alert and attention dot use a separate `statusDot*` band (light `#268ae0` / `#b37824` /
    `#299f51` / `#f12e2f`, dark `#5caaf6` / `#db932e` / `#35c264` / `#f7796d`). `PluginTheme`'s
    `statusWarning`, `statusSuccess` and `statusDanger` only approximate three of them, and the
    running blue has no counterpart at all; `accent` is not reliably blue. Workaround: approximate
    the three, and pick the running blue by the luminance of `surface0`.
18. **No list hook for agents.** `useAgent` and `useWorkspace` read host state by id, so a view
    across workspaces has to call `paseo.agents.list({ subscribe: {} })`. Every entry is a full
    snapshot (`availableModes`, `features`, permissions), and a daemon with 340 unarchived agents
    sends all of them again after each reconnect. Workaround: subscribe to active statuses only and
    page finished agents when the view is open.
