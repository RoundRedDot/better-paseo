import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { PaseoApi, PaseoAgentListOptions } from "@getpaseo/client";
import { filterLanes, type TasksHandle, type TasksOptions } from "../../client/tasks/data";
import { useMultiHostTasks } from "../../client/tasks/data/multi-host";
import { EMPTY_FILTERS, LANE_ORDER } from "../../client/tasks/model";
import { at, createFakePaseo, makeAgent, makeWorkspace } from "./helpers/fake-paseo";
import "./helpers/quiet-renderer";

/**
 * `useHosts` and `getPaseoClient` are supplied by the app's bundle loader.
 * The test plays that loader: `hostState.hosts` is what `useHosts` returns
 * and `hostState.clients` is the table `getPaseoClient` reads.
 */
const hostState = vi.hoisted(() => ({
  hosts: [] as Array<{ serverId: string; label: string; status: "idle" | "connecting" | "online" | "offline" | "error" }>,
  clients: new Map<string, unknown>(),
}));

vi.mock("@getpaseo/plugin/client", () => ({
  useHosts: () => hostState.hosts,
  getPaseoClient: (serverId: string) => {
    const client = hostState.clients.get(serverId);
    if (!client) throw new Error(`no client for ${serverId}`);
    return client;
  },
}));

vi.mock("react-native", () => import("./helpers/rn-mock"));

// React 19 wants the act environment flag; the test process is the whole renderer.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type Fake = {
  paseo: PaseoApi;
  calls: ReadonlyArray<{ method: string; input: unknown }>;
  openSubscriptions(): number;
  failNextAgentList(match?: (options: PaseoAgentListOptions) => boolean, message?: string): void;
};

const LOCAL = "host-1";
const REMOTE = "host-2";

const OPTIONS: TasksOptions = { doneWindow: "all", includeDone: true };

function mount(fake: Fake, selectedHostIds?: readonly string[], beforeRelease?: (paseo: PaseoApi) => void) {
  let current!: TasksHandle;
  function Probe() {
    current = useMultiHostTasks(fake.paseo, LOCAL, OPTIONS, selectedHostIds, beforeRelease);
    return null;
  }
  let renderer!: ReactTestRenderer;
  return {
    async render() {
      await act(async () => {
        renderer = create(React.createElement(Probe));
        for (let index = 0; index < 12; index += 1) await Promise.resolve();
      });
    },
    get current() {
      return current;
    },
    unmount: () => act(() => renderer.unmount()),
  };
}

function localFake(): Fake {
  const workspace = makeWorkspace({ id: "ws-local" });
  return createFakePaseo({
    agents: [makeAgent({ id: "local-agent", workspaceId: "ws-local", status: "running", updatedAt: at(1) })],
    workspaces: [workspace],
  });
}

function remoteFake(): Fake {
  const workspace = makeWorkspace({ id: "ws-remote" });
  return createFakePaseo({
    agents: [
      makeAgent({ id: "remote-running", workspaceId: "ws-remote", status: "running", updatedAt: at(2) }),
      makeAgent({ id: "remote-review", workspaceId: "ws-remote", status: "idle", requiresAttention: true, attentionReason: "finished", updatedAt: at(3) }),
    ],
    workspaces: [workspace],
  });
}

function twoHosts() {
  const local = localFake();
  const remote = remoteFake();
  hostState.hosts = [
    { serverId: LOCAL, label: "Here", status: "online" },
    { serverId: REMOTE, label: "Remote", status: "online" },
  ];
  hostState.clients = new Map<string, unknown>([[LOCAL, local.paseo], [REMOTE, remote.paseo]]);
  return { local, remote, mounted: mount(local) };
}

