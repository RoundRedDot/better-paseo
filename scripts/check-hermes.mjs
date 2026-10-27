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
// 2. compiles it with the Hermes V1 `hermesc` of this repo's `react-native`
//    devDependency (Paseo 0.13) and with React Native 0.81.5's legacy one
//    (Paseo 0.12), and fails with every error mapped back to its source file
//    and line;
// 3. unless `--no-run`, evaluates the bundle in the legacy `hermes` VM,
//    the way `packages/app/src/plugins/evaluate.ts` does, with stub modules,
//    calls `contribute`, and checks the host's registration rules (timeline
//    renderers must be plain functions).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
let entry = path.resolve(root, option("entry", "index.client.tsx"));
const run = !args.includes("--no-run");
const keep = args.includes("--keep");
// `--built`: what an install compiles instead (`scripts/build-client.mjs`):
// the minified bundle inside a generated `index.client.ts`, and the Tasks
// chunk the plugin server sends. Both run through `new Function`, so hermesc
// compiles each on its own and the VM evaluates the chunk too.
const installBuild = args.includes("--built") ? await import("./build-client.mjs").then((m) => m.buildClient({ root }).then((b) => ({ ...b, entry: m.clientEntry(b.main) }))) : null;
if (installBuild) {
  const builtDir = mkdtempSync(path.join(tmpdir(), "bc-built-"));
  entry = path.join(builtDir, "index.client.ts");
  writeFileSync(entry, installBuild.entry);
}

const PLATFORM_DIR = { darwin: "osx-bin", linux: "linux64-bin", win32: "win64-bin" }[process.platform];
const EXE = process.platform === "win32" ? ".exe" : "";
const rnRequire = createRequire(path.join(root, "package.json"));
let rnPackage;
try {
  rnPackage = rnRequire.resolve("react-native/package.json");
} catch {
  console.error("check:hermes: react-native is not installed; run `npm ci`");
  process.exit(2);
}
if (!PLATFORM_DIR) {
  console.error(`check:hermes: no hermesc for ${process.platform}`);
  process.exit(2);
}

// The devDependency's compiler: React Native 0.86 (Paseo 0.13) runs Hermes V1
// and takes its hermesc from the `hermes-compiler` package; 0.81 and older
// carried one in `sdks/hermesc`. V1 publishes no VM to run a bundle in.
function currentHermesc() {
  try {
    const compiler = createRequire(rnPackage).resolve("hermes-compiler/package.json");
    return path.join(path.dirname(compiler), "hermesc", PLATFORM_DIR, `hermesc${EXE}`);
  } catch {
    return path.join(path.dirname(rnPackage), "sdks", "hermesc", PLATFORM_DIR, `hermesc${EXE}`);
  }
}

