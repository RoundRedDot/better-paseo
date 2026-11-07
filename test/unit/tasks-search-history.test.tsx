import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { setTasksArchivedLane, useTasks, type TasksHandle } from "../../client/tasks/data";
import { useSearchHistory } from "../../client/tasks/board/search-history";
import { createFakePaseo, makeAgent } from "./helpers/fake-paseo";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("loads every history page during search and restores the selected time window afterwards", async () => {
  const agents = Array.from({ length: 120 }, (_, i) => {
    const time = new Date(Date.now() - (i === 0 ? 1000 : (i + 10) * 86400000)).toISOString();
    return makeAgent({ id: `history-${i}`, title: i === 119 ? "needle" : "other", status: "idle", requiresAttention: false, updatedAt: time, lastUserMessageAt: time });
  });
  const fake = createFakePaseo({ agents });
  let searching = false;
  let tasks!: TasksHandle;
  let loading = false;
  function Probe() {
    tasks = useTasks(fake.paseo, { doneWindow: searching ? "all" : "24h", includeDone: true });
    loading = useSearchHistory(tasks, searching ? "needle" : "", true);
    return null;
  }
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<Probe />); });
  expect(tasks.lanes.done.cards).toHaveLength(1);
  searching = true;
  await act(async () => { tree.update(<Probe />); for (let i = 0; i < 30; i++) await Promise.resolve(); });
  expect(tasks.lanes.done.cards).toHaveLength(120);
  expect(tasks.lanes.done.cards.some((card) => card.title === "needle")).toBe(true);
  expect(loading).toBe(false);
  searching = false;
  await act(async () => { tree.update(<Probe />); });
  expect(tasks.lanes.done.cards.map((card) => card.id)).toEqual(["history-0"]);
  await act(async () => { tree.unmount(); });
});

it("stops on a page failure and retries on a new query", async () => {
  const agents = Array.from({ length: 80 }, (_, i) => makeAgent({ id: `failed-${i}`, status: "idle", requiresAttention: false }));
  const fake = createFakePaseo({ agents });
  fake.failNextAgentList((options) => Boolean(options.page?.cursor), "history page failed");
  let tasks!: TasksHandle;
  let loading = false;
  let query = "query";
  function Probe() {
    tasks = useTasks(fake.paseo, { doneWindow: "all", includeDone: true });
    loading = useSearchHistory(tasks, query, true);
    return null;
  }
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<Probe />); for (let i = 0; i < 30; i++) await Promise.resolve(); });
  expect(tasks.historyError).toBe("history page failed");
  expect(loading).toBe(false);
  expect(fake.calls.filter((call) => call.method === "agents.list" && Boolean((call.input as { page?: { cursor?: string } }).page?.cursor))).toHaveLength(1);
  query = "another";
  await act(async () => { tree.update(<Probe />); for (let i = 0; i < 30; i++) await Promise.resolve(); });
  expect(tasks.lanes.done.cards).toHaveLength(80);
  await act(async () => { tree.unmount(); });
});

it("continues history loading when another subscription reports an error", async () => {
  const agents = Array.from({ length: 80 }, (_, i) => makeAgent({ id: `unrelated-${i}`, status: "idle", requiresAttention: false }));
  const fake = createFakePaseo({ agents });
  let tasks!: TasksHandle;
  let query = "";
  function Probe() {
    tasks = useTasks(fake.paseo, { doneWindow: "all", includeDone: true });
    useSearchHistory(tasks, query, true);
    return null;
  }
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<Probe />); });
  fake.failNextAgentList((options) => !options.page?.cursor, "unrelated list error");
  await act(async () => { void tasks.refresh(); for (let i = 0; i < 30; i++) await Promise.resolve(); });
  expect(tasks.error).toBe("unrelated list error");
  query = "query";
  await act(async () => { tree.update(<Probe />); for (let i = 0; i < 30; i++) await Promise.resolve(); });
  expect(tasks.lanes.done.cards).toHaveLength(80);
  expect(tasks.historyError).toBeNull();
  await act(async () => { tree.unmount(); });
});

