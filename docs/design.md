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

## Colour

The board draws in the host theme's colours (`surface0`, `surface1`, `surface2`, `border`,
`foreground`, `foregroundMuted`, `accent`), so it follows light, dark and custom themes. A data
colour (a status, a label, a project, a provider) is never invented: where Paseo has one, take
Paseo's exact value, from the shipped bundle
(`/Applications/Paseo.app/Contents/Resources/app-dist/_expo/static/js/web/index-*.js`), and
check it against a screenshot of the same thing in Paseo with a pixel read, not by eye.

Paseo keeps three sets per identity colour name (violet, sky, emerald, orange, pink, indigo,
teal, red, amber, blue). Each set has its own job; taking the wrong one is the mistake to avoid:

| Set | Paseo name | Red, for example | Used by Paseo for | Used by the board for |
| --- | --- | --- | --- | --- |
| Base | `identityColor` | `#b06260` | a project's generated icon (white initial on it); a label chip's 10% tint | `IDENTITY_COLORS` (`client/tasks/cards/project-icon.tsx`) |
| Light text | `identityForeground(_, "light")` | `#9c4243` | not what the label list or sidebar draws | nothing (the board used it by mistake until 2026-10-23) |
| Bright | `identityForeground(_, "dark")` | `#d88381` | label dots and label text, in both themes | `LABEL_COLORS` (`client/tasks/data/index.ts`), every tag |

### Data colours

| What | Source | Light | Dark |
| --- | --- | --- | --- |
| Status: running, needs input, done unread, failed | Paseo's `statusDot*` | `#268ae0`, `#b37824`, `#299f51`, `#f12e2f` | `#5caaf6`, `#db932e`, `#35c264`, `#f7796d` |
| Label | Paseo's bright identity set, by the label's colour name; the daemon's definitions come through `tasks.labels` | as listed in `LABEL_COLORS` | same |
| Label the daemon gives no colour | a Linear label colour, picked by name, distinct until the 10 run out (`client/tasks/label-colors.ts`) | | |
| Project icon | Paseo's base identity set, hashed from the project key as Paseo does | | |
| Provider | the vendor's brand colour (`client/components/provider-logo.tsx`); a monochrome mark takes `foreground` | | |
| Branch | the plugin's own (GitHub's link blue); Paseo has none | `#0969da` | `#4493f8` |
| Archive | the plugin's own (Tailwind yellow), kept clear of the warning orange | `#eab308` | `#facc15` |

The theme's `statusSuccess`, `statusWarning` and `statusDanger` win over the table when a theme
sets them.

### Tints

A data colour reaches a surface only by mixing into it (`mix(surface, hue, amount)`), never as
a translucent overlay, so a tint reads the same over any card. Text on a tint is pulled toward
`foreground` until it reads at 4.5:1 (`readableOn`).

| Use | Fill | Border | Text and icon |
| --- | --- | --- | --- |
| Agent pill (coloured brand) | hue 12% (20% dark) | none | icon the hue, text the hue 30% toward `foreground` |
| Branch pill | hue 8% (14% dark) | none | icon the hue, text `foreground` |
| Status pill (subtasks) | hue 10% (16% dark) | hue 26% (34% dark) | muted |
| Neutral pill | `foreground` 3.5% (6% dark) | `pillBorder` | muted |
| Label pill | none | `pillBorder` | the tag in the label colour, text muted |
| Answer button | amber 12% (18% dark), 20% (26%) hovered | amber 40% (45% dark) | amber at 4.5:1 |
| Mark read button | none | green 40% (45% dark) | green at 4.5:1 on the card and hovered |
| Archive button | none | Archive's yellow | the yellow at 4.5:1 on the card and hovered |

## Pills and chips

Every pill is fully rounded with a hairline border unless the table says otherwise; every
control row is rounded at 6. An icon in a pill or row is the size of the Lucide icons beside it.

| Component | Where | Height | Radius | Fill | Icon | Text |
| --- | --- | --- | --- | --- | --- | --- |
| Card pill | `Pill` in `task-card.tsx` | 20 (24 phone) | full | per the tints table | 11 (12 phone) | `sm` x 11/12, line x 1.25 |
| Details chip | `Chip` in `detail-charts.tsx` | 22 (28 touch) | full | none | 14 (16 touch) | `sm` |
| Filter bar chip, folded chip, menu button | `filter-bar.tsx` | 28 | 6 | none; `surface1` hovered or open | 14 | `base` |
| Phone filter sheet chip | `filter-sheet.tsx` | 32 | 4 | none; `accentSoft` when on | 14 | `base` |
| Menu row | `menu.tsx`, `MENU` | 32 | 6 | none; `chrome.hover` hovered | 16 | `base` |
| Sidebar group row | `details-sidebar.tsx` | 36 (44 touch) | 6 | none; `surface2` on, `controlHover` hovered | 16 in a 20 slot | `base`, count `sm` |
| Card button | `CardButton` in `task-card.tsx` | 28 (at least 32 phone) | 6 (7 phone) | per the tints table | 13 (14 phone) | `sm`, weight 500 |

All heights grow with the host's interface text size through `taskControlHeight`.

## Labels

A label looks the same wherever it appears: a solid tag in its colour, then its name.

- **A specific label** (a card pill, a details chip, a label menu row, the phone sheet's chips, a
  sidebar group row, an applied label filter, a row in a folded label chip's menu) leads with
  `TagMark` (`client/tasks/cards/tag-mark.tsx`) in the label's colour, or `foregroundMuted` for a
  label with none. Never a dot, never a tinted pill.
- **Labels as a kind** (the filter bar's Labels button, the sidebar's Labels tab, the count on a
  folded chip) draw Lucide's outline `Tag` in `foregroundMuted`, like the other filter kinds.
- The label's pill or chip keeps the neutral hairline and no fill, and the name stays muted
  (`foreground` in the details): the colour is the tag's alone.
- `TagMark` is Lucide's Tag outline, filled, built from Views (the host `Icon` only strokes and the
  sandbox has no react-native-svg). Its hole is drawn in the colour of the surface under it, so
  pass the surface as it is right now: the card's current fill (hovered, highlighted, failed), the
  menu row's fill (`leading` may be a function of it), the sidebar row's fill (on, hovered), the
  board's `surface0` under a clear filter chip.

## Buttons

### Working state

A Tasks button whose action waits on the daemon (Stop, Mark read, Unarchive) never changes its
words while it works. This holds on the card, in the details sidebar and in the phone sheet's action
bar alike. While the action is out the button:

- keeps its label and its resting look (Stop stays in its danger tint, not the solid confirm fill);
- shows a hollow spinner ring in the icon's slot, in the icon's box and colour so the button keeps
  its width (a button with no icon gains the spinner before its label). The ring is `SpinnerRing`
  (`client/tasks/cards/status-icon.tsx`): the running status ring without its centre dot, a 30%
  track with a turning 90% quarter, on the running rings' shared clock. Not the platform's
  `ActivityIndicator`, whose spokes differ between iOS, Android and web;
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
