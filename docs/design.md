# Design notes

The design rules for everything the plugin draws: the chat timeline, block details, the Tasks board and the settings page. Numbers are points at the default text size and come from the code they name; when one changes, change it here in the same commit. What the board does and why lives in [tasks-board.md](tasks-board.md).

## Foundations

The plugin draws two families of surface: the chat timeline with its block details and settings
(`client/components`, `client/ui`, `client/details`) and the Tasks board (`client/tasks`). They
share the host theme, the motion tokens and the input model; each keeps its own type ramp and size
constants. Moving a constant from one family to the other is a design change, not a cleanup.

### Type

| Family | Source | Steps (size/line) | Scaling |
| --- | --- | --- | --- |
| Chat chrome | `TYPE`, `UI_SCALE` (`client/ui/tokens/typography.ts`) | label 13/18; target 12/18 mono; meta 12/16 mono, tabular; caption 12/16; button 13/18; setting 15/22 touch, 14/20 desktop; settingNote 13/18; title 16/22 | fixed |
| Chat prose | `proseScale(b)` | body b / even(1.5b); h1 ⌊1.5b⌋ and h2 ⌊1.25b⌋ (line +6); h3 b+1; secondary b−1; small and code b−2 | b is the host content size, else 15 web, 16 native |
| Block rows | `blockMetrics` (`shared/preferences-settings.ts`) | the reader's block text size, 9–20, default 13 | row = label line +8 desktop, +10 touch (26/28 at 13) |
| Tasks | `HOST_FONT`, `HOST_LINE` (`client/tasks/type-ramp.ts`), `TaskText` (`client/tasks/typography.tsx`) | sm 12/16 (`smRead` 12/18 for wrapping text), base 14/20, lg 16/22, xl 18/26, 2xl 20/28, 3xl 22/30 | × host UI size / 14 (default 14 web, 15 native), rounded, no clamp |

- Draw board text through `TaskText` so it follows the host interface size. Grow a board control
  with `taskControlHeight(h, scale)`, `round(h × max(1, scale))`: controls grow with large text and
  never shrink below their authored size.
- Chat chrome is never drawn below 12. Only block text that the reader sets below 12 goes lower.
- The iPad floating sidebar is the one place the board scales type down (×0.9 through
  `TasksTypographyScale`); its targets still use `max(1, scale)`.
- Lane titles are base 14/20 on the web and sm 12/18 on native (`laneTitle`). Board monospace is
  `TASK_MONO`: Menlo on iOS, `monospace` on Android, a `ui-monospace` stack on the web.

### Space, radius and lines

- Chat, details and settings space on `space` (4, 8, 12, 16; 24 only between settings sections)
  and round on `radiusV2`: chip 4, block 6, card 8, overlay 12, bubble 16 with a 2 tail, pill full
  (`client/components/theme-tokens.ts`).
- The board keeps its own constants and does not read `space` or `radiusV2`: card 8
  (`CARD_RADIUS`), lane panel 5 (`PANEL_RADIUS`), detail card 12 (`DETAIL_CARD`), menu 12
  (`MENU.radius`), control rows 6, tablet toolbar buttons 7.
