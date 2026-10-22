import { mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execCommand } = vi.hoisted(() => ({ execCommand: vi.fn() }));
vi.mock("@getpaseo/plugin/server", () => ({ execCommand }));

import { registerTasksServer } from "../../server/tasks/register";
import { createStopMarks, STOP_MARK_MAX_AGE_MS, STOPS_KEPT } from "../../server/tasks/stop-marks";

const DAY = 24 * 60 * 60 * 1000;
let dir = "";
let path = "";
let clock = Date.parse("2026-10-21T00:00:00Z");
const now = () => clock;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "stop-marks-"));
  path = join(dir, "data", "tasks-stops.json");
  clock = Date.parse("2026-10-21T00:00:00Z");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const ids = async (marks: ReturnType<typeof createStopMarks>) => (await marks.list()).map((stop) => stop.agentId);

describe("tasks stop marks", () => {
  it("saves a mark and a fresh instance loads it, oldest first", async () => {
    const marks = createStopMarks(path, now);
    await marks.mark("agent-a");
    clock += 1000;
    await marks.mark("agent-b");
    clock += 1000;
    await marks.mark("agent-a");
    expect(await ids(createStopMarks(path, now))).toEqual(["agent-b", "agent-a"]);
    const [stop] = await createStopMarks(path, now).list();
    expect(stop).toEqual({ agentId: "agent-b", stoppedAt: new Date(clock - 1000).toISOString() });
    expect((await readdir(join(dir, "data"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("starts empty from a missing file, and from corrupt or mis-shaped ones", async () => {
    expect(await createStopMarks(path, now).list()).toEqual([]);
    await createStopMarks(path, now).mark("agent-a");
    for (const text of ["{not json", "[]", '{"stops":"x"}', '{"stops":[{"agentId":1}]}', ""]) {
      await writeFile(path, text);
      const marks = createStopMarks(path, now);
      expect(await marks.list()).toEqual([]);
      await marks.mark("agent-b");
      expect(await ids(createStopMarks(path, now))).toEqual(["agent-b"]);
    }
  });

  it("drops entries older than 30 days, with unsafe ids and bad times, on load", async () => {
    const at = (age: number) => new Date(clock - age).toISOString();
    await createStopMarks(path, now).mark("seed");
    await writeFile(path, JSON.stringify({ stops: [
      { agentId: "old", stoppedAt: at(STOP_MARK_MAX_AGE_MS + DAY) },
      { agentId: "../evil", stoppedAt: at(DAY) },
      { agentId: "bad-time", stoppedAt: "yesterday" },
      { agentId: "edge", stoppedAt: at(STOP_MARK_MAX_AGE_MS - 1000) },
      { agentId: "fresh", stoppedAt: at(DAY) },
    ] }));
    const marks = createStopMarks(path, now);
    expect(await ids(marks)).toEqual(["edge", "fresh"]);
    // A mark ages out while the server runs, too.
    clock += 2000;
    expect(await ids(marks)).toEqual(["fresh"]);
  });

  it("keeps the newest marks within the cap", async () => {
    const stops = Array.from({ length: STOPS_KEPT + 20 }, (_, index) => ({ agentId: `agent-${index}`, stoppedAt: new Date(clock - 1000 + index).toISOString() }));
    await createStopMarks(path, now).mark("seed");
    await writeFile(path, JSON.stringify({ stops }));
    const marks = createStopMarks(path, now);
    const kept = await ids(marks);
    expect(kept).toHaveLength(STOPS_KEPT);
    expect(kept[0]).toBe("agent-20");
    await marks.mark("one-more");
    const saved = JSON.parse(await readFile(path, "utf8")).stops;
    expect(saved).toHaveLength(STOPS_KEPT);
    expect(saved[saved.length - 1].agentId).toBe("one-more");
  });

  it("writes only when a mark changes", async () => {
    const marks = createStopMarks(path, now);
    await marks.mark("agent-a");
    const written = await readFile(path, "utf8");
    await writeFile(path, "sentinel");
    await marks.clear("agent-unknown");
    await marks.list();
    expect(await readFile(path, "utf8")).toBe("sentinel");
    await marks.clear("agent-a");
    expect(await readFile(path, "utf8")).not.toBe("sentinel");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ stops: [] });
    expect(written).toContain("agent-a");
  });

  it("serializes overlapping writes so the file ends with the final state", async () => {
    const marks = createStopMarks(path, now);
    await Promise.all(Array.from({ length: 30 }, (_, index) => marks.mark(`agent-${index}`)));
    await Promise.all([marks.clear("agent-3"), marks.mark("agent-3"), marks.clear("agent-4")]);
    expect(await ids(createStopMarks(path, now))).toEqual(await ids(marks));
    expect(await ids(marks)).not.toContain("agent-4");
    expect(await ids(marks)).toContain("agent-3");
  });

  it("survives a write that fails", async () => {
    const marks = createStopMarks(join(dir, "blocked", "tasks-stops.json"), now);
    await writeFile(join(dir, "blocked"), "not a directory");
    await expect(marks.mark("agent-a")).resolves.toBeUndefined();
    expect(await ids(marks)).toEqual(["agent-a"]);
  });
});

describe("tasks stop marks on the server", () => {
  const readsPath = () => join(dir, "tasks-reads.json");

  function setup() {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    const events = new Map<string, (event: unknown) => unknown>();
    const server = {
      registerSettings() {},
      on(name: string, handler: (event: unknown) => unknown) { events.set(name, handler); return () => {}; },
      before() { return () => {}; },
      handle(contract: { name: string }, handler: (input: unknown) => Promise<unknown>) { handlers.set(contract.name, handler); },
    } as unknown as PluginServerContext;
    registerTasksServer(server, createStopMarks(path, now), undefined, undefined, createStopMarks(readsPath(), now));
    return {
      stopped: async () => ((await handlers.get("tasks.stopped")!({})) as { stops: Array<{ agentId: string }> }).stops.map((stop) => stop.agentId),
      reads: async () => ((await handlers.get("tasks.reads")!({})) as { reads: Array<{ agentId: string }> }).reads.map((read) => read.agentId),
      event: async (name: string, id: string) => { await events.get(name)!({ agent: { id } }); },
    };
  }

  it("clears a mark when the agent starts a new turn or is archived, and keeps the others", async () => {
    const marks = createStopMarks(path, now);
    await marks.mark("agent-a");
    await marks.mark("agent-b");
    await marks.mark("agent-c");
    // A restarted server reads them back from the file.
    const server = setup();
    expect(await server.stopped()).toEqual(["agent-a", "agent-b", "agent-c"]);
    await server.event("agent.turn_started", "agent-a");
    await server.event("agent.archived", "agent-c");
    await server.event("agent.turn_started", "agent-unknown");
    expect(await server.stopped()).toEqual(["agent-b"]);
    expect(await ids(createStopMarks(path, now))).toEqual(["agent-b"]);
  });

  it("clears a read mark the same way: the next turn or the archive", async () => {
    const reads = createStopMarks(readsPath(), now);
    await reads.mark("agent-a");
    await reads.mark("agent-b");
    await reads.mark("agent-c");
    const server = setup();
    expect(await server.reads()).toEqual(["agent-a", "agent-b", "agent-c"]);
    await server.event("agent.turn_started", "agent-a");
    await server.event("agent.archived", "agent-c");
    expect(await server.reads()).toEqual(["agent-b"]);
  });
});
