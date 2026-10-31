import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { PaseoProject, PaseoProviderModelsResult } from "@getpaseo/client";
import { filterLanes, setLabelDefinitionsLoader, setTasksArchivedLane, setLastTurnLoader, setProjectIconsLoader, setReadMarksLoader, setSubagentLoader, useTaskCounts, useTasks, withActiveSubtasks, type CountScope, withLastTurn, withReadMark, withSubagentCards, withSubagents, type TasksHandle } from "../../client/tasks/data";
import type { ProviderSubagent } from "../../shared/tasks-rpc";
import { EMPTY_FILTERS, LANE_ORDER, type LaneId, type LaneModel, type TaskCard } from "../../client/tasks/model";
import { sampleCards } from "../../client/tasks/sample-cards";
import { fallbackLabelColor } from "../../client/tasks/label-colors";
import { cardStart, cardTimer, formatEnded } from "../../client/tasks/cards/card-time";
import { at, createFakePaseo, makeAgent, makePlacement, makeWorkspace } from "./helpers/fake-paseo";
import "./helpers/quiet-renderer";

const storeNotificationProbe = vi.hoisted(() => ({ enabled: false, count: 0 }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  const wrappedSubscriptions = new WeakMap<object, unknown>();
  return {
    ...react,
    useSyncExternalStore: (
      subscribe: Parameters<typeof react.useSyncExternalStore>[0],
      getSnapshot: Parameters<typeof react.useSyncExternalStore>[1],
      getServerSnapshot?: Parameters<typeof react.useSyncExternalStore>[2],
    ) => {
      let wrapped = wrappedSubscriptions.get(subscribe) as typeof subscribe | undefined;
      if (!wrapped) {
        wrapped = (onStoreChange) => subscribe(() => {
          if (storeNotificationProbe.enabled) storeNotificationProbe.count += 1;
          onStoreChange();
        });
        wrappedSubscriptions.set(subscribe, wrapped);
      }
      return react.useSyncExternalStore(wrapped, getSnapshot, getServerSnapshot);
    },
  };
});

vi.mock("react-native", () => import("./helpers/rn-mock"));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Fake = ReturnType<typeof createFakePaseo>;
type Renderer = ReturnType<typeof TestRenderer.create>;

const PROJECT: PaseoProject = {
  projectId: "project-id",
  projectKey: "project-key",
  projectDisplayName: "Project",
  projectRootPath: "/Users/dev/code/project",
  projectKind: "git",
  projectIconRevision: "rev-1",
};

function workspace(labels: string[] = []) {
  return makeWorkspace({
    id: "ws",
    projectId: "project-id",
    projectDisplayName: "Project",
    name: "project",
    title: "Tasks workspace",
    labels,
    gitRuntime: { currentBranch: "feature/tasks", isDirty: true, aheadBehind: { ahead: 2, behind: 1 } },
    githubRuntime: {
      featuresEnabled: true,
      pullRequest: {
        number: 42,
        title: "Tasks board",
        url: "https://example.test/pr/42",
        state: "open",
        baseRefName: "main",
        headRefName: "feature/tasks",
        isMerged: false,
      },
    },
  });
}

/**
 * An agent in the test workspace. One given only `updatedAt` was prompted
 * then too: the done lane times a card by its turn, not by the daemon's
 * later updates.
 */
function activeAgent(id: string, overrides: Partial<ReturnType<typeof makeAgent>> = {}) {
  const prompted = overrides.updatedAt !== undefined && !("lastUserMessageAt" in overrides) ? { lastUserMessageAt: overrides.updatedAt } : null;
  return makeAgent({ id, workspaceId: "ws", ...prompted, ...overrides });
}

async function mountTasks(fake: Fake, doneWindow: "24h" | "7d" | "all" = "24h", includeDone = true) {
  let current!: TasksHandle;
  function Probe() {
    current = useTasks(fake.paseo, { doneWindow, includeDone });
    return null;
  }
  let renderer!: Renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Probe));
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
  return { get current() { return current; }, renderer, unmount: () => act(() => renderer.unmount()) };
}

it("refreshes subscriptions to recover an agent missed by live updates", async () => {
  const fake = createFakePaseo({ agents: [], workspaces: [workspace()] });
  const mounted = await mountTasks(fake);
  try {
    fake.setAgentSilently(activeAgent("missed", { status: "running" }));
    expect(mounted.current.byId.has("missed")).toBe(false);
    await act(async () => {
      mounted.current.refresh();
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    expect(mounted.current.lanes.running.cards.map((card) => card.id)).toContain("missed");
    expect(mounted.current.ready).toBe(true);
  } finally {
    mounted.unmount();
  }
});

describe("Tasks data store refresh", () => {
  const flush = async (rounds = 12) => {
    for (let index = 0; index < rounds; index += 1) await Promise.resolve();
  };
  const listCalls = (fake: Fake) => fake.calls.filter((call) => call.method === "agents.list");

  it("updates cards in place while the old lists stay live, then releases them", async () => {
    const fake = createFakePaseo({
      agents: [
        activeAgent("run", { status: "running", title: "Running" }),
        activeAgent("review", { status: "idle", requiresAttention: true, attentionReason: "finished", updatedAt: recentIso(5_000) }),
        activeAgent("done", { status: "idle", requiresAttention: false, updatedAt: recentIso(9_000) }),
      ],
      workspaces: [workspace()],
    });
    const mounted = await mountTasks(fake, "all");
    try {
      const open = fake.openSubscriptions();
      const before = mounted.current;
      const doneCard = before.byId.get("done")!;
      const reviewCard = before.byId.get("review")!;
      fake.setAgentSilently(activeAgent("run", { status: "running", title: "Renamed", updatedAt: recentIso(0) }));
      const release = fake.holdReady();
      let result: string | undefined;
      await act(async () => {
        void mounted.current.refresh().then((value) => { result = value; });
        await flush();
      });
      // In flight: nothing goes back to loading, and the old lists still deliver.
      expect(result).toBeUndefined();
      expect(mounted.current.ready).toBe(true);
      expect(LANE_ORDER.every((lane) => !mounted.current.lanes[lane].initialLoading && !mounted.current.lanes[lane].loading)).toBe(true);
      expect([...mounted.current.byId.keys()].sort()).toEqual(["done", "review", "run"]);
      expect(mounted.current.byId.get("run")?.title).toBe("Running");
      await act(async () => {
        fake.upsertAgent(activeAgent("live", { status: "running", updatedAt: recentIso(0) }));
        await flush(2);
      });
      expect(mounted.current.byId.get("live")?.lane).toBe("running");

      await act(async () => {
        release();
        await flush();
      });
      expect(result).toBe("done");
      expect(mounted.current.byId.get("run")?.title).toBe("Renamed");
      expect(mounted.current.byId.get("live")?.lane).toBe("running");
      // Unchanged cards keep their objects, so their rows do not draw again.
      expect(mounted.current.byId.get("done")).toBe(doneCard);
      expect(mounted.current.byId.get("review")).toBe(reviewCard);
      expect(fake.openSubscriptions()).toBe(open);
      expect(mounted.current.error).toBeNull();
    } finally {
      mounted.unmount();
    }
  });

  it("keeps a running task out of the done lane when a stale idle snapshot arrives during a refresh", async () => {
    const fake = createFakePaseo({ agents: [activeAgent("printing", { status: "running", updatedAt: recentIso(1_000), lastUserMessageAt: recentIso(1_000) })] });
    const mounted = await mountTasks(fake, "all");
    try {
      const release = fake.holdReady();
      let result: string | undefined;
      await act(async () => {
        void mounted.current.refresh().then((value) => { result = value; });
        await flush();
        fake.pushAgentSnapshot(activeAgent("printing", { status: "idle", updatedAt: recentIso(1_500), lastUserMessageAt: null }));
        await flush();
      });
      expect(mounted.current.byId.get("printing")).toMatchObject({ lane: "running", status: "running" });
      await act(async () => {
        release();
        await flush();
      });
      expect(result).toBe("done");
      expect(mounted.current.byId.get("printing")).toMatchObject({ lane: "running", status: "running" });
      expect(mounted.current.lanes.done.cards.map((card) => card.id)).not.toContain("printing");
      expect(fake.calls.some((call) => call.method === "agents.ref.refresh" && (call.input as { agentId: string }).agentId === "printing")).toBe(true);
    } finally {
      mounted.unmount();
    }
  });

  it("keeps the loaded done pages while it reads them again, then swaps them in at once", async () => {
    const done = Array.from({ length: 120 }, (_, index) => activeAgent("done-" + index, { status: "idle", requiresAttention: false, updatedAt: recentIso((index + 1) * 1_000) }));
    const fake = createFakePaseo({ agents: done });
    const mounted = await mountTasks(fake, "all");
    try {
      for (let page = 0; page < 2; page += 1) {
        await act(async () => {
          mounted.current.loadMoreDone();
          await flush();
        });
      }
      expect(mounted.current.lanes.done.cards).toHaveLength(120);
      // Since read: one on the second page archived, one on the third renamed.
      fake.setAgentSilently(activeAgent("done-60", { status: "idle", requiresAttention: false, updatedAt: recentIso(61_000), archivedAt: recentIso(0) }));
      fake.setAgentSilently(activeAgent("done-110", { status: "idle", requiresAttention: false, updatedAt: recentIso(111_000), title: "Renamed late" }));
      const release = fake.holdReady();
      const pages = () => listCalls(fake).filter((call) => (call.input as { subscribe?: unknown }).subscribe === undefined).length;
      const pagesBefore = pages();
      let result: string | undefined;
      await act(async () => {
        void mounted.current.refresh().then((value) => { result = value; });
        await flush();
        mounted.current.loadMoreDone();
        await flush();
      });
      expect(mounted.current.lanes.done.cards).toHaveLength(120);
      expect(mounted.current.lanes.done.loading).toBe(false);
      expect(pages()).toBe(pagesBefore);

      // The new first page lands while the pages are still being read: the lane keeps them.
      const agentsApi = fake.paseo.agents as { list: (options: { subscribe?: unknown }) => Promise<unknown> };
      const list = agentsApi.list.bind(agentsApi);
      let openPages!: () => void;
      const pageGate = new Promise<void>((resolve) => { openPages = resolve; });
      agentsApi.list = async (options) => {
        if (!options.subscribe) await pageGate;
        return list(options);
      };
      await act(async () => {
        release();
        await flush(30);
      });
      expect(result).toBeUndefined();
      expect(mounted.current.lanes.done.cards).toHaveLength(120);
      expect(mounted.current.byId.get("done-110")?.title).not.toBe("Renamed late");
      await act(async () => {
        openPages();
        await flush(30);
      });
      expect(result).toBe("done");
      expect(pages()).toBe(pagesBefore + 2);
      expect(mounted.current.lanes.done.cards).toHaveLength(119);
      expect(mounted.current.byId.has("done-60")).toBe(false);
      expect(mounted.current.byId.get("done-110")?.title).toBe("Renamed late");
      expect(mounted.current.lanes.done.hasMore).toBe(false);
      expect(mounted.current.lanes.done.loading).toBe(false);
    } finally {
      mounted.unmount();
    }
  });

  it("fails without losing a card or a live list, and can be asked again", async () => {
    const fake = createFakePaseo({ agents: [activeAgent("run", { status: "running" })], workspaces: [workspace()] });
    const mounted = await mountTasks(fake, "all");
    try {
      const open = fake.openSubscriptions();
      fake.failNextAgentList((options) => Boolean(options.subscribe && options.filter?.statuses?.includes("running")), "daemon unavailable");
      let result: string | undefined;
      await act(async () => {
        result = await mounted.current.refresh();
        await flush();
      });
      expect(result).toBe("failed");
      expect(mounted.current.error).toBe("daemon unavailable");
      expect(mounted.current.ready).toBe(true);
      expect(mounted.current.byId.get("run")?.lane).toBe("running");
      expect(fake.openSubscriptions()).toBe(open);
      // The old running list still delivers.
      await act(async () => {
        fake.upsertAgent(activeAgent("run", { status: "idle", requiresAttention: false, updatedAt: recentIso(0) }));
        await flush(2);
      });
      expect(mounted.current.byId.get("run")?.lane).toBe("done");

      await act(async () => {
        result = await mounted.current.refresh();
        await flush();
      });
      expect(result).toBe("done");
      expect(mounted.current.error).toBeNull();
      expect(fake.openSubscriptions()).toBe(open);
    } finally {
      mounted.unmount();
    }
  });

  it("joins a refresh in flight, and ends superseded when the board closes", async () => {
    const fake = createFakePaseo({ agents: [activeAgent("run", { status: "running" })], workspaces: [workspace()] });
    const mounted = await mountTasks(fake, "all");
    const release = fake.holdReady();
    const listsBefore = listCalls(fake).length;
    let first!: Promise<string>;
    let second!: Promise<string>;
    await act(async () => {
      first = mounted.current.refresh();
      second = mounted.current.refresh();
      await flush();
    });
    expect(second).toBe(first);
    // One status, attention and done list each.
    expect(listCalls(fake).length - listsBefore).toBe(3);
    mounted.unmount();
    release();
    await act(async () => { await flush(); });
    await expect(first).resolves.toBe("superseded");
    expect(fake.openSubscriptions()).toBe(0);
  });

  it("gives the done list to an archived-lane switch made during a refresh, without a stuck load", async () => {
    const fake = createFakePaseo({ agents: [
      activeAgent("done", { status: "idle", requiresAttention: false, updatedAt: recentIso(2_000) }),
      activeAgent("gone", { status: "idle", requiresAttention: false, updatedAt: recentIso(3_000), archivedAt: recentIso(1_000) }),
    ] });
    const mounted = await mountTasks(fake, "all");
    try {
      const release = fake.holdReady();
      let result: string | undefined;
      await act(async () => {
        void mounted.current.refresh().then((value) => { result = value; });
        await flush();
        setTasksArchivedLane(fake.paseo, true);
        await flush();
      });
      await act(async () => {
        release();
        await flush(30);
      });
      expect(result).toBe("done");
      expect(mounted.current.lanes.done.loading).toBe(false);
      expect(mounted.current.lanes.done.cards.map((card) => card.id)).toEqual(["done"]);
      const doneLists = listCalls(fake).filter((call) => (call.input as { filter?: { statuses?: string[] } }).filter?.statuses?.includes("idle"));
      expect((doneLists.at(-1)!.input as { filter: { includeArchived?: boolean } }).filter.includeArchived).toBe(true);
    } finally {
      setTasksArchivedLane(fake.paseo, false);
      mounted.unmount();
    }
  });

  it("applies nothing a timed-out refresh hears late, keeps the lists it would have replaced, and lets the archived lane reload", async () => {
    const fake = createFakePaseo({ agents: [
      activeAgent("run", { status: "running", title: "Original", updatedAt: recentIso(5_000) }),
      activeAgent("done", { status: "idle", requiresAttention: false, updatedAt: recentIso(9_000) }),
    ], workspaces: [workspace()] });
    const mounted = await mountTasks(fake, "all");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const open = fake.openSubscriptions();
      // The daemon's newer record, which only the late snapshot carries.
      fake.setAgentSilently(activeAgent("run", { status: "running", title: "Late snapshot", updatedAt: recentIso(1_000) }));
      const release = fake.holdReady();
      let first!: Promise<string>;
      await act(async () => {
        first = mounted.current.refresh();
        await flush();
        vi.advanceTimersByTime(30_000);
        await flush();
      });
      await expect(first).resolves.toBe("failed");
      await act(async () => {
        release();
        await flush(30);
      });
      expect(mounted.current.byId.get("run")?.title).toBe("Original");
      expect(fake.openSubscriptions()).toBe(open);
      // The lists it would have replaced still deliver.
      await act(async () => {
        fake.upsertAgent(activeAgent("run", { status: "running", title: "Live", updatedAt: recentIso(0) }));
        await flush(2);
      });
      expect(mounted.current.byId.get("run")?.title).toBe("Live");
      await act(async () => {
        setTasksArchivedLane(fake.paseo, true);
        await flush(30);
      });
      expect(mounted.current.lanes.done.loading).toBe(false);
      expect(mounted.current.lanes.done.cards.map((card) => card.id)).toEqual(["done"]);
    } finally {
      vi.useRealTimers();
      setTasksArchivedLane(fake.paseo, false);
      mounted.unmount();
    }
  });

  it("drops the done pages a timed-out refresh reads late, and pages on again", async () => {
    const done = Array.from({ length: 130 }, (_, index) => activeAgent("done-" + index, { status: "idle", requiresAttention: false, updatedAt: recentIso((index + 1) * 1_000) }));
    const fake = createFakePaseo({ agents: done });
    const mounted = await mountTasks(fake, "all");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await act(async () => {
        mounted.current.loadMoreDone();
        await flush();
      });
      expect(mounted.current.lanes.done.cards).toHaveLength(100);
      fake.setAgentSilently(activeAgent("done-60", { status: "idle", requiresAttention: false, updatedAt: recentIso(61_000), archivedAt: recentIso(0) }));
      const agentsApi = fake.paseo.agents as { list: (options: { subscribe?: unknown }) => Promise<unknown> };
      const list = agentsApi.list.bind(agentsApi);
      let openPages!: () => void;
      const pageGate = new Promise<void>((resolve) => { openPages = resolve; });
      agentsApi.list = async (options) => {
        if (!options.subscribe) await pageGate;
        return list(options);
      };
      let first!: Promise<string>;
      await act(async () => {
        first = mounted.current.refresh();
        await flush(30);
        vi.advanceTimersByTime(30_000);
        await flush();
      });
      await expect(first).resolves.toBe("failed");
      await act(async () => {
        openPages();
        await flush(30);
      });
      // The late page is not swapped in: the old pages stay until a refresh lands.
      expect(mounted.current.lanes.done.cards).toHaveLength(100);
      expect(mounted.current.byId.has("done-60")).toBe(true);
      const pages = listCalls(fake).filter((call) => (call.input as { subscribe?: unknown }).subscribe === undefined).length;
      await act(async () => {
        mounted.current.loadMoreDone();
        await flush(30);
      });
      expect(listCalls(fake).filter((call) => (call.input as { subscribe?: unknown }).subscribe === undefined).length).toBe(pages + 1);
      expect(mounted.current.lanes.done.loading).toBe(false);
    } finally {
      vi.useRealTimers();
      mounted.unmount();
    }
  });

  it("ends at once when the board closes during a refresh the daemon has not answered", async () => {
    const fake = createFakePaseo({ agents: [activeAgent("run", { status: "running" })], workspaces: [workspace()] });
    const mounted = await mountTasks(fake, "all");
    fake.holdReady();
    let first!: Promise<string>;
    await act(async () => {
      first = mounted.current.refresh();
      await flush();
    });
    mounted.unmount();
    const soon = new Promise<string>((resolve) => setTimeout(() => resolve("still waiting"), 50));
    await expect(Promise.race([first, soon])).resolves.toBe("superseded");
    expect(fake.openSubscriptions()).toBe(0);
  });

  it("lands a retry after a timeout, and the first refresh's late lists change nothing", async () => {
    const fake = createFakePaseo({ agents: [activeAgent("run", { status: "running", title: "Original", updatedAt: recentIso(5_000) })], workspaces: [workspace()] });
    const mounted = await mountTasks(fake, "all");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const open = fake.openSubscriptions();
      fake.setAgentSilently(activeAgent("run", { status: "running", title: "First read", updatedAt: recentIso(3_000) }));
      const releaseFirst = fake.holdReady();
      let first!: Promise<string>;
      await act(async () => {
        first = mounted.current.refresh();
        await flush();
        vi.advanceTimersByTime(30_000);
        await flush();
      });
      await expect(first).resolves.toBe("failed");
      fake.stopHolding();
      fake.setAgentSilently(activeAgent("run", { status: "running", title: "Retry", updatedAt: recentIso(1_000) }));
      let second!: Promise<string>;
      await act(async () => {
        second = mounted.current.refresh();
        await flush(30);
      });
      expect(second).not.toBe(first);
      await expect(second).resolves.toBe("done");
      expect(mounted.current.byId.get("run")?.title).toBe("Retry");
      expect(mounted.current.error).toBeNull();
      await act(async () => {
        releaseFirst();
        await flush(30);
      });
      expect(mounted.current.byId.get("run")?.title).toBe("Retry");
      expect(fake.openSubscriptions()).toBe(open);
    } finally {
      vi.useRealTimers();
      mounted.unmount();
    }
  });

  it("keeps the lists that land and the old list of one that fails, and reports failed", async () => {
    const fake = createFakePaseo({ agents: [
      activeAgent("run", { status: "running", title: "Original run", updatedAt: recentIso(5_000) }),
      activeAgent("review", { status: "idle", requiresAttention: true, attentionReason: "finished", title: "Original review", updatedAt: recentIso(6_000) }),
    ], workspaces: [workspace()] });
    const mounted = await mountTasks(fake, "all");
    try {
      const open = fake.openSubscriptions();
      fake.setAgentSilently(activeAgent("run", { status: "running", title: "Read again", updatedAt: recentIso(1_000) }));
      fake.failNextAgentList((options) => Boolean(options.subscribe && options.filter?.requiresAttention), "attention list failed");
      let result: string | undefined;
      await act(async () => {
        result = await mounted.current.refresh();
        await flush();
      });
      expect(result).toBe("failed");
      expect(mounted.current.error).toBe("attention list failed");
      // The status list landed; the attention list failed and its old one stays.
      expect(mounted.current.byId.get("run")?.title).toBe("Read again");
      expect(mounted.current.byId.get("review")?.lane).toBe("review");
      expect(fake.openSubscriptions()).toBe(open);
      await act(async () => {
        fake.upsertAgent(activeAgent("review", { status: "idle", requiresAttention: true, attentionReason: "finished", title: "Live review", updatedAt: recentIso(0) }));
        fake.upsertAgent(activeAgent("run", { status: "running", title: "Live run", updatedAt: recentIso(0) }));
        await flush(2);
      });
      expect(mounted.current.byId.get("review")?.title).toBe("Live review");
      expect(mounted.current.byId.get("run")?.title).toBe("Live run");
    } finally {
      mounted.unmount();
    }
  });

  it("keeps loadMoreDone the same function across updates, so the lanes need not draw again", async () => {
    const fake = createFakePaseo({ agents: [activeAgent("run", { status: "running", updatedAt: recentIso(5_000) })] });
    const mounted = await mountTasks(fake, "all");
    try {
      const load = mounted.current.loadMoreDone;
      await act(async () => {
        fake.upsertAgent(activeAgent("run", { status: "running", title: "Renamed", updatedAt: recentIso(0) }));
        await mounted.current.refresh();
        await flush();
      });
      expect(mounted.current.byId.get("run")?.title).toBe("Renamed");
      expect(mounted.current.loadMoreDone).toBe(load);
    } finally {
      mounted.unmount();
    }
  });

  it("ends a refresh the daemon never answers as failed, and lets the next one start", async () => {
    const fake = createFakePaseo({ agents: [activeAgent("run", { status: "running" })], workspaces: [workspace()] });
    const mounted = await mountTasks(fake, "all");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      fake.holdReady();
      let first!: Promise<string>;
      await act(async () => {
        first = mounted.current.refresh();
        await flush();
      });
      await act(async () => {
        vi.advanceTimersByTime(30_000);
        await flush();
      });
      await expect(first).resolves.toBe("failed");
      expect(mounted.current.error).toBe("Refreshing tasks timed out");
      expect(mounted.current.byId.get("run")?.lane).toBe("running");
      let second!: Promise<string>;
      await act(async () => { second = mounted.current.refresh(); });
      expect(second).not.toBe(first);
    } finally {
      vi.useRealTimers();
      mounted.unmount();
    }
  });
});