- Lines: borders, dividers and pills are a hairline (`HAIRLINE`); action buttons are 0.5
  (`BUTTON_LINE`, see [Buttons](#look)); a dashed subagent card and a card's inner block divider
  are 1. `devicePixel()` gives one device pixel on the web.

### Surfaces and states

A state is a mix into the surface under it (`mix(from, to, t)`), never a translucent overlay, so
it reads the same on any card. The board's card surface is `surface0` on a light theme and
`surface2` on a dark one (`cardTokens`, `client/tasks/cards/tokens.ts`).

| Token | Mix | Light / dark | Used for |
| --- | --- | --- | --- |
| `hoverBackground` | card → foreground | 4% | a hovered card, or one whose menu is open |
| `controlHover` | card → foreground | 7% / 10% | round icons, a plain button's hover |
| `current`, `currentBorder` | card → accent; border → accent | 7% / 10%; 45% | the card shown in the details |
| `highlight` | card → accent | 8% / 12% | a card the board just pointed at, for 1 s, with an accent border |
| `failed`, `failedHover`, `failedBorder` | card → danger; border → danger | 5% / 8%; 8% / 12%; 35% / 40% | a failed card |
| `pillFill`, `pillBorder`, `buttonBorder` | card → foreground; border → foreground | 3.5% / 6%; 5% / 8%; 5% / 20% | neutral pills, outlines |
| `rowHover`, `rowPress`, `sunk`, `track` (`detailColors`) | card → foreground | 5%, 8%, 2.5%, 9% | detail rows, hero blocks, bars |
| Lane panel (`boardPalette`) | `surface1` dark; halfway `surface1` → `surface2` light | hover `surface2` | lanes |

- When states stack on a card, the first applies: highlighted, current, failed, hovered, rest.
- Card shadow: `0 1 2` at 6% (18% dark) at rest, `0 2 6` at 7% (26% dark) hovered.
- Menu chrome (`menuChrome`): `surface0`, hairline border, hover foreground 5.5% (8% dark),
  shadow `0 4 24` and `0 1 3` at 8% and 4% (45% and 30% dark). `panelChrome` reuses it.
- Chat rows have no surface at rest: `surface1` hovered, `surface2` pressed or held. The chat's
  `surface1` and `surface2` are the foreground at 2.5% and 4.5% (3% and 6% dark) over the page.

### Motion

Motion is short and decelerating; nothing bounces or overshoots. `motionDuration(ms, reduced)`
returns 0 when the system asks for reduced motion (`useReducedMotion`, which follows
`prefers-reduced-motion` on the web). Under reduced motion each animation snaps, holds still, or
keeps a short fade, as listed.

| Motion | Duration (ms) | Easing | Reduced motion |
| --- | --- | --- | --- |
| Chat expand (`FadeIn`) | 120 fade; height never animates, collapse unmounts | out cubic | none |
| Preview entrance: hover previews, tips, a card's hover buttons (`PREVIEW_REVEAL`) | 140, 4 pt drift | `cubic-bezier(.33,1,.68,1)` | shown at once |
| Board lane motion (`MOTION`, `lane-motion.tsx`) | slide 240, fly 300, leave 160; a new card fades in 120 after 120 | `cubic-bezier(.2,0,0,1)` | settles in place |
| Count roll (`RollingCount`) | 300, 6 pt | | new value at once |
| Lane resize, strip swap | 220, 160 | | resize snaps |
| Lane flash | two pulses, 600 in and 800 out, accent 7% at peak | cosine | one still beat of 1 s |
| Phone lane switch | in 200, out 120, 24 pt | | none |
| Phone search; card subtask panel | 180; open 180, close 140 | `MOTION.ease`; out cubic | snaps |
| Board sheet | open 280, detent 240, settle and close 200 | | 0 |
| Block details (`DETAILS_MOTION`) | open 280, scrim 200, detent 240, close 200; side 240 in, 160 out, 24 pt; swipe 220 | `cubic-bezier(.2,0,0,1)` | a 120 fade |
| Switch knob | 140 | | snaps |
| Running ring, spinner | 900 per turn on one shared clock (12 steps on native) | linear | still |
| Running dot | 1200 pulse, opacity 1 ↔ 0.3 (4 steps on native) | | |
| Breathing skeleton | 1200, opacity 1 → 0.5 → 1 | | held at 1 |
| Web hover transitions (`webTransition`) | 120 on background, border, shadow, colour, opacity | ease-out | still play (see [Open inconsistencies](#open-inconsistencies)) |

### Focus, selection and scrollbars

- Keyboard focus is neutral and outside the element. A card draws a 1 px `foregroundMuted`
  outline 2 pt out on the web (a 1 px ring shadow on native), switched without a transition;
  selection keeps the accent fill and border. A search field hides its input's outline and turns
  its own hairline `foregroundMuted` while focused.
- A pointer press never leaves a focus ring: `installPointerFocusRing` hides the outline for focus
  that came from a press inside the plugin's root, keyboard focus keeps it, and text inputs are
  exempt.
- Reading content is selectable (`selectableSurface` overrides the host timeline's
  `user-select: none`); chrome is not: icons, control labels and row verbs use `unselectable`.
  Native has no inheritance, so each text there takes `selectableTextStyle`.
- On the web a scroller hides its scrollbar while idle. A lane or details column shows a 6 pt
  thumb (radius 3) while it scrolls and fades it out 800 ms after the last scroll (in 100, out
  400); its gutter stays reserved so nothing shifts. A horizontal track (`h-scroll.tsx`) is 2 pt
  and holds for 1 s. Native draws the platform indicator.

### Input and touch targets

- Hover comes from capability, not screen size: `useInputCapabilities` reports hover from
  `(hover: hover) and (pointer: fine)` on the web and from a real hover on native (an iPad
  pointer); touch is a coarse pointer or no hover. Every hover affordance has a touch equivalent:
  a persistent button, a long press or a tap.
- The board picks its touch sizes by platform: any native client is touch (`TOUCH`,
  `Platform.OS !== "web"`), so an iPad draws desktop lanes with touch targets. The phone layout
  (`compact`) is a separate switch.
- Targets: chat rows reach 44 through hit slop; board toolbar buttons are 28 on the web and 36 on
  native; detail rows, headings and buttons 32, 44 on touch; round icons 28, 36; chips 22, 28;
  sidebar group rows 36, 44; card buttons 28, at least 32 on a phone; copy buttons 24 with a 32
  hit area. A long press is 450 ms on a card and 500 ms on a chat row.

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

## Chat timeline

### Rows

Every tool call, notice and grouped call is one disclosure row (`DISCLOSURE_HEADER`,
`client/ui/disclosure-header.tsx`).

| Part | Rule |
| --- | --- |
| Height | 26 desktop, 28 touch; a 44 hit area on touch |
| Bleed | 8 into the gutter on each side, padded 8 back; radius 6 |
| Icon slot | 16 wide plus a 2 trailing pad around a 14 icon; text starts at 24 (`textColumn`) |
| Verb | 13/18, weight 500 |
| Target | 12/18 mono, cut in the middle at 72 characters (40 compact) |
| Meta | 12/16 mono, tabular, at most 45% of the row, entries two spaces apart |
| Group count | a 22 circle on `surface2`, 11/14 |

- **Tone** (`rowPalette`): a finished row is quiet, its target muted and its meta and icon pulled
  toward the page; a running row's target sits halfway to `foreground`; a row waiting on the
  reader, and any hovered, pressed, open or current row, is full contrast.
- **Status in the slot**: a running row draws the accent running dot; a failed row draws its icon
  and its failure meta (`exit N`, `failed`, `timed out`) in `danger`, and while collapsed adds one
  selectable error line under the text. Exit 0 reads `✓`, any other exit `✗ N`.
- **States**: no frame or fill at rest, `surface1` hovered, `surface2` pressed or held. With a
  pointer the chevron replaces the icon while the row is hovered; an open row keeps a down chevron
  unless its icon reports status. A row with nothing to open is inert: it does not light up and
  its text is selectable. `rowLabelStyle` may hide the verb or the icon; the slot stays, so the
  text column never moves.
- **Expanding**: tools start collapsed. A failure opens when the reader chose to expand failures,
  and a child agent that needs permission always opens. The body is a `surface1` slab, radius 6,
  padded 8 × 12, 2 above and 6 below, with no frame; a permission or warning body adds a 1 pt
  border mixed 45% toward warning (`permissionBorder`). The body fades in and the row keeps its
  place in the inverted native list (`useScrollAnchor`). A card taller than 60% of the viewport
  pins its header on `surface0`, with a hairline once the header moves.
- **Row actions**: with a pointer, copy buttons overlay the end of the target on the row's hover
  fill, so the meta never moves, and their tips open above. On touch the actions show at the row's
  end only while it is open; a collapsed row opens its menu on a long press (500 ms; a 10 pt move
  cancels), which the web's context menu also opens.

### Thoughts, todos and messages

- **Thought** (`ReasoningCard`): a row, collapsed by default, with `Lightbulb` (the accent dot
  while streaming). Streaming it reads `Thinking · <current section or last sentence>`, updated per
  sentence, not per chunk; done, `Thought · N steps · 12s`. The body sits in the text column with
  no box or rule; sections are 12 apart, titles 13/18 weight 500, and a paragraph over 600
  characters clamps to 4 lines with Show more. A one-sentence thought that fits the row is inert.
- **Todo list** (`client/components/task-list.tsx`): `ListChecks`, "Tasks", `n/m` mono and a 14
  progress ring (accent on `surface2`); when all are done the ring becomes a success
  `CircleCheck`. Items: the running dot in progress, a success `Check` when done, a warning
  `TriangleAlert` when blocked, a 10 pt `foregroundSubtle` ring when pending. A done item is
  muted, never struck through.
- **User message**: a right-aligned `surface2` bubble, radius 16 with a 2 tail at the top right,
  padded 16, at the content size with a 1.4 line height, at most 560 wide (86% on a phone). Its
  trailing line holds Copy, the rewind menu, the time and the usage.
- **Notice**: a row. Info is a muted `Info`, warning `TriangleAlert`, error `CircleX`, fatal
  `OctagonX` at weight 500; error and fatal add a 2 pt left rule. Long or technical text opens in
  a mono block on `surfaceCode`.
- **Turn footer**: one line 24 high, 8 above and 16 below: Copy, the model with its provider logo,
  the clock, the duration. On a phone it drops the clock, then the model, rather than wrap.
- Rows take back 12 of the host's 16 between timeline items (`ROW_GAP_COMPENSATION`).

### Markdown

| Variant (`variantMetrics`) | Block gap | List indent | Tables |
| --- | --- | --- | --- |
| Document | 12 desktop, 16 touch | 20 | body − 1 |
| Compact | 8 | 16 | body − 1 |
| Terminal | 8 | 16 | mono, body − 2 |

- Headings are weight 600; bullets are `•`, `◦`, `‣` by level; links are the accent, underlined;
  quotes have a 2 pt left border and muted text, never italic.
- Inline code is a `surface2` chip, radius 4, on the web. Native cannot pad inline text, so it
  draws the code colour at weight 600 instead.
- Code blocks: `surfaceCode`, radius 6, no border. A 30 header (32 native) carries the language,
  Wrap and Copy (24 buttons; Copy shows a check for 1.2 s). Blocks start wrapped and fold after 12
  lines; the document variant numbers blocks of 4 or more lines.
- Tables: a 1 pt frame, radius 6; the header row on `surface2` with muted weight-500 text;
  all-numeric columns right-aligned; sideways scroll with the indicator shown only while
  scrolling. The copy control is a 30 square at the top left (radius 12); on the web it opens to
  Copy as Markdown and Copy as image.
- Paths (`PathText`): a pointer press reveals the file, and hovering shows the full path after
  400 ms with an underline; a tap copies the absolute path with a toast.
- Images: a `surfaceCode` card with a 28 header and a show/hide toggle, the canvas on `surface0`,
  at most 480 tall inline; chips give the dimensions and size. The viewer is a 90% black backdrop,
  zoom 0.25 to 8; a double tap resets, and a 96 pt drag, a flick, Escape or back closes it.
- Selected text on the web raises a floating Copy / Add to chat bar; native uses the platform
  menu.

### Block details and previews

| Form (`client/details/layout-model.ts`) | When | Width |
| --- | --- | --- |
| Drawer | narrower than 600 | full width, over a scrim |
| Floating | 600 to 960, or no room beside the timeline | min(W − 32, 760) |
| Side | 960 and wider, with room | clamp(0.36 W, 420, 640) |

- Each breakpoint keeps 16 pt of hysteresis. A pointer click expands a row in place; the panel
  opens from Open in panel or Open details. A tap opens the details, or the viewer for an image.
- Header 44 pointer, 52 touch: a 28 `surface1` icon tile (radius 7, 16 icon), the title 14/20
  weight 600, a subtitle with `i / n`, then previous, next and close. Toolbar 36, 44 on touch. The
  current row in the timeline takes an `accentSoft` fill and a 2 pt accent bar.
- Text size: on native a pinch sets an absolute size from 12 to 26 (default 14), and the Text size
  badge, with − / + and Reset, stays 2 s after the fingers lift. The web has no pinch.
- Hover preview: on the web it opens after the reader's hover delay (default 1 s) and closes
  150 ms after the pointer leaves; it spans the content column 6 below the row, above it when
  below has no room, at most 360 tall. Native opens it pinned on a long press. Its toolbar ends
  with Maximize and Open in panel.
- Copy buttons are a 24 box with a 14 icon and a 32 hit area, and show a plain check for 1.2 s.
  Toolbar buttons are 24 with 14 icons and a tip after 400 ms.

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
| Subtask corner mark | grey at rest (`foregroundMuted` 50%); while the card is hovered, chosen in the sidebar or focused, the project icon's theme colour: an uploaded icon's most common lively colour (else its most common colour that is not white), read by the server in `tasks.project-icons` (`server/tasks/icon-color.ts`), or a generated square's identity colour, pulled to 3:1 against the card so a black logo shows on a dark card, and a grey hue on to 3.5:1 against the resting grey so turning active shows (a black logo is near white on a dark card). A short arc around a subtask card's top-right corner like an iPad window's resize grip: centre-line radius 10 pt, stroke 2.5 pt with round ends, 3.5 pt in from both edges (`CornerMark` and `MARK_ARC` in `task-card.tsx`); the context ring keeps its place, and a provider subagent's card is dashed instead | full | full |
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
| `plain` | Open tab and Open parent everywhere (card, sidebar, bar), Unarchive, a permission answer that is neither | `buttonBorder`: the theme border 5% toward `foreground` (20% dark, where the border all but matches the card and a half-pixel line in it vanishes) | `foreground` | `controlHover`, `foreground` 7% (10% dark) |
| `primary` | Allow | accent 50% (55% dark) | accent at 4.5:1 | accent tint |
| `danger` | Stop, Confirm stop, Deny | the theme's `statusDanger` | the same | danger tint |
| `answer` | "Answer", which opens the tab for a question | needs-input amber 40% (45% dark) | amber at 4.5:1 | amber tint |
| `archive` | Archive | Archive's yellow | the yellow at 4.5:1 | yellow tint |
| `read` | Mark read on an unread card (a failed card's stays `plain`) | unread green 40% (45% dark) | green at 4.5:1 | green tint |

`buttonHue(tokens, look)` (`client/tasks/cards/action-style.ts`) returns these three colours;
`CardButton`, `ReadControl`, `StopControl`, `OutlineButton`, `RequestButton` and `BarButton` all
take them from it, and `requestLook(button)` picks a permission button's look in every place.
A new action button takes a look from the table rather than its own colours.

### Same buttons on the card and in its details

The details sidebar's header and the phone sheet's bar offer the card's buttons, with its labels
and looks. A subtask whose parent's tab opens (`parentOpensInPaseo`) has "Open parent" right
before Open tab, and Open tab reads "Open" on every card, a provider subagent's included (its
tab is the parent's). Mark read takes Stop's place for a card in review, in the unread green
(plain on a failed card). "Answer" stands in for Open tab, which then is not drawn beside it.
The details may add only status hints such as "Already open".

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
ordinary “Open” keeps `ArrowUpRight`. The same `CornerLeftUp` marks the parent everywhere it
is named: the parent link in a subtask card's meta row (at the meta text size, muted,
`foreground` while hovered) and the details' parent row.

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

The row has two columns: a combined identity/status mark and a flexible content
column. The jump target sits at the content column's top-right on the title's line;
only the title reserves its width plus 8 pt, and the metadata uses the full content
width. Do not give the jump target a full-height column of its own.

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
| Jump target | 22 pt wide, one title line high | 32 pt wide, one title line high |
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

The jump button keeps the title's reserved width while hidden; hover never reflows the title
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

## Board surfaces

Three layouts share one card and one set of tokens. The desktop board is the web with a pointer.
A tablet is any native client wide enough for two lanes: desktop lanes with touch rules and no
hover. The phone layout (`compact`) shows one lane at a time. The colours, tints and buttons above
apply to all three.

### Card

| Metric (`DESKTOP`, `PHONE` in `task-card.tsx`) | Desktop and tablet | Phone |
| --- | --- | --- |
| Padding (sides / top / bottom) | 12 / 10 / 12 | 14 / 12 / 14 |
| Meta row to title; between rows | 5; 10 | 6; 12 |
| Status icon slot / box | 14 / 16 | 18 / 20 |
| Icons in the card | 12 | 14 |
| Title | `laneTitle()`, weight 500, at most 2 lines | base 14/20, weight 500, at most 2 lines |
| Meta and footer text | `sm` | `sm` |

- Radius 8, a hairline border, the card shadow; fill, border and shadow follow
  [Surfaces and states](#surfaces-and-states). Archiving changes only the status mark and the
  actions, not the fill or the border.
- The meta row is one muted line, segments joined by a spaced `›`; the context ring ends it, or
  ends the title row when there is no meta row. On a phone the ring shows only above 80%.
- A provider subagent's card is dashed (1 pt), with no shadow at rest; a subtask card carries the
  [corner arc](#data-colours).
- A new card fades in (120 after 120); a highlighted one keeps its accent fill and border for 1 s.
- Actions by layout: on the desktop board they fade in on hover with the preview entrance, as an
  overlay on the footer backed by the card's fill, and the footer keeps the buttons' height, so
  nothing moves; on a tablet they always show, in their own right-aligned row under the timer; on
  a phone they fill a row at the card's bottom with Open tab last. A desktop permission card puts
  its answer buttons and footer on one row.

### Lanes

- Widths follow the lane width presets in [tasks-board.md](tasks-board.md) (`LANE_SIZES`), with 8 between lanes and 12 at
  the board's edges (`LANES`). On touch the gap between lanes is itself a target.
- A lane is a panel of radius 5 on the lane fill. Its header is 40 high, padded 14 left and 8
  right: the status icon (14), the name (`laneTitle`, weight 500), a muted rolling count, and a
  24 collapse button (radius 6, `FoldHorizontal`). A history lane names its time range at `sm`.
  While loading, the count is a 14 × 10 `surface2` bar.
- A collapsed lane is a 40 strip: the status icon, the name set vertically (Chinese stacked
  upright, Latin turned 90° with 1 of letter spacing) and the count.
- Cards are 12 apart. Loading draws three breathing skeleton cards (radius 6, `surface2` bars).
- An empty lane draws `BoardEmptyState`: a dashed hairline box, radius 8, padded 28 × 20 (16 when
  narrow), a 20 muted icon, the title at weight 600 and a centred `sm` hint; a phone adds a 36
  Clear filters pill. A filter-hidden count sits under the cards as a `ListFilter` note in `sm`.
- Load more is a 26 pill (36 on a phone) with a hairline border, `surface1` hovered.

### Toolbars

| Toolbar | Height | Targets | Contents |
| --- | --- | --- | --- |
| Desktop (`DesktopToolbar`, `DesktopFilterBar`) | 48, then a wrapping filter bar of at least 44 | 28 | search 220 wide (radius 6, 13 icon), the centred total at base weight 600, round switches; filter menu buttons and chips of radius 6 |
| Tablet (`TabletToolbar`) | 56, 36 when narrower than 680 | 44, 28 when narrow | see [tasks-board.md](tasks-board.md); buttons radius 7, `surface1` when on or hovered |
| Phone header (`phone-board.tsx`) | at least 52 | round buttons | the total at lg weight 600, a 28 sort pill, then Search, Subtasks, Archived, Filters |

- Round buttons (`RoundButton`) are a 36 circle in a 44 target with a hairline, an accent border
  when active, and a badge at least 20 high on the accent with a 2 pt `surface0` ring.
- An on/off switch in a toolbar is a round button whose icon tells the state; Archived is struck
  through while the lane is hidden. Segmented controls (`Segments`) are 28 high on the desktop
  (radius 6, inner 4), 32 and fully round on a phone, the chosen cell on `surface2`.
- The phone's search is a 36 pill under the header; the lane switcher is a segmented bar on the
  lane fill whose chosen cell is raised as a card (card fill, border and shadow, weight 600), with
  the needs-input count in the warning colour.

### Menus and sheets

- `CascadeMenu` (`board/menu.tsx`, `MENU`): menu chrome, radius 12, rows 32 (44 with a detail
  line) of radius 6 with 16 icons, at most 420 tall, 8 from the screen's edge. A submenu opens
  after 150 ms of hover or on a click, aligned to its row's top and overlapping the parent by 4,
  toward the side with room. Arrow keys, Enter and Escape work; a press outside closes it. Danger
  rows take the danger colour; a check is the accent.
- On touch every row is at least 44 and submenus become a drill-down in the same panel, with a
  `›` hint and a Back row (`touchSections`).
- The card menu opens at the pointer on the web (240 wide, submenus 220), flipping at the edges.
  On touch a long press opens it in the host `Modal` titled with the card, its submenus flattened,
  rows at least 44 with 18 icons.
- The filter sheet opens in the host `Modal` on phones, tablets and narrow web boards: sections
  padded 16 with muted `sm` titles, chips 32 high (radius 4, accent border and `accentSoft` when
  on), toggle rows 48, sort rows 44, and a pinned footer of Reset and an accent Show pill, both 44.

### Details

- The sidebar (`sidebar-model.ts`) is inline from 1020, floating below 996 down to 784 and a bottom
  sheet below 760; between those pairs it keeps its current form. Inline it is 380 wide (340 to
  520, a double click restores 380) and slides 12 in over 180; floating it is a radius-16 panel on
  the lane fill with the menu shadow, entering with a 24 slide over 220. The iPad floating panel
  is 340 (320 to 480) with a 24 grab strip.
- The web resize handle is a 1 px line that shows after 100 ms of hover and follows the pointer.
- The board sheet has a 58% half detent; full height leaves 8 of the lanes showing; radius 16 on
  top, a 36 × 5 handle.

| Metric (`DETAIL_CARD`, `TOUCH_CARD`) | Pointer | Touch |
| --- | --- | --- |
| Row, heading, button | 32 | 44 |
| List row | 30 | 44 |
| Icon | 16 | 18 |
| Chip | 22 | 28 |
| Round icon | 28 | 36 |

- A detail card is the card fill with a hairline border, radius 12, the rest shadow, 8 between
  cards and 12 × 6 inside. The header is padded 12: the status row (icon 14, the status, close),
  the title at base weight 600, chips and labels, and the actions 12 below. Open tab leads on the
  desktop and comes last on touch.
- Hero blocks (the running turn, a permission request, an error, the last turn's summary) are
  `sunk` boxes of radius 10 with a 1 pt border; an error box is the danger at 6% with a border at
  28%. Values are 2xl in the turn hero and lg in summary tiles.
- Sections are divided by a hairline inset 12; a heading is a radius-6 row whose chevron turns −90°
  when closed and whose muted text turns `foreground` on hover. A message heading ends with the
  message's own time, and its tip gives the full timestamp.
- Message bodies sit in a `sunk` box of radius 8 and fold after 4 lines or 240 characters under a
  fade; while the timeline is read they breathe as a skeleton instead of saying Loading.
- Charts: the context bar is 6 high (radius 3) with ticks at 75% and 90%; the token bar is 8-high
  segments 2 apart (cached accent 32%, input accent, output foreground 45%). On touch their tips
  show on tap and hide after 3 s.
- With no card chosen, the sidebar shows stat cells (at least 56, 64 on touch, radius 8, the count
  at xl; needs input with a warning border and count) and the group card: round 28 segments (36 on
  touch) over group rows of 36 (44), radius 6, `surface2` when on.
- A phone's details sheet has a 40 stepper and an action bar of 48 buttons (radius 12) over a
  hairline.

### Status marks

`StatusIcon` (`cards/status-icon.tsx`) draws the same marks in lane headers, cards, the phone's
lane switcher, the sidebar entry and subtask rows:

| State | Mark |
| --- | --- |
| Running | a 1.5 ring, track 30%, a 90° head at 90%, a 6 centre dot; 900 ms a turn on one shared clock |
| Needs input | a hollow amber ring |
| Unread | a 6 green dot |
| Failed | an 8 danger dot |
| Done | a green `CircleCheck` |
| Stopped from the board | a muted square, 0.75 of the mark |
| Archived | a muted `Archive` |

- The mark is 12 in a 16 box, ×0.75 below 16, and 12 plus half the extra above it.
- `SpinnerRing` is the running ring without its dot, for working buttons.
- `ContextRing` draws from tinted sprites (14 on cards, 12 in subtask rows): muted, warning from
  70% on cards (75% in subtask rows), danger above 90%.
- `RollingCount` rolls a changed number 6 pt over 300 ms, up when it grows and down when it
  shrinks; `RollingTotal` rolls only on the web.

## Hover tips

On a web pointer layout a control names its action in a tip: the board toolbar, the details
sidebar's stat cells, group segments and group rows, and every button and row action in the
details. Mark the control with `tipProps(text)` (`client/tasks/cards/card-hints.tsx`); the
board's single `BoardTips` layer, drawn last in the board, reads it, so a sidebar scroller never
clips a tip. A card's own pills and marks keep `hintProps` and the card's `CardHints` layer;
the two never answer each other's marks.

- A tip opens after the pointer rests 400 ms (`HINT_DELAY_MS`), in the card hints' chrome and
  entrance (`panelChrome`, a 140 ms fade with a 4 pt drift, none under reduced motion).
- It sits below the control, or above it when the board's bottom leaves no room for one line.
  In the board's left half it starts at the control's left edge, otherwise it ends at its right.
- A press, a wheel or any scroll inside the board closes it; the same control shows it again
  only once the pointer has left it. A control whose menu is open shows no tip.
- The tip text is the action, with the shortcut in brackets (`Search (/)`); a button folded to
  its icon names what the label said. A text button may repeat its label.
- Touch and native draw no tips and carry no tip markup. A tip never replaces the control's
  accessibility label.

## Switches

A control with `accessibilityRole="switch"` (the settings `Toggle`, the filter bar's round
switches, the filter sheet's rows) also toggles with Space on the web. React Native Web gives
Space only to button roles, so every such control spreads `useSwitchSpace(onPress)`
(`client/ui/use-switch-space.ts`): a plain Space prevents the page from scrolling on keydown
and toggles once on keyup; repeats, modified or composing keys and a blur in between do
nothing, and Enter stays with RNW's own press. `SwitchTrack` slides its knob in 140 ms and
snaps when the system asks for reduced motion.

## Settings

The settings page (`client/settings-page.tsx`, `client/settings-controls.tsx`) is one screen
with a Chat and a Tasks tab.

| Control | Rule |
| --- | --- |
| `Toggle` | the 40 × 24 `SwitchTrack` with an 18 knob, a 10 hit slop; see [Switches](#switches) |
| `Segmented` | a `surface2` track padded 2, radius 6, 28 high (32 on touch, equal widths); the chosen segment on `surface0` with a border, weight 500 |
| `PlainButton` | at least 32 high, 1 pt border, radius 6, 13 weight 500 muted; `surface2` pressed, 0.4 opacity disabled |
| Section | a muted 13 weight-500 title over a `surface1` card of radius 8, bordered on the desktop, a grouped list on touch |
| Setting row | at least 44 on touch, padded 11, rules inset 16; padded 14 × 16 on the desktop, its control wrapping under the text when narrow; 0.45 opacity disabled |

- From 960 wide the page has two columns: the preview takes 44% (380 to 640) and stays in view on
  the web. The preview card has a `surface1` header with a Desktop / Mobile control; Mobile draws a
  390-wide phone frame of radius 16.
- Accent swatches are 22 in 44 targets. Tasks field chips are pills at least 28 high (34 compact),
  with the accent border and a 10% (20% dark) accent fill when on.
- Resetting asks twice: Reset needs a second press within 4 s and its note turns warning while
  armed; the Tasks Restore asks again in place with Cancel.

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

## Open inconsistencies

The code disagrees with itself or with its comments in these places. Each needs a decision before
it is designed against; until then the code's behaviour above is what ships.

- `webTransition` (card and button hover) and the lane strip swap fade (`lane-resize.tsx`) play
  under reduced motion, while every other animation honours it.
- `accentRing` (`client/tasks/cards/tokens.ts`) is described as the focus ring but nothing reads
  it; focus is the neutral 1 px outline.
- The phone lane switcher computes and animates an underline (`underlineX`, `underlineScale` in
  `phone-board.tsx`) that is never drawn; the chosen cell is raised instead.
- `InputCapabilities.touch` documents 32 px targets; the board uses 36 to 44 on touch.
- `UI_SCALE` says nothing is drawn below 12, but block text may be set down to 9.
- `ReasoningCard`'s comment gives an expanded thought a 1 px frame and a divider; its styles draw
  neither ("no box, no rule").
- The motion module's header lists three kinds of motion; the board keeps its own `MOTION` table
  beside it.
