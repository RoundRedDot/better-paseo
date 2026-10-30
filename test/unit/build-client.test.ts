import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TASKS_CHUNK } from "../../server/tasks-chunk";

// The install-time build (`scripts/build-client.mjs`): the bundle without the
// Tasks board, the board as a chunk, and no module in both.

const root = path.resolve(__dirname, "../..");

describe("install build", () => {
  it("leaves no build in the checkout: index.client.ts would shadow the source, and the server chunk stays null", () => {
    expect(existsSync(path.join(root, "index.client.ts"))).toBe(false);
    expect(TASKS_CHUNK).toBeNull();
  });

  it("refuses to write an entry into a checkout", () => {
    const run = spawnSync(process.execPath, [path.join(root, "scripts/build-client.mjs"), "--install"], { cwd: root, encoding: "utf8" });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("is not a Paseo install");
    expect(existsSync(path.join(root, "index.client.ts"))).toBe(false);
  });

  it("runs as the manifest's last build step", () => {
    const manifest = JSON.parse(readFileSync(path.join(root, "paseo-plugin.json"), "utf8")) as { build: string[][] };
    expect(manifest.build.at(-1)).toEqual(["node", "scripts/build-client.mjs", "--install"]);
  });

  it("splits the Tasks board off, shares every module both sides need, and copies none", async () => {
    const { buildClient, clientEntry, chunkModule } = await import("../../scripts/build-client.mjs");
    const built = await buildClient();
    for (const file of ["client/tasks/board/board-screen.tsx", "client/tasks/data/index.ts", "client/tasks/cards/task-card.tsx"]) {
      expect(built.mainInputs.has(file)).toBe(false);
      expect(built.chunkInputs.has(file)).toBe(true);
    }
    expect([...built.chunkInputs].filter((file) => built.mainInputs.has(file))).toEqual([]);
    // The stores both sides read are the bundle's.
    for (const file of ["client/tasks/board/enabled.ts", "client/tasks/board/params.ts", "client/tasks/board/carry.ts", "client/tasks/i18n.ts"]) {
      expect(built.shared.has(file)).toBe(true);
    }
    expect(built.main).toContain(JSON.stringify(built.chunkId));
    // The registry holds every name the chunk reads off a shared module: a missing one would be undefined at runtime.
    const missing: string[] = [];
    const requiredFiles = new Set<string>();
    for (const [, local, file] of built.chunk.matchAll(/([\w$]+)=(?:[\w$]+\()?require\("bc-shared:([^"]+)"\)/g)) {
      requiredFiles.add(file!);
      const names = built.shared.get(file!);
      if (!names) missing.push(`${file}: not shared`);
      if (!names || names === "*") continue;
      const reads = built.chunk.matchAll(new RegExp(`(?<![\\w$.])${local!.replace(/\$/g, "\\$")}\\.([\\w$]+)`, "g"));
      for (const [, name] of reads) if (!names.has(name!)) missing.push(`${file}: ${name}`);
    }
    expect([...requiredFiles].sort()).toEqual([...built.shared.keys()].sort());
    expect(missing).toEqual([]);
    // No interop getter made in a loop: Hermes would give each the last export (build-client.mjs).
    for (const code of [built.main, built.chunk]) expect(code).not.toMatch(/\{get:\(\)=>[\w$]+\[[\w$]+\],enumerable:/);
    // Only the host's modules and the shared ones are required.
    const required = new Set([...built.chunk.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]!));
    for (const id of required) expect(id.startsWith("bc-shared:") || /^(react|react-native|zod|@tanstack\/react-query|@getpaseo\/plugin)/.test(id)).toBe(true);
    // ASCII only: Hermes keeps a one-byte string only then (check-hermes.mjs).
    const entry = clientEntry(built.main);
    expect(/^[\x00-\x7f]*$/.test(entry)).toBe(true);
    expect(/^[\x00-\x7f]*$/.test(chunkModule(built.chunkId, built.chunk))).toBe(true);
  });
});

describe("shared names", () => {
  it("reads the names an ESM chunk imports from each shared module", async () => {
    const { sharedNames } = await import("../../scripts/build-client.mjs");
    const names = sharedNames([
      'import { a, b as c } from "bc-shared:x.ts";',
      'import def, { d } from "bc-shared:y.ts";',
      'import * as all from "bc-shared:z.ts";',
      'export { e } from "bc-shared:x.ts";',
      'export * from "bc-shared:w.ts";',
      'import "bc-shared:v.ts";',
      'import { "quoted" as q } from "bc-shared:u.ts";',
    ].join("\n"));
    expect(names.get("x.ts")).toEqual(new Set(["a", "b", "e"]));
    expect(names.get("y.ts")).toEqual(new Set(["d", "default"]));
    expect(names.get("z.ts")).toBe("*");
    expect(names.get("w.ts")).toBe("*");
    expect(names.get("v.ts")).toEqual(new Set());
    expect(names.get("u.ts")).toEqual(new Set(["quoted"]));
  });
});