function recentIso(ageMs: number) {
  return new Date(Date.now() - ageMs).toISOString();
}

describe("Tasks data store", () => {
  it.each(["request_user_input", "request_user_input_async"])("summarizes structured questions from %s and follows pending updates", async (name) => {
    const question = "按仓库的 Plan-first 要求，请确认这份修改范围。";
    const permission = {
      id: "question-request", provider: "codex", name, kind: "question" as const, title: "Question",
      input: { questions: [{ id: "scope", header: "Scope", question, options: [{ label: "确认，按此修改" }] }] },
    };
    const fake = createFakePaseo({
      agents: [activeAgent("asking", { provider: "codex", status: "running", pendingPermissions: [permission] })],
      workspaces: [workspace()],
    });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      expect(mounted.current.byId.get("asking")?.permission).toMatchObject({ title: "Question", summary: question });
      await act(async () => {
        fake.upsertAgent(activeAgent("asking", {
          provider: "codex", status: "running",
          pendingPermissions: [{ ...permission, input: { questions: [
            { question: "  Confirm the scope?\nInclude tests?  " },
            { question: "Which checks should run?" },
          ] } }],
        }));
        await Promise.resolve();
      });
      expect(mounted.current.byId.get("asking")?.permission?.summary)
        .toBe("Confirm the scope? Include tests? · Which checks should run?");
    } finally {
      mounted.unmount();
    }
  });

  it.each([
    { questions: [] },
    { questions: [null, {}, { question: " " }, { question: 42 }] },
  ])("leaves empty structured questions without a summary: $questions", async ({ questions }) => {
    const fake = createFakePaseo({
      agents: [activeAgent("asking", {
        status: "running", pendingPermissions: [{
          id: "question-request", provider: "codex", name: "request_user_input_async", kind: "question", title: "Question",
          input: { questions },
        }],
      })],
      workspaces: [workspace()],
    });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      expect(mounted.current.byId.get("asking")?.permission?.summary).toBeNull();
    } finally {
      mounted.unmount();
    }
  });

  it("merges active and done subscriptions, classifies lanes, and applies lane sort order", async () => {
    const fake = createFakePaseo({
      agents: [
        activeAgent("input-late", { status: "idle", requiresAttention: true, attentionTimestamp: at(2), pendingPermissions: [{ id: "p", provider: "claude", name: "Bash", kind: "tool", input: { command: "npm test\nextra" } }] }),
        activeAgent("input-early", { status: "idle", requiresAttention: true, attentionTimestamp: at(1), pendingPermissions: [{ id: "p2", provider: "claude", name: "Edit file", kind: "tool" }] }),
        activeAgent("running-late", { status: "running", activeTurn: { turnId: "t2", startedAt: at(2) } }),
        activeAgent("running-early", { status: "initializing", activeTurn: { turnId: "t1", startedAt: at(1) } }),
        activeAgent("failed", { status: "error", attentionReason: "error", attentionTimestamp: at(5), lastError: "tool crashed" }),
        activeAgent("unread", { status: "idle", requiresAttention: true, attentionReason: "finished", attentionTimestamp: at(3) }),
        activeAgent("done", { status: "closed", updatedAt: recentIso(60_000) }),
        activeAgent("archived", { status: "running", archivedAt: at(8) }),
      ],
      workspaces: [workspace(["bug", "release"])],
    });
    const mounted = await mountTasks(fake);
    try {
      expect(mounted.current.ready).toBe(true);
      expect(mounted.current.lanes.needs_input.cards.map((card) => card.id)).toEqual(["input-early", "input-late"]);
      expect(mounted.current.lanes.running.cards.map((card) => card.id)).toEqual(["running-early", "running-late"]);
      expect(mounted.current.lanes.review.cards.map((card) => card.id)).toEqual(["failed", "unread"]);
      expect(mounted.current.lanes.done.cards.map((card) => card.id)).toEqual(["done"]);
      expect(mounted.current.byId.size).toBe(7);
      expect(mounted.current.byId.has("archived")).toBe(false);
      expect(mounted.current.byId.get("input-late")?.permission).toMatchObject({ requestId: "p", summary: "npm test", remaining: 0 });
      expect(mounted.current.byId.get("failed")?.error).toBe("tool crashed");
      // Mark read only where clearing the attention moves the card: a daemon error stays failed.
      expect([...mounted.current.byId.values()].filter((card) => card.readable).map((card) => card.id).sort()).toEqual(["failed", "unread"]);
      expect(mounted.current.byId.get("done")?.context).toBeNull();
      expect(mounted.current.byId.get("running-early")?.location).toMatchObject({
        projectId: "project-id",
        projectName: "Project",
        workspaceName: "Tasks workspace",
        workspaceKind: "local_checkout",
        branch: "feature/tasks",
        git: { dirty: true, ahead: 2, behind: 1 },
        pullRequest: { number: 42, title: "Tasks board" },
      });
      expect(fake.calls.filter((call) => call.method === "agents.list")).toHaveLength(3);
      expect(filterLanes(mounted.current.lanes, {
        query: "feature/tasks",
        workspaceIds: [],
        providers: [],
        labels: [],
        hideSubtasks: false,
      }).running.cards.map((card) => card.id)).toEqual(["running-early", "running-late"]);
    } finally {
      mounted.unmount();
    }
  });

  it("offers Mark read on every review card, and moves a card marked since its prompt to done", async () => {
    const prompt = Date.now() - 10 * 60_000;
    const iso = (ms: number) => new Date(ms).toISOString();
    const fake = createFakePaseo({
      agents: [
        activeAgent("unread", { status: "idle", requiresAttention: true, attentionReason: "finished", lastUserMessageAt: iso(prompt) }),
        activeAgent("kept-error", { status: "idle", lastError: "usage limit", lastUserMessageAt: iso(prompt) }),
        activeAgent("daemon-error", { status: "error", requiresAttention: true, attentionReason: "error", lastError: "crashed", lastUserMessageAt: iso(prompt) }),
        // Marked, then prompted again: the mark is for an earlier failure.
        activeAgent("prompted", { status: "error", lastError: "crashed again", lastUserMessageAt: iso(prompt + 60_000) }),
      ],
      workspaces: [workspace()],
    });
    const loader = vi.fn(async () => [
      { agentId: "kept-error", readAt: iso(prompt + 30_000) },
      { agentId: "daemon-error", readAt: iso(prompt + 30_000) },
      { agentId: "prompted", readAt: iso(prompt + 30_000) },
    ]);
    setReadMarksLoader(loader);
    const mounted = await mountTasks(fake, "all");
    try {
      expect(mounted.current.lanes.review.cards.map((card) => card.id).sort()).toEqual(["daemon-error", "kept-error", "prompted", "unread"]);
      expect(mounted.current.lanes.review.cards.every((card) => card.readable)).toBe(true);
      expect(mounted.current.lanes.running.cards.some((card) => card.readable)).toBe(false);

      await act(async () => {
        mounted.current.refreshReads();
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
      });
      expect(loader).toHaveBeenCalled();
      // Done, the reason kept for the grey line; no Mark read there.
      expect(mounted.current.byId.get("kept-error")).toMatchObject({ lane: "done", status: "done", error: "usage limit", readable: false });
      expect(mounted.current.byId.get("daemon-error")).toMatchObject({ lane: "done", status: "done", error: "crashed" });
      expect(mounted.current.byId.get("prompted")).toMatchObject({ lane: "review", status: "failed", readable: true });
      expect(mounted.current.counts.review).toBe(2);
    } finally {
      mounted.unmount();
      setReadMarksLoader(null);
    }
  });

  it("gives no Stop to a review card the daemon is resuming for a Mark read", async () => {
    const fake = createFakePaseo({
      agents: [
        activeAgent("resuming", { status: "initializing", requiresAttention: true, attentionReason: "finished" }),
        activeAgent("starting", { status: "initializing", activeTurn: { turnId: "t1", startedAt: at(1) } }),
      ],
      workspaces: [workspace()],
    });
    const mounted = await mountTasks(fake);
    try {
      expect(mounted.current.byId.get("resuming")).toMatchObject({ lane: "review", readable: true, stoppable: false });
      expect(mounted.current.byId.get("starting")).toMatchObject({ lane: "running", stoppable: true });
    } finally {
      mounted.unmount();
    }
  });

  it("keeps a card marked read in review when something failed after the mark", () => {
    const card = { ...sampleCards(Date.parse("2026-10-22T10:00:00.000Z")).find((sample) => sample.id === "sample-failed")! };
    const prompted = Date.parse(card.timing.lastUserMessageAt ?? "2026-10-22T09:00:00.000Z");
    const marked = prompted + 60_000;
    expect(withReadMark(card, marked, marked - 1)).toMatchObject({ lane: "done", status: "done", readable: false });
    expect(withReadMark(card, marked, marked + 1)).toMatchObject({ lane: "review", status: "failed", readable: true });
    expect(withReadMark(card, undefined, Number.NEGATIVE_INFINITY)).toMatchObject({ lane: "review", readable: true });
    expect(withReadMark({ ...card, lane: "running", status: "running" }, marked, 0).readable).toBeFalsy();
  });

  it.each(["feature/tasks", "feature-tasks"])("hides a workspace name that repeats branch %s", async (workspaceName) => {
    const fake = createFakePaseo({
      agents: [activeAgent("a", { status: "running" })],
      workspaces: [{ ...workspace(), title: workspaceName }],
    });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      expect(mounted.current.byId.get("a")?.location.workspaceName).toBeNull();
      expect(mounted.current.byId.get("a")?.location.workspaceTitle).toBe(workspaceName);
    } finally {
      mounted.unmount();
    }
  });

  it("preserves raw folder names and placement workspace titles when display values are deduplicated", async () => {
    const workspaceAgent = activeAgent("raw-workspace", {
      status: "running",
      cwd: "/Users/dev/code/feature-tasks",
    });
    const placementAgent = activeAgent("raw-placement", { status: "running", workspaceId: undefined });
    const fake = createFakePaseo({
      agents: [workspaceAgent, placementAgent],
      workspaces: [{ ...workspace(), title: "feature/tasks" }],
      placements: {
        "raw-placement": makePlacement(placementAgent, { workspaceName: "main" }),
      },
    });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      const workspaceLocation = mounted.current.byId.get("raw-workspace")?.location;
      expect(workspaceLocation?.workspaceName).toBeNull();
      expect(workspaceLocation?.workspaceTitle).toBe("feature/tasks");
      expect(workspaceLocation?.folder).toBeNull();
      expect(workspaceLocation?.folderName).toBe("feature-tasks");

      const placementLocation = mounted.current.byId.get("raw-placement")?.location;
      expect(placementLocation?.workspaceName).toBeNull();
      expect(placementLocation?.workspaceTitle).toBe("main");
    } finally {
      mounted.unmount();
    }
  });

  it("uses the raw provider id as the label for unknown providers", async () => {
    const fake = createFakePaseo({ agents: [activeAgent("a", { status: "running", provider: "bc-bench" })] });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      expect(mounted.current.byId.get("a")?.providerLabel).toBe("bc-bench");
      expect(mounted.current.byId.get("a")?.provider).toBe("bc-bench");
    } finally {
      mounted.unmount();
    }
  });

  it("uses the placement project key, falls back to the project descriptor, and preserves unchanged cards", async () => {
    const placementAgent = activeAgent("placement", { status: "running", workspaceId: "ws" });
    const fallbackAgent = activeAgent("fallback", { status: "running", workspaceId: "ws" });
    const unknownAgent = activeAgent("unknown", { status: "running", workspaceId: "ws-unknown" });
    const fake = createFakePaseo({
      agents: [placementAgent, fallbackAgent, unknownAgent],
      workspaces: [workspace(), makeWorkspace({ id: "ws-unknown", projectId: "missing-project" })],
      projects: [{ ...PROJECT, projectKey: "descriptor-key" }],
      placements: {
        placement: makePlacement(placementAgent, { projectKey: "placement-key" }),
        fallback: makePlacement(fallbackAgent, { projectKey: "" }),
        unknown: makePlacement(unknownAgent, { projectKey: "" }),
      },
    });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      expect(mounted.current.byId.get("placement")?.location.projectKey).toBe("placement-key");
      expect(mounted.current.byId.get("fallback")?.location.projectKey).toBe("descriptor-key");
      expect(mounted.current.byId.get("unknown")?.location.projectKey).toBeNull();
      const unchanged = mounted.current.byId.get("fallback");
      await act(async () => {
        fake.upsertAgent(
          activeAgent("placement", { status: "running", workspaceId: "ws", title: "Updated placement" }),
          makePlacement(placementAgent, { projectKey: "placement-key" }),
        );
        await Promise.resolve();
      });
      expect(mounted.current.byId.get("fallback")).toBe(unchanged);
    } finally {
      mounted.unmount();
    }
  });

  it("keeps actionable child tasks visible when hiding other subtasks", () => {
    const samples = new Map(sampleCards().map((card) => [card.id, card]));
    const parentId = "orchestrator-parent";
    const child = (id: string, sampleId: string): TaskCard => ({
      ...samples.get(sampleId)!,
      id,
      parent: { id: parentId, title: "Orchestrator parent", missing: false, archived: false },
    });
    const children = [
      child("child-running", "sample-child-1"),
      child("child-needs-input", "sample-input"),
      child("child-failed", "sample-failed"),
      child("child-unread", "sample-unread"),
      child("child-done", "sample-done"),
    ];
    const parent: TaskCard = {
      ...samples.get("sample-done")!,
      id: parentId,
      title: "Orchestrator parent",
      children: children.map(({ id, title, status }) => ({ id, title, status })),
    };
    const cards = [parent, ...children];
    const lanes = Object.fromEntries(LANE_ORDER.map((id) => [id, {
      id,
      cards: cards.filter((card) => card.lane === id),
      hasMore: false,
      loading: false,
    }])) as Record<LaneId, LaneModel>;
    const filters = {
      query: "",
      workspaceIds: [],
      providers: [],
      labels: [],
      hideSubtasks: true,
    };

    const hidden = filterLanes(lanes, filters);
    expect(hidden.needs_input.cards.map((card) => card.id)).toEqual(["child-needs-input"]);
    expect(hidden.running.cards.map((card) => card.id)).toEqual(["child-running"]);
    expect(hidden.review.cards.map((card) => card.id)).toEqual(["child-failed"]);
    expect(hidden.done.cards.map((card) => card.id)).toEqual([parentId]);
    expect(hidden.done.cards[0]?.children.map((childCard) => childCard.id)).toEqual(children.map((card) => card.id));

    const visible = filterLanes(lanes, { ...filters, hideSubtasks: false });
    for (const id of LANE_ORDER) {
      expect(visible[id].cards.map((card) => card.id)).toEqual(lanes[id].cards.map((card) => card.id));
    }

    // A parent waiting on its subtasks sits in the running lane and shows the running one as a row.
    const waiting: TaskCard = { ...parent, lane: "running", status: "running", waitingOnSubtasks: true, provider: "parent-only" };
    const waitingLanes = Object.fromEntries(LANE_ORDER.map((id) => [id, {
      ...lanes[id],
      cards: [waiting, ...children].filter((card) => card.lane === id),
    }])) as Record<LaneId, LaneModel>;
    const folded = filterLanes(waitingLanes, filters);
    expect(folded.running.cards.map((card) => card.id)).toEqual([parentId]);
    expect(folded.needs_input.cards.map((card) => card.id)).toEqual(["child-needs-input"]);
    expect(folded.review.cards.map((card) => card.id)).toEqual(["child-failed"]);
    // With the parent filtered out, the running subtask has no row to stand in for it.
    expect(filterLanes(waitingLanes, { ...filters, providers: [children[0]!.provider] }).running.cards.map((card) => card.id))
      .toEqual(["child-running"]);
  });

  it("notifies store listeners once for a multi-agent subscription snapshot", async () => {
    const agents = Array.from({ length: 120 }, (_, index) => activeAgent(`snapshot-${index}`, { status: "running" }));
    const fake = createFakePaseo({ agents });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      storeNotificationProbe.count = 0;
      storeNotificationProbe.enabled = true;
      try {
        act(() => fake.reconnectAgentSubscription(0));
      } finally {
        storeNotificationProbe.enabled = false;
      }
      expect(storeNotificationProbe.count).toBe(1);
      expect(mounted.current.lanes.running.cards).toHaveLength(120);
    } finally {
      mounted.unmount();
    }
  });

  it("pages the done lane, stops at the time-window tail, and shows a task that finishes while open", async () => {
    const recent = Array.from({ length: 51 }, (_, index) => activeAgent("done-" + index, {
      status: "idle",
      requiresAttention: false,
      updatedAt: recentIso(index * 1_000),
    }));
    const fake = createFakePaseo({ agents: [activeAgent("working", { status: "running" }), ...recent] });
    const mounted = await mountTasks(fake, "24h", true);
    try {
      expect(mounted.current.lanes.done.cards).toHaveLength(50);
      expect(mounted.current.lanes.done.hasMore).toBe(true);
      await act(async () => {
        mounted.current.loadMoreDone();
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      });
      expect(mounted.current.lanes.done.cards).toHaveLength(51);
      expect(mounted.current.lanes.done.hasMore).toBe(false);
      expect(fake.calls.filter((call) => call.method === "agents.list" && (call.input as { subscribe?: unknown }).subscribe === undefined)).toHaveLength(1);

      await act(async () => {
        fake.upsertAgent(activeAgent("working", { status: "idle", updatedAt: recentIso(1_000) }));
        await Promise.resolve();
      });
      expect(mounted.current.byId.get("working")?.lane).toBe("done");
    } finally {
      mounted.unmount();
    }

    const oldTail = createFakePaseo({
      agents: [
        activeAgent("fresh", { status: "idle", updatedAt: recentIso(10_000) }),
        activeAgent("old", { status: "idle", updatedAt: recentIso(48 * 60 * 60 * 1000) }),
        ...Array.from({ length: 51 }, (_, index) => activeAgent("older-" + index, { status: "idle", updatedAt: recentIso((49 + index) * 60 * 60 * 1000) })),
      ],
    });
    const oldMounted = await mountTasks(oldTail, "24h", true);
    try {
      expect(oldMounted.current.lanes.done.hasMore).toBe(false);
      expect(oldMounted.current.lanes.done.cards.map((card) => card.id)).toEqual(["fresh"]);
    } finally {
      oldMounted.unmount();
    }
  });

  it("keeps a task while its running subscription removes it before the done update", async () => {
    const running = activeAgent("moving", { status: "running", updatedAt: recentIso(2_000) });
    const done = activeAgent("moving", { status: "idle", updatedAt: recentIso(0) });
    const fake = createFakePaseo({ agents: [running] });
    const mounted = await mountTasks(fake);
    try {
      fake.setAgentSilently(done);
      act(() => fake.removeFromStatusSubscription("moving"));
      expect(mounted.current.byId.get("moving")?.lane).toBe("running");
      await act(async () => { await Promise.resolve(); });
      expect(mounted.current.byId.get("moving")?.lane).toBe("done");
      await act(async () => fake.removeAgent("moving"));
      expect(mounted.current.byId.has("moving")).toBe(false);
    } finally {
      mounted.unmount();
    }
  });

  it("keeps a running task out of the done lane when the daemon sends its idle snapshot late", async () => {
    const fake = createFakePaseo();
    const mounted = await mountTasks(fake, "24h", true);
    try {
      const created = recentIso(2_000);
      // A new agent with a first prompt, as Paseo 0.13 publishes it: idle once
      // registered, running once prompted, then the idle copy `createAgent`
      // returned, older than the running one, and nothing more until the turn ends.
      await act(async () => {
        fake.upsertAgent(activeAgent("printing", { status: "idle", updatedAt: created, lastUserMessageAt: null }));
        fake.upsertAgent(activeAgent("printing", { status: "running", updatedAt: recentIso(1_000), lastUserMessageAt: recentIso(1_000) }));
        fake.pushAgentSnapshot(activeAgent("printing", { status: "idle", updatedAt: recentIso(1_500), lastUserMessageAt: null }));
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      });
      expect(mounted.current.byId.get("printing")).toMatchObject({ lane: "running", status: "running" });
      expect(mounted.current.lanes.done.cards.map((card) => card.id)).not.toContain("printing");
      expect(fake.calls.filter((call) => call.method === "agents.ref.refresh")).toContainEqual(
        { method: "agents.ref.refresh", input: { agentId: "printing" } },
      );

      // Its turn ends: the later idle update moves it to done as usual.
      await act(async () => {
        fake.upsertAgent(activeAgent("printing", { status: "idle", updatedAt: recentIso(0), lastUserMessageAt: recentIso(1_000) }));
        await Promise.resolve();
      });
      expect(mounted.current.byId.get("printing")?.lane).toBe("done");
    } finally {
      mounted.unmount();
    }
  });

  it("replaces subscription membership from reconnect snapshots", async () => {
    const fake = createFakePaseo({ agents: [activeAgent("a", { status: "running" })] });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      expect(mounted.current.byId.has("a")).toBe(true);
      fake.setAgentSilently(activeAgent("a", { status: "idle" }));
      await act(async () => {
        fake.reconnectSubscriptions();
        await Promise.resolve();
      });
      expect(mounted.current.byId.has("a")).toBe(false);
    } finally {
      mounted.unmount();
    }
  });

  it("indexes parent and direct child cards, and reads a missing parent once, unasked", async () => {
    const fake = createFakePaseo({
      agents: [
        activeAgent("parent", { status: "running", title: "Parent task" }),
        activeAgent("child", { status: "running", title: "Child task", labels: { "paseo.parent-agent-id": "parent" } }),
        activeAgent("orphan", { status: "running", labels: { "paseo.parent-agent-id": "archived-parent" } }),
        makeAgent({ id: "archived-parent", status: "idle", title: "Archived parent", archivedAt: at(4) }),
      ],
    });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      expect(mounted.current.byId.get("parent")?.children).toEqual([{ id: "child", title: "Child task", status: "running", provider: "claude", modelLabel: "claude-opus-5-5", thinkingLabel: null, modeLabel: "Default", context: null, lane: "running", timing: expect.objectContaining({ turnStartedAt: null }) }]);
      expect(mounted.current.byId.get("child")?.parent).toEqual({ id: "parent", title: "Parent task", missing: false, archived: false });
      // Read as soon as the card is built, so the card can say the parent is archived.
      expect(mounted.current.byId.get("orphan")?.parent).toEqual({ id: "archived-parent", title: "Archived parent", missing: true, archived: true, archivedAs: "agent" });
      await act(async () => {
        fake.upsertAgent(activeAgent("later-child", { status: "running", title: "Later child", labels: { "paseo.parent-agent-id": "parent" } }));
        await Promise.resolve();
      });
      expect(mounted.current.byId.get("parent")?.children.map((child) => child.id)).toEqual(["child", "later-child"]);
      expect(fake.calls.filter((call) => call.method === "agents.ref.refresh")).toHaveLength(1);
      mounted.current.resolveParent("archived-parent");
      expect(fake.calls.filter((call) => call.method === "agents.ref.refresh")).toHaveLength(1);
    } finally {
      mounted.unmount();
    }
  });

  it("drops a card whose agent another client deleted, and keeps one that only closed", async () => {
    const fake = createFakePaseo({
      agents: [
        activeAgent("gone", { status: "idle", requiresAttention: true, updatedAt: recentIso(60_000) }),
        activeAgent("resting", { status: "idle", requiresAttention: true, updatedAt: recentIso(60_000) }),
      ],
      workspaces: [workspace()],
    });
    const mounted = await mountTasks(fake);
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      expect(mounted.current.byId.get("gone")?.lane).toBe("review");
      // Another client deletes "gone": this session sees it close, then nothing more.
      await act(async () => {
        fake.upsertAgent(activeAgent("gone", { status: "closed", requiresAttention: true, updatedAt: recentIso(1_000) }));
        fake.forgetAgent("gone");
        // "resting" closes for good reasons and stays.
        fake.upsertAgent(activeAgent("resting", { status: "closed", requiresAttention: true, updatedAt: recentIso(1_000) }));
        await Promise.resolve();
      });
      expect(mounted.current.byId.has("gone")).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
      });
      expect(mounted.current.byId.has("gone")).toBe(false);
      expect(mounted.current.counts.review).toBe(1);
      expect(mounted.current.byId.get("resting")?.lane).toBe("review");
      // One look for the deleted agent; the closed one is asked again once in case its delete was slow, then left alone.
      const refreshes = (id: string) => fake.calls.filter((call) => call.method === "agents.ref.refresh" && (call.input as { agentId: string }).agentId === id).length;
      expect(refreshes("gone")).toBe(1);
      expect(refreshes("resting")).toBe(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(refreshes("resting")).toBe(2);
    } finally {
      vi.useRealTimers();
      mounted.unmount();
    }
  });

  it("drops a card archived after the done lane paged it in", async () => {
    const done = Array.from({ length: 51 }, (_, index) => activeAgent("done-" + index, {
      status: "idle",
      requiresAttention: false,
      updatedAt: recentIso(index * 1_000),
    }));
    const fake = createFakePaseo({ agents: done, workspaces: [workspace()] });
    const mounted = await mountTasks(fake);
    try {
      await act(async () => {
        mounted.current.loadMoreDone();
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      });
      expect(mounted.current.byId.has("done-50")).toBe(true);
      vi.useFakeTimers({ toFake: ["setTimeout"] });
      // Only the page read holds "done-50"; the subscriptions just say it left them.
      await act(async () => {
        fake.upsertAgent(activeAgent("done-50", { status: "idle", requiresAttention: false, updatedAt: recentIso(50_000), archivedAt: recentIso(0) }));
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
      });
      expect(mounted.current.byId.has("done-50")).toBe(false);
      expect(mounted.current.lanes.done.cards).toHaveLength(50);
    } finally {
      vi.useRealTimers();
      mounted.unmount();
    }
  });

  it("drops a paged-in done card archived while disconnected", async () => {
    const done = Array.from({ length: 51 }, (_, index) => activeAgent("done-" + index, {
      status: "idle",
      requiresAttention: false,
      updatedAt: recentIso(index * 1_000),
    }));
    const fake = createFakePaseo({ agents: done, workspaces: [workspace()] });
    const mounted = await mountTasks(fake);
    try {
      await act(async () => {
        mounted.current.loadMoreDone();
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      });
      expect(mounted.current.byId.has("done-50")).toBe(true);
      fake.setAgentSilently(activeAgent("done-50", { status: "idle", requiresAttention: false, updatedAt: recentIso(50_000), archivedAt: recentIso(0) }));
      await act(async () => {
        fake.reconnectSubscriptions();
        await Promise.resolve();
      });
      expect(mounted.current.byId.has("done-50")).toBe(false);
      expect(mounted.current.lanes.done.cards).toHaveLength(50);
    } finally {
      mounted.unmount();
    }
  });

  it("leaves out the tasks of an archived workspace, and Paseo's agents that outlive one", async () => {
    const fake = createFakePaseo({
      agents: [
        activeAgent("live", { status: "idle", requiresAttention: true, updatedAt: recentIso(1_000) }),
        // Its workspace was archived without it: Paseo still lists the agent, but no longer the workspace.
        activeAgent("stale", { status: "idle", requiresAttention: true, updatedAt: recentIso(2_000), workspaceId: "ws-archived" }),
      ],
      workspaces: [workspace()],
    });
    const mounted = await mountTasks(fake);
    try {
      expect(mounted.current.byId.get("live")?.lane).toBe("review");
      expect(mounted.current.byId.has("stale")).toBe(false);
      expect(mounted.current.counts.review).toBe(1);
      await act(async () => {
        fake.removeWorkspace("ws");
        await Promise.resolve();
      });
      expect(mounted.current.byId.has("live")).toBe(false);
      expect(mounted.current.counts.review).toBe(0);
    } finally {
      mounted.unmount();
    }
  });

  it("brings an unarchived parent back as a done card the child links to", async () => {
    const fake = createFakePaseo({
      agents: [
        activeAgent("orphan", { status: "running", labels: { "paseo.parent-agent-id": "archived-parent" } }),
        makeAgent({ id: "archived-parent", status: "idle", title: "Archived parent", archivedAt: at(4) }),
      ],
    });
    const mounted = await mountTasks(fake, "all");
    try {
      expect(mounted.current.byId.get("orphan")?.parent).toMatchObject({ id: "archived-parent", missing: true });
      // Paseo's unarchive clears archivedAt and stamps updatedAt, so the done lane takes it.
      await act(async () => {
        fake.upsertAgent(makeAgent({ id: "archived-parent", status: "idle", title: "Archived parent", archivedAt: null, updatedAt: at(20) }));
        await Promise.resolve();
      });
      expect(mounted.current.byId.get("orphan")?.parent).toEqual({ id: "archived-parent", title: "Archived parent", missing: false, archived: false });
      expect(mounted.current.byId.get("archived-parent")?.children.map((child) => child.id)).toEqual(["orphan"]);
    } finally {
      mounted.unmount();
    }
  });

  it("tells a parent the done window left out from an archived one, and reads it again on demand", async () => {
    const fake = createFakePaseo({
      agents: [
        activeAgent("child", { status: "running", labels: { "paseo.parent-agent-id": "old-parent" } }),
        makeAgent({ id: "old-parent", status: "idle", title: "Old parent", updatedAt: at(4) }),
      ],
    });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      // Off the board, but not archived: nothing to unarchive.
      expect(mounted.current.byId.get("child")?.parent).toEqual({ id: "old-parent", title: "Old parent", missing: true, archived: false });

      // Archived elsewhere, then read again (as after an unarchive): the answer and the card follow.
      fake.upsertAgent(makeAgent({ id: "old-parent", status: "idle", title: "Old parent", updatedAt: at(4), archivedAt: at(5) }));
      let archived: boolean | null = null;
      await act(async () => {
        archived = await mounted.current.refreshParent("old-parent");
      });
      expect(archived).toBe(true);
      expect(mounted.current.byId.get("child")?.parent).toMatchObject({ missing: true, archived: true });
    } finally {
      mounted.unmount();
    }
  });

  it("detects optional labels and icons, maps tag colours, and caches icons by revision", async () => {
    const agent = activeAgent("a", { status: "running", labels: { "paseo.open-agent-tab.a": "true" } });
    const oldHost = createFakePaseo({ agents: [agent], workspaces: [workspace(["bug"])] });
    const oldMounted = await mountTasks(oldHost, "24h", false);
    try {
      // No label definitions: Linear's Bug red.
      expect(oldMounted.current.byId.get("a")?.labels).toEqual([{ name: "bug", color: "#eb5757" }]);
      expect(oldMounted.current.byId.get("a")?.openTab).toBe(true);
      oldMounted.current.requestProjectIcon("project-id");
      expect(oldHost.calls.some((call) => call.method === "projects.icon")).toBe(false);
    } finally {
      oldMounted.unmount();
    }

    const freshHost = createFakePaseo({
      agents: [agent],
      workspaces: [workspace(["bug"])],
      projects: [PROJECT],
      withLabelsAndIcons: true,
      labels: [{ name: "bug", color: "red" }],
      projectIcons: { "project-id": { data: "aW1hZ2U=", mimeType: "image/png" } },
    });
    const freshMounted = await mountTasks(freshHost, "24h", false);
    try {
      expect(freshMounted.current.byId.get("a")?.labels).toEqual([{ name: "bug", color: "#d88381" }]);
      await act(async () => {
        freshMounted.current.requestProjectIcon("project-id");
        freshMounted.current.requestProjectIcon("project-id");
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
      });
      expect(freshMounted.current.byId.get("a")?.location.projectIcon).toBe("data:image/png;base64,aW1hZ2U=");
      expect(freshHost.calls.filter((call) => call.method === "projects.icon")).toHaveLength(1);
      await act(async () => {
        freshHost.upsertProject({ ...PROJECT, projectIconRevision: "rev-2" });
        await Promise.resolve();
      });
      await act(async () => {
        freshMounted.current.requestProjectIcon("project-id");
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
      });
      expect(freshHost.calls.filter((call) => call.method === "projects.icon")).toHaveLength(2);
    } finally {
      freshMounted.unmount();
    }
  });

  it("offers every label Paseo defines or a workspace carries, a card or not", async () => {
    const host = createFakePaseo({
      agents: [activeAgent("a", { status: "running" })],
      workspaces: [workspace(["bug"])],
      projects: [PROJECT],
      withLabelsAndIcons: true,
      labels: [{ name: "bug", color: "red" }, { name: "spare", color: "red" }],
    });
    const mounted = await mountTasks(host, "24h", false);
    try {
      expect(mounted.current.labels).toEqual([{ name: "bug", color: "#d88381" }, { name: "spare", color: "#d88381" }]);
    } finally {
      mounted.unmount();
    }
  });

  it("colors labels from the server's definitions on a host that lists none, standing in only for the rest", async () => {
    const agent = activeAgent("a", { status: "running" });
    const host = createFakePaseo({ agents: [agent], workspaces: [workspace(["bug", "infra", "unlisted"])] });
    const loader = vi.fn(async () => [{ name: "bug", color: "pink" }, { name: "infra", color: "emerald" }]);
    setLabelDefinitionsLoader(loader);
    try {
      const mounted = await mountTasks(host, "24h", false);
      try {
        expect(loader).toHaveBeenCalledTimes(1);
        expect(mounted.current.byId.get("a")?.labels).toEqual([
          { name: "bug", color: "#d87da3" },
          { name: "infra", color: "#6cae96" },
          { name: "unlisted", color: fallbackLabelColor("unlisted") },
        ]);
      } finally {
        mounted.unmount();
      }
    } finally {
      setLabelDefinitionsLoader(null);
    }
  });

  it("gives labels without a color distinct Linear colors that stay put", async () => {
    // A fresh module: the colors other tests handed out are kept for the session.
    vi.resetModules();
    const { fallbackLabelColor } = await import("../../client/tasks/label-colors");
    // "linear" comes first and hashes to Bug's red: it steps past it, so Bug keeps red to itself.
    // Seven others fill the colors Linear's default labels leave free.
    const names = ["linear", "部署", "操作", "打包", "功能", "教学", "配置", "Bug"];
    const colors = names.map(fallbackLabelColor);
    expect(new Set(colors).size).toBe(names.length);
    expect(names.map(fallbackLabelColor)).toEqual(colors);
    expect(fallbackLabelColor("Bug")).toBe("#eb5757");
    expect(fallbackLabelColor("Feature")).toBe("#bb87fc");
  });

  it("gives the workspace options their project's key and loaded icon, so filter rows match the cards", async () => {
    const host = createFakePaseo({
      agents: [activeAgent("a", { status: "running" })],
      workspaces: [workspace()],
      projects: [PROJECT],
      withLabelsAndIcons: true,
      projectIcons: { "project-id": { data: "aW1hZ2U=", mimeType: "image/png" } },
    });
    const mounted = await mountTasks(host, "24h", false);
    try {
      expect(mounted.current.workspaces[0]).toMatchObject({ id: "ws", projectKey: "project-key", projectIcon: null });
      await act(async () => {
        mounted.current.requestProjectIcon("project-id");
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
      });
      expect(mounted.current.workspaces[0]!.projectIcon).toBe("data:image/png;base64,aW1hZ2U=");
      // A new revision drops the stale icon and fetches the new one, though no card asks again.
      await act(async () => {
        host.upsertProject({ ...PROJECT, projectIconRevision: "rev-2" });
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
      });
      expect(host.calls.filter((call) => call.method === "projects.icon")).toHaveLength(2);
      expect(mounted.current.workspaces[0]!.projectIcon).toBe("data:image/png;base64,aW1hZ2U=");
    } finally {
      mounted.unmount();
    }
  });

  it("reads icons from the server in one batch on a host whose API has no icon call", async () => {
    const host = createFakePaseo({
      agents: [activeAgent("a", { status: "running" })],
      workspaces: [workspace()],
      projects: [PROJECT, { ...PROJECT, projectId: "other", projectKey: "other-key" }],
    });
    const loader = vi.fn(async (projectIds: string[]) => projectIds.map((projectId) => ({ projectId, icon: projectId === "project-id" ? { data: "aW1hZ2U=", mimeType: "image/png", color: "#ff4d23" } : null })));
    setProjectIconsLoader(loader);
    try {
      const mounted = await mountTasks(host, "24h", false);
      try {
        await act(async () => {
          mounted.current.requestProjectIcon("project-id");
          mounted.current.requestProjectIcon("other");
          await new Promise((resolve) => setTimeout(resolve, 0));
          for (let index = 0; index < 4; index += 1) await Promise.resolve();
        });
        expect(loader.mock.calls).toEqual([[["project-id", "other"]]]);
        expect(mounted.current.byId.get("a")?.location.projectIcon).toBe("data:image/png;base64,aW1hZ2U=");
        // The server's theme colour for the icon rides along, for the subtask mark.
        expect(mounted.current.byId.get("a")?.location.projectIconColor).toBe("#ff4d23");
        // A project without an icon is answered too, so it is not asked again.
        await act(async () => {
          mounted.current.requestProjectIcon("other");
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(loader).toHaveBeenCalledTimes(1);
        expect(mounted.current.error).toBeNull();
      } finally {
        mounted.unmount();
      }
    } finally {
      setProjectIconsLoader(null);
    }
  });

  it("keeps the generated icons, without a board error, when the server cannot read them", async () => {
    const host = createFakePaseo({ agents: [activeAgent("a", { status: "running" })], workspaces: [workspace()], projects: [PROJECT] });
    setProjectIconsLoader(async () => {
      throw new Error("no daemon");
    });
    try {
      const mounted = await mountTasks(host, "24h", false);
      try {
        await act(async () => {
          mounted.current.requestProjectIcon("project-id");
          await new Promise((resolve) => setTimeout(resolve, 0));
          for (let index = 0; index < 4; index += 1) await Promise.resolve();
        });
        expect(mounted.current.byId.get("a")?.location.projectIcon).toBeNull();
        expect(mounted.current.error).toBeNull();
      } finally {
        mounted.unmount();
      }
    } finally {
      setProjectIconsLoader(null);
    }
  });

  it("refetches an icon whose project revision moved while the request was in flight", async () => {
    const host = createFakePaseo({
      agents: [activeAgent("a", { status: "running" })],
      workspaces: [workspace()],
      withLabelsAndIcons: true,
      projectIcons: { "project-id": { data: "aW1hZ2U=", mimeType: "image/png" } },
    });
    const mounted = await mountTasks(host, "24h", false);
    try {
      await act(async () => {
        mounted.current.requestProjectIcon("project-id");
        host.upsertProject(PROJECT);
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      });
      expect(mounted.current.byId.get("a")?.location.projectIcon).toBe("data:image/png;base64,aW1hZ2U=");
      expect(host.calls.filter((call) => call.method === "projects.icon")).toHaveLength(2);
    } finally {
      mounted.unmount();
    }
  });

  it("offers every provider enabled in Paseo to the Agent filter, cards or not, and follows the snapshot", async () => {
    const fake = createFakePaseo({
      agents: [activeAgent("a", { status: "running", provider: "claude" }), activeAgent("b", { status: "running", provider: "copilot" })],
      providerEntries: [
        { provider: "claude", label: "Claude" },
        { provider: "pi", label: "Pi" },
        { provider: "omp", label: "Oh My Pi", enabled: false, status: "unavailable" },
        { provider: "copilot", label: "Copilot", enabled: false },
        { provider: "acme", label: "Acme Agent" },
      ],
    });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      // Pi has no card yet; Copilot is disabled but a card ran on it; Oh My Pi is disabled and unused.
      expect(mounted.current.providers).toEqual([
        { id: "acme", label: "Acme Agent" },
        { id: "claude", label: "Claude" },
        { id: "copilot", label: "Copilot" },
        { id: "pi", label: "Pi" },
      ]);
      await act(async () => {
        fake.updateProviders([{ provider: "claude", label: "Claude" }, { provider: "grok", label: "Grok" }]);
        await Promise.resolve();
      });
      expect(mounted.current.providers.map((provider) => provider.id)).toEqual(["claude", "copilot", "grok"]);
    } finally {
      mounted.unmount();
    }
    expect(fake.openSubscriptions()).toBe(0);
  });

  it("falls back to the cards' providers on a host without the providers snapshot", async () => {
    const fake = createFakePaseo({ agents: [activeAgent("a", { status: "running", provider: "codex" })] });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      expect(mounted.current.providers).toEqual([{ id: "codex", label: "Codex" }]);
    } finally {
      mounted.unmount();
    }
  });

  it("loads model display names once per provider and preserves unchanged card identities", async () => {
    const catalog: PaseoProviderModelsResult["models"] = [{
      provider: "claude",
      id: "claude-opus-5-5",
      label: "Claude Opus 5.5",
      defaultThinkingOptionId: "high",
      thinkingOptions: [{ id: "high", label: "High", isDefault: true }],
    }];
    const fake = createFakePaseo({
      agents: [activeAgent("a", { status: "running" }), activeAgent("b", { status: "running" })],
      models: { claude: catalog },
    });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      expect(mounted.current.byId.get("a")?.modelLabel).toBe("Claude Opus 5.5");
      expect(mounted.current.byId.get("a")?.thinkingLabel).toBe("High");
      expect(fake.calls.filter((call) => call.method === "providers.listModels")).toHaveLength(1);
      const unchanged = mounted.current.byId.get("b");
      await act(async () => {
        fake.upsertAgent(activeAgent("a", { status: "running", updatedAt: at(11), title: "Updated A" }));
        await Promise.resolve();
      });
      expect(mounted.current.byId.get("a")?.title).toBe("Updated A");
      expect(mounted.current.byId.get("b")).toBe(unchanged);
    } finally {
      mounted.unmount();
    }
  });

  it("shares active subscriptions across hooks and releases them with the last consumer", async () => {
    const fake = createFakePaseo({ agents: [activeAgent("a", { status: "running" })] });
    let ready = false;
    let counts = { needsInput: 0, running: 0 };
    function BoardAndSidebar() {
      const board = useTasks(fake.paseo, { doneWindow: "24h", includeDone: true });
      const sidebar = useTaskCounts(fake.paseo, false);
      ready = board.ready && sidebar.ready;
      counts = { needsInput: sidebar.needsInput, running: sidebar.running };
      return null;
    }
    let renderer!: Renderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(BoardAndSidebar));
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    expect(ready).toBe(true);
    expect(counts.running).toBe(1);
    expect(fake.calls.filter((call) => call.method === "agents.list")).toHaveLength(3);
    expect(fake.openSubscriptions()).toBe(5);
    act(() => renderer.unmount());
    expect(fake.openSubscriptions()).toBe(0);
  });

  describe("sidebar counts", () => {
    async function mountCounts(fake: Fake, review = false) {
      let current!: ReturnType<typeof useTaskCounts>;
      let renders = 0;
      function Counts() {
        current = useTaskCounts(fake.paseo, review);
        renders += 1;
        return null;
      }
      let renderer!: Renderer;
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(Counts));
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      });
      return { get current() { return current; }, get renders() { return renders; }, unmount: () => act(() => renderer.unmount()) };
    }

    const permission = { id: "p", provider: "claude", name: "Bash", kind: "tool" as const };

    it("opens status and workspace subscriptions to distinguish background tasks", async () => {
      const fake = createFakePaseo({
        agents: [
          activeAgent("running", { status: "running" }),
          activeAgent("asking", { status: "running", pendingPermissions: [permission] }),
          activeAgent("unread", { status: "idle", requiresAttention: true, attentionReason: "finished" }),
          activeAgent("done", { status: "idle" }),
        ],
        workspaces: [workspace()],
        projects: [PROJECT],
        withLabelsAndIcons: true,
        models: { claude: [] },
      });
      const counts = await mountCounts(fake);
      try {
        expect(counts.current).toEqual({ needsInput: 1, running: 1, review: 0, ready: true });
        expect(fake.calls.map((call) => call.method)).toEqual(["agents.list", "workspaces.list"]);
        expect(fake.calls[0]?.input).toEqual({ filter: { statuses: ["running", "initializing", "error"], includeBackground: true }, subscribe: {} });
        expect(fake.openSubscriptions()).toBe(2);
      } finally {
        counts.unmount();
      }
      expect(fake.openSubscriptions()).toBe(0);
    });

    it("count what the board's filters leave on each lane, and count again when they change", async () => {
      const fake = createFakePaseo({
        agents: [
          activeAgent("parent", { status: "running", provider: "claude" }),
          activeAgent("child", { status: "running", provider: "claude", labels: { "paseo.parent-agent-id": "parent" } }),
          activeAgent("other", { status: "running", provider: "codex", workspaceId: "ws-2" }),
        ],
      });
      const unfiltered: CountScope = { filters: EMPTY_FILTERS };
      const hidden: CountScope = { filters: { ...EMPTY_FILTERS, hideSubtasks: true } };
      const claude: CountScope = { filters: { ...EMPTY_FILTERS, hideSubtasks: true, providers: ["claude"] } };
      let scope = unfiltered;
      let current!: ReturnType<typeof useTaskCounts>;
      function Counts() {
        current = useTaskCounts(fake.paseo, false, scope);
        return null;
      }
      let renderer!: Renderer;
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(Counts));
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      });
      try {
        expect(current.running).toBe(3);
        scope = hidden;
        act(() => renderer.update(React.createElement(Counts)));
        // The running child shows on its running parent's card, not as a card of its own.
        expect(current.running).toBe(2);
        scope = claude;
        act(() => renderer.update(React.createElement(Counts)));
        expect(current.running).toBe(1);
      } finally {
        act(() => renderer.unmount());
      }
    });

    it("follow live updates and re-render only when a number changes", async () => {
      const fake = createFakePaseo({ agents: [activeAgent("a", { status: "running" })] });
      const counts = await mountCounts(fake);
      try {
        const before = counts.renders;
        const shown = counts.current;
        await act(async () => {
          fake.upsertAgent(activeAgent("a", { status: "running", title: "Renamed", updatedAt: at(12) }));
          await Promise.resolve();
        });
        expect(counts.renders).toBe(before);
        expect(counts.current).toBe(shown);
        await act(async () => {
          fake.upsertAgent(activeAgent("b", { status: "running", pendingPermissions: [permission] }));
          await Promise.resolve();
        });
        expect(counts.current).toEqual({ needsInput: 1, running: 1, review: 0, ready: true });
        await act(async () => {
          fake.upsertAgent(activeAgent("a", { status: "idle", requiresAttention: true, attentionReason: "finished" }));
          await Promise.resolve();
        });
        expect(counts.current).toEqual({ needsInput: 1, running: 0, review: 0, ready: true });
      } finally {
        counts.unmount();
      }
    });

    it("shares the board's cards while open and keeps status and workspaces after", async () => {
      const fake = createFakePaseo({
        agents: [
          activeAgent("running", { status: "running" }),
          activeAgent("legacy", { status: "idle", requiresAttention: true, attentionReason: "permission" }),
          activeAgent("unread", { status: "idle", requiresAttention: true, attentionReason: "finished" }),
        ],
        workspaces: [workspace()],
        projects: [PROJECT],
      });
      const counts = await mountCounts(fake);
      try {
        expect(counts.current).toEqual({ needsInput: 0, running: 1, review: 0, ready: true });
        const board = await mountTasks(fake);
        expect(board.current.ready).toBe(true);
        expect(board.current.byId.get("running")?.location.branch).toBe("feature/tasks");
        // The board's attention subscription lists an old daemon's permission wait and the unread agent; the counts follow it.
        expect(counts.current).toEqual({ needsInput: 1, running: 1, review: 1, ready: true });
        expect(fake.openSubscriptions()).toBe(5);
        board.unmount();
        expect(fake.openSubscriptions()).toBe(2);
        expect(counts.current).toEqual({ needsInput: 0, running: 1, review: 0, ready: true });
        await act(async () => {
          fake.upsertAgent(activeAgent("second", { status: "running" }));
          await Promise.resolve();
        });
        expect(counts.current.running).toBe(2);
        const methods = fake.calls.map((call) => call.method);
        const reopened = await mountTasks(fake);
        try {
          expect(reopened.current.ready).toBe(true);
          expect(reopened.current.lanes.review.cards.map((card) => card.id)).toEqual(["unread"]);
          expect(reopened.current.byId.get("second")?.location.branch).toBe("feature/tasks");
          expect(fake.calls.slice(methods.length).map((call) => call.method).sort()).toEqual(["agents.list", "agents.list", "projects.list"]);
        } finally {
          reopened.unmount();
        }
      } finally {
        counts.unmount();
      }
      expect(fake.openSubscriptions()).toBe(0);
    });
    it("with the review count, list the unread and failed agents too and keep them past a board", async () => {
      const fake = createFakePaseo({
        agents: [
          activeAgent("running", { status: "running" }),
          activeAgent("asking", { status: "running", pendingPermissions: [permission] }),
          activeAgent("unread", { status: "idle", requiresAttention: true, attentionReason: "finished" }),
          activeAgent("failed", { status: "error", requiresAttention: true, attentionReason: "error" }),
          activeAgent("done", { status: "idle" }),
        ],
        workspaces: [workspace()],
        projects: [PROJECT],
      });
      const counts = await mountCounts(fake, true);
      try {
        expect(counts.current).toEqual({ needsInput: 1, running: 1, review: 2, ready: true });
        expect(fake.calls.map((call) => call.input)).toEqual([
          { filter: { statuses: ["running", "initializing", "error"], includeBackground: true }, subscribe: {} },
          { filter: { includeBackground: true }, subscribe: {} },
          { filter: { requiresAttention: true, includeBackground: true }, subscribe: {} },
        ]);
        expect(fake.calls.map((call) => call.method)).toEqual(["agents.list", "workspaces.list", "agents.list"]);
        expect(fake.openSubscriptions()).toBe(3);
        const board = await mountTasks(fake);
        expect(board.current.ready).toBe(true);
        expect(fake.calls.filter((call) => call.method === "agents.list")).toHaveLength(3);
        expect(fake.calls.filter((call) => call.method === "workspaces.list")).toHaveLength(1);
        board.unmount();
        expect(fake.openSubscriptions()).toBe(3);
        expect(counts.current).toEqual({ needsInput: 1, running: 1, review: 2, ready: true });
        await act(async () => {
          fake.upsertAgent(activeAgent("unread", { status: "idle", requiresAttention: false }));
          await Promise.resolve();
        });
        expect(counts.current.review).toBe(1);
      } finally {
        counts.unmount();
      }
      expect(fake.openSubscriptions()).toBe(0);
    });

    it("leave out the unread agents of an archived workspace, and show no review count until the workspaces arrive", async () => {
      const fake = createFakePaseo({
        agents: [
          activeAgent("unread", { status: "idle", requiresAttention: true, attentionReason: "finished" }),
          activeAgent("orphan-1", { workspaceId: "gone", status: "idle", requiresAttention: true, attentionReason: "finished" }),
          activeAgent("orphan-2", { workspaceId: "gone", status: "closed", requiresAttention: true, attentionReason: "finished" }),
        ],
        workspaces: [workspace()],
      });
      const list = fake.paseo.workspaces.list.bind(fake.paseo.workspaces);
      let releaseWorkspaces!: () => void;
      const gate = new Promise<void>((resolve) => { releaseWorkspaces = resolve; });
      (fake.paseo.workspaces as { list: unknown }).list = async (options: { subscribe: {} }) => {
        await gate;
        return list(options);
      };
      const counts = await mountCounts(fake, true);
      try {
        expect(counts.current).toEqual({ needsInput: 0, running: 0, review: 0, ready: false });
        await act(async () => {
          releaseWorkspaces();
          for (let index = 0; index < 8; index += 1) await Promise.resolve();
        });
        expect(counts.current).toEqual({ needsInput: 0, running: 0, review: 1, ready: true });
        // A board that comes and goes leaves the workspaces with the count: the orphans stay out.
        const board = await mountTasks(fake);
        expect(board.current.lanes.review.cards.map((card) => card.id)).toEqual(["unread"]);
        board.unmount();
        expect(counts.current.review).toBe(1);
      } finally {
        counts.unmount();
      }
      expect(fake.openSubscriptions()).toBe(0);
    });
  });

  it("holds the board on its skeleton until the unread agents and the workspaces arrive", async () => {
    const fake = createFakePaseo({
      agents: [activeAgent("running", { status: "running" }), activeAgent("unread", { status: "idle", requiresAttention: true, attentionReason: "finished" })],
      workspaces: [workspace()],
    });
    const list = fake.paseo.workspaces.list.bind(fake.paseo.workspaces);
    let releaseWorkspaces!: () => void;
    const gate = new Promise<void>((resolve) => { releaseWorkspaces = resolve; });
    (fake.paseo.workspaces as { list: unknown }).list = async (options: { subscribe: {} }) => {
      await gate;
      return list(options);
    };
    const mounted = await mountTasks(fake, "24h", false);
    try {
      expect(mounted.current.ready).toBe(false);
      await act(async () => {
        releaseWorkspaces();
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      });
      expect(mounted.current.ready).toBe(true);
      expect(mounted.current.byId.get("unread")?.location.workspaceName).toBe("Tasks workspace");
    } finally {
      mounted.unmount();
    }
  });

  it("reads model names only while a board is open", async () => {
    const catalog: PaseoProviderModelsResult["models"] = [{ provider: "claude", id: "claude-opus-5-5", label: "Claude Opus 5.5", thinkingOptions: [] }];
    const fake = createFakePaseo({ agents: [activeAgent("a", { status: "running" })], models: { claude: catalog } });
    let renderer!: Renderer;
    function Sidebar() {
      useTaskCounts(fake.paseo, false);
      return null;
    }
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(Sidebar));
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    try {
      expect(fake.calls.some((call) => call.method === "providers.listModels")).toBe(false);
      const board = await mountTasks(fake);
      expect(board.current.byId.get("a")?.modelLabel).toBe("Claude Opus 5.5");
      board.unmount();
      const again = await mountTasks(fake);
      expect(again.current.byId.get("a")?.modelLabel).toBe("Claude Opus 5.5");
      again.unmount();
      expect(fake.calls.filter((call) => call.method === "providers.listModels")).toHaveLength(1);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it("times the last turn from the server's record, not from a later updatedAt", async () => {
    const prompt = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const iso = (ms: number) => new Date(ms).toISOString();
    const loader = vi.fn(async (ids: string[]) => ids.includes("resumed")
      ? [{ agentId: "resumed", startedAt: prompt + 50, endedAt: prompt + 4 * 60_000 }]
      : []);
    setLastTurnLoader(loader);
    const fake = createFakePaseo({
      agents: [
        // Resumed a day after its turn ended: updatedAt moved, the turn did not.
        activeAgent("resumed", { status: "idle", lastUserMessageAt: iso(prompt), updatedAt: recentIso(60_000) }),
        activeAgent("unrecorded", { status: "idle", lastUserMessageAt: iso(prompt), updatedAt: recentIso(60_000) }),
        activeAgent("working", { status: "running", lastUserMessageAt: recentIso(30_000), activeTurn: { turnId: "t", startedAt: recentIso(30_000) } }),
      ],
      workspaces: [workspace()],
    });
    // Both ended two days ago, out of the 24h window.
    const mounted = await mountTasks(fake, "all");
    try {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
      });
      expect(loader).toHaveBeenCalledTimes(1);
      expect(mounted.current.byId.get("resumed")?.timing).toMatchObject({ lastTurnMs: 4 * 60_000 - 50, lastTurnEndedAt: iso(prompt + 4 * 60_000) });
      expect(mounted.current.byId.get("unrecorded")?.timing).toMatchObject({ lastTurnMs: null, lastTurnEndedAt: null });

      // A turn the board sees end is timed from its start to the update that ends it.
      const ended = Date.now();
      await act(async () => {
        fake.upsertAgent(activeAgent("working", { status: "idle", lastUserMessageAt: recentIso(30_000), activeTurn: null, updatedAt: iso(ended) }));
        await Promise.resolve();
      });
      const working = mounted.current.byId.get("working")!.timing;
      expect(working.lastTurnEndedAt).toBe(iso(ended));
      expect(working.lastTurnMs).toBeGreaterThanOrEqual(30_000);
      expect(working.lastTurnMs).toBeLessThan(31_000);
    } finally {
      mounted.unmount();
      setLastTurnLoader(null);
    }
  });

  it("keeps the done window and order on each task's own end, not on an agent the daemon just loaded", async () => {
    const day = 24 * 60 * 60 * 1000;
    const iso = (ms: number) => new Date(ms).toISOString();
    const now = Date.now();
    const loader = vi.fn(async (ids: string[]) => ids.includes("recorded")
      ? [{ agentId: "recorded", startedAt: now - 2 * day + 50, endedAt: now - 60 * 60_000 }]
      : []);
    setLastTurnLoader(loader);
    const fake = createFakePaseo({
      agents: [
        // Loaded from storage just now: updatedAt moved, nothing ended.
        activeAgent("stored", { status: "idle", lastUserMessageAt: iso(now - 9 * day), updatedAt: recentIso(1_000) }),
        // Its long turn began two days ago and ended an hour ago.
        activeAgent("recorded", { status: "idle", lastUserMessageAt: iso(now - 2 * day), updatedAt: recentIso(2_000) }),
        activeAgent("prompted", { status: "idle", lastUserMessageAt: iso(now - 10 * 60_000), updatedAt: recentIso(3_000) }),
      ],
      workspaces: [workspace()],
    });
    const mounted = await mountTasks(fake, "24h");
    try {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
      });
      expect(mounted.current.lanes.done.cards.map((card) => card.id)).toEqual(["prompted", "recorded"]);
      // The footer says when the turn ended, not when the daemon touched it.
      expect(cardTimer(mounted.current.byId.get("recorded")!, now, "en")?.text).toBe(`~47h · ${formatEnded(iso(now - 60 * 60_000), now, "en")}`);
    } finally {
      mounted.unmount();
      setLastTurnLoader(null);
    }
  });

  it("fills a running card's missing cost from the server's record", async () => {
    const loader = vi.fn(async (ids: string[]) => ids.map((agentId) => ({ agentId, endedAt: Date.now() - 60_000, totalCostUsd: 0.25 })));
    setLastTurnLoader(loader);
    const fake = createFakePaseo({
      agents: [
        // Claude's context update while it works replaced the usage, cost and all.
        activeAgent("working", { status: "running", lastUserMessageAt: recentIso(30_000), activeTurn: { turnId: "t", startedAt: recentIso(30_000) }, lastUsage: { contextWindowUsedTokens: 30_000, contextWindowMaxTokens: 200_000 } }),
        activeAgent("costed", { status: "running", lastUserMessageAt: recentIso(30_000), activeTurn: { turnId: "t", startedAt: recentIso(30_000) }, lastUsage: { outputTokens: 10, totalCostUsd: 0.4 } }),
      ],
      workspaces: [workspace()],
    });
    const mounted = await mountTasks(fake);
    try {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
      });
      expect(mounted.current.byId.get("working")?.usage).toEqual({ inputTokens: null, cachedInputTokens: null, outputTokens: null, totalCostUsd: 0.25 });
      // The agent's own figure wins.
      expect(mounted.current.byId.get("costed")?.usage?.totalCostUsd).toBe(0.4);
    } finally {
      mounted.unmount();
      setLastTurnLoader(null);
    }
  });

  it("fails a task whose last turn ended on an error, until it is prompted again", async () => {
    const prompt = Date.now() - 10 * 60_000;
    const iso = (ms: number) => new Date(ms).toISOString();
    const limit = "You've hit your session limit · resets 5:20pm (Asia/Singapore)";
    const loader = vi.fn(async (ids: string[]) => ids.flatMap((agentId) => {
      if (agentId === "limited") return [{ agentId, startedAt: prompt, endedAt: prompt + 2_000, error: limit }];
      if (agentId === "prompted") return [{ agentId, endedAt: prompt - 60_000, error: limit }];
      if (agentId === "working" && loader.mock.calls.length > 1) return [{ agentId, endedAt: Date.now(), error: "API Error: 529 Overloaded" }];
      return [];
    }));
    setLastTurnLoader(loader);
    const fake = createFakePaseo({
      agents: [
        activeAgent("limited", { status: "idle", lastUserMessageAt: iso(prompt), updatedAt: iso(prompt + 2_000) }),
        // Prompted again after the limit: that turn is someone else's story.
        activeAgent("prompted", { status: "idle", lastUserMessageAt: iso(prompt), updatedAt: iso(prompt + 2_000) }),
        // A Codex usage limit: idle once its attention is cleared, `lastError` kept.
        activeAgent("codex-limit", { provider: "codex", status: "idle", lastError: "You've hit your usage limit.", updatedAt: iso(prompt) }),
        activeAgent("working", { status: "running", lastUserMessageAt: recentIso(30_000), activeTurn: { turnId: "t", startedAt: recentIso(30_000) } }),
      ],
      workspaces: [workspace()],
    });
    // Fake before mounting: the board asks for the last turns on a timer it sets while mounting.
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const mounted = await mountTasks(fake);
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
      });
      expect(mounted.current.byId.get("limited")).toMatchObject({ lane: "review", status: "failed", error: limit, readable: true });
      expect(mounted.current.byId.get("prompted")).toMatchObject({ lane: "done", status: "done", error: null });
      expect(mounted.current.byId.get("codex-limit")).toMatchObject({ lane: "review", status: "failed", error: "You've hit your usage limit.", readable: true });
      expect(mounted.current.counts.review).toBe(2);

      // A turn the board sees end is asked about once the server has recorded it.
      await act(async () => {
        fake.upsertAgent(activeAgent("working", { status: "idle", lastUserMessageAt: recentIso(30_000), activeTurn: null, updatedAt: iso(Date.now()) }));
        await Promise.resolve();
      });
      expect(mounted.current.byId.get("working")?.lane).toBe("done");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
      });
      expect(loader.mock.calls.at(-1)?.[0]).toEqual(["working"]);
      expect(mounted.current.byId.get("working")).toMatchObject({ lane: "review", status: "failed", error: "API Error: 529 Overloaded" });

      // Prompted again: working, then done once the server's record has no error.
      await act(async () => {
        fake.upsertAgent(activeAgent("limited", { status: "running", updatedAt: iso(Date.now()), lastUserMessageAt: iso(Date.now()), activeTurn: { turnId: "t2", startedAt: iso(Date.now()) } }));
        await Promise.resolve();
      });
      expect(mounted.current.byId.get("limited")).toMatchObject({ lane: "running", error: null });
    } finally {
      vi.useRealTimers();
      mounted.unmount();
      setLastTurnLoader(null);
    }
  });

  it("matches a recorded turn to the latest prompt", () => {
    const timing = {
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-21T07:55:10.540Z",
      turnStartedAt: null,
      attentionAt: null,
      lastUserMessageAt: "2026-10-20T06:50:56.205Z",
      lastTurnMs: null,
      lastTurnEndedAt: null,
    };
    const prompt = Date.parse(timing.lastUserMessageAt);
    // No recorded start: timed from the prompt.
    expect(withLastTurn(timing, { startedAt: null, endedAt: prompt + 246_063 }, false).lastTurnMs).toBe(246_063);
    // Ended before the prompt: an earlier turn, unknown once the agent is done, the last one while it works.
    expect(withLastTurn(timing, { startedAt: prompt - 9_000, endedAt: prompt - 1_000 }, false)).toBe(timing);
    expect(withLastTurn(timing, { startedAt: prompt - 9_000, endedAt: prompt - 1_000 }, true).lastTurnMs).toBe(8_000);
    expect(withLastTurn(timing, { startedAt: null, endedAt: prompt - 1_000 }, true)).toBe(timing);
  });

  describe("provider subagents", () => {
    const PROMPT = "2026-10-22T09:10:56.339Z";
    function subagent(id: string, overrides: Partial<ProviderSubagent> = {}): ProviderSubagent {
      return {
        id,
        parentAgentId: "parent",
        provider: "claude",
        title: "general-purpose",
        description: `RRD-${id} task`,
        status: "failed",
        createdAt: "2026-10-22T09:12:00.000Z",
        updatedAt: "2026-10-22T09:18:55.000Z",
        subtitle: "general-purpose · Opus 5.5 · High · 189.7k tokens",
        ...overrides,
      };
    }
    function doneCard(): TaskCard {
      const card = sampleCards(Date.parse("2026-10-22T10:00:00.000Z")).find((sample) => sample.lane === "done")!;
      return { ...card, id: "parent", status: "done", error: null, children: [], timing: { ...card.timing, lastUserMessageAt: PROMPT } };
    }

    it("marks a finished parent failed in review, with a row per failure since its prompt", () => {
      const card = withSubagents(doneCard(), [subagent("b", { createdAt: "2026-10-22T09:13:00.000Z" }), subagent("a"), subagent("c", { status: "running", createdAt: "2026-10-22T09:14:00.000Z" })]);
      expect(card).toMatchObject({ lane: "review", status: "failed", error: "2 subagents failed" });
      expect(card.children.map((child) => [child.id, child.kind, child.status, child.title])).toEqual([
        ["a", "provider", "failed", "RRD-a task"],
        ["b", "provider", "failed", "RRD-b task"],
        ["c", "provider", "running", "RRD-c task"],
      ]);
      expect(card.children[0]).toMatchObject({ provider: card.provider, subtitle: "general-purpose · Opus 5.5 · High · 189.7k tokens", subagentType: "general-purpose", lane: "review" });
      expect(card.children[0]!.timing).toMatchObject({ lastTurnMs: 6 * 60_000 + 55_000, lastTurnEndedAt: "2026-10-22T09:18:55.000Z" });
    });

    it("gives each provider subagent a read-only card in its own lane, hidden with subtasks while its parent shares the lane", () => {
      const running: TaskCard = {
        ...doneCard(),
        lane: "running",
        status: "running",
        labels: [{ name: "perf", color: null }],
        timing: { ...doneCard().timing, turnStartedAt: "2026-10-22T09:11:00.000Z" },
      };
      const parent = withSubagents(running, [subagent("a"), subagent("c", { status: "running", createdAt: "2026-10-22T09:14:00.000Z" })]);
      const early: TaskCard = { ...running, id: "early", children: [], timing: { ...running.timing, turnStartedAt: "2026-10-22T09:00:00.000Z" } };
      const late: TaskCard = { ...running, id: "late", children: [], timing: { ...running.timing, turnStartedAt: "2026-10-22T09:20:00.000Z" } };
      const empty = (id: LaneId): LaneModel => ({ id, cards: [], hasMore: false, loading: false });
      const lanes = Object.fromEntries(LANE_ORDER.map((id) => [id, empty(id)])) as Record<LaneId, LaneModel>;
      lanes.running = { ...lanes.running, cards: [early, parent, late] };
      const withCards = withSubagentCards(lanes);
      // Merged in by the lane's own order: the running one by its start, the failed one in review.
      expect(withCards.running.cards.map((card) => card.id)).toEqual(["early", "parent", "c", "late"]);
      expect(withCards.review.cards.map((card) => card.id)).toEqual(["a"]);
      expect(withCards.review.cards[0]).toMatchObject({
        title: "RRD-a task",
        status: "failed",
        stoppable: false,
        openTab: false,
        children: [],
        labels: running.labels,
        location: running.location,
        parent: { id: "parent", title: running.title, missing: false, archived: false },
        subagent: { subtitle: "general-purpose · Opus 5.5 · High · 189.7k tokens", type: "general-purpose" },
        // Its model and effort as an agent's, for the model pill and the details' chips.
        modelLabel: "Opus 5.5",
        thinkingLabel: "High",
      });
      // The same parent card gives the same subagent cards, so a memoized card skips its render.
      expect(withSubagentCards(lanes).running.cards[2]).toBe(withCards.running.cards[2]);
      const noSubagents = { ...lanes, running: { ...lanes.running, cards: [early, late] } };
      expect(withSubagentCards(noSubagents)).toBe(noSubagents);

      const filters = { query: "", workspaceIds: [], providers: [], labels: [], hideSubtasks: true };
      const hidden = filterLanes(withCards, filters);
      expect(hidden.running.cards.map((card) => card.id)).toEqual(["early", "parent", "late"]);
      expect(hidden.review.cards.map((card) => card.id)).toEqual(["a"]);
      expect(filterLanes(withCards, { ...filters, hideSubtasks: false }).running.cards.map((card) => card.id)).toEqual(["early", "parent", "c", "late"]);
      // An archived parent's subagents get no card.
      const archived = { ...lanes, running: empty("running"), archived: { ...lanes.archived, cards: [{ ...parent, lane: "archived" as const }] } };
      expect(withSubagentCards(archived)).toBe(archived);
    });

    it("reads the type off the facts line where the descriptor has no title, and names no inherited model", () => {
      const running: TaskCard = { ...doneCard(), lane: "running", status: "running", timing: { ...doneCard().timing, turnStartedAt: "2026-10-22T09:11:00.000Z" } };
      const parent = withSubagents(running, [subagent("bg", { title: null, description: null, status: "running", subtitle: "general-purpose · High · 518k tokens" })]);
      expect(parent.children[0]).toMatchObject({ title: "Subagent", subagentType: "general-purpose" });
      const empty = (id: LaneId): LaneModel => ({ id, cards: [], hasMore: false, loading: false });
      const lanes = Object.fromEntries(LANE_ORDER.map((id) => [id, empty(id)])) as Record<LaneId, LaneModel>;
      lanes.running = { ...lanes.running, cards: [parent] };
      expect(withSubagentCards(lanes).running.cards[1]).toMatchObject({
        subagent: { subtitle: "general-purpose · High · 518k tokens", type: "general-purpose" },
        modelLabel: null,
        thinkingLabel: "High",
      });
    });

    it("lets a failure go once the parent is prompted after it, and keeps a working parent's lane", () => {
      const prompted = { ...doneCard(), timing: { ...doneCard().timing, lastUserMessageAt: "2026-10-22T09:30:00.000Z" } };
      expect(withSubagents(prompted, [subagent("a")])).toBe(prompted);
      const running = { ...doneCard(), lane: "running" as const, status: "running" as const };
      const shown = withSubagents(running, [subagent("a")]);
      expect(shown).toMatchObject({ lane: "running", status: "running", error: null });
      expect(shown.children.map((child) => child.status)).toEqual(["failed"]);
      // A failure of its own keeps its own reason.
      const failed = { ...doneCard(), lane: "review" as const, status: "failed" as const, error: "API error" };
      expect(withSubagents(failed, [subagent("a")]).error).toBe("API error");
    });

    it("moves a done parent to review on the board and drops it when the failures go", async () => {
      let answer: ProviderSubagent[] = [subagent("a"), subagent("b")];
      let version = 1;
      const loader = vi.fn(async (since?: string) => (since === String(version) ? { version: String(version), subagents: null } : { version: String(version), subagents: answer }));
      setSubagentLoader(loader);
      const fake = createFakePaseo({
        agents: [activeAgent("parent", { status: "idle", lastUserMessageAt: PROMPT, updatedAt: recentIso(60_000) })],
        workspaces: [workspace()],
      });
      // Prompted on a fixed day, so the done lane needs every day.
      const mounted = await mountTasks(fake, "all");
      try {
        await act(async () => {
          await vi.waitFor(() => expect(mounted.current.lanes.review.cards.map((card) => card.id)).toEqual(["parent"]));
        });
        expect(mounted.current.byId.get("parent")).toMatchObject({ status: "failed", error: "2 subagents failed" });
        expect(mounted.current.counts).toMatchObject({ review: 1, done: 0 });

        answer = [];
        version = 2;
        // An agent update brings the next read forward.
        await act(async () => {
          fake.upsertAgent(activeAgent("other", { status: "running" }));
          await new Promise((resolve) => setTimeout(resolve, 1_600));
        });
        await act(async () => {
          await vi.waitFor(() => expect(mounted.current.byId.get("parent")).toMatchObject({ lane: "done", status: "done", error: null, children: [] }));
        });
      } finally {
        mounted.unmount();
        setSubagentLoader(null);
      }
    });

    it("counts a running subagent's card in the sidebar's running count, as the board's lane does", async () => {
      setSubagentLoader(async () => ({ version: "1", subagents: [subagent("a", { status: "running" })] }));
      const fake = createFakePaseo({ agents: [activeAgent("parent", { status: "running" })] });
      let current!: ReturnType<typeof useTaskCounts>;
      function Counts() {
        current = useTaskCounts(fake.paseo, true);
        return null;
      }
      let renderer!: Renderer;
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(Counts));
        await new Promise((resolve) => setTimeout(resolve, 0));
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      });
      try {
        await act(async () => {
          await vi.waitFor(() => expect(current.running).toBe(2));
        });
        expect(current).toEqual({ needsInput: 0, running: 2, review: 0, ready: true });
      } finally {
        act(() => renderer.unmount());
        setSubagentLoader(null);
      }
    });

    it("brings a failed parent no list holds into the review count, by id", async () => {
      setSubagentLoader(async () => ({ version: "1", subagents: [subagent("a")] }));
      const fake = createFakePaseo({
        agents: [
          activeAgent("parent", { status: "idle", lastUserMessageAt: PROMPT }),
          activeAgent("running", { status: "running" }),
        ],
      });
      let current!: ReturnType<typeof useTaskCounts>;
      function Counts() {
        current = useTaskCounts(fake.paseo, true);
        return null;
      }
      let renderer!: Renderer;
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(Counts));
        await new Promise((resolve) => setTimeout(resolve, 0));
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      });
      try {
        await act(async () => {
          await vi.waitFor(() => expect(current.review).toBe(2));
        });
        // The parent and its failed subagent's card, as the board's review lane shows them.
        expect(current).toEqual({ needsInput: 0, running: 1, review: 2, ready: true });
        expect(fake.calls.filter((call) => call.method === "agents.ref.refresh").map((call) => call.input)).toEqual([{ agentId: "parent" }]);
      } finally {
        act(() => renderer.unmount());
        setSubagentLoader(null);
      }
    });
  });
  describe("subtasks still at work", () => {
    function doneParent(children: TaskCard["children"]): TaskCard {
      const card = sampleCards(Date.parse("2026-10-22T10:00:00.000Z")).find((sample) => sample.lane === "done")!;
      return { ...card, id: "parent", status: "done", error: null, children };
    }
    const child = (status: TaskCard["status"]) => ({ id: `child-${status}`, title: status, status });

    it("moves a finished parent to the running lane while a subtask runs or waits", () => {
      for (const status of ["running", "needs_input"] as const) {
        expect(withActiveSubtasks(doneParent([child("done"), child(status)]))).toMatchObject({ lane: "running", status: "running", waitingOnSubtasks: true, readable: false });
      }
      const review = { ...doneParent([child("running")]), lane: "review" as const, status: "unread" as const, readable: true };
      expect(withActiveSubtasks(review)).toMatchObject({ lane: "running", status: "running", readable: false });
      const settled = doneParent([child("done"), child("unread"), child("failed")]);
      expect(withActiveSubtasks(settled)).toBe(settled);
      const failed = { ...doneParent([child("running")]), lane: "review" as const, status: "failed" as const, error: "API error" };
      expect(withActiveSubtasks(failed)).toBe(failed);
      const working = { ...doneParent([child("running")]), lane: "running" as const, status: "running" as const };
      expect(withActiveSubtasks(working)).toBe(working);
    });

    it("times a waiting parent by its subtasks' work: from the earliest one still at work", () => {
      const started = (status: TaskCard["status"], msAgo: number | null, now: number) => ({
        ...child(status),
        lane: status === "needs_input" ? ("needs_input" as const) : ("running" as const),
        timing: { ...doneParent([]).timing, turnStartedAt: msAgo === null ? null : new Date(now - msAgo).toISOString() },
      });
      const now = Date.parse("2026-10-22T10:30:00.000Z");
      const card = withActiveSubtasks(doneParent([started("running", 65_000, now), started("needs_input", 125_000, now), started("done", 600_000, now), started("running", null, now)]));
      expect(cardTimer(card, now, "en")).toEqual({ text: "2m 5s", tone: "muted" });
      expect(cardStart(card, now)).toBe(cardStart({ lane: "running", timing: { ...card.timing, turnStartedAt: new Date(now - 125_000).toISOString() } }, now));
      // A subtask without a start (itself waiting on its own) leaves the last turn's timer.
      const unstarted = withActiveSubtasks(doneParent([started("running", null, now)]));
      expect(cardTimer(unstarted, now, "en")?.text).toBe(cardTimer({ ...unstarted, lane: "done" }, now, "en")?.text);
      expect(cardStart(unstarted, now)).toBeNull();
    });

    it("times a waiting parent by its last turn, not as a turn that is starting", () => {
      const card = withActiveSubtasks(doneParent([child("running")]));
      const now = Date.parse(card.timing.updatedAt) + 60_000;
      expect(cardTimer(card, now, "en")).not.toMatchObject({ tone: "running" });
      expect(cardTimer(card, now, "en")?.text).toBe(cardTimer({ ...card, lane: "done" }, now, "en")?.text);
      expect(cardStart({ ...card, timing: { ...card.timing, turnStartedAt: card.timing.updatedAt } }, now)).toBeNull();
    });

    it("keeps a parent and its parent running until the last grandchild stops", async () => {
      const fake = createFakePaseo({
        agents: [
          activeAgent("parent", { status: "idle", updatedAt: recentIso(120_000) }),
          activeAgent("child", { status: "idle", updatedAt: recentIso(60_000), labels: { "paseo.parent-agent-id": "parent" } }),
          activeAgent("grandchild", { status: "running", labels: { "paseo.parent-agent-id": "child" } }),
        ],
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake);
      try {
        expect(mounted.current.lanes.running.cards.map((card) => card.id).sort()).toEqual(["child", "grandchild", "parent"]);
        expect(mounted.current.byId.get("parent")).toMatchObject({ status: "running", waitingOnSubtasks: true, stoppable: false });
        expect(mounted.current.byId.get("parent")?.children).toEqual([expect.objectContaining({ id: "child", status: "running", lane: "running", waitingOnSubtasks: true })]);
        expect(mounted.current.byId.get("grandchild")?.waitingOnSubtasks).toBeUndefined();

        await act(async () => {
          fake.upsertAgent(activeAgent("grandchild", { status: "idle", updatedAt: recentIso(0), labels: { "paseo.parent-agent-id": "child" } }));
          await Promise.resolve();
        });
        expect(mounted.current.lanes.running.cards).toEqual([]);
        expect(mounted.current.byId.get("parent")).toMatchObject({ lane: "done", status: "done" });
        expect(mounted.current.byId.get("parent")?.waitingOnSubtasks).toBeUndefined();
        expect(mounted.current.byId.get("child")).toMatchObject({ lane: "done", status: "done" });
      } finally {
        mounted.unmount();
      }
    });
  });
});

