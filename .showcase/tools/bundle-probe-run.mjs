// Bundles client/debug/bundle-probe.ts with the host's client esbuild settings
// and runs it in Node, proving `marked` and `remend` survive that pipeline.
import { build } from "esbuild";
import path from "node:path";
import { createRequire } from "node:module";

const dir = path.resolve(process.argv[2] ?? ".");
const result = await build({
  entryPoints: [path.join(dir, "client/debug/bundle-probe.ts")],
  absWorkingDir: dir,
  bundle: true,
  format: "cjs",
  platform: "neutral",
  target: "es2020",
  mainFields: ["module", "main"],
  supported: { "async-await": false },
  logLevel: "silent",
  write: false,
});
const module_ = { exports: {} };
new Function("module", "exports", "require", result.outputFiles[0].text)(
  module_,
  module_.exports,
  createRequire(import.meta.url),
);
console.log(JSON.stringify(module_.exports.runBundleProbe()));
