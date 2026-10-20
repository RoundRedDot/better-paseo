import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { PaseoProject, PaseoProviderModelsResult } from "@getpaseo/client";
import { filterLanes, useTaskCounts, useTasks, type TasksHandle } from "../../client/tasks/data";
import { at, createFakePaseo, makeAgent, makeWorkspace } from "./helpers/fake-paseo";
import "./helpers/quiet-renderer";

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
        activeAgent("done", { status: "closed", updatedAt: at(4) }),
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
      expect(mounted.current.byId.get("parent")?.children).toEqual([{ id: "child", title: "Child task", status: "running" }]);
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
    let counts = { needsInput: 0, running: 0, review: 0, done: 0 };
    function BoardAndSidebar() {
      const board = useTasks(fake.paseo, { doneWindow: "24h", includeDone: true });
      const sidebar = useTaskCounts(fake.paseo);
      ready = board.ready && sidebar.ready;
      counts = { needsInput: sidebar.needsInput, running: sidebar.running, review: sidebar.review, done: sidebar.done };
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
    expect(fake.openSubscriptions()).toBe(4);
    act(() => renderer.unmount());
    expect(fake.openSubscriptions()).toBe(0);
  });
});
