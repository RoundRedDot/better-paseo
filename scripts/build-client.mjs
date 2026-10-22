#!/usr/bin/env node
// Install-time client build: a smaller catalog for every reconnect.
//
//   node scripts/build-client.mjs             sizes only, writes nothing
//   node scripts/build-client.mjs --out <dir> writes index.client.ts and tasks-chunk.ts into <dir>
//   node scripts/build-client.mjs --install   the manifest's build step (paseo-plugin.json)
//
// Paseo compiles `index.client.ts(x)` with esbuild, without minifying, and
// sends the result to the app inside the plugin catalog, again on every
// reconnect. Paseo's own entry lookup takes `index.client.ts` before
// `index.client.tsx`, and its manifest `build` runs before that lookup, on
// installs and updates only (never for a directory source, so a checkout
// keeps compiling from source). This script makes two things there:
//
// 1. `index.client.ts`: the bundle, built with the host's options plus
//    `minify`, carried as a string the file evaluates with `new Function`.
//    As code the host would print it back out (about a third larger); as a
//    string it travels as is.
// 2. `server/tasks-chunk.ts`: the Tasks board's code (`client/tasks/chunk/
//    entry.ts`), left out of the bundle; the plugin server sends it when the
//    board, its sidebar entry or its settings first show (`tasksChunkRpc`),
//    and the client keeps it across reconnects (`chunk/remote.ts`).
//
// The chunk must not hold copies of modules the bundle holds (one enabled
// store, one board session, one language), so every module both would
// contain stays in the bundle and reaches the chunk through
// `bc-tasks-shared`, a registry of those modules' namespaces. Sharing a
// module keeps all of its exports in the bundle, which can pull in more, so
// the two builds repeat until the shared set holds still.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Paseo's client externals (`packages/server/src/server/plugins/compiler.ts`). */
export const HOST_EXTERNALS = [
  "@getpaseo/plugin",
  "@getpaseo/plugin/client",
  "@getpaseo/plugin/client/ui",
  "@getpaseo/plugin/client/react-native",
  "@tanstack/react-query",
  "react",
  "react/jsx-runtime",
  "react-native",
  "zod",
];

const SHARED_PREFIX = "bc-shared:";
const CHUNK_ENTRY = "client/tasks/chunk/entry.ts";
const CHUNK_DIR = "client/tasks/chunk";

/** The host's client options (compiler.ts), minified. */
function hostOptions(root) {
  return {
    bundle: true,
    format: "cjs",
    jsx: "automatic",
    platform: "neutral",
    target: "es2020",
    mainFields: ["module", "main"],
    supported: { "async-await": false },
    external: HOST_EXTERNALS,
    treeShaking: true,
    minify: true,
    write: false,
    metafile: true,
    logLevel: "silent",
    absWorkingDir: root,
  };
}

/**
 * The host's post-pass (`makeHermesInteropEager`), which it cannot apply
 * inside a string, and in its minified spelling. esbuild's `__copyProps`
 * makes one getter per export in a `for (let ... of ...)` loop, and Hermes
 * gives every closure made in such a loop the last value, so each named
 * import would read the last export. The host swaps the getter for a value
 * (`get: () => from[key]`); minified it reads `get:()=>t[r]`. The helper
 * appears once per output, so anything else means esbuild changed it.
 */
const COPY_PROPS_GETTER = /\{get:\(\)=>([\w$]+)\[([\w$]+)\],enumerable:/g;

function hermesInterop(code, name) {
  const found = code.match(COPY_PROPS_GETTER) ?? [];
  if (found.length !== 1) throw new Error(`build-client: expected one esbuild __copyProps getter in the ${name}, found ${found.length}`);
  return code.replace(COPY_PROPS_GETTER, "{value:$1[$2],enumerable:");
}

function loadEsbuild(root) {
  return createRequire(path.join(root, "package.json"))("esbuild");
}

/** Files the output holds code from, relative to the root. */
function liveInputs(metafile) {
  const output = Object.values(metafile.outputs)[0];
  return new Set(Object.entries(output.inputs).filter(([, input]) => input.bytesInOutput > 0).map(([file]) => file));
}

async function buildMain(esbuild, root, shared, chunkId) {
  const remote = path.join(root, CHUNK_DIR, "remote.ts");
  const result = await esbuild.build({
    ...hostOptions(root),
    entryPoints: [path.join(root, "index.client.tsx")],
    define: { __BC_TASKS_CHUNK_ID__: JSON.stringify(chunkId) },
    plugins: [
      {
        name: "bc-tasks-remote",
        setup(build) {
          // The bundle takes the chunk from the server, not from source.
          build.onResolve({ filter: /^\.\/source$/ }, (args) =>
            path.resolve(args.resolveDir) === path.join(root, CHUNK_DIR) ? { path: remote } : undefined,
          );
          build.onResolve({ filter: /^bc-tasks-shared$/ }, () => ({ path: "bc-tasks-shared", namespace: "bc-tasks-shared" }));
          build.onLoad({ filter: /.*/, namespace: "bc-tasks-shared" }, () => {
            const files = [...shared].sort();
            const imports = files.map((file, index) => `import * as m${index} from ${JSON.stringify(path.join(root, file))};`);
            const entries = files.map((file, index) => `  ${JSON.stringify(SHARED_PREFIX + file)}: m${index},`);
            return { contents: `${imports.join("\n")}\nexport default {\n${entries.join("\n")}\n};\n`, loader: "ts", resolveDir: root };
          });
        },
      },
    ],
  });
  return { code: hermesInterop(result.outputFiles[0].text, "bundle"), inputs: liveInputs(result.metafile) };
}

async function buildChunk(esbuild, root, mainInputs) {
  const used = new Set();
  const result = await esbuild.build({
    ...hostOptions(root),
    entryPoints: [path.join(root, CHUNK_ENTRY)],
    plugins: [
      {
        name: "bc-tasks-shared",
        setup(build) {
          build.onResolve({ filter: /^\./ }, async (args) => {
            if (args.pluginData?.bcInner) return undefined;
            const resolved = await build.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, pluginData: { bcInner: true } });
            if (resolved.errors.length > 0) return { errors: resolved.errors };
            const file = path.relative(root, resolved.path).split(path.sep).join("/");
            if (!mainInputs.has(file)) return { path: resolved.path };
            used.add(file);
            return { path: SHARED_PREFIX + file, external: true };
          });
        },
      },
    ],
  });
  return { code: hermesInterop(result.outputFiles[0].text, "Tasks chunk"), inputs: liveInputs(result.metafile), shared: used };
}