it("ignores a failed page from a cleared search even if the same query is entered again", async () => {
  const agents = Array.from({ length: 80 }, (_, i) => makeAgent({ id: `cancel-${i}`, status: "idle", requiresAttention: false }));
  const fake = createFakePaseo({ agents });
  const api = fake.paseo.agents;
  const list = api.list.bind(api);
  let rejectPage!: (error: Error) => void;
  let held = false;
  api.list = ((options: Parameters<typeof list>[0]) => {
    if (options?.page?.cursor && !held) { held = true; return new Promise((_resolve, reject) => { rejectPage = reject; }); }
    return list(options);
  }) as typeof api.list;
  let query = "query";
  let tasks!: TasksHandle;
  function Probe() {
    tasks = useTasks(fake.paseo, { doneWindow: "all", includeDone: true });
    useSearchHistory(tasks, query, true);
    return null;
  }
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<Probe />); for (let i = 0; i < 20; i++) await Promise.resolve(); });
  expect(held).toBe(true);
  query = "";
  await act(async () => { tree.update(<Probe />); });
  query = "query";
  await act(async () => { tree.update(<Probe />); });
  await act(async () => { rejectPage(new Error("cancelled")); for (let i = 0; i < 30; i++) await Promise.resolve(); });
  expect(tasks.historyError).toBeNull();
  expect(tasks.lanes.done.cards).toHaveLength(80);
  await act(async () => { tree.unmount(); });
});

it.each(["archive", "refresh"] as const)("resumes history paging after %s interrupts an in-flight page", async (change) => {
  const agents = Array.from({ length: 120 }, (_, i) => makeAgent({ id: `resume-${i}`, status: "idle", requiresAttention: false }));
  const fake = createFakePaseo({ agents });
  const api = fake.paseo.agents;
  const list = api.list.bind(api);
  let rejectPage!: (error: Error) => void;
  let held = false;
  api.list = ((options: Parameters<typeof list>[0]) => {
    if (options?.page?.cursor && !held) {
      held = true;
      return new Promise((_resolve, reject) => { rejectPage = reject; });
    }
    return list(options);
  }) as typeof api.list;
  let query = "";
  let tasks!: TasksHandle;
  let loading = false;
  function Probe() {
    tasks = useTasks(fake.paseo, { doneWindow: query ? "all" : "24h", includeDone: true, includeArchived: change === "archive" && switched });
    loading = useSearchHistory(tasks, query, true);
    return null;
  }
  let switched = false;
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<Probe />); });
  query = "search";
  await act(async () => { tree.update(<Probe />); for (let i = 0; i < 20; i++) await Promise.resolve(); });
  expect(held).toBe(true);
  const release = fake.holdReady();
  await act(async () => {
    if (change === "archive") { switched = true; setTasksArchivedLane(fake.paseo, true); tree.update(<Probe />); }
    else void tasks.refresh();
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
  await act(async () => { rejectPage(new Error("stale page")); release(); for (let i = 0; i < 60; i++) await Promise.resolve(); });
  expect(tasks.error).toBeNull();
  expect(tasks.historyError).toBeNull();
  expect(tasks.lanes.done.cards).toHaveLength(120);
  expect(loading).toBe(false);
  await act(async () => { tree.unmount(); });
});

it("does not request another page after search is cleared", async () => {
  const loadMoreSearch = vi.fn();
  const tasks = { ready: true, error: null, lanes: { done: { loading: false, hasMore: true } }, loadMoreSearch } as unknown as TasksHandle;
  function Probe({ searching }: { searching: boolean }) {
    useSearchHistory(tasks, searching ? "needle" : "", true);
    return null;
  }
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<Probe searching />); });
  expect(loadMoreSearch).toHaveBeenCalledTimes(1);
  tasks.lanes.done.loading = true;
  await act(async () => { tree.update(<Probe searching={false} />); });
  tasks.lanes.done.loading = false;
  await act(async () => { tree.update(<Probe searching={false} />); });
  expect(loadMoreSearch).toHaveBeenCalledTimes(1);
  await act(async () => { tree.unmount(); });
});

