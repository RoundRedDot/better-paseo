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
  assets/tool-marks/         # Line sources of the tool-row marks (MCP services, shell programs)
  scripts/build-tool-marks.mjs # Rasterises assets/tool-marks into server/mark-bitmaps.ts
  client/
    live-renderers.tsx       # Timeline item to component mapping
    settings-page.tsx        # Settings screen; settings-preview.tsx draws its sample turn
    preferences.ts           # Client-side presentation preferences
    i18n/                    # English and Simplified Chinese strings for the settings page and toolbars
    components/              # Cards, syntax block, Markdown, image viewer, find bar, theme tokens
      marks.ts               # Brand mark ids, and the client cache marks.bitmaps fills
      lobe-marks.ts          # Vendor SVG sources, read only by the generator
    tools/ reasoning/ state/ # Tool summaries, reasoning parser, per-call expansion state
  docs/perf/                 # Benchmark charts and the comparison page
  docs/design.md             # Design notes: the icon family, mark format and how to add a mark
  docs/plugin-registry-update.md # getpaseo/plugins pin pull request
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

The public listing on paseo.sh/plugins installs the commit pinned in
getpaseo/plugins. Open that pin pull request with
[plugin-registry-update.md](plugin-registry-update.md).

## Install build

The app downloads every plugin's client bundle again on each reconnect (inside
the plugin catalog, decrypted in JS behind the relay), so its size shows as the
"This plugin surface is unavailable." pause on a phone. The manifest's last
build step, `node scripts/build-client.mjs --install`, runs on installs and
updates from Git or npm (never for a directory source, and never on reload) and
writes two files into the install:

- `index.client.ts`, which Paseo takes before `index.client.tsx`: the bundle,
  minified with the host's options and carried in a string the file evaluates
  with `new Function`, so the host's own compile does not print it back out.
- `server/tasks-chunk.ts`: the Tasks board's code (`client/tasks/chunk/entry.ts`),
  left out of the bundle. The plugin server sends it when the board, its
  sidebar entry or its settings first show (`tasksChunkRpc`), and the client
  keeps its code on the JS global by build id, so a reconnect evaluates it
  again without asking (`client/tasks/chunk/remote-chunk.ts`).

Modules both halves need stay in the bundle and reach the chunk by id
(`bc-tasks-shared`), so there is one enabled store, one board session and one
language. In a checkout, in tests and for a directory install, `chunk/source.ts`
imports the chunk directly and nothing is generated. `node scripts/build-client.mjs`
prints the sizes; `--out <dir>` writes the files elsewhere. `--install` refuses
to run outside Paseo's staging directory: an `index.client.ts` left in a
checkout would shadow the source. To try an install build on a private daemon,
commit, then `paseo --home <home> plugin install git:file://<checkout> --ref <full sha>`.

## Hermes check

On iOS and Android the client bundle runs on Hermes without Metro or Babel:
the daemon bundles `index.client.tsx` with esbuild (target `es2020`, async
functions lowered, nothing else), and the app evaluates the result as source.
Code that works on web can still fail to load there, and when it fails the
whole plugin is dropped, so web testing will not catch it.

`npm run check:hermes` (`scripts/check-hermes.mjs`) bundles the client with
the host's options and compiles it twice: with the Hermes V1 `hermesc` of the
`react-native` devDependency (0.86, Paseo 0.13's), and with React Native
0.81.5's legacy Hermes, which Paseo 0.12 still runs and which rejects code V1
accepts, `class` among it. The legacy compiler and `hermes` VM come from
`npm pack react-native@0.81.5` on the first run, cached in
`~/.cache/better-paseo/`. Any error is mapped back to its source file and
line. Hermes V1 publishes no VM, so the script then evaluates the bundle in
the legacy `hermes` VM against stub modules, calls `contribute`, and checks
the host's registration rules. Pass
`--no-run` to compile only. `npm run check:hermes` then runs it again with
`--built` on the install build: the minified bundle and the Tasks chunk each
compile on their own, and the VM evaluates the chunk too. esbuild is a root devDependency, pinned to the
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

`import()` compiles and loads, but it does not shorten startup. The host bundles
one file without code splitting, so esbuild keeps the imported code in the
bundle and wraps almost every module (207 of 246, measured) in a lazy
initialiser. In the `hermes` VM on a Mac, with stub modules, running the
bundle's module code took about 76 ms (median) with the settings page, the
Tasks board and the find bar behind `import()`, against about 62 ms with
static imports. Leaving those three out of the bundle took it to about 42 ms.
Code only leaves the startup path when it leaves the bundle.

## Media and benchmark production

Video scripts, screenshot tooling, benchmark reports and raw samples are maintained separately in the private [better-paseo-media repository](https://github.com/RoundRedDot/better-paseo-media).
The public README and gallery use final image assets hosted on this repository's GitHub Releases. Media and raw measurements are not part of a plugin checkout or install.
Unit-test fixtures and pure test helpers stay under `test/`, so plugin tests do not require access to the private repository.

## Plugin directory release notes

The Version tab reads the marketplace's reviewed Git commit, then loads `release-notes/<full-commit>.json` from the public `RoundRedDot/better-paseo-assets` repository. The publisher maintains each JSON with the same full `commit` and non-empty `zh` and `en` arrays of user-facing notes. Publish notes for the reviewed commit as part of the registry update; a missing or unavailable file is shown separately from the version comparison. The notes describe that marketplace release, not every change since an arbitrary installation.
