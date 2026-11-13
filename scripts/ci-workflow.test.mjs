import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repoRoot = new URL("../", import.meta.url);
const workflowPath = new URL(".github/workflows/ci.yml", repoRoot);
const filtersPath = new URL(".github/ci-paths.yml", repoRoot);

const gatedJobs = new Map([
  ["typecheck", "typecheck"],
  ["test", "test"],
  ["client", "client"],
]);

function jobBlocks(source) {
  const jobs = new Map();
  let currentJob;
  for (const line of source.split("\n")) {
    const jobMatch = /^  ([a-z0-9-]+):\s*$/.exec(line);
    if (jobMatch) {
      currentJob = jobMatch[1];
      jobs.set(currentJob, []);
      continue;
    }
    if (currentJob) jobs.get(currentJob).push(line);
  }
  return jobs;
}

function loadFilters(path) {
  const filters = {};
  let currentFilter;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const filterMatch = /^([a-z_]+):\s*$/.exec(line);
    if (filterMatch) {
      currentFilter = filterMatch[1];
      filters[currentFilter] = [];
      continue;
    }
    const patternMatch = /^  - "([^"]+)"\s*$/.exec(line);
    if (currentFilter && patternMatch) filters[currentFilter].push(patternMatch[1]);
  }
  return filters;
}

test("gated checks are static jobs fed by the changes job", () => {
  const source = readFileSync(workflowPath, "utf8");
  const jobs = jobBlocks(source);
  const trigger = source.split("jobs:", 1)[0];

  assert.match(trigger, /^\s+merge_group:\s*$/m);
  assert.doesNotMatch(source, /strategy:\s*\n\s+matrix:/);
  assert.doesNotMatch(source, /\$\{\{\s*always\(\)/);

  const changes = jobs.get("changes")?.join("\n") ?? "";
  assert.match(changes, /filters: \.github\/ci-paths\.yml/);
  assert.match(changes, /node --test scripts\/ci-workflow\.test\.mjs/);
  assert.doesNotMatch(changes, /npm-retry\.mjs|npm run /);

  for (const [jobId, contract] of gatedJobs) {
    const job = jobs.get(jobId)?.join("\n");
    assert.ok(job, `missing static job ${jobId}`);
    assert.match(job, new RegExp(`^    name: ${jobId}$`, "m"));
    assert.match(job, /needs: changes/);
    assert.match(job, /!cancelled\(\)/);
    assert.match(job, /needs\.changes\.outputs\.full != 'false'/);
    assert.match(job, new RegExp(`needs\\.changes\\.outputs\\.${contract} != 'false'`));
  }
});

test("path contracts cover the router, the toolchain, and each check", () => {
  const filters = loadFilters(filtersPath);
  for (const name of ["routing", "workspace", "ci", "typecheck", "test", "client"]) {
    assert.ok(filters[name]?.length, `missing paths for ${name}`);
  }
  assert.deepEqual(filters.routing, [".github/ci-paths.yml"]);
  assert.ok(filters.workspace.includes("package.json"));
  assert.ok(filters.ci.includes(".github/workflows/ci.yml"));
});