it("keeps normal pages but releases search pages and restores the cursor on close", async () => {
  const fake = createFakePaseo({ agents: Array.from({ length: 160 }, (_, i) => makeAgent({ id: `owned-${i}`, status: "idle", requiresAttention: false })) });
  let query = "";
  let tasks!: TasksHandle;
  function Probe() {
    tasks = useTasks(fake.paseo, { doneWindow: "all", includeDone: true });
    useSearchHistory(tasks, query, true);
    return null;
  }
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<Probe />); });
  await act(async () => { tasks.loadMoreDone(); for (let i = 0; i < 20; i++) await Promise.resolve(); });
  expect(tasks.lanes.done.cards).toHaveLength(100);
  query = "find";
  await act(async () => { tree.update(<Probe />); for (let i = 0; i < 30; i++) await Promise.resolve(); });
  expect(tasks.lanes.done.cards).toHaveLength(160);
  query = "";
  await act(async () => { tree.update(<Probe />); });
  expect(tasks.lanes.done.cards).toHaveLength(100);
  expect(tasks.lanes.done.hasMore).toBe(true);
  await act(async () => { tasks.loadMoreDone(); for (let i = 0; i < 20; i++) await Promise.resolve(); });
  expect(tasks.lanes.done.cards).toHaveLength(150);
  await act(async () => { tree.unmount(); });
});

it("does not restore search pages when search closes while refresh waits for its first page", async () => {
  const fake = createFakePaseo({ agents: Array.from({ length: 160 }, (_, i) => makeAgent({ id: `refresh-close-${i}`, status: "idle", requiresAttention: false })) });
  let query = "";
  let tasks!: TasksHandle;
  function Probe() { tasks = useTasks(fake.paseo, { doneWindow: "all", includeDone: true }); useSearchHistory(tasks, query, true); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<Probe />); });
  await act(async () => { tasks.loadMoreDone(); for (let i = 0; i < 20; i++) await Promise.resolve(); });
  query = "find";
  await act(async () => { tree.update(<Probe />); for (let i = 0; i < 30; i++) await Promise.resolve(); });
  expect(tasks.lanes.done.cards).toHaveLength(160);
  const release = fake.holdReady();
  await act(async () => { void tasks.refresh(); for (let i = 0; i < 15; i++) await Promise.resolve(); });
  query = "";
  await act(async () => { tree.update(<Probe />); });
  await act(async () => { release(); for (let i = 0; i < 60; i++) await Promise.resolve(); });
  expect(tasks.lanes.done.cards).toHaveLength(100);
  expect(tasks.lanes.done.hasMore).toBe(true);
  await act(async () => { tree.unmount(); });
});

it("ignores a failed search-only refresh page after search closes", async () => {
  const fake = createFakePaseo({ agents: Array.from({ length: 160 }, (_, i) => makeAgent({ id: `refresh-reject-${i}`, status: "idle", requiresAttention: false })) });
  let query = "";
  let tasks!: TasksHandle;
  function Probe() { tasks = useTasks(fake.paseo, { doneWindow: "all", includeDone: true }); useSearchHistory(tasks, query, true); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<Probe />); });
  await act(async () => { tasks.loadMoreDone(); for (let i = 0; i < 20; i++) await Promise.resolve(); });
  query = "find";
  await act(async () => { tree.update(<Probe />); for (let i = 0; i < 30; i++) await Promise.resolve(); });
  const list = fake.paseo.agents.list.bind(fake.paseo.agents);
  let reject!: (error: Error) => void;
  vi.spyOn(fake.paseo.agents, "list").mockImplementation((options) => options?.page?.cursor === "100"
    ? new Promise((_resolve, fail) => { reject = fail; }) : list(options));
  let outcome: string | undefined;
  await act(async () => { void tasks.refresh().then((value) => { outcome = value; }); for (let i = 0; i < 40; i++) await Promise.resolve(); });
  expect(reject).toBeTypeOf("function");
  query = "";
  await act(async () => { tree.update(<Probe />); });
  await act(async () => { reject(new Error("stale search page")); for (let i = 0; i < 30; i++) await Promise.resolve(); });
  expect(tasks.error).toBeNull();
  expect(outcome).toBe("done");
  expect(tasks.lanes.done.cards).toHaveLength(100);
  await act(async () => { tree.unmount(); });
});

