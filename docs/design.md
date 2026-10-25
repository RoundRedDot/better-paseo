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
| Subtask corner mark | the project icon's theme colour, unfaded: an uploaded icon's most common lively colour (else its most common colour that is not white), read by the server in `tasks.project-icons` (`server/tasks/icon-color.ts`); a generated square's identity colour. Pulled to 3:1 against the card, so a black logo shows on a dark card. A 12 pt triangle over a subtask card's top-right corner (`CornerMark` in `task-card.tsx`); the context ring keeps its place, and a provider subagent's card is dashed instead | full | full |
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
| Action buttons | none at rest; see [Buttons](#look) | | |

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
| Card button | `CardButton` in `action-buttons.tsx` | 28 (at least 32 phone) | 6 (7 phone) | none; per [Buttons](#look) hovered | 13 (14 phone) | `sm`, weight 500 |

All heights grow with the host's interface text size through `taskControlHeight`.

### Thinking level labels

Use `formatThinkingLevel` in `client/tasks/cards/format.ts` for visible structured
thinking levels in shared subtask metadata only when the measured full metadata
row exceeds its available width. Show the supplied full level when it
fits, and restore it after widening or reducing the interface font size. This
uses actual content fit, not the `240 * scale` permission threshold. The card's
combined model pill, standalone thinking pill and details chip keep the supplied full level.
For subtask abbreviations, match case-insensitively after trimming:

| Full level | Visible label |
| --- | --- |
| None | `n` |
| Minimal | `min` |
| Low | `l` |
| Medium | `m` |
| High | `h` |
| Xhigh / Extra High | `xh` |
| Max | `max` |

Keep the `Brain` icon. Hover hints and accessibility labels retain the original
full level; do not abbreviate stored data, model copy values or provider-written
facts strings. Unknown/custom levels remain as supplied. Measure the original
full thinking label even while its abbreviation is visible, including rows with
no permission mode, so resizing cannot make the two representations oscillate.
These scope rules apply to both wide and compact layouts.

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

### Look

Every Tasks action button is an outline, on the card, in the details sidebar and in the phone
sheet's action bar alike: Stop (armed or not), Allow, Deny, "Answer", Mark read, Archive,
Unarchive, Open tab. None is ever filled with its hue.

- **At rest** only the border, the label and the icon carry the button's colour. The fill is
  the surface under it: transparent on the card, the card colour in the sidebar and the bar.
- **Hovered** (pressed on a phone, which has no hover) the button's hue is tinted over the card,
  10% on a light theme and 16% on a dark one. The border and label stay.
- **Armed**, "Confirm stop" keeps Stop's colours exactly; its words change and its icon turns from
  Lucide's `Power` to `OctagonAlert` (`CONFIRM_STOP_ICON`), the stop sign asking for the second
  press. It keeps that icon when its label folds on a narrow row.
- **The outline is 0.5 pt** everywhere. Chrome, and so Paseo's Electron, rounds any border under
  1 CSS px up to a whole one (2 device px at 2x), so on the web `buttonOutline()`
  (`client/tasks/board/board-style.ts`) draws the line as an inset `box-shadow`, 1 device px at
  2x; on iOS and Android it is a plain 0.5 border. The split Stop pill gets per-side lines so its
  seam is drawn once, in the danger hue at 40%.
- **The label and icon** are the hue pulled toward `foreground` until they read at 4.5:1 on the
  card and on the hover tint (`readableOn`). A plain button's icon is `foregroundMuted` in the
  sidebar and the bar.

| Look | Used by | Border | Label and icon | Hover |
| --- | --- | --- | --- | --- |
| `plain` | Open tab on the card and in the sidebar, the tab square in the bar, a permission answer that is neither | `buttonBorder`: the theme border 5% toward `foreground` (20% dark, where the border all but matches the card and a half-pixel line in it vanishes) | `foreground` | `controlHover`, `foreground` 7% (10% dark) |
| `primary` | Allow, Unarchive, the bar's Open tab | accent 50% (55% dark) | accent at 4.5:1 | accent tint |
| `danger` | Stop, Confirm stop, Deny | the theme's `statusDanger` | the same | danger tint |
| `answer` | "Answer", which opens the tab for a question | needs-input amber 40% (45% dark) | amber at 4.5:1 | amber tint |
| `archive` | Archive | Archive's yellow | the yellow at 4.5:1 | yellow tint |
| `read` | Mark read on an unread card (a failed card's stays `plain`) | unread green 40% (45% dark) | green at 4.5:1 | green tint |

`buttonHue(tokens, look)` (`client/tasks/cards/action-style.ts`) returns these three colours;
`CardButton`, `ReadControl`, `StopControl`, `OutlineButton`, `RequestButton` and `BarButton` all
take them from it, and `requestLook(button)` picks a permission button's look in every place.
A new action button takes a look from the table rather than its own colours.

### Layout and narrow widths

The same rule applies to card actions (desktop hover, tablet and phone), the details sidebar,
and the mobile details sheet's action bar. Keep the existing action order and a single row.
Measure the available content width and the complete label at the current language, host type
size and system font scale. When the buttons do not fit, fold labels **from left to right**:
each affected button becomes an icon-only control before the next button gives up its label.
Never truncate a label, wrap it, or reduce its font to squeeze it in. Restore complete labels
when the row has room again. A narrow default tablet lane is normally at least 260 pt; it may
show part of the next lane rather than force two complete lanes into the viewport. On the same
small tablet, Narrow adapts down to 220 pt, keeping its scroll width at least 40 pt below
Default. Wide stays at 300 pt when the board is below 632 pt; wider boards retain the
existing preset ranges.

An icon-only button keeps its outline, colour, height, action and full accessibility label.
Its width is its base target height (28/32 pt on cards, 48 pt in the sheet bar); its height
still grows with large type. A split Stop button additionally reserves its menu segment.
Keep confirmation (`OctagonAlert`), working spinner and disabled semantics in icon-only mode.
A spinner replaces the action icon, so a folded working button never draws a second arrow.
Optional status hints such as “Already open” leave with the label. “Open parent” uses
`CornerLeftUp`, including its context-menu entry and provider-subtask parent-tab shortcut;
ordinary “Open” keeps `ArrowUpRight`.

`ActionRow` and `useActionFit` (`client/tasks/cards/action-row.tsx`) own the measurement and
ordered folding. All action-button variants participate in that row rather than independently
shrinking their labels.

### Working state

A Tasks button whose action waits on the daemon (Stop, Mark read, Unarchive) never changes its
words while it works. This holds on the card, in the details sidebar and in the phone sheet's action
bar alike. While the action is out the button:

- keeps its label and its resting look (Stop goes back to "Stop" in its danger outline);
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

`CardButton` (`client/tasks/cards/action-buttons.tsx`), `ReadControl` and `StopControl` (`client/tasks/cards/task-card.tsx`) and
`OutlineButton` and `BarButton` (`client/tasks/cards/detail-cards.tsx`) draw this state; pass
`busy` rather than a different label. The spinner's `testID` is the button's with `-spinner`
appended (`detail-stop-spinner`), and each button's test checks the label, the dimming, the busy
state and the spinner.

## Shared subtask lists

This section is the project design contract for child Agent rows across desktop,
iPad, phone, light and dark themes. Apply it to expanded cards, the details
sidebar and the details sheet through the shared components below. An iPad lane
can be narrow even when the device is wide; available row width governs folding.

The agreed visual rules are:

- Keep the combined identity/status mark on the left and the jump action on the right.
- Keep the title on one line and its secondary metadata on one line; neither
  metadata fields nor the time group may create another line.
- Show full thinking levels when the complete metadata row fits; use the agreed
  lowercase abbreviation only when it overflows, and restore the full level when it fits again.
- Reduce permission/mode text to its icon in narrow or overflowing columns,
  including custom modes. Keep its full accessibility name.
- Never show `待查看` / `To review` as secondary text, even in a wide row.
  Keep the unread status dot and accessible status. Keep waiting-input and failed text.

### Component ownership

All three expanded subtask lists use `SubtaskRow` from
`client/tasks/cards/subtask-row.tsx`, also exported by the cards barrel:

| Surface | Container |
| --- | --- |
| Expanded board card | `TaskCardView` in `task-card.tsx` |
| Details sidebar | `TaskDetailCards` in `detail-cards.tsx` |
| Mobile details sheet | The same `TaskDetailCards`, with touch targets |

`SubtaskRow` owns the row geometry, title, `ChildMark`, `SubtaskMetadata`, jump
button and hover rendering. Containers supply data, theme, interaction capability
and navigation callbacks; they own sorting, expansion and completed-row muting.
Do not add a surface-specific row renderer, style override or visibility rule.

### Row layout

The row has three columns: a combined identity/status mark, a flexible content
column, and a fixed jump target. Its title and metadata never compete for width.

| Element | Shared rule |
| --- | --- |
| Identity slot | 18 pt wide, aligned with the title's first line; contains `ChildMark` |
| Content column | `flex: 1`, `minWidth: 0`; 2 pt between title and metadata |
| Title | `HOST_FONT.sm` / `HOST_LINE.smRead`; one line, tail ellipsis; leading tag or issue ID muted |
| Metadata | `HOST_FONT.sm` / `HOST_LINE.smRead`, 12 pt icons and context ring; one line below the title with 10 pt column gaps; remaining long text uses tail ellipsis |
| Row | 8 pt column gaps, 6 pt horizontal padding, radius 6 |

Touch changes targets and vertical spacing, not the content or icon rules:

| Metric | Pointer | Touch |
| --- | --- | --- |
| Minimum row height | 32 pt | 44 pt |
| Vertical padding | 7 pt | 10 pt |
| Jump target | 22 x 22 pt | 32 x 32 pt |
| Jump glyph | 14 pt | 16 pt |

Typography follows the host interface size. Minimum row heights grow through
`taskControlHeight`; marks and metadata icons retain their shared authored sizes.

### Combined identity and status

`ChildMark` draws the identity at 14 pt with the status overlapping its bottom-right
corner. Keep both visible; a standalone status icon does not identify the child.

| Child kind | Identity |
| --- | --- |
| Ordinary Paseo agent | Agent brand through `BrandMark` |
| Provider-native subagent (`kind: "provider"`) | Type/tool icon through `subagentTypeIcon`, not the parent agent's brand |

Reuse the existing mapping in `client/tasks/subagent-type.ts`; do not copy it into
individual surfaces or infer a type from the task's description:

| Subagent type | Lucide icon |
| --- | --- |
| `Explore` | `Search` |
| `Plan` | `ListChecks` |
| `general-purpose` | `Shapes` |
| `workflow` | `Workflow` |
| `fork` | `Split` |
| `claude`, custom, missing or unknown type | `Bot` |

Type matching ignores case and surrounding spaces and works without a subtitle.
These are subagent type icons, not the icons of tools the subagent is executing.
The same identity keeps its running or needs-input ring, unread or failed dot,
finished check, or archived box as its state changes.

| State | Identity corner |
| --- | --- |
| Running | Running ring |
| Needs input | Hollow warning ring |
| Unread | Success dot; no secondary unread text |
| Failed | Danger dot; keep the failed secondary text |
| Done | Success-coloured `CircleCheck` |
| Archived | Muted `Archive` |

Use the existing status/theme tokens for these marks. Keep the corner's knockout
the same colour as the row background, including on hover; never hide the corner
to make more room for metadata.

### Secondary information

`SubtaskMetadata` owns this order and uses the same fields in every surface:

| Information | Rendering |
| --- | --- |
| Provider subagent facts | `subagentFacts(...).text`; preserve the supplied facts, without repeating the leading type icon |
| Model | Model label, including when siblings use the same model |
| Thinking level | `Brain` followed by the supplied full level when it fits, otherwise the lowercase [thinking level label](#thinking-level-labels); retain the supplied full accessibility label |
| Permission/mode | `modeIcon` followed by the mode label; `ShieldOff` uses the warning colour |
| Attention status | Waiting-input or failed text, with the appropriate tone; unread uses only the identity mark's status dot at every width |
| Context | `ContextRing`; amber from 75%, red from 90%; percentage in its accessibility label |
| Start time | `Clock` followed by the start time, when available |
| Duration | `Hourglass` followed by the timer; a waiting task uses `Clock` |

Chinese duration labels omit the `约` prefix in cards, shared child rows and timer
hints: use `8m` or `1h 30m`. Keep the existing minute rounding and one-minute
minimum; English duration estimates retain their existing `~` prefix.

Omit missing fields rather than inventing values. Do not merge shared model or
thinking information into a footnote. Only the metadata follows the live clock;
a timer tick must not rebuild the surrounding card or list.

### Narrow columns

Measure the metadata column, not the screen or the enclosing sheet: a wide tablet
can still have narrow lanes. `SubtaskMetadata` owns the measurement and considers
a positive width at most `240 * useTasksFontScale()` narrow. Also measure the
unfolded metadata row: when its natural width exceeds the available column,
fold the optional permission text even above that threshold. The invisible,
non-interactive measurement row contains text and icon-sized spacers only, is
excluded from assistive technology, and never duplicates live rings or controls.

| Information | When to reduce | Reduced rendering and restoration |
| --- | --- | --- |
| All permission/mode labels, including `Bypass`, `Full Access`, `Default Permissions`, `Allow All`, `Plan Mode` and custom modes | Positive column width at most `240 * scale`, or unfolded row wider than the column | Hide text, keep the mode icon and full accessibility name; restore text only when neither condition applies |
| Thinking level | The measured full metadata row is wider than the positive column width | Keep `Brain` and use the lowercase abbreviation; restore the full supplied level when the row fits, including at exact equality |
| Unread / To review text | Always omitted | Keep the identity status dot and row's accessible status; never restore secondary unread text |
| Running child's start time and duration | Positive column width at most `240 * scale` | Hide; restore outside that narrow band |
| Brand/type with status, model and context | Do not omit | Keep; long model text may truncate within the single line |
| Waiting-input and failed status, waiting and finished times | Do not omit | Keep; long text may truncate within the single line |

Do not use the permission threshold as a shortcut for thinking-level abbreviation.
A short metadata row can show `Medium` in a narrow column; a longer row may need
`m` above 240 pt. Measure the full metadata with original thinking and permission
labels, even while either is reduced. Width 0 or an unknown width is not evidence
of overflow. Rows with thinking but no mode still need this measurement.

Restore permission text when the unfolded row fits and the column is no longer
narrow; restore running times when the column is no longer narrow. Never restore
unread text. Re-evaluate the threshold and natural width when the interface font
or metadata changes, even if the column width stays the same. Keep
measuring a row whose only metadata was its now-hidden running time, so widening
can restore it. A child with only unread status has no metadata line. Layouts
must not shrink the mode icon, abbreviated thinking label or context ring.
Card, sidebar and sheet callers include the full status once in the row's
accessibility label; `SubtaskRow` does not append it again.

### Interaction and navigation

The jump button reserves its width while hidden; hover never reflows the title
or metadata. Touch and native clients show it continuously. Web pointer layouts
show it on hover, except that a provider subagent's parent-tab shortcut stays visible.
If navigation is unavailable, omit the button.

Ordinary children use `ArrowUpRight` to open their own tab. Provider subagents use
`CornerLeftUp` to open their parent's tab. Row presses and optional long presses
run the callbacks supplied by the container; the component does not choose a
different navigation path. On web, the row is a group and its action is a leaf
button, avoiding nested button markup.

### Verification

- Compare rendered rows through the card, sidebar and mobile-sheet entry points,
  including sparse data, completed rows and provider subagents without subtitles.
- Seed real `MARK_BITMAPS` through `seedMarkBitmaps` in offline previews. Check
  decoded brand images or mapped type icons together with their status overlays;
  mounting an empty image slot is not visual proof.
- Check long titles, enlarged interface text, light/dark themes, hover stability,
  full-to-abbreviated-to-full thinking transitions, rows without a permission mode,
  exact-fit and zero-width measurements, icon-only permission accessibility,
  absence of unread text at every width and preserved waiting/failed information.
- Keep regression coverage in `test/unit/tasks-cards.test.ts`,
  `test/unit/tasks-cards-web.test.ts` and `test/unit/tasks-subagent-type.test.ts`.
  Browser fixtures and static/native-mock tests do not establish real-device
  acceptance; report device verification separately.

## Device board preferences

Show subtasks, Show archived lane, Show groups with no active tasks, and Lane width are
preferences of the current device. Boards, filter sheets, and the Tasks settings page share
one local record; another device connected to the same daemon keeps its own values.
Web and Electron persist it in localStorage; iOS and Android use the host-linked AsyncStorage
module. Read the persisted record before mounting the board. On first migration only, seed it
from the old host settings; later host updates never override it. Keep the old host fields
unchanged when saving unrelated shared settings. Restore defaults resets the four local
preferences too. A failed local write reports an error and rolls back its value rather than
claiming it was saved.
