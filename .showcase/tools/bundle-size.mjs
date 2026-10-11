// Measures the client bundle the way the Paseo 0.11.2 host compiler builds it
// (packages/server/src/server/plugins/compiler.ts, compileTarget "client").
// Usage: node .showcase/tools/bundle-size.mjs [pluginDir] [--write out.js]
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const writeIndex = args.indexOf("--write");
const outFile = writeIndex >= 0 ? args.splice(writeIndex, 2)[1] : null;
const dir = path.resolve(args[0] ?? ".");

const result = await build({
  entryPoints: [path.join(dir, "index.client.tsx")],
  absWorkingDir: dir,
  bundle: true,
  format: "cjs",
  jsx: "automatic",
  platform: "neutral",
  target: "es2020",
  mainFields: ["module", "main"],
  supported: { "async-await": false },
  external: [
    "@getpaseo/plugin",
    "@getpaseo/plugin/*",
    "@tanstack/react-query",
    "react",
    "react/jsx-runtime",
    "react-native",
    "zod",
  ],
  metafile: true,
  logLevel: "silent",
  treeShaking: true,
  write: false,
});
const text = result.outputFiles[0].text;
if (outFile) writeFileSync(outFile, text);
const inputs = Object.keys(result.metafile.inputs);
console.log(
  JSON.stringify({
    dir,
    bytes: Buffer.byteLength(text),
    gzipBytes: gzipSync(text).length,
    hasMarked: inputs.some((f) => f.includes("node_modules/marked/")),
    hasRemend: inputs.some((f) => f.includes("node_modules/remend/")),
  }),
);