// Paseo 0.12, still supported (`requirements.paseo`), runs React Native
// 0.81.5's legacy Hermes, whose package ships both hermesc and the `hermes`
// VM. Fetched once with `npm pack` and kept outside the repo.
const LEGACY_REACT_NATIVE = "0.81.5";
function legacyHermesDir() {
  const cache = path.join(homedir(), ".cache", "better-paseo", `hermes-rn-${LEGACY_REACT_NATIVE}`, PLATFORM_DIR);
  if (existsSync(path.join(cache, `hermes${EXE}`))) return cache;
  const work = mkdtempSync(path.join(tmpdir(), "bc-hermes-legacy-"));
  try {
    const packed = spawnSync("npm", ["pack", `react-native@${LEGACY_REACT_NATIVE}`, "--silent", "--pack-destination", work], { encoding: "utf8", shell: process.platform === "win32" });
    const tarball = packed.status === 0 ? path.join(work, packed.stdout.trim().split("\n").pop()) : null;
    if (!tarball || !existsSync(tarball)) return null;
    const inner = `package/sdks/hermesc/${PLATFORM_DIR}`;
    if (spawnSync("tar", ["-xzf", tarball, "-C", work, inner]).status !== 0) return null;
    mkdirSync(path.dirname(cache), { recursive: true });
    rmSync(cache, { recursive: true, force: true });
    cpSync(path.join(work, inner), cache, { recursive: true });
    return cache;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const legacyDir = legacyHermesDir();
const compilers = [{ label: "Hermes V1", hermesc: currentHermesc() }];
if (legacyDir) compilers.push({ label: `legacy Hermes (RN ${LEGACY_REACT_NATIVE})`, hermesc: path.join(legacyDir, `hermesc${EXE}`) });
else console.log(`check:hermes: could not fetch react-native@${LEGACY_REACT_NATIVE}; legacy Hermes compile and the VM run are skipped`);
for (const { hermesc } of compilers) {
  if (!existsSync(hermesc)) {
    console.error(`check:hermes: no hermesc for ${process.platform} at ${hermesc}`);
    process.exit(2);
  }
}

// --- 1. Bundle like the host -----------------------------------------------

const { buildSync } = createRequire(path.join(root, "package.json"))("esbuild");
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

// --- 1b. ASCII only ----------------------------------------------------------
// The engine keeps the source it evaluated. V8 stores a string one byte per
// character only while every character is Latin-1 (Hermes: ASCII), so one
// `–` anywhere doubles the whole bundle in memory: about 1.7 MB of heap on the
// web build, measured. esbuild escapes string literals itself; comments it
// keeps and regex literals reach the bundle as written, so write those with
// `\uXXXX` escapes or plain ASCII.
const nonAscii = [];
for (const [index, text] of jsFile.text.split("\n").entries()) {
  for (let column = 0; column < text.length; column++) {
    if (text.charCodeAt(column) > 0x7f) {
      nonAscii.push({ line: index + 1, column, char: text[column], text });
      break;
    }
  }
}
if (nonAscii.length > 0) {
  console.error(`check:hermes: FAIL — ${nonAscii.length} bundle line(s) with non-ASCII characters`);
  for (const { line, column, char, text } of nonAscii.slice(0, 20)) {
    const code = char.charCodeAt(0).toString(16).padStart(4, "0");
    console.error(`  near ${locate(line, column) ?? `bundle:${line}`}  U+${code.toUpperCase()}`);
    console.error(`    ${text.trim().slice(0, 160)}`);
  }
  process.exit(1);
}

/** A path under the repo relative to it; the legacy cache in full. */
const shown = (file) => (path.relative(root, file).startsWith("..") ? file : path.relative(root, file));
for (const [index, { label, hermesc }] of compilers.entries()) {
  const compiled = spawnSync(hermesc, ["-emit-binary", "-out", path.join(dir, `client-${index}.hbc`), bundlePath], {
    encoding: "utf8",
  });
  if (compiled.status !== 0) {
    const pattern = /^(.*?):(\d+):(\d+): error: (.*)$/;
    const errors = (compiled.stderr || "")
      .split("\n")
      .map((line) => pattern.exec(line))
      .filter(Boolean);
    console.error(`check:hermes: FAIL — ${label} cannot compile ${path.relative(root, entry)} (${errors.length} error(s))`);
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
  console.log(`check:hermes: ${label} compile OK (${bundle.length} bytes, ${shown(hermesc)})`);
  if (installBuild) {
    for (const [name, code] of [["bundle", installBuild.main], ["Tasks chunk", installBuild.chunk]]) {
      const file = path.join(dir, `${name.replace(/\W+/g, "-")}.js`);
      writeFileSync(file, `(function (require, module, exports) {\n${code}\n})`);
      // Minified lines are long, and hermesc echoes each line it warns about.
      const result = spawnSync(hermesc, ["-emit-binary", "-out", `${file}.${index}.hbc`, file], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
      if (result.status !== 0) {
        console.error(`check:hermes: FAIL — ${label} cannot compile the built ${name} (minified; rebuild without minify to locate)`);
        const errors = (result.stderr || result.stdout || String(result.error)).split("\n").filter((line) => line.includes(": error:"));
        console.error(errors.slice(0, 20).map((line) => `  ${line.slice(0, 300)}`).join("\n"));
        console.error(`  kept at ${file}`);
        process.exit(1);
      }
    }
    console.log(`check:hermes: ${label} built bundle and Tasks chunk compile OK (chunk ${installBuild.chunk.length} bytes, ${installBuild.shared.size} shared modules)`);
  }
}

// --- 3. Evaluate in the Hermes VM (smoke) ------------------------------------

if (!run) {
  if (!keep) rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
// The only VM there is: legacy Hermes, as Paseo 0.12 runs it.
const hermes = legacyDir ? path.join(legacyDir, `hermes${EXE}`) : null;
if (!hermes || !existsSync(hermes)) {
  console.log(`check:hermes: run skipped, no hermes VM${hermes ? ` at ${hermes}` : ""}`);
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
// The host injects this module as a plain object, so a missing export reads as
// undefined (not as a stub): the exact keys of Paseo 0.11.2's
// \`pluginReactNativeRuntime\`, and with SHAPE "sticky" the hook the bc/sticky
// host adds (H2b). The plugin must load under both.
var STOCK_REACT_NATIVE_KEYS = ["Icon", "Modal", "ScrollView", "FlatList", "TextInput", "copyText", "useRevealedText", "useToast"];
function pluginReactNative(shape) {
  var runtime = {};
  for (var k = 0; k < STOCK_REACT_NATIVE_KEYS.length; k++) {
    runtime[STOCK_REACT_NATIVE_KEYS[k]] = makeStub("plugin/client/react-native." + STOCK_REACT_NATIVE_KEYS[k]);
  }
  if (shape === "sticky") runtime.useTimelineStickyHeader = function () { return null; };
  return runtime;
}
var modules = {
  react: React,
  "react/jsx-runtime": makeStub("react/jsx-runtime"),
  "react-native": RN,
  zod: makeStub("zod"),
  "@tanstack/react-query": makeStub("react-query"),
  "@getpaseo/plugin": makeStub("plugin"),
  "@getpaseo/plugin/client": makeStub("plugin/client"),
  "@getpaseo/plugin/client/ui": makeStub("plugin/client/ui"),
  "@getpaseo/plugin/client/react-native": pluginReactNative(SHAPE),
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
  if (CHUNK !== null) {
    // The chunk as remote.ts evaluates it: shared modules from the bundle, the rest from the host.
    stage = "chunk";
    var chunk = { exports: {} };
    new Function("require", "module", "exports", CHUNK)(function (id) {
      return id.indexOf("bc-shared:") === 0 ? makeStub(id) : runtimeRequire(id);
    }, chunk, chunk.exports);
    var names = ["TasksBoardScreen", "TasksSidebarEntry", "TasksSettingsPanel", "startTasksData", "prefetchBoardFromCommand", "releaseBoardPrefetch"];
    for (var n = 0; n < names.length; n++) {
      if (typeof chunk.exports[names[n]] !== "function") problems.push("Tasks chunk exports no " + names[n]);
    }
    stage = "chunk start";
    var stopData = chunk.exports.startTasksData(client);
    if (typeof stopData === "function") stopData();
  }
  stage = "dispose";
  if (typeof dispose === "function") dispose();
} catch (e) {
  problems.push(stage + " threw " + (e && e.name) + ": " + (e && e.message));
}
print("registered " + counts.transformers + " transformers, " + counts.renderers + " renderers, " + counts.settings + " settings screens (" + SHAPE + " host)");
for (var i = 0; i < problems.length; i++) print("PROBLEM " + problems[i]);
`;
// Once against a stock 0.11.2 host and once against a host with the sticky
// header hook (bc/sticky): feature detection must work both ways.
for (const shape of ["stock", "sticky"]) {
  const harnessPath = path.join(dir, `harness-${shape}.js`);
  writeFileSync(harnessPath, `var SOURCE = ${JSON.stringify(bundle)};\nvar SHAPE = ${JSON.stringify(shape)};\nvar CHUNK = ${JSON.stringify(installBuild ? installBuild.chunk : null)};\n${harness}`);
  const ran = spawnSync(hermes, [harnessPath], { encoding: "utf8" });
  const output = `${ran.stdout ?? ""}${ran.stderr ?? ""}`.trim();
  const problems = output.split("\n").filter((line) => line.startsWith("PROBLEM "));
  if (ran.status !== 0 || problems.length > 0) {
    console.error(`check:hermes: FAIL (${shape} host) — the bundle compiles but does not load in the Hermes VM`);
    for (const line of output.split("\n")) console.error(`  ${line}`);
    console.error(`  bundle kept at ${bundlePath}`);
    process.exit(1);
  }
  console.log(`check:hermes: run OK (${output.split("\n").find((line) => line.startsWith("registered")) ?? output})`);
}
if (!keep) rmSync(dir, { recursive: true, force: true });