describe("Tasks data store, archived lane", () => {
  async function mountArchived(fake: Fake, includeArchived: boolean, doneWindow: "24h" | "7d" | "all" = "24h") {
    let current!: TasksHandle;
    let setArchived!: (on: boolean) => void;
    function Probe() {
      const [archived, set] = React.useState(includeArchived);
      setArchived = set;
      current = useTasks(fake.paseo, React.useMemo(() => ({ doneWindow, includeDone: true, includeArchived: archived }), [archived]));
      return null;
    }
    let renderer!: Renderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(Probe));
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    return {
      get current() { return current; },
      async setArchived(on: boolean) {
        await act(async () => {
          setArchived(on);
          for (let index = 0; index < 8; index += 1) await Promise.resolve();
        });
      },
      unmount: () => act(() => renderer.unmount()),
    };
  }

  const ids = (lane: LaneModel) => lane.cards.map((card) => card.id);

  it("lists archived tasks and an archived workspace's in their own lane, in the done window, only when asked", async () => {
    const fake = createFakePaseo({
      agents: [
        activeAgent("done", { status: "idle", updatedAt: recentIso(1_000) }),
        activeAgent("archived", { status: "closed", updatedAt: recentIso(2_000), archivedAt: recentIso(2_000), lastError: "boom" }),
        activeAgent("archived-old", { status: "closed", updatedAt: recentIso(3 * 86_400_000), archivedAt: recentIso(3 * 86_400_000) }),
        // Its workspace was archived without it.
        activeAgent("stale", { status: "idle", updatedAt: recentIso(3_000), workspaceId: "ws-archived" }),
        activeAgent("running", { status: "running", activeTurn: { turnId: "t", startedAt: recentIso(4_000) } }),
      ],
      workspaces: [workspace()],
    });
    const off = await mountArchived(fake, false);
    try {
      expect(ids(off.current.lanes.done)).toEqual(["done"]);
      expect(ids(off.current.lanes.archived)).toEqual([]);
      expect(off.current.byId.has("archived")).toBe(false);
      expect(off.current.byId.has("stale")).toBe(false);
      // Off, the done list asks for no archived agent.
      const doneLists = fake.calls.filter((call) => call.method === "agents.list" && (call.input as { filter?: { statuses?: string[] } }).filter?.statuses?.includes("idle"));
      expect(doneLists.map((call) => (call.input as { filter: { includeArchived?: boolean } }).filter.includeArchived)).toEqual([undefined]);

      await off.setArchived(true);
      expect(ids(off.current.lanes.done)).toEqual(["done"]);
      expect(ids(off.current.lanes.archived)).toEqual(["archived", "stale"]);
      expect(off.current.counts.archived).toBe(2);
      expect(off.current.byId.get("archived")).toMatchObject({ lane: "archived", status: "archived", archived: "agent", readable: false });
      expect(off.current.byId.get("stale")).toMatchObject({ lane: "archived", status: "archived", archived: "workspace" });
      expect(ids(off.current.lanes.running)).toEqual(["running"]);
      const last = fake.calls.filter((call) => call.method === "agents.list").at(-1)!.input as { filter: { includeArchived?: boolean } };
      expect(last.filter.includeArchived).toBe(true);

      await off.setArchived(false);
      expect(ids(off.current.lanes.archived)).toEqual([]);
      expect(off.current.byId.has("archived")).toBe(false);
      expect(off.current.byId.has("stale")).toBe(false);
      expect(ids(off.current.lanes.done)).toEqual(["done"]);
    } finally {
      off.unmount();
    }
  });

  it("draws a switch that turns the lane on ahead of its setting in one render, and the lane once its list lands", async () => {
    const fake = createFakePaseo({
      agents: [
        activeAgent("done", { status: "idle", updatedAt: recentIso(1_000) }),
        activeAgent("archived", { status: "closed", updatedAt: recentIso(2_000), archivedAt: recentIso(2_000) }),
      ],
      workspaces: [workspace()],
    });
    let renders = 0;
    let current!: TasksHandle;
    let setArchived!: (on: boolean) => void;
    function Probe() {
      const [archived, set] = React.useState(false);
      setArchived = set;
      renders += 1;
      current = useTasks(fake.paseo, React.useMemo(() => ({ doneWindow: "24h" as const, includeDone: true, includeArchived: archived }), [archived]));
      return null;
    }
    let renderer!: Renderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(Probe));
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    try {
      const before = renders;
      const doneLists = () => fake.calls.filter((call) => call.method === "agents.list" && (call.input as { filter?: { statuses?: string[] } }).filter?.statuses?.includes("idle"));
      const listsBefore = doneLists().length;
      act(() => {
        setTasksArchivedLane(fake.paseo, true);
        setArchived(true);
      });
      // The store's switch and the setting's in one render: the layout effect finds the lane already on.
      expect(renders - before).toBe(1);
      expect(doneLists()).toHaveLength(listsBefore + 1);
      expect(current.lanes.archived.initialLoading).toBe(true);
      await act(async () => {
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      });
      expect(ids(current.lanes.archived)).toEqual(["archived"]);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it("tags a child's parent archived, itself or with its workspace, while the archived lane shows it", async () => {
    const fake = createFakePaseo({
      agents: [
        activeAgent("archived", { status: "closed", updatedAt: recentIso(2_000), archivedAt: recentIso(2_000) }),
        activeAgent("stale", { status: "idle", updatedAt: recentIso(3_000), workspaceId: "ws-archived" }),
        activeAgent("live", { status: "idle", updatedAt: recentIso(4_000) }),
        activeAgent("child-a", { status: "running", labels: { "paseo.parent-agent-id": "archived" } }),
        activeAgent("child-w", { status: "running", labels: { "paseo.parent-agent-id": "stale" } }),
        activeAgent("child-l", { status: "running", labels: { "paseo.parent-agent-id": "live" } }),
      ],
      workspaces: [workspace()],
    });
    const on = await mountArchived(fake, true);
    try {
      expect(on.current.byId.get("child-a")?.parent).toMatchObject({ id: "archived", missing: false, archived: false, archivedAs: "agent" });
      expect(on.current.byId.get("child-w")?.parent).toMatchObject({ id: "stale", missing: false, archivedAs: "workspace" });
      expect(on.current.byId.get("child-l")?.parent).not.toHaveProperty("archivedAs");
    } finally {
      on.unmount();
    }
  });

  it("moves the board's count once per switch, keeping the cards until the new done list lands", async () => {
    const fake = createFakePaseo({
      agents: [
        activeAgent("done", { status: "idle", updatedAt: recentIso(1_000) }),
        activeAgent("archived", { status: "closed", updatedAt: recentIso(2_000), archivedAt: recentIso(2_000) }),
        activeAgent("stale", { status: "idle", updatedAt: recentIso(3_000), workspaceId: "ws-archived" }),
        activeAgent("running", { status: "running", activeTurn: { turnId: "t", startedAt: recentIso(4_000) } }),
      ],
      workspaces: [workspace()],
    });
    const totals: number[] = [];
    let setArchived!: (on: boolean) => void;
    function Probe() {
      const [archived, set] = React.useState(false);
      setArchived = set;
      const tasks = useTasks(fake.paseo, React.useMemo(() => ({ doneWindow: "24h" as const, includeDone: true, includeArchived: archived }), [archived]));
      totals.push(LANE_ORDER.reduce((sum, lane) => sum + (lane === "archived" && !archived ? 0 : tasks.lanes[lane].cards.length), 0));
      return null;
    }
    let renderer!: Renderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(Probe));
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    try {
      const lists = () => fake.calls.filter((call) => call.method === "agents.list").length;
      const listsBefore = lists();
      const settled = totals.at(-1)!;
      expect(settled).toBe(2);
      totals.length = 0;
      await act(async () => {
        setArchived(true);
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      });
      expect(new Set(totals)).toEqual(new Set([2, 4]));
      expect(totals.indexOf(4)).toBe(totals.lastIndexOf(2) + 1);
      // Only the done list is read again; the board keeps its other subscriptions.
      expect(lists()).toBe(listsBefore + 1);

      totals.length = 0;
      await act(async () => {
        setArchived(false);
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      });
      expect(new Set(totals)).toEqual(new Set([2]));
      expect(lists()).toBe(listsBefore + 2);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it("widens with the done window and pages with the done lane", async () => {
    const fake = createFakePaseo({
      agents: [
        ...Array.from({ length: 50 }, (_, index) => activeAgent("done-" + index, { status: "idle", updatedAt: recentIso(1_000 + index * 1_000) })),
        activeAgent("archived-late", { status: "closed", updatedAt: recentIso(60_000), archivedAt: recentIso(60_000) }),
        activeAgent("archived-old", { status: "closed", updatedAt: recentIso(3 * 86_400_000), archivedAt: recentIso(3 * 86_400_000) }),
      ],
      workspaces: [workspace()],
    });
    const mounted = await mountArchived(fake, true, "all");
    try {
      expect(ids(mounted.current.lanes.archived)).toEqual([]);
      expect(mounted.current.lanes.archived.hasMore).toBe(true);
      await act(async () => {
        mounted.current.loadMoreDone();
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      });
      expect(ids(mounted.current.lanes.archived)).toEqual(["archived-late", "archived-old"]);
      expect(mounted.current.lanes.archived.hasMore).toBe(false);
      expect(mounted.current.lanes.done.cards).toHaveLength(50);
    } finally {
      mounted.unmount();
    }
  });

  it("moves a task archived on the board into the lane, and back when it is unarchived", async () => {
    const fake = createFakePaseo({
      agents: [activeAgent("task", { status: "idle", title: "Task", updatedAt: recentIso(1_000) })],
      workspaces: [workspace()],
    });
    const mounted = await mountArchived(fake, true);
    try {
      expect(mounted.current.byId.get("task")?.lane).toBe("done");
      await act(async () => {
        fake.upsertAgent(activeAgent("task", { status: "closed", title: "Task", updatedAt: recentIso(0), archivedAt: recentIso(0) }));
        await Promise.resolve();
      });
      expect(ids(mounted.current.lanes.done)).toEqual([]);
      expect(ids(mounted.current.lanes.archived)).toEqual(["task"]);
      await act(async () => {
        fake.upsertAgent(activeAgent("task", { status: "closed", title: "Task", updatedAt: recentIso(0), archivedAt: null }));
        await Promise.resolve();
      });
      expect(ids(mounted.current.lanes.archived)).toEqual([]);
      expect(ids(mounted.current.lanes.done)).toEqual(["task"]);
    } finally {
      mounted.unmount();
    }
  });

  it("keeps archived children off a live parent and links them to it", async () => {
    const fake = createFakePaseo({
      agents: [
        activeAgent("parent", { status: "idle", title: "Parent", updatedAt: recentIso(1_000) }),
        activeAgent("child", { status: "closed", title: "Child", updatedAt: recentIso(2_000), archivedAt: recentIso(2_000), labels: { "paseo.parent-agent-id": "parent" } }),
      ],
      workspaces: [workspace()],
    });
    const mounted = await mountArchived(fake, true);
    try {
      expect(mounted.current.byId.get("parent")?.children).toEqual([]);
      expect(mounted.current.byId.get("child")?.parent).toEqual({ id: "parent", title: "Parent", missing: false, archived: false });
    } finally {
      mounted.unmount();
    }
  });

  it("orders the archived lane by archive time, newest first, ahead of a later update", async () => {
    const fake = createFakePaseo({
      agents: [
        // Touched after an older archive: its updatedAt must not put it first.
        activeAgent("touched", { status: "closed", updatedAt: recentIso(60_000), archivedAt: recentIso(3 * 86_400_000) }),
        activeAgent("fresh", { status: "closed", updatedAt: recentIso(2 * 86_400_000), archivedAt: recentIso(30 * 60_000) }),
        activeAgent("workspace", { status: "idle", updatedAt: recentIso(2 * 86_400_000), workspaceId: "ws-old" }),
      ],
      workspaces: [
        workspace(),
        makeWorkspace({ id: "ws-old", archivingAt: recentIso(5 * 60_000) }),
      ],
    });
    const mounted = await mountArchived(fake, true, "all");
    try {
      expect(ids(mounted.current.lanes.archived)).toEqual(["workspace", "fresh", "touched"]);
      await act(async () => {
        fake.removeWorkspace("ws-old");
        await Promise.resolve();
      });
      // The list drops the workspace; the archive time it already reported still orders the card.
      expect(ids(mounted.current.lanes.archived)).toEqual(["workspace", "fresh", "touched"]);
    } finally {
      mounted.unmount();
    }
  });

  it("keeps the 24h window on archive time, so a later update does not bring an old archive back", async () => {
    const fake = createFakePaseo({
      agents: [
        activeAgent("touched", { status: "closed", updatedAt: recentIso(60_000), archivedAt: recentIso(3 * 86_400_000) }),
        activeAgent("fresh", { status: "closed", updatedAt: recentIso(2 * 86_400_000), archivedAt: recentIso(30 * 60_000) }),
      ],
      workspaces: [workspace()],
    });
    const mounted = await mountArchived(fake, true, "24h");
    try {
      expect(ids(mounted.current.lanes.archived)).toEqual(["fresh"]);
    } finally {
      mounted.unmount();
    }
  });
});
