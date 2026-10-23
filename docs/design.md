# Design notes

## Icons

Every icon in the timeline is one line family: the host's Lucide set, drawn at the host's stroke.
A tool row, a preview header, a hub or agent card all draw from it. Where a call belongs to a
service or a program with a mark of its own (Linear, Jenkins, Python, Docker), the row draws that
mark instead, redrawn in the same line style so it sits beside the Lucide icons at the same weight.

### What the host draws

- Paseo wraps the whole app in `<LucideProvider strokeWidth={ICON_STROKE_WIDTH}>`, and
  `ICON_STROKE_WIDTH` is **1.5** (`packages/app/src/app/_layout.tsx`; the same in 0.11.2, 0.12.0
  and main). A Lucide icon a plugin draws through the host `Icon` is therefore 1.5 on the 24-unit
  grid, not Lucide's default 2. Compare every icon against 1.5.
- The host `Icon` takes a Lucide name. An unknown name renders nothing, so use names that exist in
  `lucide-react-native` (the host pins 1.50). Upstream main also accepts `{ svg }` icons tinted
  through `currentColor` (getpaseo/paseo#7368); no release has it yet. Once one does, the marks
  below can move from rasters to host-drawn vectors.
- The offline showcase stands in for the host with `lucide-react` (`.showcase/shims`). The shim
  passes the same 1.5, so screenshots show the weight the user sees. Keep them in step.

### Which icon a row draws

`toolCallIconName` (`client/components/tool-callouts.tsx`) picks, in order:

1. An agent operation's own icon, or a provider mark for a created agent.
2. For an MCP call, the service's icon from `client/tools/mcp-service-icon.ts`.
3. For a shell or bash call, the program's icon from `client/tools/command-icon.ts`.
4. The kind's Lucide icon (`toolIconName`): `Plug` for MCP, `SquareTerminal` for shell, and so on.

MCP servers are matched on the server name with case and separators dropped, because Claude's
connectors prefix and keep the case (`claude_ai_Google_Calendar`) and local servers add their own
words (`linear-server`, `mcp-server-git`). The table is ordered and the first match wins, so put
the narrower pattern first (`github` and `gitlab` before the whole-name `git`, `confluence` before
`atlassian`). A server that carries several services names the service in its tool
(`mcp-atlassian`: `confluence_*` draws Confluence, the rest Jira); list those in `SHARED_SERVERS`.

A shell command's program is the first word of the first command that is not shell setup (`cd`,
`export`, `source`, env assignments, `sudo`, `env`, `time`), without its directory, `.exe`, or a
trailing version (`python3.12` is `python`, `pip3` is `pip`). A runner that fetches another program
(`npx`, `pnpx`, `bunx`, `uvx`, `pipx`) draws that program's icon when it is listed (`npx playwright
test` is Playwright, `npx tsc` is TypeScript) and its own otherwise (`npx some-tool` is npm). A
subcommand that is a different tool draws that tool (`xcrun simctl` is the simulator, other `xcrun`
commands are Apple).

A service or program with no usable line mark draws the Lucide icon for what it is (`FolderOpen`
for the filesystem server, `Coffee` for Java, `ShipWheel` for kubectl and Helm, `Dog` for
Datadog, `Smartphone` for the iOS simulator and device servers, `Atom` for Electron,
`FlaskConical` for Jest and Mocha, `Container` for Podman, `LibraryBig` for Context7). Everyday
utilities are drawn by what they do: `Server` for ssh, scp and rsync, `Archive` for tar and zip,
`Braces` for jq and yq, `FileDiff` for diff, `ExternalLink` for open, `Search` for rg, grep and
search servers. One that is not listed keeps the plug or the terminal: an unknown icon is never
guessed.

Coding agents run from a shell (`claude`, `codex`, `gemini`, `opencode`, `cursor-agent`,
`copilot`, `ollama`) draw the same `provider:*` mark as the agent rows that run them, so one
agent looks the same wherever it appears. Those marks are the vendors' solid silhouettes, the one
place a tool row is not a line icon.

### Mark format

| Property | Value |
| --- | --- |
| Grid | Lucide's 24 units; strokes round-capped and round-joined |
| Weight | 1.5, the host's stroke |
| Live area | Lucide's: a full-bleed vendor glyph is scaled by 22/24 (0.9167) about the centre |
| Colour | white; the row tints it (`tintColor`) with its icon colour, danger when the call failed |
| Raster | 96 x 96 RGBA PNG. React Native's `<Image>` cannot decode SVG and the plugin sandbox has no react-native-svg |
| Id | `brand:<file name>`, listed in `MARK_IDS` and `MONO_MARKS` (`client/components/marks.ts`) |
| Delivery | served by the daemon's `marks.bitmaps` RPC on first use, cached on `globalThis` across reconnects; the client bundle carries only the ids |

A row draws its mark with `BrandMark` directly, not through `Glyph`'s box, so a mark costs one
native view, the same as a Lucide icon.

### Choosing a source

Take the vendor's own shape and only adapt its weight. Do not redraw a logo that has an official
or established line version. In order of preference:

| Source | Treatment | In the source file | Examples |
| --- | --- | --- | --- |
| Tabler brand icon (same grid and style as Lucide) | stroke set to 1.5 | `stroke-width="1.5"` | Jira, Docker, Python, Vite, Next.js |
| Another line icon set, or the vendor's own (TDesign for WeCom, IconPark for Feishu, Lucide Lab, Arcticons, Remix `-line`, Teenyicons `-outline`, Proicons) | stroke rescaled to 1.5 on its own grid (3 on a 48 grid) | the rescaled `stroke-width` | Feishu, Confluence, ESLint, webpack |
| Vendor glyph that is already line-like but drawn as filled outlines | thinned by a quarter unit a side, only if its strokes are heavier than 1.5 | `data-erode="1"` | Sentry, Perplexity, Gitee, WeCom |
| Vendor glyph that is already line-like at 1.5 | used as is | nothing | SonarQube, Kafka, Prettier, Turborepo |
| Solid vendor glyph (a filled disc, a face) | drawn as its own contour, a band 1.5 wide just inside its edges, holes included | `data-outline="1"` | Jenkins, Grafana, Postman, Redis, Expo, Vitest, Bun, NGINX |
| No mark survives at 14 px, or its strokes stay thinner than 1.5 | the Lucide icon for what it is | nothing to add | Datadog (`Dog`), Electron (`Atom`), Jest (`FlaskConical`), Podman (`Container`); Argo, Hugging Face, Nx and Neovim are not listed |

Exceptions kept on purpose: the Paseo mark is Paseo's own line logo and is not redrawn; Notion keeps
its official N inside a 1.5 frame; npm and Go use Tabler's wordmarks as their marks.

Thinning is a judgement made by eye, not by default: Gitee, WeCom and Heroku are too heavy without
it, SonarQube and Kafka too faint with it. A mark that stays faint even unthinned (Electron's
hairline orbits) gives way to a Lucide icon. Decide it by the check below.

### Adding a mark

1. Pick the source with the table above and save it as `assets/tool-marks/<name>.svg`: white,
   24-unit `viewBox`, the treatment attribute if any, and a comment naming the source and what was
   done to it.
2. Add `brand:<name>` to `MARK_IDS` and `MONO_MARKS` in `client/components/marks.ts`.
3. Run `node scripts/build-tool-marks.mjs` (needs `resvg` and ImageMagick). It writes every mark into
   `server/mark-bitmaps.ts`, adding new entries; unchanged sources produce identical bytes.
4. Map the service or program in `mcp-service-icon.ts` or `command-icon.ts`, and add a case to
   `test/unit/mcp-service-icon.test.ts` or `test/unit/command-icon.test.ts`.
5. Check it at 14 px beside `Globe` and `Plug` in both themes (a temporary row in
   `.showcase/showcase.tsx`, `SHOT_ONLY=shot-tools-v2-light,shot-tools-v2-dark`). It must read as
   the vendor's mark and carry the same weight as its neighbours.
6. When the weight is in doubt, check on the real host. On the iOS simulator a raster at 1.5 carries
   about 13% more ink than the host's vector at 1.5 (antialiasing), and one at 2 about 46% more;
   the web showcase shows no gap. A mark that looks right in the showcase can still be heavy on a
   phone, never the other way round.

### Cost

- Each mark is 0.6 to 2.6 KB of PNG (median about 1.6 KB), in the daemon only. The client bundle
  grows by the id strings and the two lookup tables.
- Both lookups are cached by their key; a cached lookup is about 0.15 microseconds in Hermes.
- On the iOS simulator (A/A/B, five runs each, 2026-10-20) a 110-turn history rendered the same as
  before, and a turn of 134 calls with 61 different icons rendered its rows 17% faster, because a
  mark is one `Image` where the Lucide icon it replaces is an `Svg` with three or four shapes.
  Dropped and longest frames did not change.
- The first row that shows a new mark draws an empty slot of the same size until the RPC answers,
  once per app launch.

## Buttons

### Working state

A Tasks button whose action waits on the daemon (Stop, Mark read, Unarchive) never changes its
words while it works. This holds on the card, in the details sidebar and in the phone sheet's action
bar alike. While the action is out the button:

- keeps its label and its resting look (Stop stays in its danger tint, not the solid confirm fill);
- shows the platform's small `ActivityIndicator` in the icon's slot, scaled into the icon's box so
  the button keeps its width (a button with no icon gains the spinner before its label);
- dims to 0.6 opacity and drops its hover fill;
- takes no second press: `disabled`, and `accessibilityState={{ disabled: true, busy: true }}`.

No "…ing" labels ("Stopping…", "Unarchiving…"). A confirm step is not a working state: Stop's
"Confirm stop" asks for a second press and may say so in words; once confirmed and working, the
button goes back to "Stop" with a spinner.

`CardButton`, `ReadControl` and `StopControl` (`client/tasks/cards/task-card.tsx`) and
`OutlineButton` and `BarButton` (`client/tasks/cards/detail-cards.tsx`) draw this state; pass
`busy` rather than a different label. The spinner's `testID` is the button's with `-spinner`
appended (`detail-stop-spinner`), and each button's test checks the label, the dimming, the busy
state and the spinner.