describe("multi-host board", () => {
  it("merges both hosts' cards into unified lanes, tagged with their host", async () => {
    const { local, mounted } = twoHosts();
    await mounted.render();
    try {
      expect(mounted.current.lanes.running.cards.map((card) => card.id).sort()).toEqual(["local-agent", "remote-running"]);
      expect(mounted.current.byId.get("local-agent")).toMatchObject({ hostId: LOCAL, hostLabel: "Here" });
      expect(mounted.current.byId.get("remote-running")).toMatchObject({ hostId: REMOTE, hostLabel: "Remote" });
      expect(mounted.current.byId.get("remote-review")).toMatchObject({ hostId: REMOTE, hostLabel: "Remote" });
      expect(mounted.current.ready).toBe(true);
      expect(mounted.current.error).toBeNull();
      // The remote's subscriptions stay open alongside the local board's.
      expect(local.openSubscriptions()).toBeGreaterThan(0);
    } finally {
      await mounted.unmount();
    }
  });

  it("sums lane counts across hosts", async () => {
    const { mounted } = twoHosts();
    await mounted.render();
    try {
      expect(mounted.current.counts).toEqual({
        needsInput: mounted.current.lanes.needs_input.cards.length,
        running: 2,
        review: 1,
        done: mounted.current.lanes.done.cards.length,
        archived: mounted.current.lanes.archived.cards.length,
      });
      expect(LANE_ORDER.every((lane) => mounted.current.lanes[lane].cards.every((card) => card.hostId !== undefined))).toBe(true);
    } finally {
      await mounted.unmount();
    }
  });

  it("narrows to the selected hosts through filterLanes", async () => {
    const { mounted } = twoHosts();
    await mounted.render();
    try {
      const shown = filterLanes(mounted.current.lanes, { ...EMPTY_FILTERS, hostIds: [LOCAL] });
      const ids = LANE_ORDER.flatMap((lane) => shown[lane].cards.map((card) => card.id));
      expect(ids).toContain("local-agent");
      expect(ids).not.toContain("remote-running");
      expect(ids).not.toContain("remote-review");
    } finally {
      await mounted.unmount();
    }
  });

  it("reads only the selected hosts when the board is opened with host params", async () => {
    const local = localFake();
    const remote = remoteFake();
    hostState.hosts = [
      { serverId: LOCAL, label: "Here", status: "online" },
      { serverId: REMOTE, label: "Remote", status: "online" },
    ];
    hostState.clients = new Map<string, unknown>([[LOCAL, local.paseo], [REMOTE, remote.paseo]]);
    const mounted = mount(local, [LOCAL]);
    await mounted.render();
    try {
      expect(mounted.current.byId.has("local-agent")).toBe(true);
      expect(mounted.current.byId.has("remote-running")).toBe(false);
    } finally {
      await mounted.unmount();
    }
  });

  it("refreshes every host", async () => {
    const { local, remote, mounted } = twoHosts();
    await mounted.render();
    const beforeLocal = local.calls.filter((call) => call.method === "agents.list").length;
    const beforeRemote = remote.calls.filter((call) => call.method === "agents.list").length;
    try {
      let result: string | undefined;
      await act(async () => {
        void mounted.current.refresh().then((value) => { result = value; });
        for (let index = 0; index < 12; index += 1) await Promise.resolve();
      });
      expect(result).toBe("done");
      expect(local.calls.filter((call) => call.method === "agents.list").length).toBeGreaterThan(beforeLocal);
      expect(remote.calls.filter((call) => call.method === "agents.list").length).toBeGreaterThan(beforeRemote);
      expect(mounted.current.byId.has("remote-review")).toBe(true);
    } finally {
      await mounted.unmount();
    }
  });

  it("reports no error while one host answers, and all their errors once every host fails", async () => {
    const local = localFake();
    const remote = remoteFake();
    hostState.hosts = [
      { serverId: LOCAL, label: "Here", status: "online" },
      { serverId: REMOTE, label: "Remote", status: "online" },
    ];
    hostState.clients = new Map<string, unknown>([[LOCAL, local.paseo], [REMOTE, remote.paseo]]);
    const mounted = mount(local);
    await mounted.render();
    try {
      // The local list still lands, so a remote failure alone does not blank the board.
      remote.failNextAgentList(() => true, "remote down");
      await act(async () => {
        void mounted.current.refresh();
        for (let index = 0; index < 12; index += 1) await Promise.resolve();
      });
      expect(mounted.current.error).toBeNull();
      expect(mounted.current.byId.has("local-agent")).toBe(true);

      local.failNextAgentList(() => true, "local down");
      remote.failNextAgentList(() => true, "remote down");
      await act(async () => {
        void mounted.current.refresh();
        for (let index = 0; index < 12; index += 1) await Promise.resolve();
      });
      expect(mounted.current.error).toBe("local down; remote down");
    } finally {
      await mounted.unmount();
    }
  });

  it("includes the local host even when useHosts does not list it yet", async () => {
    hostState.hosts = [];
    hostState.clients = new Map();
    const local = localFake();
    const mounted = mount(local);
    await mounted.render();
    try {
      expect(mounted.current.byId.get("local-agent")).toMatchObject({ hostId: LOCAL, hostLabel: "This host" });
    } finally {
      await mounted.unmount();
    }
  });
});
