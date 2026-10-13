# Developing Better Paseo

## Project structure

```text
better-paseo/
  paseo-plugin.json          # Manifest: id, Paseo requirement, build step
  index.client.tsx           # Timeline transformers, renderers, settings screen
  index.server.ts            # Daemon-side RPCs: file.reveal, file.image, highlight.tokens, fonts.embedded, marks.bitmaps
  shared/
    contracts.ts             # Data contracts shared by client and server
    preferences-settings.ts  # The settings record (defineSettings, host scope) and its migrations
    *-rpc.ts                 # One contract per RPC: file, image, highlight, font, mark, perf
  server/
    font-data.ts             # GENERATED subset woff2 faces (Inter), served by fonts.embedded
    mark-bitmaps.ts          # GENERATED PNG rasters of every brand mark, served by marks.bitmaps
  client/
    live-renderers.tsx       # Timeline item to component mapping
    settings-page.tsx        # Settings screen; settings-preview.tsx draws its sample turn
    preferences.ts           # Client-side presentation preferences
    i18n/                    # English and Simplified Chinese strings for the settings page and toolbars
    components/              # Cards, syntax block, Markdown, image viewer, find bar, theme tokens
      marks.ts               # Brand mark ids, and the client cache marks.bitmaps fills
      lobe-marks.ts          # Vendor SVG sources, read only by the generator
    tools/ reasoning/ state/ # Tool summaries, reasoning parser, per-call expansion state
  .showcase/                 # Offline harness for the screenshots and replay benchmarks
  docs/images/               # Screenshots used by the READMEs
  docs/perf/                 # Benchmark charts and the comparison page
  docs/bench/                # Benchmark methods, tools and raw runs
```

## Commands

```bash
npm install
npm run typecheck
npm test
npm run check:hermes
paseo plugin reload better-paseo
```

Paseo installs the plugin from GitHub, so a change on a local branch is not what a client runs
until it is pushed and the plugin is updated (`paseo plugin update better-paseo`).

## Hermes check

On iOS and Android the client bundle runs on Hermes without Metro or Babel:
the daemon bundles `index.client.tsx` with esbuild (target `es2020`, async
functions lowered, nothing else), and the app evaluates the result as source.
Code that works on web can still fail to load there, and when it fails the
whole plugin is dropped, so web testing will not catch it.

`npm run check:hermes` (`scripts/check-hermes.mjs`) bundles the client with
the host's options and compiles it with `hermesc` from the `react-native`
devDependency. Any error is mapped back to its source file and line. The
script then evaluates the bundle in the bundled `hermes` VM against stub
modules, calls `contribute`, and checks the host's registration rules. Pass
`--no-run` to compile only. esbuild is a root devDependency, pinned to the
same release vitest resolves, so the check does not hang on a transitive
install.

What must not reach client code, including client dependencies:

- **No `class` in any form**: declarations, expressions, fields, private
  members, or static blocks. Use closures and plain objects. This is why
  `marked` cannot be imported on the client.
- No regular-expression `v` flag (a compile error, so the check catches it).
- No `Array.prototype.toSorted` and no `Intl.Segmenter`. Both are missing at
  runtime rather than at compile time, so the check only catches them when
  they run while the plugin loads. Code reached later, from a render, is not
  covered.
- No non-ASCII characters in the bundle. One stray `–` or `✓` makes Hermes keep
  the whole ~950 KB source as two-byte text; the check rejects them.
- Timeline renderers are registered as **plain functions**. Paseo checks
  `typeof Component === "function"`, so the object `React.memo` returns is
  rejected. Wrap a memoised body in a function component instead.

## Screenshots

`.showcase/` renders the real components with React Native Web and fixture data. Rebuild every
`#shot-*` capture after a visual change (`SHOT_SCALE=2` renders at 2x, as the README hero `#shot-hero-devices` is):

```bash
(cd .showcase && npm install)
node .showcase/tools/shots.mjs . /tmp/shots dark
```

The tool writes `/tmp/shots/dark/shot-*.png`. The headless browser takes the system language, so the
settings page comes out in Chinese on a Chinese system; `docs/images/settings.png` is the English
capture and `docs/images/settings-zh.png` the Chinese one.

## Benchmark charts

The README charts are generated from the raw runs in `docs/bench/native-vs-fork/raw`:

```bash
node docs/perf/readme-charts.mjs
```

It writes `docs/perf/readme/*.{en,zh}.svg` and prints the medians it drew, so they can be checked
against the tables in [`fork-vs-upstream.md`](fork-vs-upstream.md). How the runs are made is in
[`docs/bench/native-vs-fork`](bench/native-vs-fork/README.md).
