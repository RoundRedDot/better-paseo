import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writePerfDump } from "../../server/perf-dump";
import { perfDumpRpc } from "../../shared/perf-rpc";

describe("writePerfDump", () => {
  it("writes the data to <platform>-<label>-<timestamp>.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bc-perf-"));
    const path = await writePerfDump(
      { label: "mixed-turn", platform: "ios", data: { snapshot: { frames: 1 } } },
      { dir, now: new Date("2026-10-11T04:05:06.789Z") },
    );
    expect(path).toBe(join(dir, "ios-mixed-turn-2026-10-11T04-05-06-789Z.json"));
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ snapshot: { frames: 1 } });
  });

  it("keeps a hostile label inside the directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bc-perf-"));
    const path = await writePerfDump({ label: "../../etc/passwd", platform: "web", data: {} }, { dir });
    expect(path.startsWith(dir + "/")).toBe(true);
    expect(await readdir(dir)).toHaveLength(1);
  });
});

describe("perfDumpRpc", () => {
  it("uses a host-legal method name", () => {
    expect(perfDumpRpc.name).toMatch(/^[a-z][a-z0-9._-]*$/);
  });
});
