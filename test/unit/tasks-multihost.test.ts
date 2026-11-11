/**
 * One board for every connected Paseo host (`client/tasks/data/hosts.ts`):
 * which hosts the board reads, how their lanes merge, where an agent's calls
 * go, and what the host filter keeps.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { filterLanes, remoteTasksSnapshot, setLastTurnLoader, setReadMarksLoader, setSubagentLoader, subscribeRemoteTasks, withSubagentCards, type TasksHandle } from "../../client/tasks/data";
import { awayNotice, boardHosts, hostMethods, mergeHostTasks, readHostApis, useMergedTasks, routedPaseo, scopedId, stampCard, unscopeId, type BoardHosts, type HostSummary, type RemoteTasks } from "../../client/tasks/data/hosts";
import { EMPTY_FILTERS, LANE_ORDER, remoteCard, type LaneId, type LaneModel, type TaskCard } from "../../client/tasks/model";
import { sampleCards } from "../../client/tasks/sample-cards";
import { activeChips, buildFilterOptions, clearedParams } from "../../client/tasks/board/filter-options";
import { EMPTY_PARAMS, activeFilterCount, decodeBoardParams, encodeBoardParams, resolveBoardParams } from "../../client/tasks/board/params";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";
import { at, createFakePaseo, makeAgent, makeWorkspace } from "./helpers/fake-paseo";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));

const NOW = Date.parse("2026-10-20T12:00:00Z");
const OWN = { id: "srv-own", label: "This Mac" };

function lanesOf(cards: TaskCard[]): Record<LaneId, LaneModel> {
  return Object.fromEntries(LANE_ORDER.map((id) => [id, { id, cards: cards.filter((card) => card.lane === id), hasMore: false, loading: false }])) as Record<LaneId, LaneModel>;
}

function handle(cards: TaskCard[], extra: Partial<TasksHandle> = {}): TasksHandle {
  const lanes = lanesOf(cards);
  return {
    lanes,
    counts: { needsInput: lanes.needs_input.cards.length, running: lanes.running.cards.length, review: lanes.review.cards.length, done: lanes.done.cards.length, archived: lanes.archived.cards.length },
    byId: new Map(cards.map((card) => [card.id, card])),
    workspaces: [],
    providers: [],
    labels: [],
    ready: true,
    error: null,
    refresh: vi.fn(async () => "done" as const),
    loadMoreDone: vi.fn(),
    resolveParent: vi.fn(),
    refreshParent: vi.fn(async () => false),
    refreshReads: vi.fn(),
    refreshUnreads: vi.fn(),
    requestProjectIcon: vi.fn(),
    ...extra,
  };
}

function card(id: string, overrides: Partial<TaskCard> = {}): TaskCard {
  const base = sampleCards(NOW).find((sample) => sample.id === "sample-running")!;
  return { ...base, id, title: id, children: [], parent: null, ...overrides };
}

function running(id: string, startedMinutesAgo: number, overrides: Partial<TaskCard> = {}): TaskCard {
  const base = card(id, overrides);
  return { ...base, lane: "running", status: "running", timing: { ...base.timing, turnStartedAt: new Date(NOW - startedMinutesAgo * 60_000).toISOString() } };
}

const fakeApi = (name: string) => ({ name } as unknown as PaseoApi);

function twoHosts(remote = fakeApi("remote")): BoardHosts {
  return {
    multi: true,
    all: [OWN, { id: "srv-remote", label: "remote-box" }],
    remotes: [{ id: "srv-remote", label: "remote-box", api: remote }],
    away: [],
  };
}

describe("readHostApis", () => {
  it("takes useHosts and getPaseoClient only when the app supplies both", () => {
    const useHosts = () => [];
    const getPaseoClient = () => fakeApi("x");
    expect(readHostApis({ useHosts, getPaseoClient })).toEqual({ useHosts, getPaseoClient });
    expect(readHostApis({ useHosts })).toBeNull();
    expect(readHostApis({})).toBeNull();
    expect(readHostApis(null)).toBeNull();
  });

  it("treats a module that throws on a missing name as an older Paseo", () => {
    const strict = new Proxy({}, { get: (_target, key) => { throw new Error(`No "${String(key)}" export`); } });
    expect(readHostApis(strict)).toBeNull();
  });
});

describe("boardHosts", () => {
  const connect = (id: string) => (id === "srv-remote" ? fakeApi(id) : null);

  it("is one host while Paseo lists no other", () => {
    expect(boardHosts(OWN, [], connect)).toEqual({ multi: false, all: [OWN], remotes: [], away: [] });
    expect(boardHosts(OWN, [{ serverId: OWN.id, label: "Laptop", status: "online" }], connect)).toEqual({ multi: false, all: [{ id: OWN.id, label: "Laptop" }], remotes: [], away: [] });
  });

  it("reads an online host and names one offline, reconnecting or without an API", () => {
    const hosts: HostSummary[] = [
      { serverId: OWN.id, label: "This Mac", status: "online" },
      { serverId: "srv-remote", label: "remote-box", status: "online" },
      { serverId: "srv-off", label: "off-box", status: "offline" },
      { serverId: "srv-back", label: "back-box", status: "connecting" },
      { serverId: "srv-noapi", label: "noapi-box", status: "online" },
    ];
    const result = boardHosts(OWN, hosts, connect);
    expect(result.multi).toBe(true);
    expect(result.all.map((host) => host.label)).toEqual(["This Mac", "remote-box", "off-box", "back-box", "noapi-box"]);
    expect(result.remotes.map((host) => host.id)).toEqual(["srv-remote"]);
    expect(result.away).toEqual([
      { id: "srv-off", label: "off-box", status: "offline" },
      { id: "srv-back", label: "back-box", status: "connecting" },
      { id: "srv-noapi", label: "noapi-box", status: "connecting" },
    ]);
  });
});

describe("mergeHostTasks", () => {
  it("returns the board's own data untouched with one host", () => {
    const own = handle([running("a", 5)]);
    const merged = mergeHostTasks(own, { multi: false, all: [OWN], remotes: [], away: [] }, []);
    expect(merged.tasks).toBe(own);
    expect(merged.routes.size).toBe(0);
  });

  it("puts every host's cards in one lane in the lane's own order, each with its host", () => {
    const own = handle([running("local-new", 2), running("local-old", 30)]);
    const remote = handle([running("remote-mid", 10)]);
    const hosts = twoHosts();
    const merged = mergeHostTasks(own, hosts, [{ host: hosts.remotes[0]!, tasks: remote }]);
    // Running: oldest first, across hosts.
    expect(merged.tasks.lanes.running.cards.map((item) => item.id)).toEqual(["local-old", "remote-mid", "local-new"]);
    const byId = merged.tasks.byId;
    expect(byId.get("local-old")?.host).toEqual({ id: OWN.id, label: OWN.label, remote: false });
    expect(byId.get("remote-mid")?.host).toEqual({ id: "srv-remote", label: "remote-box", remote: true });
    expect(remoteCard(byId.get("remote-mid")!)).toBe(true);
    expect(remoteCard(byId.get("local-old")!)).toBe(false);
    expect(merged.tasks.counts.running).toBe(3);
    expect(merged.tasks.hosts).toEqual(hosts.all);
  });

  it("scopes a remote host's workspace and project ids so two daemons' ids cannot meet", () => {
    const shared = { workspaceId: "ws-1", projectId: "prj-1" };
    const own = handle([running("local", 2, { location: { ...card("x").location, ...shared } })], {
      workspaces: [{ id: "ws-1", name: "main", projectId: "prj-1", projectName: "app" }],
    });
    const remote = handle([running("remote", 3, { location: { ...card("y").location, ...shared } })], {
      workspaces: [{ id: "ws-1", name: "main", projectId: "prj-1", projectName: "app" }],
    });
    const hosts = twoHosts();
    const merged = mergeHostTasks(own, hosts, [{ host: hosts.remotes[0]!, tasks: remote }]);
    expect(merged.tasks.byId.get("local")!.location.workspaceId).toBe("ws-1");
    expect(merged.tasks.byId.get("remote")!.location.workspaceId).toBe(scopedId("srv-remote", "ws-1"));
    expect(merged.tasks.byId.get("remote")!.location.projectId).toBe(scopedId("srv-remote", "prj-1"));
    expect(merged.tasks.workspaces.map((workspace) => workspace.id).sort()).toEqual(["srv-remote/ws-1", "ws-1"]);
    expect(unscopeId("srv-remote/ws-1", ["srv-remote"])).toEqual({ hostId: "srv-remote", id: "ws-1" });
    expect(unscopeId("ws-1", ["srv-remote"])).toBeNull();
    // A project icon goes to the host that owns the project, by its own id.
    merged.tasks.requestProjectIcon("srv-remote/prj-1");
    merged.tasks.requestProjectIcon("prj-1");
    expect(remote.requestProjectIcon).toHaveBeenCalledWith("prj-1");
    expect(own.requestProjectIcon).toHaveBeenCalledWith("prj-1");
    expect(own.requestProjectIcon).toHaveBeenCalledTimes(1);
  });

  it("routes a remote card, its children and its parent to its host, and keeps card identity across merges", () => {
    const child = { id: "remote-child", title: "child", status: "running" as const };
    const remoteCardModel = running("remote-parent", 3, { children: [child], parent: { id: "remote-grandparent", title: null, missing: true, archived: null } });
    const own = handle([running("local", 1)]);
    const remote = handle([remoteCardModel]);
    const hosts = twoHosts();
    const first = mergeHostTasks(own, hosts, [{ host: hosts.remotes[0]!, tasks: remote }]);
    expect([...first.routes]).toEqual(expect.arrayContaining([["remote-parent", "srv-remote"], ["remote-child", "srv-remote"], ["remote-grandparent", "srv-remote"]]));
    expect(first.routes.has("local")).toBe(false);
    const second = mergeHostTasks(own, hosts, [{ host: hosts.remotes[0]!, tasks: remote }]);
    expect(second.tasks.byId.get("remote-parent")).toBe(first.tasks.byId.get("remote-parent"));
    expect(second.tasks.byId.get("local")).toBe(first.tasks.byId.get("local"));
    // A parent lookup goes to the card's host.
    void first.tasks.refreshParent("remote-grandparent");
    first.tasks.resolveParent("remote-grandparent");
    expect(remote.refreshParent).toHaveBeenCalledWith("remote-grandparent");
    expect(remote.resolveParent).toHaveBeenCalledWith("remote-grandparent");
    expect(own.refreshParent).not.toHaveBeenCalled();
  });

  it("pages, refreshes and reads marks per host", async () => {
    const done = card("remote-done", { lane: "done", status: "done" });
    const own = handle([running("local", 1)]);
    const remote = handle([done]);
    remote.lanes.done = { ...remote.lanes.done, hasMore: true };
    const hosts = twoHosts();
    const merged = mergeHostTasks(own, hosts, [{ host: hosts.remotes[0]!, tasks: remote }]);
    expect(merged.tasks.lanes.done.hasMore).toBe(true);
    merged.tasks.loadMoreDone();
    expect(remote.loadMoreDone).toHaveBeenCalledTimes(1);
    expect(own.loadMoreDone).not.toHaveBeenCalled();
    await expect(merged.tasks.refresh()).resolves.toBe("done");
    expect(own.refresh).toHaveBeenCalled();
    expect(remote.refresh).toHaveBeenCalled();
    remote.refresh = vi.fn(async () => "failed" as const);
    await expect(mergeHostTasks(own, hosts, [{ host: hosts.remotes[0]!, tasks: remote }]).tasks.refresh()).resolves.toBe("failed");
    // Read and unread marks are this plugin server's: the board's own host only.
    merged.tasks.refreshReads();
    expect(own.refreshReads).toHaveBeenCalled();
    expect(remote.refreshReads).not.toHaveBeenCalled();
  });

  it("keeps the handle's calls the same across merges, acting on the latest parts", () => {
    // The board's effects key on these calls: `useSearchHistory` begins a history
    // search again whenever `beginHistorySearch` changes, and that updates the
    // stores, which merge again. New calls per merge looped until React gave up.
    const hosts = twoHosts();
    const first = handle([running("local", 1)], { beginHistorySearch: vi.fn(), endHistorySearch: vi.fn(), loadMoreSearch: vi.fn() });
    const second = handle([running("local", 2)], { beginHistorySearch: vi.fn(), endHistorySearch: vi.fn(), loadMoreSearch: vi.fn() });
    const remote = handle([running("remote", 3)], { beginHistorySearch: vi.fn() });
    let current: TasksHandle | null = null;
    function Probe(props: { own: TasksHandle }) {
      current = useMergedTasks(props.own, hosts, [{ host: hosts.remotes[0]!, tasks: remote }]).tasks;
      return null;
    }
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(Probe, { own: first })); });
    const before = current!;
    act(() => { renderer.update(React.createElement(Probe, { own: second })); });
    const after = current!;
    expect(after).not.toBe(before);
    for (const key of ["refresh", "loadMoreDone", "loadMoreSearch", "beginHistorySearch", "endHistorySearch", "resolveParent", "refreshParent", "requestProjectIcon"] as const) {
      expect(after[key], key).toBe(before[key]);
    }
    const owner = {};
    before.beginHistorySearch!(owner);
    expect(second.beginHistorySearch).toHaveBeenCalledWith(owner);
    expect(first.beginHistorySearch).not.toHaveBeenCalled();
    expect(remote.beginHistorySearch).toHaveBeenCalledWith(owner);
    act(() => renderer.unmount());
  });

  it("routes calls made by hostMethods to the host that holds the agent", () => {
    const own = handle([]);
    const remote = handle([]);
    const hosts = twoHosts();
    const methods = hostMethods(() => ({ own, remotes: [{ host: hosts.remotes[0]!, tasks: remote }], routes: new Map([["remote-agent", "srv-remote"]]) }));
    methods.resolveParent("remote-agent");
    methods.resolveParent("local-agent");
    expect(remote.resolveParent).toHaveBeenCalledWith("remote-agent");
    expect(own.resolveParent).toHaveBeenCalledWith("local-agent");
  });

  it("keeps a stamped card while its card and host hold", () => {
    const base = running("a", 1);
    const host = { id: "srv-remote", label: "remote-box", remote: true };
    expect(stampCard(base, host)).toBe(stampCard(base, host));
    expect(stampCard(base, { ...host, label: "renamed" })).not.toBe(stampCard(base, host));
  });
});

describe("routedPaseo", () => {
  it("resolves an agent on its own host and everything else on the board's", () => {
    const ownRef = vi.fn((agent: unknown) => ({ host: "own", agent }));
    const remoteRef = vi.fn((agent: unknown) => ({ host: "remote", agent }));
    const own = { agents: { ref: ownRef, list: vi.fn() }, workspaces: { list: vi.fn() } } as unknown as PaseoApi;
    const remote = { agents: { ref: remoteRef } } as unknown as PaseoApi;
    const routes = new Map([["remote-agent", remote]]);
    const routed = routedPaseo(own, (id) => routes.get(id) ?? null);
    expect(routed.agents.ref("remote-agent")).toEqual({ host: "remote", agent: "remote-agent" });
    expect(routed.agents.ref("local-agent")).toEqual({ host: "own", agent: "local-agent" });
    expect(routed.agents.ref({ id: "remote-agent" } as never)).toEqual({ host: "remote", agent: { id: "remote-agent" } });
    expect(routed.agents.list).toBe(own.agents.list);
    expect(routed.workspaces).toBe(own.workspaces);
  });
});

describe("host filter", () => {
  it("keeps only the picked hosts' cards and leaves a one-host board alone", () => {
    const own = handle([running("local", 1)]);
    const remote = handle([running("remote", 2)]);
    const hosts = twoHosts();
    const merged = mergeHostTasks(own, hosts, [{ host: hosts.remotes[0]!, tasks: remote }]);
    const ids = (filters: typeof EMPTY_FILTERS) => filterLanes(merged.tasks.lanes, filters).running.cards.map((item) => item.id);
    expect(ids(EMPTY_FILTERS)).toEqual(["remote", "local"]);
    expect(ids({ ...EMPTY_FILTERS, hosts: ["srv-remote"] })).toEqual(["remote"]);
    expect(ids({ ...EMPTY_FILTERS, hosts: [OWN.id] })).toEqual(["local"]);
    // A card without a host (one host on the board) is never left out by a stale pick.
    expect(filterLanes(own.lanes, { ...EMPTY_FILTERS, hosts: ["srv-remote"] }).running.cards.map((item) => item.id)).toEqual(["local"]);
  });

  it("keeps a provider subagent's card with its parent's host, and counts each host as its lanes show", () => {
    const parent = running("local-parent", 1);
    const sub = { id: "local-sub", title: "Explore", status: "running" as const, kind: "provider" as const, subagentType: "Explore", lane: "running" as const, timing: parent.timing };
    const own = handle([{ ...parent, children: [sub] }]);
    const remote = handle([running("remote", 2)]);
    const hosts = twoHosts();
    const merged = mergeHostTasks(own, hosts, [{ host: hosts.remotes[0]!, tasks: remote }]);
    const lanes = withSubagentCards(merged.tasks.lanes);
    expect(lanes.running.cards.find((item) => item.id === "local-sub")?.host).toEqual({ ...OWN, remote: false });
    const shown = (hostIds: string[]) => LANE_ORDER.flatMap((lane) => filterLanes(lanes, { ...EMPTY_FILTERS, hosts: hostIds })[lane].cards.map((item) => item.id)).sort();
    expect(shown(["srv-remote"])).toEqual(["remote"]);
    expect(shown([OWN.id])).toEqual(["local-parent", "local-sub"]);
    // Each host's chip counts what picking it shows.
    const options = buildFilterOptions(merged.tasks, EMPTY_PARAMS);
    for (const option of options.hosts!) expect(option.count).toBe(shown([option.id]).length);
    // One host: the subagent card has no host, as before.
    expect(withSubagentCards(own.lanes).running.cards.find((item) => item.id === "local-sub")).not.toHaveProperty("host");
  });

  it("lists every host with its cards, as a chip and in the params", () => {
    const own = handle([running("local", 1)]);
    const remote = handle([running("remote-1", 2), running("remote-2", 3)]);
    const hosts: BoardHosts = { ...twoHosts(), all: [...twoHosts().all, { id: "srv-off", label: "off-box" }], away: [{ id: "srv-off", label: "off-box", status: "offline" }] };
    const merged = mergeHostTasks(own, hosts, [{ host: hosts.remotes[0]!, tasks: remote }]);
    const params = { ...EMPTY_PARAMS, hosts: ["srv-remote"] };
    const options = buildFilterOptions(merged.tasks, params);
    expect(options.hosts).toEqual([
      { id: OWN.id, label: OWN.label, count: 1, on: false },
      { id: "srv-remote", label: "remote-box", count: 2, on: true },
      { id: "srv-off", label: "off-box", count: 0, on: false },
    ]);
    const strings = BOARD_STRINGS.en;
    const chips = activeChips(params, { hideSubtasks: false, doneWindow: "24h" }, options, strings);
    expect(chips.map((chip) => `${chip.kind}: ${chip.value}`)).toEqual(["Host: remote-box"]);
    expect(chips[0]!.clear(params).hosts).toEqual([]);
    expect(activeFilterCount(params, { hideSubtasks: false, doneWindow: "24h" })).toBe(1);
    expect(decodeBoardParams(encodeBoardParams(params))).toEqual(params);
    expect(resolveBoardParams(params, { hideSubtasks: false, doneWindow: "24h" }).filters.hosts).toEqual(["srv-remote"]);
    expect(clearedParams(params)).not.toHaveProperty("hosts");
    // One host: no host options, and a pick left from before shows no chip.
    const single = buildFilterOptions(own, params);
    expect(single.hosts).toBeUndefined();
    expect(activeChips(params, { hideSubtasks: false, doneWindow: "24h" }, single, strings)).toEqual([]);
  });
});

describe("awayNotice", () => {
  it("names the hosts whose cards are missing, once", () => {
    expect(awayNotice([], "en")).toBeNull();
    expect(awayNotice([{ id: "a", label: "remote-box", status: "offline" }], "en")).toBe("remote-box is offline; its tasks are hidden for now.");
    expect(awayNotice([{ id: "a", label: "remote-box", status: "connecting" }], "en")).toBe("Reconnecting to remote-box; its tasks return once connected.");
    expect(awayNotice([{ id: "a", label: "a-box", status: "offline" }, { id: "b", label: "b-box", status: "error" }], "en")).toBe("a-box and b-box are offline; their tasks are hidden for now.");
    expect(awayNotice([{ id: "a", label: "remote-box", status: "offline" }], "zh")).toBe("remote-box 已离线，它的任务暂不显示。");
  });
});

describe("remote store", () => {
  afterEach(() => {
    setLastTurnLoader(null);
    setSubagentLoader(null);
    setReadMarksLoader(null);
  });

  it("reads another host's agents through its own API and asks this plugin's server nothing", async () => {
    const lastTurns = vi.fn(async () => []);
    const subagents = vi.fn(async () => ({ version: "v", subagents: [] }));
    const reads = vi.fn(async () => []);
    setLastTurnLoader(lastTurns);
    setSubagentLoader(subagents);
    setReadMarksLoader(reads);
    const fake = createFakePaseo({
      agents: [makeAgent({ id: "remote-run", workspaceId: "ws", status: "running", updatedAt: at(1), lastUserMessageAt: at(1) })],
      workspaces: [makeWorkspace({ id: "ws", projectId: "prj", name: "app" })],
    });
    const listener = vi.fn();
    vi.useFakeTimers();
    const release = subscribeRemoteTasks(fake.paseo, listener, true);
    try {
      await vi.advanceTimersByTimeAsync(0);
      const snapshot = remoteTasksSnapshot(fake.paseo, { doneWindow: "24h", includeDone: true });
      expect(snapshot.ready).toBe(true);
      expect(snapshot.lanes.running.cards.map((item) => item.id)).toEqual(["remote-run"]);
      // A Mark read's follow-up, the subagent poll and a turn's end all leave the server alone.
      snapshot.refreshReads();
      fake.upsertAgent(makeAgent({ id: "remote-run", workspaceId: "ws", status: "idle", updatedAt: at(2), lastUserMessageAt: at(1) }));
      await vi.advanceTimersByTimeAsync(120_000);
      expect(lastTurns).not.toHaveBeenCalled();
      expect(subagents).not.toHaveBeenCalled();
      expect(reads).not.toHaveBeenCalled();
    } finally {
      release();
      vi.useRealTimers();
    }
  });
});
