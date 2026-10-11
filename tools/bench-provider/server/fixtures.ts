import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ReplayItem = { type: string; [key: string]: unknown };
export interface ReplayLine {
  t: number;
  item: ReplayItem;
  mode: "append" | "replace";
}
export interface ReplayFixture {
  name: string;
  description: string;
  scenario: string;
  lines: ReplayLine[];
}

/**
 * Absolute fixture directory baked in by `scripts/set-fixtures-dir.mjs`. The file is generated
 * and git-ignored, hence the guarded require: the daemon bundles it when present and a fresh
 * checkout (or the repo's root typecheck) does not need it to exist.
 */
function generatedFixturesDir(): string | undefined {
  try {
    return (require("./fixtures-dir.generated") as { FIXTURES_DIR?: string }).FIXTURES_DIR;
  } catch {
    return undefined;
  }
}

/** Directories searched for `*.jsonl`, first hit wins. */
export function fixtureDirectories(): string[] {
  const dirs: string[] = [];
  if (process.env.BC_BENCH_FIXTURES) dirs.push(process.env.BC_BENCH_FIXTURES);
  const generated = generatedFixturesDir();
  if (generated) dirs.push(generated);
  return dirs;
}

function resolveDirectory(): string {
  const dirs = fixtureDirectories();
  for (const dir of dirs) {
    if (existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".jsonl"))) return dir;
  }
  throw new Error(
    `No stream fixtures found. Searched: ${dirs.join(", ")}. Run \`npm run sync-fixtures\` in tools/bench-provider before installing, or set BC_BENCH_FIXTURES.`,
  );
}

export function listFixtures(): ReplayFixture[] {
  const dir = resolveDirectory();
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => parseFixture(readFileSync(join(dir, f), "utf8"), f.replace(/\.jsonl$/, "")));
}

export function loadFixture(name: string): ReplayFixture {
  const dir = resolveDirectory();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`Invalid fixture name: ${name}`);
  const file = join(dir, `${name}.jsonl`);
  if (!existsSync(file)) {
    const known = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => f.replace(/\.jsonl$/, ""));
    throw new Error(`Unknown fixture "${name}". Available: ${known.join(", ")}`);
  }
  return parseFixture(readFileSync(file, "utf8"), name);
}

export function parseFixture(text: string, name: string): ReplayFixture {
  const rows = text.split("\n").filter((line) => line.length > 0);
  const meta = JSON.parse(rows[0] ?? "{}") as { kind?: string; name?: string; description?: string; scenario?: string };
  if (meta.kind !== "meta") throw new Error(`${name}: first line must be a meta record`);
  const lines = rows.slice(1).map((row, index) => {
    const parsed = JSON.parse(row) as ReplayLine;
    if (typeof parsed.t !== "number" || !parsed.item || (parsed.mode !== "append" && parsed.mode !== "replace")) {
      throw new Error(`${name}: malformed record at line ${index + 2}`);
    }
    return parsed;
  });
  return { name: meta.name ?? name, description: meta.description ?? "", scenario: meta.scenario ?? "", lines };
}
