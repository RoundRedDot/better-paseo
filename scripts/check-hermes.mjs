#!/usr/bin/env node
// Hermes gate for the plugin client bundle.
//
//   npm run check:hermes [-- --entry index.client.tsx] [--no-run] [--keep]
//
// Paseo's daemon bundles `index.client.tsx` with esbuild and the native app
// evaluates the result directly — no Metro, no Babel — so anything Hermes
// cannot compile (any `class`, the regex `v` flag, ...) breaks the plugin on
// iOS and Android while web keeps working. This script:
//
// 1. bundles the entry with the host's client options (Paseo
//    `packages/server/src/server/plugins/compiler.ts`, `compileTarget` and
//    `wrapCommonJsBundle` / `makeHermesInteropEager`);
// 2. compiles it with `hermesc` from this repo's `react-native` devDependency
//    and fails with every error mapped back to its source file and line;
// 3. unless `--no-run`, evaluates the bundle in the `hermes` VM next to it,
//    the way `packages/app/src/plugins/evaluate.ts` does, with stub modules,
//    calls `contribute`, and checks the host's registration rules (timeline
//    renderers must be plain functions).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const entry = path.resolve(root, option("entry", "index.client.tsx"));
const run = !args.includes("--no-run");
const keep = args.includes("--keep");

// esbuild: a root devDependency (the release vitest resolves); the showcase
// install is the fallback for a checkout that skipped the root install.
function loadEsbuild() {
  for (const base of [root, path.join(root, ".showcase")]) {
    try {
      return createRequire(path.join(base, "package.json"))("esbuild");
    } catch {
      // try the next install
    }
  }
  console.error("check:hermes: esbuild not found; run `npm ci` (or `npm ci` in .showcase/)");
  process.exit(2);
}

const PLATFORM_DIR = { darwin: "osx-bin", linux: "linux64-bin", win32: "win64-bin" }[process.platform];
const EXE = process.platform === "win32" ? ".exe" : "";
const rnRequire = createRequire(path.join(root, "package.json"));
let hermesDir;
try {
  hermesDir = path.join(path.dirname(rnRequire.resolve("react-native/package.json")), "sdks", "hermesc", PLATFORM_DIR ?? "");
} catch {
  console.error("check:hermes: react-native is not installed; run `npm ci`");
  process.exit(2);
}
const hermesc = path.join(hermesDir, `hermesc${EXE}`);
if (!PLATFORM_DIR || !existsSync(hermesc)) {
  console.error(`check:hermes: no hermesc for ${process.platform} at ${hermesc}`);
  process.exit(2);
}

// --- 1. Bundle like the host -----------------------------------------------

const { buildSync } = loadEsbuild();
const built = buildSync({
  entryPoints: [entry],
  bundle: true,
  format: "cjs",
  jsx: "automatic",
  platform: "neutral",
  target: "es2020",
  mainFields: ["module", "main"],
  supported: { "async-await": false },
  external: [
    "@getpaseo/plugin",
    "@getpaseo/plugin/client",
    "@getpaseo/plugin/client/ui",
    "@getpaseo/plugin/client/react-native",
    "@tanstack/react-query",
    "react",
    "react/jsx-runtime",
    "react-native",
    "zod",
  ],
  treeShaking: true,
  logLevel: "silent",
  write: false,
  sourcemap: "external",
  outfile: path.join(root, "client-bundle.js"),
  absWorkingDir: root,
});
const jsFile = built.outputFiles.find((file) => file.path.endsWith(".js"));
const mapFile = built.outputFiles.find((file) => file.path.endsWith(".map"));
// The host's two post-passes, verbatim in effect.
const PREFIX = "(function(require) {\nconst module = { exports: {} };\nconst exports = module.exports;\n";
const PREFIX_LINES = 3;
const body = jsFile.text.replaceAll("get: () => from[key]", "value: from[key]");
const bundle = `${PREFIX}${body}\nreturn module.exports;\n})`;

