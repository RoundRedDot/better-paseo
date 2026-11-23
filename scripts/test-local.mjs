import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const slowTests = ["test/unit/markdown-blocks-exhaustive.test.ts", "test/unit/markdown-streaming-height-exhaustive.test.ts"];

function addTree(hash, base, relative) {
  const full = path.join(base, relative);
  const stat = lstatSync(full);
  hash.update(`${relative}\0${stat.mode}\0`);
  if (stat.isSymbolicLink()) {
    hash.update(readFileSync(full));
    return;
  }
  if (stat.isDirectory()) {
    for (const name of readdirSync(full).sort()) {
      if (relative === "node_modules" && [".bin", ".vite", ".cache"].includes(name)) continue;
      addTree(hash, base, path.join(relative, name));
    }
    return;
  }
  hash.update(readFileSync(full));
}

export async function fingerprint(base = root) {
  const graph = await build({
    absWorkingDir: base,
    entryPoints: [...slowTests, "vitest.config.ts", "test/unit/helpers/forget-carried.ts"],
    outdir: "out", bundle: true, packages: "external", platform: "node", write: false, metafile: true,
    logLevel: "silent",
  });
  if (graph.warnings.length) throw new Error("Cannot determine the test dependency graph.");
  const hash = createHash("sha256");
  const readsEnvironment = Object.keys(graph.metafile.inputs).some((input) =>
    /process\s*\.\s*env|import\s*\.\s*meta\s*\.\s*env/.test(readFileSync(path.join(base, input), "utf8")));
  const transient = new Set(["CODEX_SESSION_ID", "CODEX_THREAD_ID", "CODEX_TOOL_CALL_ID", "PASEO_AGENT_ID", "PASEO_AGENT_CWD"]);
  const env = Object.entries(process.env)
    .filter(([key]) => readsEnvironment || !transient.has(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, value?.split(base).join("<root>")]);
  hash.update(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, env }));
  const envFiles = readdirSync(base).filter((name) => name === ".env" || name.startsWith(".env."));
  const inputs = new Set([...Object.keys(graph.metafile.inputs), ...envFiles, "package.json", "package-lock.json", "tsconfig.json", "test/fixtures/streams", "node_modules", "scripts/test-local.mjs"]);
  for (const input of [...inputs].sort()) addTree(hash, base, input);
  return hash.digest("hex");
}

export async function runLocal({ getFingerprint, readRecord, writeRecord, run, log = console.log }) {
  let before;
  try {
    before = await getFingerprint();
  } catch (error) {
    log(`Cannot fingerprint test inputs (${error.message}); running the full suite without caching.`);
    return run([]);
  }
  const cached = readRecord() === before;
  if (cached) log("Markdown exhaustive sweeps: reusing matching successful local result.");
  else log("Markdown exhaustive sweeps: no matching result; running full suite.");
  const args = cached ? slowTests.flatMap((test) => ["--exclude", test]) : [];
  const result = run(args);
  if (result !== 0) return result;
  const after = await getFingerprint();
  if (after !== before) throw new Error("Test inputs changed while running; no result was saved.");
  if (!cached) {
    writeRecord(before);
    log("Markdown exhaustive sweeps: successful result saved.");
  }
  return 0;
}

async function main() {
  const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim();
  const cacheDir = path.join(gitDir, "local-validation");
  const record = path.join(cacheDir, "markdown-sweeps.sha256");
  const result = await runLocal({
    getFingerprint: () => fingerprint(),
    readRecord: () => { try { return readFileSync(record, "utf8").trim(); } catch (error) { if (error.code === "ENOENT") return ""; throw error; } },
    writeRecord: (value) => {
      mkdirSync(cacheDir, { recursive: true });
      const temp = path.join(cacheDir, `markdown-sweeps.${process.pid}.tmp`);
      writeFileSync(temp, `${value}\n`);
      renameSync(temp, record);
    },
    run: (args) => {
      const child = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", ...args], { cwd: root, stdio: "inherit" });
      if (child.error) throw child.error;
      return child.status ?? 1;
    },
  });
  process.exitCode = result;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
