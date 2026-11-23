import assert from "node:assert/strict";
import test from "node:test";
import { runLocal, slowTests } from "./test-local.mjs";

function harness({ record = "", result = 0, fingerprints = ["current", "current"] } = {}) {
  const calls = [];
  const saved = [];
  return {
    calls, saved,
    run: () => runLocal({
      getFingerprint: async () => fingerprints.shift(),
      readRecord: () => record,
      writeRecord: (value) => saved.push(value),
      run: (args) => { calls.push(args); return result; },
      log: () => {},
    }),
  };
}

test("first run and changed inputs run everything and save only after success", async () => {
  for (const record of ["", "old"]) {
    const h = harness({ record });
    assert.equal(await h.run(), 0);
    assert.deepEqual(h.calls, [[]]);
    assert.deepEqual(h.saved, ["current"]);
  }
});

test("matching result skips only the exhaustive suites", async () => {
  const h = harness({ record: "current" });
  assert.equal(await h.run(), 0);
  assert.deepEqual(h.calls, [slowTests.flatMap((name) => ["--exclude", name])]);
  assert.deepEqual(h.saved, []);
});

test("a failed suite never creates a success record", async () => {
  const h = harness({ result: 1 });
  assert.equal(await h.run(), 1);
  assert.deepEqual(h.saved, []);
});

test("input changes during a full run prevent recording success", async () => {
  const h = harness({ fingerprints: ["before", "after"] });
  await assert.rejects(h.run(), /inputs changed/);
  assert.deepEqual(h.saved, []);
});

test("fingerprint follows imported source, fixtures, installed packages and environment", async () => {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { fingerprint } = await import("./test-local.mjs");
  const dir = mkdtempSync(path.join(tmpdir(), "better-paseo-validation-test-"));
  const put = (name, content) => {
    const file = path.join(dir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  try {
    put(slowTests[0], 'import "../../client/dependency";');
    put(slowTests[1], 'export const value = 1;');
    put("client/dependency.ts", "export const a = 1;");
    put("vitest.config.ts", "export default {};");
    put("test/unit/helpers/forget-carried.ts", "export {};");
    put("test/fixtures/streams/example.jsonl", "fixture");
    put("node_modules/example/index.js", "package");
    for (const name of ["package.json", "package-lock.json", "tsconfig.json", "scripts/test-local.mjs"]) put(name, "{}");
    let previous = await fingerprint(dir);
    process.env.CODEX_TOOL_CALL_ID = "different-call";
    assert.equal(await fingerprint(dir), previous);
    for (const [name, value] of [["client/dependency.ts", "export const a = 2;"], ["test/fixtures/streams/example.jsonl", "changed"], ["node_modules/example/index.js", "changed"]]) {
      put(name, value);
      const current = await fingerprint(dir);
      assert.notEqual(current, previous, name);
      previous = current;
    }
    process.env.BETTER_PASEO_VALIDATION_TEST = "changed";
    assert.notEqual(await fingerprint(dir), previous);
    put("client/dependency.ts", "export const a = process.env.CODEX_TOOL_CALL_ID;");
    const withEnvironmentRead = await fingerprint(dir);
    process.env.CODEX_TOOL_CALL_ID = "another-call";
    assert.notEqual(await fingerprint(dir), withEnvironmentRead);
  } finally {
    delete process.env.BETTER_PASEO_VALIDATION_TEST;
    delete process.env.CODEX_TOOL_CALL_ID;
    rmSync(dir, { recursive: true, force: true });
  }
});


test("unavailable input fingerprint runs the full suite without saving", async () => {
  const calls = [];
  const result = await runLocal({
    getFingerprint: async () => { throw new Error("unknown input"); },
    readRecord: () => { throw new Error("must not read cache"); },
    writeRecord: () => { throw new Error("must not save cache"); },
    run: (args) => { calls.push(args); return 0; },
    log: () => {},
  });
  assert.equal(result, 0);
  assert.deepEqual(calls, [[]]);
});
