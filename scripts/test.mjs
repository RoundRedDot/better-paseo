/**
 * `npm test`: the unit suite without the exhaustive Markdown sweeps.
 * `npm test markdown`: only those sweeps (also `npm run test:markdown`).
 * Any other arguments go to `vitest run` unchanged.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const markdown = args[0] === "markdown";
const child = spawnSync(
  process.execPath,
  [path.join(root, "node_modules/vitest/vitest.mjs"), "run", ...(markdown ? ["-c", "vitest.markdown.config.ts", ...args.slice(1)] : args)],
  { cwd: root, stdio: "inherit" },
);
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