it("uses the refreshed normal-page cursor when a new search starts during refresh", async () => {
  const fake = createFakePaseo({ agents: Array.from({ length: 160 }, (_, i) => makeAgent({ id: `refresh-cursor-${i}`, status: "idle", requiresAttention: false })) });
  let query = "";
  let tasks!: TasksHandle;
  function Probe() { tasks = useTasks(fake.paseo, { doneWindow: "all", includeDone: true }); useSearchHistory(tasks, query, true); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<Probe />); });
  await act(async () => { tasks.loadMoreDone(); for (let i = 0; i < 20; i++) await Promise.resolve(); });
  query = "first";
  await act(async () => { tree.update(<Probe />); for (let i = 0; i < 30; i++) await Promise.resolve(); });
  const list = fake.paseo.agents.list.bind(fake.paseo.agents);
  vi.spyOn(fake.paseo.agents, "list").mockImplementation(async (options) => {
    const result = await list(options);
    if (!options?.subscribe || !options.filter?.statuses?.includes("idle") || !result.subscription) return result;
    const ready = result.subscription.ready.then((snapshot) => ({ ...snapshot, pageInfo: { ...snapshot.pageInfo, nextCursor: "51" } }));
    return { ...result, subscription: { ...result.subscription, ready } };
  });
  const release = fake.holdReady();
  await act(async () => { void tasks.refresh(); for (let i = 0; i < 15; i++) await Promise.resolve(); });
  query = "";
  await act(async () => { tree.update(<Probe />); });
  query = "second";
  await act(async () => { tree.update(<Probe />); });
  await act(async () => { release(); for (let i = 0; i < 60; i++) await Promise.resolve(); });
  query = "";
  await act(async () => { tree.update(<Probe />); });
  fake.calls.length = 0;
  await act(async () => { tasks.loadMoreDone(); for (let i = 0; i < 20; i++) await Promise.resolve(); });
  expect(fake.calls.find((call) => call.method === "agents.list")?.input).toMatchObject({ page: { cursor: "101" } });
  await act(async () => { tree.unmount(); });
});

it("keeps shared search pages until the last search ends", async () => {
  const fake = createFakePaseo({ agents: Array.from({ length: 120 }, (_, i) => makeAgent({ id: `shared-history-${i}`, status: "idle", requiresAttention: false })) });
  let a = "find", b = "find";
  let tasks!: TasksHandle;
  function Search({ query }: { query: string }) { const current = useTasks(fake.paseo, { doneWindow: "all", includeDone: true }); tasks = current; useSearchHistory(current, query, true); return null; }
  function Probe() { return <><Search query={a} /><Search query={b} /></>; }
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<Probe />); for (let i = 0; i < 40; i++) await Promise.resolve(); });
  expect(tasks.lanes.done.cards).toHaveLength(120);
  a = "";
  await act(async () => { tree.update(<Probe />); });
  expect(tasks.lanes.done.cards).toHaveLength(120);
  b = "";
  await act(async () => { tree.update(<Probe />); });
  expect(tasks.lanes.done.cards).toHaveLength(50);
  await act(async () => { tree.unmount(); });
});

it("discards an in-flight page after cancellation, and resumes when requested", async () => {
  const fake = createFakePaseo({ agents: Array.from({ length: 80 }, (_, i) => makeAgent({ id: `pause-${i}`, status: "idle", requiresAttention: false })) });
  const api = fake.paseo.agents;
  const list = api.list.bind(api);
  let release!: () => void;
  let held = false;
  api.list = ((options: Parameters<typeof list>[0]) => {
    if (options?.page?.cursor && !held) { held = true; return new Promise((resolve) => { release = () => { void list(options).then(resolve); }; }); }
    return list(options);
  }) as typeof api.list;
  let cancelled = false;
  let tasks!: TasksHandle;
  function Probe() {
    tasks = useTasks(fake.paseo, { doneWindow: "all", includeDone: true });
    useSearchHistory(tasks, "find", true, cancelled);
    return null;
  }
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<Probe />); for (let i = 0; i < 20; i++) await Promise.resolve(); });
  expect(held).toBe(true);
  cancelled = true;
  await act(async () => { tree.update(<Probe />); });
  await act(async () => { release(); for (let i = 0; i < 20; i++) await Promise.resolve(); });
  expect(tasks.lanes.done.cards).toHaveLength(50);
  cancelled = false;
  await act(async () => { tree.update(<Probe />); for (let i = 0; i < 30; i++) await Promise.resolve(); });
  expect(tasks.lanes.done.cards).toHaveLength(80);
  await act(async () => { tree.unmount(); });
});