/**
 * Both builds, repeated until the bundle holds every module the chunk takes
 * from it. Returns the bundle and chunk code, the chunk's id (a hash of its
 * code, which the bundle is built with), and what each holds.
 */
export async function buildClient({ root = ROOT } = {}) {
  const esbuild = loadEsbuild(root);
  let shared = new Set();
  for (let round = 0; round < 8; round++) {
    const main = await buildMain(esbuild, root, shared, "pending");
    const chunk = await buildChunk(esbuild, root, main.inputs);
    const settled = chunk.shared.size === shared.size && [...chunk.shared].every((file) => shared.has(file));
    if (settled) {
      const chunkId = createHash("sha256").update(chunk.code).digest("hex").slice(0, 16);
      const final = await buildMain(esbuild, root, shared, chunkId);
      return { main: final.code, mainInputs: final.inputs, chunk: chunk.code, chunkInputs: chunk.inputs, chunkId, shared };
    }
    shared = new Set([...shared, ...chunk.shared]);
  }
  throw new Error("build-client: the shared modules did not settle");
}

/** The entry Paseo compiles: the bundle as a string, evaluated with the host's `require`. */
export function clientEntry(main) {
  return [
    "// Generated by scripts/build-client.mjs at install. Do not edit or commit.",
    "// The client bundle, minified, kept in a string so the host's compile",
    "// passes it through as it is; see the script.",
    "declare const require: (id: string) => unknown;",
    "const bundle = { exports: {} as { default?: unknown } };",
    `new Function("require", "module", "exports", ${JSON.stringify(main)})(require, bundle, bundle.exports);`,
    // A function declaration, not `export default bundle.exports.default`: the
    // host's eager interop copies the exports before this module's body runs,
    // when only hoisted declarations hold their value.
    "export default function contribute(client: unknown): unknown {",
    "  return (bundle.exports.default as (client: unknown) => unknown)(client);",
    "}",
    "",
  ].join("\n");
}

/** The server's copy of the chunk (`server/tasks-chunk.ts`). */
export function chunkModule(chunkId, chunk) {
  return [
    "// Generated by scripts/build-client.mjs at install. Do not edit or commit.",
    `export const TASKS_CHUNK = { id: ${JSON.stringify(chunkId)}, code: ${JSON.stringify(chunk)} } as { id: string; code: string } | null;`,
    "",
  ].join("\n");
}

const kb = (text) => `${(Buffer.byteLength(text) / 1024).toFixed(0)} KB`;

async function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const install = args.includes("--install");
  const built = await buildClient();
  const entry = clientEntry(built.main);
  const server = chunkModule(built.chunkId, built.chunk);
  console.log(`build-client: bundle ${kb(entry)}, Tasks chunk ${kb(built.chunk)} (${built.chunkId}), ${built.shared.size} shared modules`);
  if (install) {
    // Paseo runs its build steps in `$PASEO_HOME/plugins/.staging/<id>/...`. Anywhere else (a
    // checkout, a directory install) the generated entry would shadow the source from then on.
    if (!ROOT.split(path.sep).join("/").includes("/plugins/.staging/") && !args.includes("--force")) {
      throw new Error(`build-client: --install writes index.client.ts, which shadows index.client.tsx; ${ROOT} is not a Paseo install (use --out <dir>, or --force)`);
    }
    writeFileSync(path.join(ROOT, "index.client.ts"), entry);
    writeFileSync(path.join(ROOT, "server", "tasks-chunk.ts"), server);
  } else if (outIndex >= 0) {
    const out = path.resolve(args[outIndex + 1] ?? "");
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, "index.client.ts"), entry);
    writeFileSync(path.join(out, "tasks-chunk.ts"), server);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
