import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { PaseoProject, PaseoProviderModelsResult } from "@getpaseo/client";
import { filterLanes, setLastTurnLoader, setSubagentLoader, useTaskCounts, useTasks, withLastTurn, withSubagents, type TasksHandle } from "../../client/tasks/data";
import type { ProviderSubagent } from "../../shared/tasks-rpc";
import { LANE_ORDER, type LaneId, type LaneModel, type TaskCard } from "../../client/tasks/model";
import { sampleCards } from "../../client/tasks/sample-cards";
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

function activeAgent(id: string, overrides: Partial<ReturnType<typeof makeAgent>> = {}) {
  return makeAgent({ id, workspaceId: "ws", ...overrides });
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

function recentIso(ageMs: number) {
  return new Date(Date.now() - ageMs).toISOString();
}

describe("Tasks data store", () => {
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
        openTabsOnly: false,
        hideSubtasks: false,
      }).running.cards.map((card) => card.id)).toEqual(["running-early", "running-late"]);
    } finally {
      mounted.unmount();
    }
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
      parent: { id: parentId, title: "Orchestrator parent", missing: false },
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
      openTabsOnly: false,
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

  it("indexes parent and direct child cards, and resolves a missing parent's title once", async () => {
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
      expect(mounted.current.byId.get("child")?.parent).toEqual({ id: "parent", title: "Parent task", missing: false });
      expect(mounted.current.byId.get("orphan")?.parent).toEqual({ id: "archived-parent", title: null, missing: true });
      await act(async () => {
        fake.upsertAgent(activeAgent("later-child", { status: "running", title: "Later child", labels: { "paseo.parent-agent-id": "parent" } }));
        await Promise.resolve();
      });
      expect(mounted.current.byId.get("parent")?.children.map((child) => child.id)).toEqual(["child", "later-child"]);
      await act(async () => {
        mounted.current.resolveParent("archived-parent");
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
      });
      expect(mounted.current.byId.get("orphan")?.parent).toEqual({ id: "archived-parent", title: "Archived parent", missing: true });
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

  it("detects optional labels and icons, maps tag colours, and caches icons by revision", async () => {
    const agent = activeAgent("a", { status: "running", labels: { "paseo.open-agent-tab.a": "true" } });
    const oldHost = createFakePaseo({ agents: [agent], workspaces: [workspace(["bug"])] });
    const oldMounted = await mountTasks(oldHost, "24h", false);
    try {
      expect(oldMounted.current.byId.get("a")?.labels).toEqual([{ name: "bug", color: null }]);
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
      expect(freshMounted.current.byId.get("a")?.labels).toEqual([{ name: "bug", color: "#9c4243" }]);
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
      // A new revision drops the stale icon until it is fetched again.
      await act(async () => {
        host.upsertProject({ ...PROJECT, projectIconRevision: "rev-2" });
        await Promise.resolve();
      });
      expect(mounted.current.workspaces[0]!.projectIcon).toBeNull();
    } finally {
      mounted.unmount();
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

    it("open one status subscription and nothing the board alone needs", async () => {
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
        expect(fake.calls.map((call) => call.method)).toEqual(["agents.list"]);
        expect(fake.calls[0]?.input).toEqual({ filter: { statuses: ["running", "initializing", "error"] }, subscribe: {} });
        expect(fake.openSubscriptions()).toBe(1);
      } finally {
        counts.unmount();
      }
      expect(fake.openSubscriptions()).toBe(0);
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

    it("share the board's cards while it is open and drop back to one subscription after", async () => {
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
        expect(fake.openSubscriptions()).toBe(1);
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
          expect(fake.calls.slice(methods.length).map((call) => call.method).sort()).toEqual(["agents.list", "agents.list", "projects.list", "workspaces.list"]);
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
          { filter: { statuses: ["running", "initializing", "error"] }, subscribe: {} },
          { filter: { requiresAttention: true }, subscribe: {} },
        ]);
        expect(fake.openSubscriptions()).toBe(2);
        const board = await mountTasks(fake);
        expect(board.current.ready).toBe(true);
        expect(fake.calls.filter((call) => call.method === "agents.list")).toHaveLength(3);
        board.unmount();
        expect(fake.openSubscriptions()).toBe(2);
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
    const mounted = await mountTasks(fake);
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
      expect(mounted.current.byId.get("limited")).toMatchObject({ lane: "review", status: "failed", error: limit });
      expect(mounted.current.byId.get("prompted")).toMatchObject({ lane: "done", status: "done", error: null });
      expect(mounted.current.byId.get("codex-limit")).toMatchObject({ lane: "review", status: "failed", error: "You've hit your usage limit." });
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
        fake.upsertAgent(activeAgent("limited", { status: "running", lastUserMessageAt: iso(Date.now()), activeTurn: { turnId: "t2", startedAt: iso(Date.now()) } }));
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
      expect(card.children[0]).toMatchObject({ provider: card.provider, subtitle: "general-purpose · Opus 5.5 · High · 189.7k tokens", lane: "review" });
      expect(card.children[0]!.timing).toMatchObject({ lastTurnMs: 6 * 60_000 + 55_000, lastTurnEndedAt: "2026-10-22T09:18:55.000Z" });
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
      const mounted = await mountTasks(fake);
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
          await vi.waitFor(() => expect(current.review).toBe(1));
        });
        expect(current).toEqual({ needsInput: 0, running: 1, review: 1, ready: true });
        expect(fake.calls.filter((call) => call.method === "agents.ref.refresh").map((call) => call.input)).toEqual([{ agentId: "parent" }]);
      } finally {
        act(() => renderer.unmount());
        setSubagentLoader(null);
      }
    });
  });
});