const dir = mkdtempSync(path.join(tmpdir(), "bc-hermes-"));
const bundlePath = path.join(dir, "client-bundle.js");
writeFileSync(bundlePath, bundle);

// --- 2. Compile with hermesc ------------------------------------------------

const VLQ = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Generated (1-based line, 0-based column) -> original "file:line:col", from a v3 source map. */
function sourceLocator(map) {
  const lines = map.mappings.split(";");
  return (line, column) => {
    const segments = lines[line - 1];
    if (segments === undefined) return null;
    // Fields other than the generated column are relative across the whole
    // map, so decode every line up to and including the target.
    let source = 0;
    let origLine = 0;
    let origCol = 0;
    let best = null;
    for (let index = 0; index < line; index++) {
      let genCol = 0;
      for (const segment of (lines[index] ?? "").split(",")) {
        if (!segment) continue;
        const fields = [];
        let value = 0;
        let shift = 0;
        for (const char of segment) {
          const digit = VLQ.indexOf(char);
          value += (digit & 31) << shift;
          if (digit & 32) {
            shift += 5;
          } else {
            fields.push(value & 1 ? -(value >> 1) : value >> 1);
            value = 0;
            shift = 0;
          }
        }
        genCol += fields[0];
        if (fields.length >= 4) {
          source += fields[1];
          origLine += fields[2];
          origCol += fields[3];
          if (index === line - 1 && genCol <= column) {
            best = `${map.sources[source]}:${origLine + 1}:${origCol + 1}`;
          }
        }
      }
    }
    return best;
  };
}
const locate = sourceLocator(JSON.parse(mapFile.text));
const bundleLines = bundle.split("\n");

const compiled = spawnSync(hermesc, ["-emit-binary", "-out", path.join(dir, "client.hbc"), bundlePath], {
  encoding: "utf8",
});
if (compiled.status !== 0) {
  const pattern = /^(.*?):(\d+):(\d+): error: (.*)$/;
  const errors = (compiled.stderr || "")
    .split("\n")
    .map((line) => pattern.exec(line))
    .filter(Boolean);
  console.error(`check:hermes: FAIL — Hermes cannot compile ${path.relative(root, entry)} (${errors.length} error(s))`);
  for (const [, , lineText, colText, message] of errors.slice(0, 20)) {
    const line = Number(lineText);
    const column = Number(colText) - 1;
    const original = line > PREFIX_LINES ? locate(line - PREFIX_LINES, column) : null;
    console.error(`  ${original ?? "(bundle wrapper)"}  bundle:${line}:${column + 1}  ${message}`);
    console.error(`    ${(bundleLines[line - 1] ?? "").trim().slice(0, 160)}`);
  }
  if (errors.length === 0) console.error(compiled.stderr || compiled.stdout);
  console.error(`  bundle kept at ${bundlePath}`);
  process.exit(1);
}
console.log(`check:hermes: compile OK (${bundle.length} bytes, ${path.relative(root, hermesc)})`);

// --- 3. Evaluate in the Hermes VM (smoke) ------------------------------------

const hermes = path.join(hermesDir, `hermes${EXE}`);
if (!run) {
  if (!keep) rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
if (!existsSync(hermes)) {
  console.log(`check:hermes: run skipped, no hermes VM at ${hermes}`);
  if (!keep) rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}

// Stub modules: a callable proxy answers any property read or call, so
// module-level code (StyleSheet.create, z.object, ...) runs; the few values
// whose shape matters (Platform.OS, React.memo) are spelled out.
const harness = `
var problems = [];
function makeStub(name) {
  var target = function () {};
  return new Proxy(target, {
    get: function (t, key) {
      if (key === "then") return undefined;
      if (key === Symbol.toPrimitive) return function () { return "[stub " + name + "]"; };
      if (key === "OS") return "ios";
      if (!(key in t)) t[key] = makeStub(name + "." + String(key));
      return t[key];
    },
    apply: function () { return makeStub(name + "()"); },
    construct: function () { return makeStub("new " + name); },
  });
}
var React = makeStub("react");
// Element types React builds as objects, not functions: the host rejects
// these as timeline renderers, so they must not look callable here.
React.memo = function (type) { return { $$typeof: "react.memo", type: type }; };
React.forwardRef = function (render) { return { $$typeof: "react.forward_ref", render: render }; };
React.lazy = function (load) { return { $$typeof: "react.lazy", load: load }; };
var RN = makeStub("react-native");
var modules = {
  react: React,
  "react/jsx-runtime": makeStub("react/jsx-runtime"),
  "react-native": RN,
  zod: makeStub("zod"),
  "@tanstack/react-query": makeStub("react-query"),
  "@getpaseo/plugin": makeStub("plugin"),
  "@getpaseo/plugin/client": makeStub("plugin/client"),
  "@getpaseo/plugin/client/ui": makeStub("plugin/client/ui"),
  "@getpaseo/plugin/client/react-native": makeStub("plugin/client/react-native"),
};
function runtimeRequire(name) {
  if (name in modules) return modules[name];
  throw new Error('Module "' + name + '" is not available in plugin client code');
}
var counts = { transformers: 0, renderers: 0, settings: 0 };
function isComponentType(value) {
  return typeof value === "function" || (typeof value === "object" && value !== null && "$$typeof" in value);
}
var client = new Proxy({
  addTimelineTransformer: function (c) { counts.transformers++; return function () {}; },
  addTimelineRenderer: function (c) {
    counts.renderers++;
    // evaluate.ts: a timeline renderer must be a plain function.
    if (typeof c.Component !== "function") problems.push("Timeline renderer " + c.kind + "/" + c.version + " is not a component (must be a plain function)");
    return function () {};
  },
  addSettingsScreen: function (c) {
    counts.settings++;
    if (!isComponentType(c.Component)) problems.push("Screen " + c.id + " is not a component");
    return function () {};
  },
}, {
  get: function (t, key) {
    if (key in t) return t[key];
    return function () { return function () {}; };
  },
});
var stage = "eval";
try {
  var factory = globalThis.eval(SOURCE);
  if (typeof factory !== "function") throw new Error("client bundle is not executable");
  stage = "factory";
  var exp = factory(runtimeRequire);
  stage = "contribute";
  var setup = exp && (exp.default || exp);
  if (typeof setup !== "function") throw new Error("client bundle exports no contribute function");
  var dispose = setup(client);
  stage = "dispose";
  if (typeof dispose === "function") dispose();
} catch (e) {
  problems.push(stage + " threw " + (e && e.name) + ": " + (e && e.message));
}
print("registered " + counts.transformers + " transformers, " + counts.renderers + " renderers, " + counts.settings + " settings screens");
for (var i = 0; i < problems.length; i++) print("PROBLEM " + problems[i]);
`;
const harnessPath = path.join(dir, "harness.js");
writeFileSync(harnessPath, `var SOURCE = ${JSON.stringify(bundle)};\n${harness}`);
const ran = spawnSync(hermes, [harnessPath], { encoding: "utf8" });
const output = `${ran.stdout ?? ""}${ran.stderr ?? ""}`.trim();
const problems = output.split("\n").filter((line) => line.startsWith("PROBLEM "));
if (ran.status !== 0 || problems.length > 0) {
  console.error("check:hermes: FAIL — the bundle compiles but does not load in the Hermes VM");
  for (const line of output.split("\n")) console.error(`  ${line}`);
  console.error(`  bundle kept at ${bundlePath}`);
  process.exit(1);
}
console.log(`check:hermes: run OK (${output.split("\n").find((line) => line.startsWith("registered")) ?? output})`);
if (!keep) rmSync(dir, { recursive: true, force: true });
