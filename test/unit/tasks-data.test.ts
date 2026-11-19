import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { PaseoProject, PaseoProviderModelsResult } from "@getpaseo/client";
import { ATTENTION_CLEAR_HOLD_MS, LIST_RECOVERY_DELAYS_MS, START_IDLE_HOLD_MS, START_INIT_HOLD_MS, filterLanes, setLabelDefinitionsLoader, setTasksArchivedLane, setLastTurnLoader, setParentOriginsLoader, setProjectIconsLoader, setReadMarksLoader, setSubagentLoader, useTaskCounts, useTasks, withActiveSubtasks, type CountScope, withLastTurn, withReadMark, withSubagentCards, withSubagents, withUnreadMark, setUnreadMarksLoader, setUnreadClearer, openedTask, planTitle, type TasksHandle } from "../../client/tasks/data";
import type { ProviderSubagent } from "../../shared/tasks-rpc";
import { EMPTY_FILTERS, LANE_ORDER, type LaneId, type LaneModel, type TaskCard } from "../../client/tasks/model";
import { sampleCards } from "../../client/tasks/sample-cards";
import { fallbackLabelColor } from "../../client/tasks/label-colors";
import { permissionButtons, respondToPermission } from "../../client/tasks/actions";
import { cardStart, cardTimer, formatEnded } from "../../client/tasks/cards/card-time";
import { at, createFakePaseo, makeAgent, makePlacement, makeWorkspace } from "./helpers/fake-paseo";
import "./helpers/quiet-renderer";
import { claudeExitPlanRequest, codexPlanRequest, exitPlanPermission } from "./helpers/plan-request";

const storeNotificationProbe = vi.hoisted(() => ({ enabled: false, count: 0, snapshots: [] as unknown[] }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  const wrappedSubscriptions = new WeakMap<object, unknown>();
  const latestGets = new WeakMap<object, () => unknown>();
  return {
    ...react,
    useSyncExternalStore: (
      subscribe: Parameters<typeof react.useSyncExternalStore>[0],
      getSnapshot: Parameters<typeof react.useSyncExternalStore>[1],
      getServerSnapshot?: Parameters<typeof react.useSyncExternalStore>[2],
    ) => {
      latestGets.set(subscribe, getSnapshot);
      let wrapped = wrappedSubscriptions.get(subscribe) as typeof subscribe | undefined;
      if (!wrapped) {
        wrapped = (onStoreChange) => subscribe(() => {
          if (storeNotificationProbe.enabled) {
            storeNotificationProbe.count += 1;
            storeNotificationProbe.snapshots.push(latestGets.get(subscribe)?.());
          }
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

/** Let a queued read of the whole workspace list (a timer, then its pages) run and land. */
async function settleWorkspaceCheck() {
  // A check, a list's landing that queues another, and that one: each a timer, then its pages.
  for (let round = 0; round < 6; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (let index = 0; index < 32; index += 1) await Promise.resolve();
    });
  }
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

it("identifies scheduled agents from their own schedule label", async () => {
  const fake = createFakePaseo({
    agents: [
      activeAgent("scheduled", { status: "running", labels: { "paseo.schedule-id": "schedule-1", "paseo.schedule-run": "run-1" } }),
      activeAgent("ordinary", { status: "running", labels: {} }),
      activeAgent("run-only", { status: "running", labels: { "paseo.schedule-run": "run-2" } }),
    ],
    workspaces: [workspace()],
  });
  const mounted = await mountTasks(fake);
  try {
    expect(mounted.current.byId.get("scheduled")?.scheduled).toBe(true);
    expect(mounted.current.byId.get("ordinary")?.scheduled).toBe(false);
    expect(mounted.current.byId.get("run-only")?.scheduled).toBe(false);
    await act(async () => {
      fake.upsertAgent(activeAgent("ordinary", { status: "running", labels: { "paseo.schedule-id": "schedule-2" }, updatedAt: recentIso(0) }));
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    expect(mounted.current.byId.get("ordinary")?.scheduled).toBe(true);
  } finally {
    mounted.unmount();
  }
});

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

  describe("an unread agent's attention clear", () => {
    // Paseo 0.15 archives an unread agent in two steps: its attention cleared (same updatedAt), then archivedAt.
    const unreadAt = recentIso(5_000);
    const unread = activeAgent("unread", { status: "idle", requiresAttention: true, attentionReason: "finished", updatedAt: unreadAt });
    async function mountWith() {
      const fake = createFakePaseo({ agents: [unread], workspaces: [workspace()] });
      let current!: TasksHandle;
      function Probe() {
        current = useTasks(fake.paseo, { doneWindow: "24h", includeDone: true, includeArchived: true });
        return null;
      }
      let renderer!: Renderer;
      await act(async () => {
        setTasksArchivedLane(fake.paseo, true);
        renderer = TestRenderer.create(React.createElement(Probe));
        await flush(8);
      });
      const mounted = { get current() { return current; }, unmount: () => act(() => renderer.unmount()) };
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const lanesOf: string[] = [];
      const push = async (agent: ReturnType<typeof activeAgent>) => {
        await act(async () => {
          fake.upsertAgent(agent);
          await flush(4);
        });
        lanesOf.push(mounted.current.byId.get("unread")?.lane ?? "none");
      };
      return { fake, mounted, push, lanesOf };
    }

    it("moves an archived unread card straight from review to archived", async () => {
      const { mounted, push, lanesOf } = await mountWith();
      try {
        expect(mounted.current.byId.get("unread")?.lane).toBe("review");
        await push({ ...unread, requiresAttention: false, attentionReason: null, attentionTimestamp: null } as never);
        await push({ ...unread, requiresAttention: false, attentionReason: null, attentionTimestamp: null, archivedAt: recentIso(0), updatedAt: recentIso(0) } as never);
        expect(lanesOf).toEqual(["review", "archived"]);
        await act(async () => {
          vi.advanceTimersByTime(ATTENTION_CLEAR_HOLD_MS + 100);
          await flush(4);
        });
        expect(mounted.current.byId.get("unread")?.lane).toBe("archived");
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("moves a card read on another device to done once the wait is over", async () => {
      const { mounted, push, lanesOf } = await mountWith();
      try {
        await push({ ...unread, requiresAttention: false, attentionReason: null, attentionTimestamp: null } as never);
        expect(lanesOf).toEqual(["review"]);
        await act(async () => {
          vi.advanceTimersByTime(ATTENTION_CLEAR_HOLD_MS);
          await flush(4);
        });
        expect(mounted.current.byId.get("unread")).toMatchObject({ lane: "done", status: "done" });
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("does not hold a clear that comes with a permission request", async () => {
      const { mounted, push, lanesOf } = await mountWith();
      try {
        await push({ ...unread, requiresAttention: false, attentionReason: null, attentionTimestamp: null, pendingPermissions: [{ id: "p1", provider: "claude", name: "Bash", kind: "tool", title: "Run" }] } as never);
        expect(lanesOf).toEqual(["needs_input"]);
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("does not hold a clear that comes with an error", async () => {
      const { mounted, push } = await mountWith();
      try {
        await push({ ...unread, requiresAttention: false, attentionReason: null, attentionTimestamp: null, lastError: "Usage limit reached" } as never);
        expect(mounted.current.byId.get("unread")).toMatchObject({ lane: "review", status: "failed" });
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("does not bring an archived task back when the archived lane is off", async () => {
      const fake = createFakePaseo({ agents: [unread], workspaces: [workspace()] });
      const mounted = await mountTasks(fake, "24h");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        expect(mounted.current.byId.get("unread")?.lane).toBe("review");
        const cleared = { ...unread, requiresAttention: false, attentionReason: null, attentionTimestamp: null };
        await act(async () => {
          fake.upsertAgent(cleared as never);
          await flush(4);
        });
        // Archived: with the archived lane off, every list only removes it.
        await act(async () => {
          fake.upsertAgent({ ...cleared, archivedAt: recentIso(0), updatedAt: recentIso(0) } as never);
          await flush(8);
        });
        await act(async () => {
          vi.advanceTimersByTime(ATTENTION_CLEAR_HOLD_MS + 100);
          await flush(8);
        });
        expect(mounted.current.byId.has("unread")).toBe(false);
        expect(mounted.current.lanes.done.cards.map((card) => card.id)).not.toContain("unread");
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("drops a read by id that answers after a newer state landed", async () => {
      const fake = createFakePaseo({ agents: [unread], workspaces: [workspace()] });
      const mounted = await mountTasks(fake, "24h");
      try {
        expect(mounted.current.byId.get("unread")?.lane).toBe("review");
        // An older snapshot: the board reads the agent by id, and that read hangs.
        const release = fake.holdRefreshes();
        await act(async () => {
          fake.pushAgentSnapshot({ ...unread, updatedAt: recentIso(60_000) } as never);
          await flush(8);
        });
        expect(fake.calls.some((call) => call.method === "agents.ref.refresh")).toBe(true);
        // Prompted again meanwhile: it runs.
        await act(async () => {
          fake.upsertAgent(activeAgent("unread", { status: "running", requiresAttention: false, updatedAt: recentIso(0), lastUserMessageAt: recentIso(0) }));
          await flush(8);
        });
        expect(mounted.current.byId.get("unread")?.lane).toBe("running");
        // The read answers with the state from before: it must not take the card out of running.
        await act(async () => {
          release();
          await flush(16);
        });
        expect(mounted.current.byId.get("unread")?.lane).toBe("running");
      } finally {
        mounted.unmount();
      }
    });

    it("drops a read by id that answers after the task was archived and removed", async () => {
      const fake = createFakePaseo({ agents: [unread], workspaces: [workspace()] });
      const mounted = await mountTasks(fake, "24h");
      try {
        // An older snapshot: the board reads the agent by id, and that read hangs with the unarchived state.
        const releaseOld = fake.holdRefreshes();
        await act(async () => {
          fake.pushAgentSnapshot({ ...unread, updatedAt: recentIso(60_000) } as never);
          await flush(8);
        });
        // Archived, with the archived lane off: removes only; the board reads it again and lets it go.
        const releaseNew = fake.holdRefreshes();
        await act(async () => {
          fake.upsertAgent({ ...unread, requiresAttention: false, attentionReason: null, archivedAt: recentIso(0), updatedAt: recentIso(0) } as never);
          await flush(8);
        });
        await act(async () => {
          releaseNew();
          await flush(16);
        });
        expect(mounted.current.byId.has("unread")).toBe(false);
        // The older read answers last: it must not bring the archived task back.
        await act(async () => {
          releaseOld();
          await flush(16);
        });
        expect(mounted.current.byId.has("unread")).toBe(false);
      } finally {
        mounted.unmount();
      }
    });

    it("keeps a held read when a list that never had the task removes it", async () => {
      const { fake, mounted, push, lanesOf } = await mountWith();
      try {
        await push({ ...unread, requiresAttention: false, attentionReason: null, attentionTimestamp: null } as never);
        expect(lanesOf).toEqual(["review"]);
        // The running list never held it: the SDK replays a remove it had buffered.
        await act(async () => {
          fake.pushRemoveTo("unread", (options) => options.filter?.statuses?.includes("running") === true);
          await flush(8);
        });
        // Still waiting for an archive: the read lands only after the hold.
        expect(mounted.current.byId.get("unread")?.lane).toBe("review");
        await act(async () => {
          vi.advanceTimersByTime(ATTENTION_CLEAR_HOLD_MS);
          await flush(8);
        });
        expect(mounted.current.byId.get("unread")?.lane).toBe("done");
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("keeps a task restored to running when a gone check answers with its archive", async () => {
      const done = activeAgent("gone-check", { status: "idle", requiresAttention: false, updatedAt: recentIso(5_000) });
      const fake = createFakePaseo({ agents: [done], workspaces: [workspace()] });
      const mounted = await mountTasks(fake, "24h");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        expect(mounted.current.byId.get("gone-check")?.lane).toBe("done");
        const release = fake.holdRefreshes();
        // Archived with the archived lane off: removes, then a gone check reads it (held).
        await act(async () => {
          fake.upsertAgent({ ...done, archivedAt: recentIso(1_000), updatedAt: recentIso(1_000) } as never);
          await flush(8);
          vi.advanceTimersByTime(3_500);
          await flush(8);
        });
        // Unarchived and prompted meanwhile.
        await act(async () => {
          fake.upsertAgent(activeAgent("gone-check", { status: "running", archivedAt: null, updatedAt: recentIso(0), lastUserMessageAt: recentIso(0) }));
          await flush(8);
        });
        expect(mounted.current.byId.get("gone-check")?.lane).toBe("running");
        await act(async () => {
          release();
          await flush(16);
        });
        expect(mounted.current.byId.get("gone-check")?.lane).toBe("running");
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("sits out the wait when the list that held the task removes it after the read", async () => {
      const { fake, mounted, push, lanesOf } = await mountWith();
      try {
        const cleared = { ...unread, requiresAttention: false, attentionReason: null, attentionTimestamp: null };
        fake.setAgentSilently(cleared as never);
        // The done list hears of the read first, then the attention list, which held the task, lets it go.
        await act(async () => {
          fake.pushUpsertTo(cleared as never, (options) => options.filter?.statuses?.includes("idle") === true);
          await flush(4);
        });
        lanesOf.push(mounted.current.byId.get("unread")?.lane ?? "none");
        await act(async () => {
          fake.pushRemoveTo("unread", (options) => options.filter?.requiresAttention === true);
          await flush(8);
        });
        lanesOf.push(mounted.current.byId.get("unread")?.lane ?? "none");
        // The archive's second step, within the wait.
        await push({ ...cleared, archivedAt: recentIso(0), updatedAt: recentIso(0) } as never);
        expect(lanesOf).toEqual(["review", "review", "archived"]);
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("takes a deleted task off once its gone check answers, though the same snapshot came again meanwhile", async () => {
      const closed = activeAgent("deleted", { status: "closed", requiresAttention: true, attentionReason: "finished", updatedAt: recentIso(5_000) });
      const fake = createFakePaseo({ agents: [closed], workspaces: [workspace()] });
      const mounted = await mountTasks(fake, "24h");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        expect(mounted.current.byId.get("deleted")?.lane).toBe("review");
        // Deleted on another client: this board hears nothing, and its gone check reads the agent (held).
        fake.deleteAgentSilently("deleted");
        const release = fake.holdRefreshes();
        await act(async () => {
          fake.pushAgentSnapshot(closed as never);
          await flush(4);
          vi.advanceTimersByTime(1_100);
          await flush(8);
        });
        // The same snapshot again, from another list.
        await act(async () => {
          fake.pushAgentSnapshot(closed as never);
          await flush(8);
        });
        await act(async () => {
          release();
          await flush(16);
          vi.advanceTimersByTime(5_000);
          await flush(16);
        });
        expect(mounted.current.byId.has("deleted")).toBe(false);
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("reads the task afresh once a held read's wait ends, not with a read asked before it", async () => {
      const { fake, mounted } = await mountWith();
      try {
        // An older snapshot: the board reads the agent by id, and that read (unread) hangs.
        const releaseOld = fake.holdRefreshes();
        await act(async () => {
          fake.pushAgentSnapshot({ ...unread, updatedAt: recentIso(60_000) } as never);
          await flush(8);
        });
        fake.passNewRefreshes();
        // Read on another device: the done list hears it first, then the attention list lets the task go.
        const cleared = { ...unread, requiresAttention: false, attentionReason: null, attentionTimestamp: null };
        fake.setAgentSilently(cleared as never);
        await act(async () => {
          fake.pushUpsertTo(cleared as never, (options) => options.filter?.statuses?.includes("idle") === true);
          await flush(4);
          fake.pushRemoveTo("unread", (options) => options.filter?.requiresAttention === true);
          await flush(4);
        });
        await act(async () => {
          vi.advanceTimersByTime(ATTENTION_CLEAR_HOLD_MS + 50);
          await flush(8);
        });
        // The old read answers unread: it must not keep the task in review.
        await act(async () => {
          releaseOld();
          await flush(24);
        });
        expect(mounted.current.byId.get("unread")?.lane).toBe("done");
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("does not bring back a task archived during a held read that only the attention list held", async () => {
      const fake = createFakePaseo({
        agents: Array.from({ length: 60 }, (_, index) => activeAgent(`u-${index}`, { status: "idle", requiresAttention: true, attentionReason: "finished", updatedAt: recentIso(10_000 + index * 1_000) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake, "24h");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        await act(async () => { for (let index = 0; index < 16; index += 1) await Promise.resolve(); });
        // Past the done list's first page: only the attention list holds it.
        expect(mounted.current.byId.get("u-55")?.lane).toBe("review");
        const target = fake.paseo.agents.ref("u-55").current()!;
        const cleared = { ...target, requiresAttention: false, attentionReason: null, attentionTimestamp: null };
        // Read: the attention list removes it, then the done list sends the read state (held).
        fake.setAgentSilently(cleared as never);
        // The daemon sends both in one go: no read by id answers in between.
        await act(async () => {
          fake.pushRemoveTo("u-55", (options) => options.filter?.requiresAttention === true);
          fake.pushUpsertTo(cleared as never, (options) => options.filter?.statuses?.includes("idle") === true);
          await flush(4);
        });
        // Archived within the wait, the archived lane off: every list only removes it.
        fake.setAgentSilently({ ...cleared, archivedAt: recentIso(0), updatedAt: recentIso(0) } as never);
        await act(async () => {
          fake.pushRemoveTo("u-55", () => true);
          await flush(8);
        });
        await act(async () => {
          vi.advanceTimersByTime(ATTENTION_CLEAR_HOLD_MS + 70);
          await flush(16);
        });
        expect(mounted.current.lanes.done.cards.map((card) => card.id)).not.toContain("u-55");
        await act(async () => {
          vi.advanceTimersByTime(4_000);
          await flush(16);
        });
        expect(mounted.current.byId.has("u-55")).toBe(false);
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("lets a snapshot carrying the same read wait with the held one", async () => {
      const { fake, mounted, lanesOf } = await mountWith();
      try {
        const cleared = { ...unread, requiresAttention: false, attentionReason: null, attentionTimestamp: null };
        await act(async () => {
          fake.upsertAgent(cleared as never);
          await flush(4);
        });
        lanesOf.push(mounted.current.byId.get("unread")?.lane ?? "none");
        // The done list reconnects within the wait; its snapshot carries the same read state.
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.statuses?.includes("idle") === true);
          await flush(8);
        });
        lanesOf.push(mounted.current.byId.get("unread")?.lane ?? "none");
        await act(async () => {
          vi.advanceTimersByTime(ATTENTION_CLEAR_HOLD_MS);
          await flush(8);
        });
        lanesOf.push(mounted.current.byId.get("unread")?.lane ?? "none");
        expect(lanesOf).toEqual(["review", "review", "done"]);
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("does not bring back a task archived during a held read whose removes were lost", async () => {
      const fake = createFakePaseo({ agents: [unread], workspaces: [workspace()] });
      const mounted = await mountTasks(fake, "24h");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const cleared = { ...unread, requiresAttention: false, attentionReason: null, attentionTimestamp: null };
        await act(async () => {
          fake.upsertAgent(cleared as never);
          await flush(4);
        });
        // Archived, but its removes never reached the board; the done list then reconnects without it.
        fake.setAgentSilently({ ...cleared, archivedAt: recentIso(0), updatedAt: recentIso(0) } as never);
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.statuses?.includes("idle") === true);
          await flush(8);
        });
        await act(async () => {
          vi.advanceTimersByTime(ATTENTION_CLEAR_HOLD_MS + 50);
          await flush(16);
        });
        expect(mounted.current.byId.has("unread")).toBe(false);
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("keeps a held task's card through a snapshot of its list that no longer carries it", async () => {
      const fake = createFakePaseo({
        agents: Array.from({ length: 60 }, (_, index) => activeAgent(`h-${index}`, { status: "idle", requiresAttention: true, attentionReason: "finished", updatedAt: recentIso(10_000 + index * 1_000) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake, "24h");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        await act(async () => { await flush(16); });
        const target = fake.paseo.agents.ref("h-55").current()!;
        const cleared = { ...target, requiresAttention: false, attentionReason: null, attentionTimestamp: null };
        fake.setAgentSilently(cleared as never);
        // The done list's read state is held; the attention list then reconnects without the task.
        await act(async () => {
          fake.pushUpsertTo(cleared as never, (options) => options.filter?.statuses?.includes("idle") === true);
          await flush(4);
        });
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.requiresAttention === true);
          await flush(8);
        });
        // Still shown as it was until the wait is over.
        expect(mounted.current.byId.get("h-55")?.lane).toBe("review");
        await act(async () => {
          vi.advanceTimersByTime(ATTENTION_CLEAR_HOLD_MS + 50);
          await flush(16);
        });
        expect(mounted.current.byId.get("h-55")?.lane).toBe("done");
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("shows a permission request a snapshot brings during a held read, with the same update time", async () => {
      const { fake, mounted } = await mountWith();
      try {
        const cleared = { ...unread, requiresAttention: false, attentionReason: null, attentionTimestamp: null };
        await act(async () => {
          fake.upsertAgent(cleared as never);
          await flush(4);
        });
        fake.setAgentSilently({ ...cleared, pendingPermissions: [{ id: "perm-1", provider: "claude", name: "Bash", kind: "tool", title: "Run" }] } as never);
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.statuses?.includes("idle") === true);
          await flush(8);
        });
        expect(mounted.current.byId.get("unread")?.lane).toBe("needs_input");
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("says so and reads again when a held read's read by id fails", async () => {
      const fake = createFakePaseo({ agents: [unread], workspaces: [workspace()] });
      const mounted = await mountTasks(fake, "24h");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const cleared = { ...unread, requiresAttention: false, attentionReason: null, attentionTimestamp: null };
        await act(async () => {
          fake.upsertAgent(cleared as never);
          await flush(4);
        });
        // Archived; the reads by id fail for now.
        fake.failRefreshes(new Error("connection lost"));
        await act(async () => {
          fake.upsertAgent({ ...cleared, archivedAt: recentIso(0), updatedAt: recentIso(0) } as never);
          await flush(8);
          vi.advanceTimersByTime(ATTENTION_CLEAR_HOLD_MS + 50);
          await flush(16);
        });
        expect(mounted.current.error).toBe("connection lost");
        // Reads answer again: the retry takes the archived task off and the error goes.
        fake.failRefreshes(null);
        await act(async () => {
          vi.advanceTimersByTime(2_100);
          await flush(16);
        });
        expect(mounted.current.byId.has("unread")).toBe(false);
        expect(mounted.current.error).toBeNull();
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("lets a read by id retried during a held read wait with it", async () => {
      const { fake, mounted } = await mountWith();
      try {
        // An older snapshot sends a read by id, which fails and is tried again 2 s later.
        fake.failRefreshes(new Error("connection lost"));
        await act(async () => {
          fake.pushAgentSnapshot({ ...unread, updatedAt: recentIso(60_000) } as never);
          await flush(8);
        });
        fake.failRefreshes(null);
        await act(async () => {
          vi.advanceTimersByTime(1_950);
          await flush(8);
        });
        // Read on another device just before the retry: held.
        const cleared = { ...unread, requiresAttention: false, attentionReason: null, attentionTimestamp: null };
        await act(async () => {
          fake.upsertAgent(cleared as never);
          await flush(4);
        });
        // The retry reads the same read state within the wait: the hold still decides.
        await act(async () => {
          vi.advanceTimersByTime(100);
          await flush(16);
        });
        expect(mounted.current.byId.get("unread")?.lane).toBe("review");
        await act(async () => {
          vi.advanceTimersByTime(ATTENTION_CLEAR_HOLD_MS);
          await flush(16);
        });
        expect(mounted.current.byId.get("unread")?.lane).toBe("done");
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("says nothing when a read by id fails after its task was archived and taken off", async () => {
      const fake = createFakePaseo({ agents: [unread], workspaces: [workspace()] });
      const mounted = await mountTasks(fake, "24h");
      try {
        // An older snapshot: a read by id goes out and hangs.
        const releaseOld = fake.holdRefreshes();
        await act(async () => {
          fake.pushAgentSnapshot({ ...unread, updatedAt: recentIso(60_000) } as never);
          await flush(8);
        });
        fake.passNewRefreshes();
        // Archived, the archived lane off: the board confirms it and takes the card off.
        await act(async () => {
          fake.upsertAgent({ ...unread, archivedAt: recentIso(0), updatedAt: recentIso(0) } as never);
          await flush(16);
        });
        expect(mounted.current.byId.has("unread")).toBe(false);
        // The old read times out, and so does any read asked meanwhile: none decides anything shown.
        fake.failRefreshes(new Error("read timed out"));
        await act(async () => {
          releaseOld(new Error("read timed out"));
          await flush(16);
        });
        expect(mounted.current.error).toBeNull();
      } finally {
        mounted.unmount();
      }
    });

    it("keeps a running task, says so and reads again when an older snapshot takes it off every list and the reads fail", async () => {
      const runner = activeAgent("runner", { status: "running", updatedAt: recentIso(1_000), lastUserMessageAt: recentIso(1_000) });
      const fake = createFakePaseo({ agents: [runner], workspaces: [workspace()] });
      const mounted = await mountTasks(fake, "24h");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        expect(mounted.current.byId.get("runner")?.lane).toBe("running");
        // An older idle copy: the running list removes it, the done list gets the stale upsert; reads by id fail.
        fake.failRefreshes(new Error("connection lost"));
        await act(async () => {
          fake.pushAgentSnapshot({ ...runner, status: "idle", updatedAt: recentIso(60_000) } as never);
          await flush(16);
        });
        expect(mounted.current.byId.get("runner")?.lane).toBe("running");
        expect(mounted.current.error).toBe("connection lost");
        // Reads answer again: the retry finds it still running.
        fake.failRefreshes(null);
        await act(async () => {
          vi.advanceTimersByTime(2_100);
          await flush(16);
        });
        expect(mounted.current.byId.get("runner")?.lane).toBe("running");
        expect(mounted.current.error).toBeNull();
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("holds an attention clear a reconnect's done snapshot brings, so an archive right after skips done", async () => {
      const fake = createFakePaseo({ agents: [unread], workspaces: [workspace()] });
      const mounted = await mountTasks(fake, "24h");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        expect(mounted.current.byId.get("unread")?.lane).toBe("review");
        // Missed while disconnected: the archive's first step, an attention clear (updatedAt unchanged).
        const cleared = { ...unread, requiresAttention: false, attentionReason: null, attentionTimestamp: null };
        fake.setAgentSilently(cleared as never);
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.statuses?.includes("idle") === true);
          await flush(16);
        });
        expect(mounted.current.byId.get("unread")?.lane).toBe("review");
        // The archive lands (archived lane off: removes only).
        fake.setAgentSilently({ ...cleared, archivedAt: recentIso(0), updatedAt: recentIso(0) } as never);
        await act(async () => {
          fake.removeFromAgentSubscriptions("unread");
          await flush(8);
        });
        expect(mounted.current.byId.get("unread")?.lane).not.toBe("done");
        await act(async () => {
          vi.advanceTimersByTime(ATTENTION_CLEAR_HOLD_MS + 50);
          await flush(16);
        });
        expect(mounted.current.byId.has("unread")).toBe(false);
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("lands an attention clear a reconnect's done snapshot brings once its wait is over", async () => {
      const fake = createFakePaseo({ agents: [unread], workspaces: [workspace()] });
      const mounted = await mountTasks(fake, "24h");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        // Read on another device while disconnected.
        const cleared = { ...unread, requiresAttention: false, attentionReason: null, attentionTimestamp: null };
        fake.setAgentSilently(cleared as never);
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.statuses?.includes("idle") === true);
          await flush(16);
        });
        await act(async () => {
          vi.advanceTimersByTime(ATTENTION_CLEAR_HOLD_MS + 50);
          await flush(16);
        });
        expect(mounted.current.byId.get("unread")?.lane).toBe("done");
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("says nothing when a gone check's read fails after its task ran again", async () => {
      const closed = activeAgent("rerun", { status: "closed", requiresAttention: true, attentionReason: "finished", updatedAt: recentIso(5_000) });
      const fake = createFakePaseo({ agents: [closed], workspaces: [workspace()] });
      const mounted = await mountTasks(fake, "24h");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        // A closed snapshot schedules a gone check; its read hangs.
        const release = fake.holdRefreshes();
        await act(async () => {
          fake.pushAgentSnapshot(closed as never);
          await flush(4);
          vi.advanceTimersByTime(1_100);
          await flush(8);
        });
        // Prompted again meanwhile: it runs.
        await act(async () => {
          fake.upsertAgent(activeAgent("rerun", { status: "running", requiresAttention: false, updatedAt: recentIso(0), lastUserMessageAt: recentIso(0) }));
          await flush(8);
        });
        await act(async () => {
          release(new Error("obsolete gone read failed"));
          await flush(16);
        });
        expect(mounted.current.byId.get("rerun")?.lane).toBe("running");
        expect(mounted.current.error).toBeNull();
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("takes an archived task off though an older read by id answered first", async () => {
      const done = activeAgent("rd", { status: "idle", requiresAttention: false, updatedAt: recentIso(5_000) });
      const fake = createFakePaseo({ agents: [done], workspaces: [workspace()] });
      const mounted = await mountTasks(fake, "24h");
      try {
        expect(mounted.current.byId.get("rd")?.lane).toBe("done");
        // An older snapshot: a read by id goes out with the unarchived state, held.
        const releaseOld = fake.holdRefreshes();
        await act(async () => {
          fake.pushAgentSnapshot({ ...done, updatedAt: recentIso(60_000) } as never);
          await flush(8);
        });
        // Archived, the archived lane off: removes, and the board reads it to confirm (held too).
        const releaseNew = fake.holdRefreshes();
        await act(async () => {
          fake.upsertAgent({ ...done, archivedAt: recentIso(0), updatedAt: recentIso(0) } as never);
          await flush(8);
        });
        // The old read answers first, then the confirmation.
        await act(async () => {
          releaseOld();
          await flush(16);
        });
        await act(async () => {
          releaseNew();
          await flush(16);
        });
        expect(mounted.current.byId.has("rd")).toBe(false);
      } finally {
        mounted.unmount();
      }
    });

    it("clears a read's error once a newer state of the task lands after its retries ran out", async () => {
      const fake = createFakePaseo({ agents: [unread], workspaces: [workspace()] });
      const mounted = await mountTasks(fake, "24h");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        fake.failRefreshes(new Error("old read failed"));
        await act(async () => {
          fake.pushAgentSnapshot({ ...unread, updatedAt: recentIso(60_000) } as never);
          await flush(8);
        });
        for (const wait of [2_100, 5_100, 15_100, 1_000]) {
          await act(async () => {
            vi.advanceTimersByTime(wait);
            await flush(8);
          });
        }
        expect(mounted.current.error).toBe("old read failed");
        await act(async () => {
          fake.upsertAgent(activeAgent("unread", { status: "running", title: "Renamed", requiresAttention: false, updatedAt: recentIso(0), lastUserMessageAt: recentIso(0) }));
          await flush(8);
        });
        expect(mounted.current.byId.get("unread")?.lane).toBe("running");
        expect(mounted.current.error).toBeNull();
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("does not hold a clear that comes with a new turn", async () => {
      const { mounted, push, lanesOf } = await mountWith();
      try {
        await push(activeAgent("unread", { status: "running", requiresAttention: false, updatedAt: recentIso(0), lastUserMessageAt: recentIso(0) }));
        expect(lanesOf).toEqual(["running"]);
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });
  });

  describe("a new agent's idle before its first turn", () => {
    // Paseo 0.15 sends a prompted agent's start as initializing, then idle (newer, never prompted), then running.
    const starting = (status: "initializing" | "idle", updatedAt: string) => activeAgent("fresh", { status, createdAt: recentIso(0), updatedAt, lastUserMessageAt: null, activeTurn: null });
    async function mountWith() {
      const fake = createFakePaseo({ agents: [activeAgent("old", { status: "running", updatedAt: recentIso(60_000) })], workspaces: [workspace()] });
      const mounted = await mountTasks(fake, "all");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const lanesOf: string[] = [];
      const push = async (agent: ReturnType<typeof activeAgent>) => {
        await act(async () => {
          fake.upsertAgent(agent);
          await flush(4);
        });
        lanesOf.push(mounted.current.byId.get("fresh")?.lane ?? "none");
      };
      return { fake, mounted, push, lanesOf };
    }

    it("shows the card once its first turn starts, already running, and never in another lane", async () => {
      const { mounted, push, lanesOf } = await mountWith();
      try {
        const created = Date.now();
        await push(starting("initializing", new Date(created).toISOString()));
        await push(starting("idle", new Date(created + 1).toISOString()));
        await push(activeAgent("fresh", { status: "running", createdAt: new Date(created).toISOString(), updatedAt: new Date(created + 8).toISOString(), lastUserMessageAt: new Date(created + 8).toISOString(), activeTurn: { id: "t1", startedAt: new Date(created + 8).toISOString() } as never }));
        // Starting up and the idle after it wait for the turn: the card first shows running.
        expect(lanesOf).toEqual(["none", "none", "running"]);
        expect(mounted.current.byId.get("fresh")?.status).toBe("running");
        // The held idle is dropped: nothing moves it later.
        await act(async () => {
          vi.advanceTimersByTime(START_IDLE_HOLD_MS + 100);
          await flush(4);
        });
        expect(mounted.current.byId.get("fresh")).toMatchObject({ lane: "running", status: "running" });
        expect(mounted.current.lanes.done.cards.map((card) => card.id)).not.toContain("fresh");
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("does not bring back an agent made without a prompt that was archived during its wait", async () => {
      const { fake, mounted, push, lanesOf } = await mountWith();
      try {
        const created = Date.now();
        await push(starting("initializing", new Date(created).toISOString()));
        await push(starting("idle", new Date(created + 1).toISOString()));
        // Archived within the wait, with the archived lane off: its lists only remove it.
        await act(async () => {
          fake.upsertAgent({ ...starting("idle", new Date(created + 1).toISOString()), archivedAt: new Date(created + 50).toISOString(), updatedAt: new Date(created + 50).toISOString() } as never);
          await flush(4);
        });
        await act(async () => {
          vi.advanceTimersByTime(START_IDLE_HOLD_MS + 100);
          await flush(8);
        });
        expect(lanesOf).toEqual(["none", "none"]);
        expect(mounted.current.byId.has("fresh")).toBe(false);
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("keeps a starting agent off done when the done list's snapshot carries its held idle", async () => {
      const { fake, mounted, push, lanesOf } = await mountWith();
      try {
        const created = Date.now();
        await push(starting("initializing", new Date(created).toISOString()));
        await push(starting("idle", new Date(created + 1).toISOString()));
        // The done list reconnects within the wait; its snapshot has the same idle.
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.statuses?.includes("idle") === true);
          await flush(8);
        });
        lanesOf.push(mounted.current.byId.get("fresh")?.lane ?? "none");
        await push(activeAgent("fresh", { status: "running", createdAt: new Date(created).toISOString(), updatedAt: new Date(created + 8).toISOString(), lastUserMessageAt: new Date(created + 8).toISOString(), activeTurn: { turnId: "t1", startedAt: new Date(created + 8).toISOString() } as never }));
        expect(lanesOf).toEqual(["none", "none", "none", "running"]);
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("shows an agent made without a prompt as idle once the wait is over", async () => {
      const { mounted, push, lanesOf } = await mountWith();
      try {
        const created = Date.now();
        await push(starting("initializing", new Date(created).toISOString()));
        await push(starting("idle", new Date(created + 1).toISOString()));
        expect(lanesOf).toEqual(["none", "none"]);
        await act(async () => {
          vi.advanceTimersByTime(START_IDLE_HOLD_MS);
          await flush(4);
        });
        expect(mounted.current.byId.get("fresh")?.lane).toBe("done");
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("shows an agent slow to start as starting up once the wait is over", async () => {
      const { mounted, push, lanesOf } = await mountWith();
      try {
        await push(starting("initializing", new Date().toISOString()));
        expect(lanesOf).toEqual(["none"]);
        await act(async () => {
          vi.advanceTimersByTime(START_INIT_HOLD_MS);
          await flush(4);
        });
        expect(mounted.current.byId.get("fresh")).toMatchObject({ lane: "running" });
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("does not hold an idle that ends a turn, or one that asks for the user", async () => {
      const { mounted, push } = await mountWith();
      try {
        await push(activeAgent("fresh", { status: "running", updatedAt: recentIso(10) }));
        await push(activeAgent("fresh", { status: "idle", requiresAttention: true, attentionReason: "finished", updatedAt: recentIso(0) }));
        expect(mounted.current.byId.get("fresh")?.lane).toBe("review");
        await push(starting("initializing", recentIso(-10)));
        await push(activeAgent("fresh", { status: "idle", requiresAttention: true, attentionReason: "error", lastUserMessageAt: null, updatedAt: recentIso(-20) }));
        expect(mounted.current.byId.get("fresh")?.lane).toBe("review");
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });
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

  for (const path of ["loading more", "a refresh reading the pages again"] as const) {
    it(`holds an attention clear a later done page brings (${path}), so an archive right after skips done`, async () => {
      const done = Array.from({ length: 130 }, (_, index) => activeAgent("done-" + index, { status: "idle", requiresAttention: false, updatedAt: recentIso((index + 1) * 1_000) }));
      const target = activeAgent("target", { status: "idle", requiresAttention: true, attentionReason: "finished", updatedAt: recentIso(70_500) });
      const fake = createFakePaseo({ agents: [...done, target] });
      const mounted = await mountTasks(fake, "all");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        expect(mounted.current.byId.get("target")?.lane).toBe("review");
        const cleared = { ...target, requiresAttention: false, attentionReason: null, attentionTimestamp: null };
        if (path === "a refresh reading the pages again") {
          await act(async () => {
            mounted.current.loadMoreDone();
            await flush(30);
          });
        }
        // Missed: the archive's first step, an attention clear (updatedAt unchanged).
        fake.setAgentSilently(cleared as never);
        await act(async () => {
          if (path === "loading more") mounted.current.loadMoreDone();
          else void mounted.current.refresh();
          await flush(40);
        });
        expect(fake.calls.some((call) => call.method === "agents.list" && (call.input as { page?: { cursor?: string } }).page?.cursor)).toBe(true);
        expect(mounted.current.byId.get("target")?.lane).toBe("review");
        // The archive lands (archived lane off: removes only).
        await act(async () => {
          fake.upsertAgent({ ...cleared, archivedAt: recentIso(0), updatedAt: recentIso(0) } as never);
          await flush(16);
        });
        expect(mounted.current.byId.get("target")?.lane).not.toBe("done");
        await act(async () => {
          vi.advanceTimersByTime(ATTENTION_CLEAR_HOLD_MS + 50);
          await flush(30);
        });
        expect(mounted.current.byId.has("target")).toBe(false);
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });
  }

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
    const release = fake.holdReady();
    let first!: Promise<string>;
    await act(async () => {
      first = mounted.current.refresh();
      await flush();
    });
    mounted.unmount();
    const soon = new Promise<string>((resolve) => setTimeout(() => resolve("still waiting"), 50));
    await expect(Promise.race([first, soon])).resolves.toBe("superseded");
    // The lists still unanswered (the SDK's list waits for ready) are let go as they answer.
    await act(async () => {
      release();
      await flush();
    });
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

  it("lands a done page and the end of its loading in one board update", async () => {
    const done = Array.from({ length: 120 }, (_, index) => activeAgent("done-" + index, { status: "idle", requiresAttention: false, updatedAt: recentIso((index + 1) * 1_000) }));
    const fake = createFakePaseo({ agents: done });
    const mounted = await mountTasks(fake, "all");
    try {
      expect(mounted.current.lanes.done.cards).toHaveLength(50);
      storeNotificationProbe.snapshots = [];
      storeNotificationProbe.enabled = true;
      await act(async () => {
        mounted.current.loadMoreDone();
        await flush();
      });
      storeNotificationProbe.enabled = false;
      // What the board was told at each store notify (React batches the renders themselves).
      const told = (storeNotificationProbe.snapshots as Array<Partial<TasksHandle> | undefined>)
        .filter((value): value is TasksHandle => Boolean(value?.lanes))
        .map((value) => ({ cards: value.lanes.done.cards.length, loading: value.lanes.done.loading }))
        .filter((entry, index, all) => index === 0 || entry.cards !== all[index - 1]!.cards || entry.loading !== all[index - 1]!.loading);
      // Loading starts, then the page comes with loading off: no update shows the new cards still loading.
      expect(told).toEqual([
        { cards: 50, loading: true },
        { cards: 100, loading: false },
      ]);
    } finally {
      storeNotificationProbe.enabled = false;
      storeNotificationProbe.snapshots = [];
      mounted.unmount();
    }
  });

  it("ends a failed done page's loading, and can load it again", async () => {
    const done = Array.from({ length: 120 }, (_, index) => activeAgent("done-" + index, { status: "idle", requiresAttention: false, updatedAt: recentIso((index + 1) * 1_000) }));
    const fake = createFakePaseo({ agents: done });
    const mounted = await mountTasks(fake, "all");
    const agentsApi = fake.paseo.agents as { list: (options: { subscribe?: unknown }) => Promise<unknown> };
    const list = agentsApi.list.bind(agentsApi);
    try {
      agentsApi.list = async (options) => {
        if (!options.subscribe) throw new Error("offline");
        return list(options);
      };
      await act(async () => {
        mounted.current.loadMoreDone();
        await flush();
      });
      expect(mounted.current.lanes.done.loading).toBe(false);
      expect(mounted.current.lanes.done.cards).toHaveLength(50);
      agentsApi.list = list;
      await act(async () => {
        mounted.current.loadMoreDone();
        await flush();
      });
      expect(mounted.current.lanes.done.loading).toBe(false);
      expect(mounted.current.lanes.done.cards).toHaveLength(100);
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
  // The request in the 2026-11-10 report, exactly as the daemon's CodexAsyncQuestions
  // hands it over: the model wrote only the title and option strings.
  it.each([["允许", "拒绝"], ["Not yet", "Go ahead"]])("answers a Codex async question with options %j from the card", async (...labels) => {
    const title = "是否允许按上述范围实施结构化快捷回答，包括普通二选一题也可能显示按钮？";
    const fake = createFakePaseo({
      agents: [activeAgent("asking", { provider: "codex", status: "running", pendingPermissions: [{
        id: "permission-item-1", provider: "codex", name: "request_user_input_async", kind: "question", title: "Question",
        input: { questions: [{ id: "0", header: "Question 1", question: title, options: labels.map((label) => ({ label })), isOther: true }] },
      }] })],
      workspaces: [workspace()],
    });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      const permission = mounted.current.byId.get("asking")!.permission!;
      // Codex builds the request id from the question's timeline row: the dialog reads the text before it.
      expect(permission).toMatchObject({ requestId: "permission-item-1", kind: "question", summary: title, callId: "item-1",
        questions: [{ id: "0", header: "Question 1", question: title, multiSelect: false, options: labels.map((label) => ({ label })) }] });
      const buttons = permissionButtons(permission, "zh");
      expect(buttons.map((button) => [button.label, button.kind])).toEqual(labels.map((label) => [label, "respond"]));
      await respondToPermission(fake.paseo, "asking", buttons[1]!, permission.requestId);
      expect(fake.permissionResponses).toEqual([{ agentId: "asking", requestId: "permission-item-1",
        response: { behavior: "allow", updatedInput: { answers: { "Question 1": labels[1] } } } }]);
    } finally { mounted.unmount(); }
  });

  // Claude's provider names the AskUserQuestion's tool use in the metadata; the request id is a fresh uuid.
  it("keeps a Claude question's tool use id as its call id", async () => {
    const fake = createFakePaseo({
      agents: [activeAgent("asking", { provider: "claude", status: "running", pendingPermissions: [{
        id: "permission-6b1f", provider: "claude", name: "AskUserQuestion", kind: "question", title: "Question",
        input: { questions: [{ header: "Scope", question: "Change both?", options: [{ label: "Yes" }, { label: "No" }], multiSelect: false }] },
        metadata: { toolUseId: "toolu_01ABC" },
      }] })],
      workspaces: [workspace()],
    });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      expect(mounted.current.byId.get("asking")!.permission).toMatchObject({ requestId: "permission-6b1f", name: "AskUserQuestion", callId: "toolu_01ABC" });
    } finally { mounted.unmount(); }
  });

  // Claude's ExitPlanMode, as its provider sends it: no title, Reject and
  // Implement, and Implement with the resume mode when there is one. The cards
  // show it as a plan (tasks-cards, tasks-card-action-layout, tasks-board-render).
  it.each([false, true])("answers a real Claude ExitPlanMode request with its own actions (resume %s)", async (resume) => {
    const fake = createFakePaseo({
      agents: [activeAgent("planning", { provider: "claude", status: "running", pendingPermissions: [claudeExitPlanRequest({ resume })] as never })],
      workspaces: [workspace()],
    });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      const card = mounted.current.byId.get("planning")!;
      expect(card.lane).toBe("needs_input");
      expect(card.permission).toEqual(exitPlanPermission({ resume }));
      const buttons = permissionButtons(card.permission!, "zh", true);
      expect(buttons.map((button) => [button.label, button.kind, button.variant])).toEqual([
        ["拒绝", "respond", "danger"], ["实施", "respond", "primary"], ...(resume ? [["Implement with Bypass", "respond", "secondary"]] : []),
      ]);
      for (const button of buttons) await respondToPermission(fake.paseo, "planning", button, card.permission!.requestId);
      expect(fake.permissionResponses).toEqual([
        { agentId: "planning", requestId: "permission-exit-plan", response: { behavior: "deny", selectedActionId: "reject", message: "Denied by user" } },
        { agentId: "planning", requestId: "permission-exit-plan", response: { behavior: "allow", selectedActionId: "implement" } },
        ...(resume ? [{ agentId: "planning", requestId: "permission-exit-plan", response: { behavior: "allow", selectedActionId: "implement_resume" } }] : []),
      ]);
    } finally { mounted.unmount(); }
  });

  it("answers a Codex plan approval with Dismiss and Implement", async () => {
    const fake = createFakePaseo({
      agents: [activeAgent("planning", { provider: "codex", status: "running", pendingPermissions: [codexPlanRequest()] as never })],
      workspaces: [workspace()],
    });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      const permission = mounted.current.byId.get("planning")!.permission!;
      // The plan's first line names it, not the request's fixed description; "View plan" opens the whole text.
      expect(permission).toMatchObject({ kind: "plan", title: "Plan", summary: "Section every request", body: "1. Section every request" });
      const buttons = permissionButtons(permission, "en", true);
      expect(buttons.map((button) => button.label)).toEqual(["Dismiss", "Implement"]);
      await respondToPermission(fake.paseo, "planning", buttons[0]!, permission.requestId);
      expect(fake.permissionResponses).toEqual([{ agentId: "planning", requestId: "permission-codex-plan", response: { behavior: "deny", selectedActionId: "dismiss", message: "Denied by user" } }]);
    } finally { mounted.unmount(); }
  });

  // The card names a plan by its first line; the whole plan opens from "View plan".
  it.each([
    ["# 把左右键同按新规则同步到 luoph-mini\n\n## Context\n本机已改好", "把左右键同按新规则同步到 luoph-mini"],
    ["\n\n## **Ship** the `layout` ##\nsteps", "Ship the layout"],
    ["- Section every request\n- Test it", "Section every request"],
    ["2) Test it", "Test it"],
    ["Plain   first\tline\nsecond", "Plain first line"],
    ["  \n\n", null],
    ["#", "#"],
  ])("titles the plan %j as %j", (text, title) => {
    expect(planTitle(text)).toBe(title);
  });

  it("reads a plan from its metadata when the input carries none", async () => {
    const fake = createFakePaseo({
      agents: [activeAgent("planning", { provider: "claude", status: "running", pendingPermissions: [{ ...claudeExitPlanRequest(), input: { plan: "  \n" }, metadata: { planText: "# From metadata" } }] as never })],
      workspaces: [workspace()],
    });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      expect(mounted.current.byId.get("planning")!.permission).toMatchObject({ summary: "From metadata", body: "# From metadata" });
    } finally { mounted.unmount(); }
  });

  // Codex request_user_input (Plan mode) requires a description on each option, which a card cannot show.
  it("leaves a Codex question whose options carry descriptions to the agent tab", async () => {
    const fake = createFakePaseo({
      agents: [activeAgent("asking", { provider: "codex", status: "running", pendingPermissions: [{
        id: "permission-item-2", provider: "codex", name: "request_user_input", kind: "question", title: "Question",
        input: { questions: [{ id: "plan_scope", header: "Scope", question: "Ship both fixes?", options: [
          { label: "Both", description: "One release for the two fixes" }, { label: "First only", description: "Hold the second" },
        ] }] },
      }] })],
      workspaces: [workspace()],
    });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      expect(permissionButtons(mounted.current.byId.get("asking")!.permission!).map((button) => button.kind)).toEqual(["open"]);
    } finally { mounted.unmount(); }
  });

  it("retains the full pending Claude question and options for details", async () => {
    const fake = createFakePaseo({
      agents: [activeAgent("asking", { provider: "claude", status: "running", pendingPermissions: [{
        id: "q", provider: "claude", name: "AskUserQuestion", kind: "question", title: "Question",
        input: { questions: [{ question: "Keep the timer?", header: "Timer", options: [{ label: "Keep", description: "Shows elapsed time" }, { label: "Remove", description: "Matches iOS" }], multiSelect: false }] },
      }] })],
      workspaces: [workspace()],
    });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      expect(mounted.current.byId.get("asking")?.permission?.questions).toMatchObject([{ question: "Keep the timer?", options: [{ label: "Keep", description: "Shows elapsed time" }, { label: "Remove", description: "Matches iOS" }] }]);
      await act(async () => { fake.upsertAgent(activeAgent("asking", { provider: "claude", status: "running", pendingPermissions: [] })); });
      expect(mounted.current.byId.get("asking")?.permission).toBeNull();
    } finally { mounted.unmount(); }
  });
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

  it("moves a done card back to review when marked unread since its prompt and since any read", () => {
    const card = { ...sampleCards(Date.parse("2026-10-22T10:00:00.000Z")).find((sample) => sample.id === "sample-done")! };
    const prompted = Date.parse(card.timing.lastUserMessageAt ?? "");
    const unreadAt = prompted + 60_000;
    expect(withUnreadMark(card, unreadAt, undefined)).toMatchObject({ lane: "review", status: "unread", readable: true });
    // A read at the same moment or later keeps the card done.
    expect(withUnreadMark(card, unreadAt, unreadAt)).toMatchObject({ lane: "done", status: "done" });
    expect(withUnreadMark(card, unreadAt, unreadAt + 1)).toMatchObject({ lane: "done", status: "done" });
    expect(withUnreadMark(card, unreadAt, unreadAt - 1)).toMatchObject({ lane: "review", status: "unread", readable: true });
    // A mark from before this prompt, a review card, and an archived card stay put.
    expect(withUnreadMark(card, prompted - 1, undefined)).toMatchObject({ lane: "done", status: "done" });
    expect(withUnreadMark(card, undefined, undefined)).toBe(card);
    expect(withUnreadMark({ ...card, lane: "review", status: "unread" }, unreadAt, undefined).lane).toBe("review");
    expect(withUnreadMark({ ...card, archived: "agent" }, unreadAt, undefined).lane).toBe("done");
  });

  it("moves a done card to review once its unread mark loads", async () => {
    const prompt = Date.now() - 10 * 60_000;
    const iso = (ms: number) => new Date(ms).toISOString();
    const fake = createFakePaseo({
      agents: [activeAgent("finished", { status: "closed", updatedAt: iso(prompt), lastUserMessageAt: iso(prompt) })],
      workspaces: [workspace()],
    });
    const loader = vi.fn(async () => [{ agentId: "finished", unreadAt: iso(prompt + 30_000) }]);
    setUnreadMarksLoader(loader);
    const mounted = await mountTasks(fake, "all");
    try {
      expect(mounted.current.byId.get("finished")).toMatchObject({ lane: "done", status: "done" });
      await act(async () => {
        mounted.current.refreshUnreads();
        for (let index = 0; index < 6; index += 1) await Promise.resolve();
      });
      expect(loader).toHaveBeenCalled();
      expect(mounted.current.byId.get("finished")).toMatchObject({ lane: "review", status: "unread", readable: true });
    } finally {
      mounted.unmount();
      setUnreadMarksLoader(null);
    }
  });

  it("drops the unread mark when the board opens the task, and keeps it if the server refuses", async () => {
    // Marked unread on 11-10, opened later: the card must not come back to review.
    const prompt = Date.now() - 10 * 60_000;
    const iso = (ms: number) => new Date(ms).toISOString();
    const fake = createFakePaseo({
      agents: [
        activeAgent("finished", { status: "closed", updatedAt: iso(prompt), lastUserMessageAt: iso(prompt) }),
        activeAgent("other", { status: "closed", updatedAt: iso(prompt), lastUserMessageAt: iso(prompt) }),
      ],
      workspaces: [workspace()],
    });
    let server = [{ agentId: "finished", unreadAt: iso(prompt + 30_000) }, { agentId: "other", unreadAt: iso(prompt + 30_000) }];
    const loader = vi.fn(async () => server);
    let refuse = false;
    let release!: () => void;
    const clearer = vi.fn((agentIds: string[]) => new Promise<void>((resolve, reject) => {
      release = () => {
        if (refuse) reject(new Error("refused"));
        else {
          server = server.filter((mark) => !agentIds.includes(mark.agentId));
          resolve();
        }
      };
    }));
    setUnreadMarksLoader(loader);
    setUnreadClearer(clearer);
    const settle = async () => {
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    };
    const mounted = await mountTasks(fake, "all");
    try {
      await act(async () => {
        mounted.current.refreshUnreads();
        await settle();
      });
      expect(mounted.current.byId.get("finished")).toMatchObject({ lane: "review", status: "unread" });
      const other = mounted.current.byId.get("other");
      expect(other).toMatchObject({ lane: "review", status: "unread" });

      await act(async () => {
        openedTask(fake.paseo, "finished");
        await settle();
      });
      // Out of review at once, before the server answers; the other card is untouched.
      expect(clearer).toHaveBeenCalledWith(["finished"]);
      expect(mounted.current.byId.get("finished")).toMatchObject({ lane: "done", status: "done" });
      expect(mounted.current.byId.get("other")).toBe(other);

      // A read that left before the clear landed still lists the mark: it does not move the card back.
      await act(async () => {
        mounted.current.refreshUnreads();
        await settle();
      });
      expect(mounted.current.byId.get("finished")).toMatchObject({ lane: "done" });

      await act(async () => {
        release();
        await settle();
      });
      expect(mounted.current.byId.get("finished")).toMatchObject({ lane: "done" });
      await act(async () => {
        mounted.current.refreshUnreads();
        await settle();
      });
      expect(mounted.current.byId.get("finished")).toMatchObject({ lane: "done" });

      // A server that refuses keeps its mark: the read after the failure puts the card back.
      refuse = true;
      await act(async () => {
        openedTask(fake.paseo, "other");
        await settle();
      });
      expect(mounted.current.byId.get("other")).toMatchObject({ lane: "done" });
      await act(async () => {
        release();
        await settle();
      });
      expect(mounted.current.byId.get("other")).toMatchObject({ lane: "review", status: "unread" });
    } finally {
      mounted.unmount();
      setUnreadMarksLoader(null);
      setUnreadClearer(null);
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

  it("uses the project descriptor's key (the sidebar's colour key), falls back to the placement's, and preserves unchanged cards", async () => {
    const placementAgent = activeAgent("placement", { status: "running", workspaceId: "ws" });
    const fallbackAgent = activeAgent("fallback", { status: "running", workspaceId: "ws" });
    const unknownAgent = activeAgent("unknown", { status: "running", workspaceId: "ws-unknown" });
    const orphanAgent = activeAgent("orphan", { status: "running", workspaceId: "ws-unknown" });
    const fake = createFakePaseo({
      agents: [placementAgent, fallbackAgent, unknownAgent, orphanAgent],
      workspaces: [workspace(), makeWorkspace({ id: "ws-unknown", projectId: "missing-project" })],
      projects: [{ ...PROJECT, projectKey: "descriptor-key" }],
      placements: {
        // Paseo 0.14 fills the placement's projectKey with the project id.
        placement: makePlacement(placementAgent, { projectKey: "project-id-not-key" }),
        fallback: makePlacement(fallbackAgent, { projectKey: "" }),
        unknown: makePlacement(unknownAgent, { projectKey: "" }),
        orphan: makePlacement(orphanAgent, { projectKey: "placement-key" }),
      },
    });
    const mounted = await mountTasks(fake, "24h", false);
    try {
      expect(mounted.current.byId.get("placement")?.location.projectKey).toBe("descriptor-key");
      expect(mounted.current.byId.get("fallback")?.location.projectKey).toBe("descriptor-key");
      expect(mounted.current.byId.get("unknown")?.location.projectKey).toBeNull();
      expect(mounted.current.byId.get("orphan")?.location.projectKey).toBe("placement-key");
      const unchanged = mounted.current.byId.get("fallback");
      await act(async () => {
        fake.upsertAgent(
          activeAgent("placement", { status: "running", workspaceId: "ws", title: "Updated placement" }),
          makePlacement(placementAgent, { projectKey: "project-id-not-key" }),
        );
        await Promise.resolve();
      });
      expect(mounted.current.byId.get("fallback")).toBe(unchanged);
    } finally {
      mounted.unmount();
    }
  });

  it("keeps waiting and failed child tasks visible when hiding other subtasks, folding running ones into a listed parent", () => {
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

    // The running subtask is a row on its parent's card, whatever lane that card is in.
    const hidden = filterLanes(lanes, filters);
    expect(hidden.needs_input.cards.map((card) => card.id)).toEqual(["child-needs-input"]);
    expect(hidden.running.cards.map((card) => card.id)).toEqual([]);
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

    // A parent waiting for input lists its running subtasks: they fold into it, and the waiting
    // subtask beside it in the same lane does too. The failed one, a lane away, keeps its card.
    const asking: TaskCard = { ...parent, lane: "needs_input", status: "needs_input", provider: "parent-only" };
    const askingLanes = Object.fromEntries(LANE_ORDER.map((id) => [id, {
      ...lanes[id],
      cards: [asking, ...children].filter((card) => card.lane === id),
    }])) as Record<LaneId, LaneModel>;
    const askingFolded = filterLanes(askingLanes, filters);
    expect(askingFolded.needs_input.cards.map((card) => card.id)).toEqual([parentId]);
    expect(askingFolded.running.cards.map((card) => card.id)).toEqual([]);
    expect(askingFolded.review.cards.map((card) => card.id)).toEqual(["child-failed"]);
    // A parent whose card does not list the subtask has no row to stand in for it.
    const unlisted = Object.fromEntries(LANE_ORDER.map((id) => [id, {
      ...askingLanes[id],
      cards: askingLanes[id].cards.map((card) => card.id === parentId ? { ...card, children: [] } : card),
    }])) as Record<LaneId, LaneModel>;
    expect(filterLanes(unlisted, filters).running.cards.map((card) => card.id)).toEqual(["child-running"]);
  });

  it("keeps the board quiet for a workspace update that changes nothing it shows, and keeps its workspace options", async () => {
    const fake = createFakePaseo({ agents: [activeAgent("in-ws", { status: "running" })], workspaces: [workspace()] });
    const mounted = await mountTasks(fake, "24h");
    const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
    try {
      const before = mounted.current;
      const count = async (change: () => void) => {
        storeNotificationProbe.count = 0;
        storeNotificationProbe.enabled = true;
        try {
          await act(async () => { change(); await flush(); });
        } finally {
          storeNotificationProbe.enabled = false;
        }
        return storeNotificationProbe.count;
      };
      // An agent in it starts: the daemon sends the workspace's new activity, which no card or list shows.
      expect(await count(() => fake.upsertWorkspace({ ...workspace(), status: "running", statusEnteredAt: recentIso(0), activityAt: recentIso(0) } as never))).toBe(0);
      expect(mounted.current).toBe(before);
      // An agent update draws a new snapshot, with the same workspace options.
      await act(async () => { fake.upsertAgent(activeAgent("in-ws", { status: "running", title: "Renamed task", updatedAt: recentIso(0) })); await flush(); });
      expect(mounted.current).not.toBe(before);
      expect(mounted.current.workspaces).toBe(before.workspaces);
      // A renamed workspace is news: its option changes, and its card's workspace with it.
      expect(await count(() => fake.upsertWorkspace({ ...workspace(), title: "Renamed workspace" } as never))).toBeGreaterThan(0);
      expect(mounted.current.workspaces).not.toBe(before.workspaces);
      expect(mounted.current.workspaces.map((option) => option.name)).toEqual(["Renamed workspace"]);
      // A branch switch reaches the card even though the workspace's options stay.
      const options = mounted.current.workspaces;
      expect(await count(() => fake.upsertWorkspace({ ...workspace(), title: "Renamed workspace", gitRuntime: { currentBranch: "feature", isDirty: false, aheadBehind: { ahead: 0, behind: 0 } } } as never))).toBeGreaterThan(0);
      expect(mounted.current.workspaces).toBe(options);
    } finally {
      mounted.unmount();
    }
  });

  describe("one agent update that reaches several lists", () => {
    const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
    async function notifications(change: () => void) {
      storeNotificationProbe.count = 0;
      storeNotificationProbe.enabled = true;
      try {
        await act(async () => { change(); await flush(); });
      } finally {
        storeNotificationProbe.enabled = false;
      }
      return storeNotificationProbe.count;
    }

    it("notifies once for a running agent the status and attention lists both send", async () => {
      const fake = createFakePaseo({ agents: [activeAgent("both", { status: "running", updatedAt: recentIso(5_000) })], workspaces: [workspace()] });
      const mounted = await mountTasks(fake, "24h");
      try {
        // The daemon sends the same snapshot on each list it matches: running, and needing attention.
        const updated = activeAgent("both", { status: "running", requiresAttention: true, attentionReason: "finished", title: "Asked again", updatedAt: recentIso(0) });
        expect(await notifications(() => fake.upsertAgent(updated))).toBe(1);
        expect(mounted.current.byId.get("both")).toMatchObject({ lane: "running", title: "Asked again" });
        // The same snapshot again, on any list, changes nothing.
        const before = mounted.current;
        expect(await notifications(() => fake.pushAgentSnapshot(structuredClone(updated)))).toBe(0);
        expect(mounted.current).toBe(before);
      } finally {
        mounted.unmount();
      }
    });

    it("notifies once for an idle agent the attention and done lists both send", async () => {
      const fake = createFakePaseo({ agents: [activeAgent("finished", { status: "running", updatedAt: recentIso(5_000) })], workspaces: [workspace()] });
      const mounted = await mountTasks(fake, "24h");
      try {
        const done = activeAgent("finished", { status: "idle", requiresAttention: true, attentionReason: "finished", updatedAt: recentIso(0) });
        expect(await notifications(() => fake.upsertAgent(done))).toBe(1);
        expect(mounted.current.byId.get("finished")).toMatchObject({ lane: "review", status: "unread" });
      } finally {
        mounted.unmount();
      }
    });

    it("still notifies a status change sent with the same updatedAt", async () => {
      // The daemon has sent a new status stamped with the time of the one before (initializing, then idle).
      const stamp = recentIso(5_000);
      const fake = createFakePaseo({ agents: [activeAgent("stamped", { status: "running", updatedAt: stamp })], workspaces: [workspace()] });
      const mounted = await mountTasks(fake, "24h");
      try {
        expect(mounted.current.byId.get("stamped")).toMatchObject({ lane: "running" });
        const idle = activeAgent("stamped", { status: "idle", requiresAttention: true, attentionReason: "finished", updatedAt: stamp });
        expect(await notifications(() => fake.upsertAgent(idle))).toBeGreaterThan(0);
        expect(mounted.current.byId.get("stamped")).toMatchObject({ lane: "review", status: "unread" });
      } finally {
        mounted.unmount();
      }
    });

    it("still notifies the same agent sent with another placement", async () => {
      const agent = activeAgent("moved", { status: "running", updatedAt: recentIso(5_000) });
      const fake = createFakePaseo({ agents: [agent], workspaces: [workspace()] });
      const mounted = await mountTasks(fake, "24h");
      try {
        // The same agent record, sent with another project placement: the card's project follows it.
        const before = mounted.current.byId.get("moved")!;
        const placement = { ...makePlacement(agent), projectKey: "other-project", projectName: "Other project" };
        expect(await notifications(() => fake.upsertAgent(structuredClone(agent), placement))).toBeGreaterThan(0);
        expect(mounted.current.byId.get("moved")).not.toEqual(before);
      } finally {
        mounted.unmount();
      }
    });

    it("still notifies a resent snapshot that brings a parent's row up to date", async () => {
      // A provider's model names rebuild its agents' cards one by one, in the
      // order the store holds them: a parent held first draws its row for the
      // child before the child's card has the name, and a child whose status
      // stays does not refresh its parent. A resent snapshot of the child
      // refreshes its parent, so the board must hear it.
      const catalog: PaseoProviderModelsResult["models"] = [{
        provider: "claude",
        id: "claude-opus-5-5",
        label: "Claude Opus 5.5",
        defaultThinkingOptionId: "high",
        thinkingOptions: [{ id: "high", label: "High", isDefault: true }],
      }];
      const child = activeAgent("child", { status: "running", provider: "claude", model: "claude-opus-5-5", labels: { "paseo.parent-agent-id": "parent" }, updatedAt: recentIso(9_000) });
      const fake = createFakePaseo({
        // The newer parent comes first in the list, so the store holds it first.
        agents: [activeAgent("parent", { status: "running", provider: "claude", model: "claude-opus-5-5", updatedAt: recentIso(5_000) }), child],
        workspaces: [workspace()],
        models: { claude: catalog },
      });
      const mounted = await mountTasks(fake, "24h");
      try {
        expect(mounted.current.byId.get("child")?.modelLabel).toBe("Claude Opus 5.5");
        expect(mounted.current.byId.get("parent")?.children.map((row) => row.modelLabel)).toEqual(["claude-opus-5-5"]);
        expect(await notifications(() => fake.pushAgentSnapshot(structuredClone(child)))).toBeGreaterThan(0);
        expect(mounted.current.byId.get("parent")?.children.map((row) => row.modelLabel)).toEqual(["Claude Opus 5.5"]);
      } finally {
        mounted.unmount();
      }
    });
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
      archivedWorkspaceIds: ["ws-archived"],
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

  describe("paged agent lists", () => {
    const flush = async (rounds: number) => { for (let index = 0; index < rounds; index += 1) await Promise.resolve(); };
    // The status and attention lists are each the whole of what they filter,
    // but a subscription's snapshot is only the daemon's first page (200).
    const UNREAD = 230;
    function unreadFake() {
      return createFakePaseo({
        agents: Array.from({ length: UNREAD }, (_, index) =>
          activeAgent(`unread-${index}`, { status: "idle", requiresAttention: true, attentionReason: "finished", updatedAt: recentIso(1_000 + index) })),
        workspaces: [workspace()],
      });
    }

    async function settle() {
      await act(async () => {
        for (let index = 0; index < 16; index += 1) await Promise.resolve();
      });
    }

    it("shows every unread task past the first page in review", async () => {
      const fake = unreadFake();
      const mounted = await mountTasks(fake);
      try {
        await settle();
        expect(mounted.current.lanes.review.cards).toHaveLength(UNREAD);
        expect(mounted.current.counts.review).toBe(UNREAD);
        expect(mounted.current.byId.get(`unread-${UNREAD - 1}`)?.lane).toBe("review");
        await act(async () => {
          fake.reconnectSubscriptions();
          await Promise.resolve();
        });
        await settle();
        expect(mounted.current.lanes.review.cards).toHaveLength(UNREAD);
      } finally {
        mounted.unmount();
      }
    });

    it("shows every running task past the first page in running", async () => {
      const fake = createFakePaseo({
        agents: Array.from({ length: 210 }, (_, index) => activeAgent(`run-${index}`, { status: "running", updatedAt: recentIso(1_000 + index) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake);
      try {
        await settle();
        expect(mounted.current.lanes.running.cards).toHaveLength(210);
        expect(mounted.current.counts.running).toBe(210);
      } finally {
        mounted.unmount();
      }
    });

    it("ends a refresh only once every page of its lists has landed", async () => {
      const fake = unreadFake();
      const mounted = await mountTasks(fake);
      try {
        await settle();
        const release = fake.holdPages();
        let result: string | undefined;
        await act(async () => {
          void mounted.current.refresh().then((value) => { result = value; });
          await flush(16);
        });
        expect(result).toBeUndefined();
        await act(async () => {
          release();
          await flush(16);
        });
        expect(result).toBe("done");
        expect(mounted.current.lanes.review.cards).toHaveLength(UNREAD);
      } finally {
        mounted.unmount();
      }
    });

    it("reports a later page that cannot be read, and fails the refresh", async () => {
      const fake = unreadFake();
      const mounted = await mountTasks(fake);
      try {
        await settle();
        expect(mounted.current.error).toBeNull();
        fake.failNextAgentList((options) => options.page?.cursor !== undefined && options.filter?.requiresAttention === true, "socket closed");
        let result: string | undefined;
        await act(async () => {
          void mounted.current.refresh().then((value) => { result = value; });
          await flush(16);
        });
        expect(result).toBe("failed");
        expect(mounted.current.error).toBe("socket closed");
        // What the board had stays.
        expect(mounted.current.lanes.review.cards).toHaveLength(UNREAD);
      } finally {
        mounted.unmount();
      }
    });

    it("keeps paging the list it kept after a refresh of it failed", async () => {
      const fake = createFakePaseo({
        agents: Array.from({ length: 230 }, (_, index) => activeAgent(`run-${index}`, { status: "running", updatedAt: recentIso(1_000 + index) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake);
      try {
        await settle();
        expect(mounted.current.lanes.running.cards).toHaveLength(230);
        // The refresh's status list fails, so the old one stays.
        fake.failNextAgentList((options) => options.subscribe !== undefined && options.filter?.statuses?.includes("running") === true, "socket closed");
        let result: string | undefined;
        await act(async () => {
          void mounted.current.refresh().then((value) => { result = value; });
          await flush(16);
        });
        expect(result).toBe("failed");
        // Missed while disconnected; the kept list's next snapshot must page to find it.
        fake.setAgentSilently(activeAgent("run-late", { status: "running", updatedAt: recentIso(50_000) }));
        await act(async () => {
          fake.reconnectSubscriptions();
          await flush(16);
        });
        await settle();
        expect(mounted.current.lanes.running.cards).toHaveLength(231);
        expect(mounted.current.byId.get("run-late")?.lane).toBe("running");
      } finally {
        mounted.unmount();
      }
    });

    it("ends a refresh once its newest snapshot landed, though an older one's page still hangs", async () => {
      const fake = unreadFake();
      const mounted = await mountTasks(fake);
      try {
        await settle();
        const releaseOld = fake.holdPages();
        let result: string | undefined;
        await act(async () => {
          void mounted.current.refresh().then((value) => { result = value; });
          await flush(16);
        });
        expect(result).toBeUndefined();
        // A newer snapshot of the refresh's list pages at once and lands.
        fake.passNewPages();
        await act(async () => {
          fake.reconnectSubscriptions();
          await flush(24);
        });
        expect(result).toBe("done");
        expect(mounted.current.lanes.review.cards).toHaveLength(UNREAD);
        await act(async () => {
          releaseOld();
          await flush(16);
        });
      } finally {
        mounted.unmount();
      }
    });

    it("clears a page error once a later snapshot reads every page", async () => {
      const fake = unreadFake();
      const mounted = await mountTasks(fake);
      try {
        await settle();
        fake.failNextAgentList((options) => options.page?.cursor !== undefined && options.filter?.requiresAttention === true, "socket closed");
        await act(async () => {
          fake.reconnectSubscriptions();
          await flush(16);
        });
        expect(mounted.current.error).toBe("socket closed");
        await act(async () => {
          fake.reconnectSubscriptions();
          await flush(16);
        });
        expect(mounted.current.error).toBeNull();
      } finally {
        mounted.unmount();
      }
    });

    it("does not let an older snapshot of a list undo a newer one that landed", async () => {
      // Older than the done window: only the attention list keeps these on the board.
      const old = (index: number) => recentIso(3 * 24 * 60 * 60 * 1000 + index * 1000);
      const fake = createFakePaseo({
        agents: Array.from({ length: UNREAD }, (_, index) =>
          activeAgent(`unread-${index}`, { status: "idle", requiresAttention: true, attentionReason: "finished", updatedAt: old(index), lastUserMessageAt: old(index), createdAt: old(index) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake);
      try {
        await settle();
        expect(mounted.current.lanes.review.cards).toHaveLength(UNREAD);
        // The refresh's attention list takes its first page, then its later pages hang.
        const releaseOld = fake.holdPages();
        await act(async () => {
          void mounted.current.refresh();
          await flush(16);
        });
        // Read elsewhere (on the refresh's first page, past the done list's first page, so only the attention list holds it), an update the board missed; the kept list's next snapshot carries it.
        const read = fake.paseo.agents.ref("unread-100").current()!;
        fake.setAgentSilently({ ...read, requiresAttention: false, attentionReason: null, attentionTimestamp: null } as never);
        fake.passNewPages();
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.requiresAttention === true);
          await flush(24);
        });
        expect(mounted.current.byId.get("unread-100")?.lane).not.toBe("review");
        // The refresh's older snapshot finishes: it must not bring the read task back to review.
        await act(async () => {
          releaseOld();
          await flush(24);
        });
        expect(mounted.current.byId.get("unread-100")?.lane).not.toBe("review");
        expect(mounted.current.lanes.review.cards).toHaveLength(UNREAD - 1);
      } finally {
        mounted.unmount();
      }
    });

    it("does not let an older snapshot land after a newer one whose last page finished in the same turn", async () => {
      const old = (index: number) => recentIso(3 * 24 * 60 * 60 * 1000 + index * 1000);
      const fake = createFakePaseo({
        agents: Array.from({ length: UNREAD }, (_, index) =>
          activeAgent(`unread-${index}`, { status: "idle", requiresAttention: true, attentionReason: "finished", updatedAt: old(index), lastUserMessageAt: old(index), createdAt: old(index) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake);
      try {
        await settle();
        // Snapshot A: the refresh's attention list, its later pages held.
        const releaseA = fake.holdPages();
        await act(async () => {
          void mounted.current.refresh();
          await flush(16);
        });
        // Read elsewhere; snapshot B, the kept list's newer one, has its later pages held too.
        const read = fake.paseo.agents.ref("unread-100").current()!;
        fake.setAgentSilently({ ...read, requiresAttention: false, attentionReason: null, attentionTimestamp: null } as never);
        const releaseB = fake.holdPages();
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.requiresAttention === true);
          await flush(16);
        });
        // Both finish in one turn, the newer first.
        await act(async () => {
          releaseB();
          releaseA();
          await flush(32);
        });
        expect(mounted.current.byId.get("unread-100")?.lane).not.toBe("review");
        expect(mounted.current.lanes.review.cards).toHaveLength(UNREAD - 1);
      } finally {
        mounted.unmount();
      }
    });

    it("fails a refresh whose list was superseded by a snapshot that could not read every page", async () => {
      const fake = unreadFake();
      const mounted = await mountTasks(fake);
      try {
        await settle();
        const releaseA = fake.holdPages();
        let result: string | undefined;
        await act(async () => {
          void mounted.current.refresh().then((value) => { result = value; });
          await flush(16);
        });
        // The kept list's newer snapshot fails a later page and lands what it has.
        fake.passNewPages();
        fake.failNextAgentList((options) => options.page?.cursor !== undefined && options.filter?.requiresAttention === true, "socket closed");
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.requiresAttention === true);
          await flush(24);
        });
        await act(async () => {
          releaseA();
          await flush(24);
        });
        expect(result).toBe("failed");
        expect(mounted.current.error).toBe("socket closed");
      } finally {
        mounted.unmount();
      }
    });

    it("does not bring back an archived task when a refresh's done page answers late", async () => {
      const fake = createFakePaseo({
        agents: Array.from({ length: 60 }, (_, index) => activeAgent(`done-${index}`, { status: "idle", requiresAttention: false, updatedAt: recentIso(10_000 + index * 1_000) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake, "24h");
      try {
        await settle();
        await act(async () => {
          mounted.current.loadMoreDone();
          await flush(16);
        });
        expect(mounted.current.byId.get("done-55")?.lane).toBe("done");
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        // The refresh reads the second done page now, with done-55 unarchived, and answers later.
        const releaseAnswers = fake.holdPageAnswers();
        await act(async () => {
          void mounted.current.refresh();
          await flush(16);
        });
        // Archived meanwhile, the archived lane off: removes, then a gone check takes the card off.
        const target = fake.paseo.agents.ref("done-55").current()!;
        await act(async () => {
          fake.upsertAgent({ ...target, archivedAt: recentIso(0), updatedAt: recentIso(0) } as never);
          await flush(8);
          vi.advanceTimersByTime(3_500);
          await flush(16);
        });
        expect(mounted.current.byId.has("done-55")).toBe(false);
        await act(async () => {
          releaseAnswers();
          await flush(24);
        });
        expect(mounted.current.byId.has("done-55")).toBe(false);
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("keeps unread tasks the status list landed first once that list lets them go", async () => {
      const fake = createFakePaseo({
        agents: Array.from({ length: UNREAD }, (_, index) =>
          activeAgent(`both-${index}`, { status: "running", requiresAttention: true, attentionReason: "finished", updatedAt: recentIso(1_000 + index) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake, "24h", false);
      try {
        await settle();
        expect(mounted.current.byId.size).toBe(UNREAD);
        // Their turns ended, an update the board missed: still unread, no longer running.
        for (let index = 0; index < UNREAD; index += 1) {
          const agent = fake.paseo.agents.ref(`both-${index}`).current()!;
          fake.setAgentSilently({ ...agent, status: "idle" } as never);
        }
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.statuses?.includes("running") === true);
          await flush(24);
        });
        await settle();
        // The attention list still holds them all.
        expect(mounted.current.byId.size).toBe(UNREAD);
      } finally {
        mounted.unmount();
      }
    });

    it("keeps a member another list added while this list's pages were read", async () => {
      const fake = unreadFake();
      const mounted = await mountTasks(fake, "24h", false);
      try {
        await settle();
        // The attention list's next snapshot is taken, its later pages held.
        const release = fake.holdPages();
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.requiresAttention === true);
          await flush(16);
        });
        // Meanwhile a new task runs and needs attention; the running list brings it.
        const runner = activeAgent("late-runner", { status: "running", requiresAttention: true, attentionReason: "finished", updatedAt: recentIso(0), lastUserMessageAt: recentIso(0) });
        fake.setAgentSilently(runner);
        await act(async () => {
          fake.pushUpsertTo(runner, (options) => options.filter?.statuses?.includes("running") === true);
          await flush(8);
        });
        await act(async () => {
          release();
          await flush(24);
        });
        // Its turn ends, still unread; the running list lets it go. The attention list must still hold
        // it, so the card stays (with the record it has until the attention list sends a newer one).
        fake.setAgentSilently({ ...runner, status: "idle" } as never);
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.statuses?.includes("running") === true);
          await flush(24);
        });
        expect(mounted.current.byId.has("late-runner")).toBe(true);
      } finally {
        mounted.unmount();
      }
    });

    it("ends a refresh once the kept list landed a newer snapshot, though the refresh's own page hangs", async () => {
      const fake = unreadFake();
      const mounted = await mountTasks(fake);
      try {
        await settle();
        const releaseA = fake.holdPages();
        let result: string | undefined;
        await act(async () => {
          void mounted.current.refresh().then((value) => { result = value; });
          await flush(16);
        });
        fake.passNewPages();
        // Only the kept list reconnects, and lands every page.
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.requiresAttention === true);
          await flush(24);
        });
        expect(result).toBe("done");
        expect(mounted.current.lanes.review.cards).toHaveLength(UNREAD);
        await act(async () => {
          releaseA();
          await flush(16);
        });
      } finally {
        mounted.unmount();
      }
    });

    it("retries a first list whose subscription failed when the board refreshes", async () => {
      const fake = createFakePaseo({ agents: [activeAgent("runner", { status: "running", updatedAt: recentIso(1_000) })], workspaces: [workspace()] });
      fake.failNextReady((options) => options.filter?.statuses?.includes("running") === true, "status list failed");
      const mounted = await mountTasks(fake);
      try {
        await settle();
        expect(mounted.current.ready).toBe(true);
        expect(mounted.current.error).toBe("status list failed");
        expect(mounted.current.byId.has("runner")).toBe(false);
        let result: string | undefined;
        await act(async () => {
          void mounted.current.refresh().then((value) => { result = value; });
          await flush(24);
        });
        expect(result).toBe("done");
        expect(mounted.current.error).toBeNull();
        expect(mounted.current.byId.get("runner")?.lane).toBe("running");
      } finally {
        mounted.unmount();
      }
    });

    it("leaves out a task archived before it was loaded when its done page answers late", async () => {
      const fake = createFakePaseo({
        agents: Array.from({ length: 60 }, (_, index) => activeAgent(`a-${index}`, { status: "idle", requiresAttention: false, updatedAt: recentIso(10_000 + index * 1_000) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake, "24h");
      try {
        await settle();
        expect(mounted.current.byId.has("a-55")).toBe(false);
        // The second done page is read now, a-55 unarchived, and answered later.
        const release = fake.holdPageAnswers();
        await act(async () => {
          mounted.current.loadMoreDone();
          await flush(8);
        });
        const target = fake.paseo.agents.ref("a-55").current()!;
        await act(async () => {
          fake.upsertAgent({ ...target, archivedAt: recentIso(0), updatedAt: recentIso(0) } as never);
          await flush(8);
        });
        await act(async () => {
          release();
          await flush(24);
        });
        expect(mounted.current.byId.has("a-55")).toBe(false);
        expect(mounted.current.lanes.done.cards).toHaveLength(59);
      } finally {
        mounted.unmount();
      }
    });

    it("lands the workspace list's newer failure over an older snapshot that succeeds later", async () => {
      const fake = createFakePaseo({
        agents: [activeAgent("late", { status: "idle", requiresAttention: true, updatedAt: recentIso(1_000) })],
        workspaces: [...Array.from({ length: 4 }, (_, index) => makeWorkspace({ id: `filler-${index}`, projectId: "project-id", name: `filler-${index}` })), workspace()],
        workspacePageSize: 2,
      });
      const mounted = await mountTasks(fake);
      try {
        await settle();
        const releaseA = fake.holdPages();
        let result: string | undefined;
        await act(async () => {
          void mounted.current.refresh().then((value) => { result = value; });
          await flush(16);
        });
        // The kept workspace list's newer snapshot fails a later page.
        fake.passNewPages();
        fake.failWorkspacePages(new Error("workspace page failed"));
        await act(async () => {
          fake.reconnectOldestWorkspaceSubscription();
          await flush(24);
        });
        fake.failWorkspacePages(null);
        await act(async () => {
          releaseA();
          await flush(24);
        });
        expect(result).toBe("failed");
        expect(mounted.current.error).toBe("workspace page failed");
      } finally {
        mounted.unmount();
      }
    });

    it("keeps a done task on a late page when only the running list removed it", async () => {
      const fake = createFakePaseo({
        agents: Array.from({ length: 60 }, (_, index) => activeAgent(`d-${index}`, { status: "idle", requiresAttention: false, updatedAt: recentIso(10_000 + index * 1_000) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake, "24h");
      try {
        await settle();
        const release = fake.holdPageAnswers();
        await act(async () => {
          mounted.current.loadMoreDone();
          await flush(8);
        });
        // The running list never had it; its remove says nothing about done.
        await act(async () => {
          fake.pushRemoveTo("d-55", (options) => options.filter?.statuses?.includes("running") === true);
          await flush(8);
        });
        await act(async () => {
          release();
          await flush(24);
        });
        expect(mounted.current.byId.get("d-55")?.lane).toBe("done");
        expect(mounted.current.lanes.done.cards).toHaveLength(60);
      } finally {
        mounted.unmount();
      }
    });

    it("reads an archived parent of a running background task a bounded number of times", async () => {
      const fake = createFakePaseo({
        agents: [
          makeAgent({ id: "p", status: "idle", title: "Archived parent", archivedAt: recentIso(60_000), workspaceId: "ws" }),
          activeAgent("bg-child", { status: "running", workspaceId: "ws-bg", labels: { "paseo.parent-agent-id": "p" }, updatedAt: recentIso(1_000) }),
        ],
        workspaces: [workspace(), makeWorkspace({ id: "ws-bg", projectId: "project-id", name: "bg", background: true } as never)],
      });
      // Each read answers on a later task, so a loop shows as many reads instead of hanging the test.
      const ref = fake.paseo.agents.ref.bind(fake.paseo.agents);
      (fake.paseo.agents as { ref: typeof ref }).ref = ((agent: Parameters<typeof ref>[0]) => {
        const handle = ref(agent);
        return { ...handle, refresh: async () => { await new Promise((resolve) => setTimeout(resolve, 1)); return handle.refresh(); } };
      }) as typeof ref;
      const mounted = await mountTasks(fake, "24h");
      try {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
        const reads = fake.calls.filter((call) => call.method === "agents.ref.refresh" && (call.input as { agentId: string }).agentId === "p");
        expect(reads.length).toBeLessThanOrEqual(2);
      } finally {
        mounted.unmount();
      }
    });

    it("drops a done page asked for before the done list started over", async () => {
      const fake = createFakePaseo({
        agents: Array.from({ length: 60 }, (_, index) => activeAgent(`g-${index}`, { status: "idle", requiresAttention: false, updatedAt: recentIso(10_000 + index * 1_000) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake, "24h");
      try {
        await settle();
        const release = fake.holdPageAnswers();
        await act(async () => {
          mounted.current.loadMoreDone();
          await flush(8);
        });
        // Archived with nothing sent, then the done list starts over (a re-subscribe after its buffer overflowed).
        const target = fake.paseo.agents.ref("g-55").current()!;
        fake.setAgentSilently({ ...target, archivedAt: recentIso(0), updatedAt: recentIso(0) } as never);
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.statuses?.includes("idle") === true);
          await flush(8);
        });
        await act(async () => {
          release();
          await flush(24);
        });
        expect(mounted.current.byId.has("g-55")).toBe(false);
      } finally {
        mounted.unmount();
      }
    });

    it("lets a refresh's older list finish first without taking over from the kept list's newer one", async () => {
      const old = (index: number) => recentIso(3 * 24 * 60 * 60 * 1000 + index * 1000);
      const fake = createFakePaseo({
        agents: Array.from({ length: UNREAD }, (_, index) =>
          activeAgent(`unread-${index}`, { status: "idle", requiresAttention: true, attentionReason: "finished", updatedAt: old(index), lastUserMessageAt: old(index), createdAt: old(index) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake);
      try {
        await settle();
        // The refresh's list A reads its later page now (before the read below) and answers later.
        const releaseA = fake.holdPageAnswers();
        let result: string | undefined;
        await act(async () => {
          void mounted.current.refresh().then((value) => { result = value; });
          await flush(16);
        });
        // Read elsewhere; the kept list's newer snapshot B also answers its later page later.
        const read = fake.paseo.agents.ref("unread-100").current()!;
        fake.setAgentSilently({ ...read, requiresAttention: false, attentionReason: null, attentionTimestamp: null } as never);
        const releaseB = fake.holdPageAnswers();
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.requiresAttention === true);
          await flush(16);
        });
        // A finishes first; B after.
        await act(async () => {
          releaseA();
          await flush(24);
        });
        await act(async () => {
          releaseB();
          await flush(24);
        });
        expect(result).toBe("done");
        expect(mounted.current.byId.get("unread-100")?.lane).not.toBe("review");
        expect(mounted.current.lanes.review.cards).toHaveLength(UNREAD - 1);
      } finally {
        mounted.unmount();
      }
    });

    it("drops a refresh's reread done page once the done list started over", async () => {
      const fake = createFakePaseo({
        agents: Array.from({ length: 60 }, (_, index) => activeAgent(`r-${index}`, { status: "idle", requiresAttention: false, updatedAt: recentIso(10_000 + index * 1_000) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake, "24h");
      try {
        await settle();
        await act(async () => {
          mounted.current.loadMoreDone();
          await flush(16);
        });
        // A task the board never held, in the second page's range.
        const fresh = activeAgent("r-new", { status: "idle", requiresAttention: false, updatedAt: recentIso(10_000 + 54_500) });
        fake.setAgentSilently(fresh);
        // The refresh rereads the second page now (with r-new) and answers later.
        const release = fake.holdPageAnswers();
        await act(async () => {
          void mounted.current.refresh();
          await flush(16);
        });
        // r-new is archived with nothing sent, and the done list starts over from its first page.
        fake.setAgentSilently({ ...fresh, archivedAt: recentIso(0), updatedAt: recentIso(0) } as never);
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.statuses?.includes("idle") === true);
          await flush(8);
        });
        await act(async () => {
          release();
          await flush(24);
        });
        // The old second page does not land on the new first one.
        expect(mounted.current.byId.has("r-new")).toBe(false);
        expect(mounted.current.lanes.done.cards).toHaveLength(50);
      } finally {
        mounted.unmount();
      }
    });

    it("does not bring back an archived parent when an older read of it answers late", async () => {
      const fake = createFakePaseo({
        agents: [
          makeAgent({ id: "p", status: "idle", title: "Parent", workspaceId: "ws", updatedAt: recentIso(60_000) }),
          activeAgent("bg-child", { status: "running", workspaceId: "ws-bg", labels: { "paseo.parent-agent-id": "p" }, updatedAt: recentIso(1_000) }),
        ],
        workspaces: [workspace(), makeWorkspace({ id: "ws-bg", projectId: "project-id", name: "bg", background: true } as never)],
      });
      const mounted = await mountTasks(fake, "24h");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        await act(async () => { await flush(16); });
        const release = fake.holdRefreshes();
        await act(async () => {
          void mounted.current.refreshParent("p");
          await flush(8);
        });
        fake.passNewRefreshes();
        // Archived meanwhile; its running background child keeps it until a gone check takes it off.
        const parent = fake.paseo.agents.ref("p").current()!;
        await act(async () => {
          fake.upsertAgent({ ...parent, archivedAt: recentIso(0), updatedAt: recentIso(0) } as never);
          await flush(8);
          vi.advanceTimersByTime(1_100);
          await flush(16);
        });
        expect(mounted.current.byId.has("p")).toBe(false);
        await act(async () => {
          release();
          await flush(16);
        });
        expect(mounted.current.byId.has("p")).toBe(false);
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("shows a gapless done lane when a newer first page lands while a refresh rereads", async () => {
      // A newer first page (a task added at the top shifts the list) lands while the refresh's reread
      // page is out, at each task boundary the socket allows: the lane shows a prefix of the done list,
      // never a hole where the old first page ended (keyset cursors, as the daemon's).
      for (let delay = 0; delay <= 4; delay += 1) {
        const fake = createFakePaseo({
          agents: Array.from({ length: 120 }, (_, index) => activeAgent(`k-${String(index).padStart(3, "0")}`, { status: "idle", requiresAttention: false, updatedAt: recentIso(10_000 + index * 1_000) })),
          workspaces: [workspace()],
        });
        const mounted = await mountTasks(fake, "24h");
        try {
          await settle();
          await act(async () => {
            mounted.current.loadMoreDone();
            await flush(16);
          });
          const release = fake.holdPageAnswers();
          await act(async () => {
            void mounted.current.refresh();
            for (let index = 0; index < delay; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
            fake.setAgentSilently(activeAgent("k-top", { status: "idle", requiresAttention: false, updatedAt: recentIso(1_000) }));
            fake.reconnectAgentSubscriptionWhere((options) => options.filter?.statuses?.includes("idle") === true);
            await flush(16);
          });
          await act(async () => {
            release();
            await flush(40);
          });
          const ordered = ["k-top", ...Array.from({ length: 120 }, (_, index) => `k-${String(index).padStart(3, "0")}`)];
          const shown = mounted.current.lanes.done.cards.map((card) => card.id);
          expect({ delay, shown: [...shown].sort() }).toEqual({ delay, shown: ordered.slice(0, shown.length).sort() });
          expect(shown).toContain("k-top");
        } finally {
          mounted.unmount();
        }
      }
    });

    it("lands the kept list's snapshot once a refresh's newer one was let go", async () => {
      const old = (index: number) => recentIso(3 * 24 * 60 * 60 * 1000 + index * 1000);
      const fake = createFakePaseo({
        agents: Array.from({ length: 210 }, (_, index) =>
          activeAgent(`unread-${index}`, { status: "idle", requiresAttention: true, attentionReason: "finished", updatedAt: old(index), lastUserMessageAt: old(index), createdAt: old(index) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake, "24h", false);
      try {
        await settle();
        // Missed: a new unread task, last in the list's order.
        fake.setAgentSilently(activeAgent("unread-new", { status: "idle", requiresAttention: true, attentionReason: "finished", updatedAt: old(500), lastUserMessageAt: old(500), createdAt: old(500) }));
        // The kept list reconnects (A); its later page answers later.
        const releaseA = fake.holdPageAnswers();
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.requiresAttention === true);
          await flush(16);
        });
        // A refresh's list (B) arrives newer, hangs, and the refresh times out.
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const releaseB = fake.holdPageAnswers();
        let result: string | undefined;
        await act(async () => {
          void mounted.current.refresh().then((value) => { result = value; });
          await flush(16);
          vi.advanceTimersByTime(30_000);
          await flush(16);
        });
        expect(result).toBe("failed");
        // A finishes: with B let go, it is the newest and lands.
        await act(async () => {
          releaseA();
          await flush(32);
        });
        expect(mounted.current.byId.get("unread-new")?.lane).toBe("review");
        releaseB();
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("says so and checks again when a gone check's read fails", async () => {
      const fake = createFakePaseo({
        agents: Array.from({ length: 60 }, (_, index) => activeAgent(`gc-${index}`, { status: "idle", requiresAttention: false, updatedAt: recentIso(10_000 + index * 1_000) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake, "24h");
      try {
        await settle();
        await act(async () => {
          mounted.current.loadMoreDone();
          await flush(16);
        });
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        // Archived, the archived lane off: removes; only the second done page still holds it, so a gone check reads it.
        fake.failRefreshes(new Error("connection lost"));
        const target = fake.paseo.agents.ref("gc-55").current()!;
        await act(async () => {
          fake.upsertAgent({ ...target, archivedAt: recentIso(0), updatedAt: recentIso(0) } as never);
          await flush(8);
          vi.advanceTimersByTime(1_100);
          await flush(16);
        });
        expect(mounted.current.byId.has("gc-55")).toBe(true);
        expect(mounted.current.error).toBe("connection lost");
        fake.failRefreshes(null);
        await act(async () => {
          vi.advanceTimersByTime(2_000 + 1_100);
          await flush(16);
        });
        expect(mounted.current.byId.has("gc-55")).toBe(false);
        expect(mounted.current.error).toBeNull();
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("keeps the card at the done page boundary while a refresh rereads the next page", async () => {
      const fake = createFakePaseo({
        agents: Array.from({ length: 120 }, (_, index) => activeAgent(`b-${String(index).padStart(3, "0")}`, { status: "idle", requiresAttention: false, updatedAt: recentIso(10_000 + index * 1_000) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake, "24h");
      try {
        await settle();
        await act(async () => {
          mounted.current.loadMoreDone();
          await flush(16);
        });
        expect(mounted.current.byId.has("b-049")).toBe(true);
        // A task added at the top pushes b-049 onto the second page; the refresh's reread of it answers later.
        fake.setAgentSilently(activeAgent("b-top", { status: "idle", requiresAttention: false, updatedAt: recentIso(1_000) }));
        const release = fake.holdPageAnswers();
        await act(async () => {
          void mounted.current.refresh();
          await flush(24);
        });
        expect(mounted.current.byId.has("b-top")).toBe(true);
        expect(mounted.current.byId.has("b-049")).toBe(true);
        await act(async () => {
          release();
          await flush(24);
        });
        expect(mounted.current.byId.has("b-049")).toBe(true);
        // Two pages as before: b-top and b-000..b-098 (b-099 moved to the third page, not loaded).
        expect(mounted.current.lanes.done.cards).toHaveLength(100);
      } finally {
        mounted.unmount();
      }
    });

    it("clears a gone check's error once a snapshot took its card off", async () => {
      const fake = createFakePaseo({
        agents: Array.from({ length: 60 }, (_, index) => activeAgent(`gs-${index}`, { status: "idle", requiresAttention: false, updatedAt: recentIso(10_000 + index * 1_000) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake, "24h");
      try {
        await settle();
        await act(async () => {
          mounted.current.loadMoreDone();
          await flush(16);
        });
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        fake.failRefreshes(new Error("gone-check read failed"));
        const target = fake.paseo.agents.ref("gs-55").current()!;
        await act(async () => {
          fake.upsertAgent({ ...target, archivedAt: recentIso(0), updatedAt: recentIso(0) } as never);
          await flush(8);
          vi.advanceTimersByTime(1_100);
          await flush(16);
        });
        expect(mounted.current.error).toBe("gone-check read failed");
        // The done list starts over without it: the card leaves with the second page.
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.statuses?.includes("idle") === true);
          await flush(16);
        });
        expect(mounted.current.byId.has("gs-55")).toBe(false);
        await act(async () => {
          vi.advanceTimersByTime(2_000 + 1_100);
          await flush(16);
        });
        expect(mounted.current.error).toBeNull();
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("stops a refresh's reread chain once a newer done first page landed", async () => {
      const fake = createFakePaseo({
        agents: Array.from({ length: 150 }, (_, index) => activeAgent(`c-${String(index).padStart(3, "0")}`, { status: "idle", requiresAttention: false, updatedAt: recentIso(10_000 + index * 1_000) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake, "24h");
      try {
        await settle();
        for (let page = 0; page < 2; page += 1) {
          await act(async () => {
            mounted.current.loadMoreDone();
            await flush(16);
          });
        }
        expect(mounted.current.lanes.done.cards).toHaveLength(150);
        // The refresh rereads its second page, answered later.
        const release = fake.holdPageAnswers();
        let result: string | undefined;
        await act(async () => {
          void mounted.current.refresh().then((value) => { result = value; });
          await flush(16);
        });
        // A newer first page lands; any further page of the old chain would fail.
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.statuses?.includes("idle") === true);
          await flush(8);
        });
        fake.failNextAgentList((options) => options.page?.cursor !== undefined, "obsolete page failed");
        const before = fake.pageCalls().length;
        await act(async () => {
          release();
          await flush(24);
        });
        expect(fake.pageCalls()).toHaveLength(before);
        expect(mounted.current.error).toBeNull();
        expect(result).not.toBe("failed");
      } finally {
        mounted.unmount();
      }
    });

    it("clears a gone check's error when a snapshot takes its card off after the retries ran out", async () => {
      const fake = createFakePaseo({
        agents: Array.from({ length: 60 }, (_, index) => activeAgent(`ge-${index}`, { status: "idle", requiresAttention: false, updatedAt: recentIso(10_000 + index * 1_000) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake, "24h");
      try {
        await settle();
        await act(async () => {
          mounted.current.loadMoreDone();
          await flush(16);
        });
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        fake.failRefreshes(new Error("read failed"));
        const target = fake.paseo.agents.ref("ge-55").current()!;
        await act(async () => {
          fake.upsertAgent({ ...target, archivedAt: recentIso(0), updatedAt: recentIso(0) } as never);
          await flush(8);
        });
        // Every check fails, retries included.
        for (const wait of [1_100, 3_100, 6_100, 16_100, 1_000]) {
          await act(async () => {
            vi.advanceTimersByTime(wait);
            await flush(16);
          });
        }
        expect(mounted.current.error).toBe("read failed");
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.statuses?.includes("idle") === true);
          await flush(16);
        });
        expect(mounted.current.byId.has("ge-55")).toBe(false);
        expect(mounted.current.error).toBeNull();
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("says nothing when an old done page fails after the done list started over", async () => {
      const fake = createFakePaseo({
        agents: Array.from({ length: 80 }, (_, index) => activeAgent(`of-${index}`, { status: "idle", requiresAttention: false, updatedAt: recentIso(10_000 + index * 1_000) })),
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake, "24h");
      try {
        await settle();
        const release = fake.holdPages();
        await act(async () => {
          mounted.current.loadMoreDone();
          await flush(8);
        });
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.statuses?.includes("idle") === true);
          await flush(8);
        });
        fake.failNextAgentList((options) => options.page?.cursor !== undefined, "obsolete request failed");
        await act(async () => {
          release();
          await flush(16);
        });
        expect(mounted.current.error).toBeNull();
      } finally {
        mounted.unmount();
      }
    });

    it("keeps saying a list is incomplete while another one recovers", async () => {
      const fake = createFakePaseo({
        agents: [
          ...Array.from({ length: 210 }, (_, index) => activeAgent(`run-${index}`, { status: "running", updatedAt: recentIso(1_000 + index) })),
          ...Array.from({ length: UNREAD }, (_, index) =>
            activeAgent(`unread-${index}`, { status: "idle", requiresAttention: true, attentionReason: "finished", updatedAt: recentIso(5_000 + index) })),
        ],
        workspaces: [workspace()],
      });
      const mounted = await mountTasks(fake);
      try {
        await settle();
        fake.failNextAgentList((options) => options.page?.cursor !== undefined && options.filter?.statuses?.includes("running") === true, "running list incomplete");
        fake.failNextAgentList((options) => options.page?.cursor !== undefined && options.filter?.requiresAttention === true, "review list incomplete");
        await act(async () => {
          fake.reconnectSubscriptions();
          await flush(24);
        });
        expect(["running list incomplete", "review list incomplete"]).toContain(mounted.current.error);
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.requiresAttention === true);
          await flush(24);
        });
        expect(mounted.current.error).toBe("running list incomplete");
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.statuses?.includes("running") === true);
          await flush(24);
        });
        expect(mounted.current.error).toBeNull();
      } finally {
        mounted.unmount();
      }
    });

    it("reads each later page once for the snapshot the SDK replays on subscribe", async () => {
      const fake = unreadFake();
      const mounted = await mountTasks(fake);
      try {
        await settle();
        expect(fake.pageCalls().filter((call) => call.startsWith("agents.list:"))).toHaveLength(1);
      } finally {
        mounted.unmount();
      }
    });

    it("stops reading the pages of a list once the board closes", async () => {
      const fake = createFakePaseo({
        agents: Array.from({ length: 650 }, (_, index) =>
          activeAgent(`unread-${index}`, { status: "idle", requiresAttention: true, attentionReason: "finished", updatedAt: recentIso(1_000 + index) })),
        workspaces: [workspace()],
      });
      const release = fake.holdPages();
      const mounted = await mountTasks(fake);
      await settle();
      const before = fake.pageCalls().filter((call) => call.startsWith("agents.list:")).length;
      expect(before).toBeGreaterThan(0);
      mounted.unmount();
      await act(async () => {
        release();
        await flush(16);
      });
      // Each list in flight finishes the page it asked for and asks for no other.
      expect(fake.pageCalls().filter((call) => call.startsWith("agents.list:"))).toHaveLength(before);
    });

    it("keeps the unread tasks it has when a later page cannot be read", async () => {
      const fake = unreadFake();
      const mounted = await mountTasks(fake);
      try {
        await settle();
        fake.failNextAgentList((options) => options.page?.cursor !== undefined && options.filter?.requiresAttention === true, "socket closed");
        await act(async () => {
          fake.reconnectSubscriptions();
          await Promise.resolve();
        });
        await settle();
        expect(mounted.current.lanes.review.cards).toHaveLength(UNREAD);
        expect(mounted.current.error).toBe("socket closed");
      } finally {
        mounted.unmount();
      }
    });

    it("lets a live read win over the later pages of a snapshot", async () => {
      const fake = unreadFake();
      const mounted = await mountTasks(fake);
      try {
        await settle();
        const last = `unread-${UNREAD - 1}`;
        await act(async () => {
          fake.reconnectSubscriptions();
          // Read on another device while the later pages load: the pages still hold it unread.
          fake.upsertAgent(activeAgent(last, { status: "idle", requiresAttention: false, updatedAt: recentIso(0) }));
          await Promise.resolve();
        });
        await settle();
        expect(mounted.current.byId.get(last)?.lane).toBe("done");
        expect(mounted.current.lanes.review.cards).toHaveLength(UNREAD - 1);
      } finally {
        mounted.unmount();
      }
    });
  });

  describe("a paged workspace list", () => {
    const flush = async (rounds: number) => { for (let index = 0; index < rounds; index += 1) await Promise.resolve(); };
    // The daemon pages its workspace list (200 at most) and a subscription's
    // snapshot is only the first page: with 232 workspaces the main checkout's
    // tasks fell into the archived lane (2026-11-15).
    function pagedFake() {
      const fillers = Array.from({ length: 4 }, (_, index) => makeWorkspace({ id: `filler-${index}`, projectId: "project-id", name: `filler-${index}` }));
      return createFakePaseo({
        agents: [
          activeAgent("late", { status: "idle", requiresAttention: true, updatedAt: recentIso(1_000) }),
          activeAgent("stale", { status: "idle", requiresAttention: true, updatedAt: recentIso(2_000), workspaceId: "ws-archived" }),
        ],
        // "ws" comes after two full pages of others.
        workspaces: [...fillers, workspace()],
        workspacePageSize: 2,
      });
    }

    async function settle() {
      await act(async () => {
        for (let index = 0; index < 12; index += 1) await Promise.resolve();
      });
    }

    it("keeps a task whose workspace is past the first page out of the archived lane", async () => {
      const fake = pagedFake();
      const mounted = await mountTasks(fake);
      try {
        await settle();
        expect(mounted.current.byId.get("late")?.lane).toBe("review");
        expect(mounted.current.byId.get("late")?.location.workspaceName ?? mounted.current.byId.get("late")?.location.workspaceTitle).toBeTruthy();
        // A workspace on no page is still archived.
        expect(mounted.current.byId.has("stale")).toBe(false);
        await act(async () => {
          fake.reconnectSubscriptions();
          await Promise.resolve();
        });
        await settle();
        expect(mounted.current.byId.get("late")?.lane).toBe("review");
        await act(async () => {
          fake.removeWorkspace("ws");
          await Promise.resolve();
        });
        expect(mounted.current.byId.has("late")).toBe(false);
      } finally {
        mounted.unmount();
      }
    });

    it("finishes loading the workspaces when a refresh lands during their later pages", async () => {
      const fake = pagedFake();
      const release = fake.holdPages();
      const mounted = await mountTasks(fake);
      try {
        await settle();
        expect(mounted.current.ready).toBe(false);
        await act(async () => {
          void mounted.current.refresh();
          await flush(16);
        });
        await act(async () => {
          release();
          await flush(16);
        });
        await settle();
        expect(mounted.current.ready).toBe(true);
        expect(mounted.current.byId.get("late")?.lane).toBe("review");
      } finally {
        mounted.unmount();
      }
    });

    it("windows a task archived with its workspace by the task's own update time", async () => {
      const days = (count: number) => recentIso(count * 24 * 60 * 60 * 1000);
      const fake = createFakePaseo({
        agents: [activeAgent("stale-task", { status: "idle", updatedAt: days(5), lastUserMessageAt: days(5), createdAt: days(6), workspaceId: "ws-archiving" })],
        workspaces: [workspace(), makeWorkspace({ id: "ws-archiving", projectId: "project-id", name: "archiving", archivingAt: recentIso(0) } as never)],
      });
      let current!: TasksHandle;
      function Probe() {
        current = useTasks(fake.paseo, { doneWindow: "24h", includeDone: true, includeArchived: true });
        return null;
      }
      let renderer!: Renderer;
      await act(async () => {
        setTasksArchivedLane(fake.paseo, true);
        renderer = TestRenderer.create(React.createElement(Probe));
        await flush(16);
      });
      try {
        // Its workspace is archiving just now, but the done list pages by the task's own time,
        // which is days old: the lane shows it neither now nor once paged, nor only on this board.
        expect(current.byId.has("stale-task")).toBe(false);
      } finally {
        await act(async () => renderer.unmount());
      }
    });

    it("finishes loading the workspaces when a refresh lands before their first page answered", async () => {
      const fake = pagedFake();
      const release = fake.holdWorkspaceLists();
      const mounted = await mountTasks(fake);
      try {
        await settle();
        expect(mounted.current.ready).toBe(false);
        await act(async () => {
          void mounted.current.refresh();
          await flush(16);
        });
        await act(async () => {
          release();
          await flush(24);
        });
        await settle();
        expect(mounted.current.ready).toBe(true);
        expect(mounted.current.byId.get("late")?.lane).toBe("review");
      } finally {
        mounted.unmount();
      }
    });

    it("finishes loading the workspaces when a refresh lands before their subscription is ready", async () => {
      const fake = pagedFake();
      const releaseList = fake.holdWorkspaceLists();
      const mounted = await mountTasks(fake);
      try {
        await settle();
        const releaseReady = fake.holdReady();
        await act(async () => {
          releaseList();
          await flush(16);
        });
        await act(async () => {
          void mounted.current.refresh();
          await flush(16);
        });
        await act(async () => {
          releaseReady();
          await flush(24);
        });
        await settle();
        expect(mounted.current.ready).toBe(true);
        expect(mounted.current.byId.get("late")?.lane).toBe("review");
      } finally {
        mounted.unmount();
      }
    });

    it("does not archive a task of a workspace made while disconnected before the reconnect's pages land", async () => {
      const fake = pagedFake();
      const mounted = await mountTasks(fake);
      try {
        await settle();
        expect(mounted.current.ready).toBe(true);
        // Made while disconnected: a new workspace (on a later page) and a task running in it.
        fake.setWorkspaceSilently(makeWorkspace({ id: "z-new", projectId: "project-id", name: "z-new" }));
        const release = fake.holdPages();
        await act(async () => {
          fake.reconnectOldestWorkspaceSubscription();
          await flush(8);
        });
        await act(async () => {
          fake.upsertAgent(activeAgent("new-runner", { status: "running", workspaceId: "z-new", updatedAt: recentIso(0), lastUserMessageAt: recentIso(0) }));
          await flush(8);
        });
        // Its workspace is unplaced while the list's later pages load: it waits off the board, never archived.
        expect(mounted.current.byId.has("new-runner")).toBe(false);
        await settleWorkspaceCheck();
        expect(mounted.current.byId.has("new-runner")).toBe(false);
        await act(async () => {
          release();
          await flush(24);
        });
        await settleWorkspaceCheck();
        expect(mounted.current.byId.get("new-runner")?.lane).toBe("running");
        // A workspace archived before (left out of a complete list) stays archived throughout.
        expect(mounted.current.byId.has("stale")).toBe(false);
      } finally {
        mounted.unmount();
      }
    });

    it("does not archive a new workspace's running task when the running list reconnects before the workspaces", async () => {
      const fake = createFakePaseo({ agents: [activeAgent("old", { status: "idle", requiresAttention: true, updatedAt: recentIso(5_000) })], workspaces: [workspace()] });
      const mounted = await mountTasks(fake);
      try {
        await settle();
        expect(mounted.current.ready).toBe(true);
        // Made while disconnected.
        fake.setWorkspaceSilently(makeWorkspace({ id: "z-new", projectId: "project-id", name: "z-new" }));
        fake.setAgentSilently(activeAgent("new-runner", { status: "running", workspaceId: "z-new", updatedAt: recentIso(0), lastUserMessageAt: recentIso(0) }));
        // The running list comes back first.
        await act(async () => {
          fake.reconnectAgentSubscriptionWhere((options) => options.filter?.statuses?.includes("running") === true);
          await flush(16);
        });
        // The workspace check is a timer. It may already have placed the task
        // in running; either way it must not have archived it.
        const early = mounted.current.byId.get("new-runner");
        expect(early === undefined || early.lane === "running").toBe(true);
        await settleWorkspaceCheck();
        expect(mounted.current.byId.get("new-runner")?.lane).toBe("running");
        await act(async () => {
          fake.reconnectOldestWorkspaceSubscription();
          await flush(16);
        });
        expect(mounted.current.byId.get("new-runner")?.lane).toBe("running");
      } finally {
        mounted.unmount();
      }
    });

    it("archives a removed workspace's task though the first workspace list could not read every page", async () => {
      const fake = createFakePaseo({
        agents: [activeAgent("victim", { status: "running", workspaceId: "filler-0", updatedAt: recentIso(1_000) })],
        workspaces: [...Array.from({ length: 4 }, (_, index) => makeWorkspace({ id: `filler-${index}`, projectId: "project-id", name: `filler-${index}` })), workspace()],
        workspacePageSize: 2,
      });
      const release = fake.holdPages();
      const mounted = await mountTasks(fake);
      try {
        await settle();
        // The daemon archives filler-0 while the first list's later pages load; they then fail.
        await act(async () => {
          fake.removeWorkspace("filler-0");
          await flush(8);
        });
        fake.failWorkspacePages(new Error("later page failed"));
        await act(async () => {
          release();
          await flush(24);
        });
        expect(mounted.current.ready).toBe(true);
        expect(mounted.current.error).toBe("later page failed");
        expect(mounted.current.byId.get("victim")?.lane).not.toBe("running");
      } finally {
        mounted.unmount();
      }
    });

    it("reads no more pages for a refresh that timed out", async () => {
      const fake = createFakePaseo({
        agents: [activeAgent("late", { status: "idle", requiresAttention: true, updatedAt: recentIso(1_000) })],
        workspaces: [...Array.from({ length: 6 }, (_, index) => makeWorkspace({ id: `filler-${index}`, projectId: "project-id", name: `filler-${index}` })), workspace()],
        workspacePageSize: 2,
      });
      const mounted = await mountTasks(fake);
      try {
        await settle();
        expect(mounted.current.ready).toBe(true);
        const release = fake.holdPages();
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        let result: string | undefined;
        await act(async () => {
          void mounted.current.refresh().then((value) => { result = value; });
          await flush(16);
        });
        const before = fake.pageCalls().filter((call) => call.startsWith("workspaces.list:")).length;
        await act(async () => {
          vi.advanceTimersByTime(30_000);
          await flush(16);
        });
        expect(result).toBe("failed");
        await act(async () => {
          release();
          await flush(24);
        });
        // The timed-out refresh's list was let go: it asks for no further page, and the board keeps its workspaces.
        expect(fake.pageCalls().filter((call) => call.startsWith("workspaces.list:"))).toHaveLength(before);
        expect(mounted.current.byId.get("late")?.lane).toBe("review");
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });

    it("keeps the board's workspaces when a later page cannot be read", async () => {
      const fake = pagedFake();
      const mounted = await mountTasks(fake);
      try {
        await settle();
        expect(mounted.current.byId.get("late")?.lane).toBe("review");
        fake.failWorkspacePages(new Error("socket closed"));
        await act(async () => {
          fake.reconnectSubscriptions();
          await Promise.resolve();
        });
        await settle();
        expect(mounted.current.byId.get("late")?.lane).toBe("review");
      } finally {
        mounted.unmount();
      }
    });

    it("lets a live removal win over the later pages of a snapshot", async () => {
      const fake = pagedFake();
      const mounted = await mountTasks(fake);
      try {
        await settle();
        await act(async () => {
          fake.reconnectSubscriptions();
          // Archived while the snapshot's later pages are read; the fake's list already leaves it out,
          // so put it back for the pages to carry a stale copy.
          fake.removeWorkspace("ws");
          fake.setWorkspaceSilently(workspace());
          await Promise.resolve();
        });
        await settle();
        expect(mounted.current.byId.has("late")).toBe(false);
      } finally {
        mounted.unmount();
      }
    });
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

  it("names the parent the server saw archive a task's link as history, never as a live subtask", async () => {
    let origins = [{ agentId: "both", parentAgentId: "gone" }, { agentId: "lost", parentAgentId: "gone" }];
    let version = 1;
    setSubagentLoader(async () => ({ version: "s", subagents: [] }));
    setParentOriginsLoader(async (since) => (since === String(version) ? { version: String(version), origins: null } : { version: String(version), origins }));
    const fake = createFakePaseo({
      agents: [
        activeAgent("parent", { status: "running", title: "Parent", updatedAt: at(10) }),
        activeAgent("child", { status: "running", title: "Child", labels: { "paseo.parent-agent-id": "parent" } }),
        activeAgent("by-hand", { status: "running", title: "Detached by hand", labels: { "paseo.parent-agent-id": "parent" } }),
        activeAgent("both", { status: "idle", updatedAt: at(9), title: "Live parent too", labels: { "paseo.parent-agent-id": "parent" } }),
        activeAgent("lost", { status: "running", title: "Parent unreadable" }),
      ],
    });
    const mounted = await mountTasks(fake, "all");
    // An agent update brings the next read of the server's origins forward.
    const settle = () => act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_600));
    });
    try {
      await act(async () => {
        await vi.waitFor(() => expect(mounted.current.byId.get("lost")?.parent).not.toBeNull());
      });
      // A former parent that cannot be read stays named by id, unknown rather than guessed.
      expect(mounted.current.byId.get("lost")?.parent).toEqual({ id: "gone", title: null, missing: true, archived: null, detached: true });
      // A live parent label wins over a recorded origin.
      expect(mounted.current.byId.get("both")?.parent).toEqual({ id: "parent", title: "Parent", missing: false, archived: false });
      expect(mounted.current.byId.get("parent")?.children.map((child) => child.id)).toEqual(["child", "by-hand", "both"]);

      // Detached by hand: the label goes and the server records nothing, so the card names no parent.
      await act(async () => {
        fake.upsertAgent(activeAgent("by-hand", { status: "running", title: "Detached by hand", updatedAt: at(11) }));
      });
      await settle();
      expect(mounted.current.byId.get("by-hand")?.parent).toBeNull();

      // The daemon archives the parent and detaches the surviving child; the server confirms it.
      origins = [...origins, { agentId: "child", parentAgentId: "parent" }];
      version = 2;
      await act(async () => {
        fake.upsertAgent(activeAgent("parent", { status: "closed", title: "Parent", updatedAt: at(12), archivedAt: at(12) }));
        fake.upsertAgent(activeAgent("child", { status: "running", title: "Child", updatedAt: at(13) }));
      });
      await settle();
      const detached = mounted.current.byId.get("child");
      expect(detached?.parent).toEqual({ id: "parent", title: "Parent", missing: true, archived: true, archivedAs: "agent", detached: true });
      expect(mounted.current.byId.get("by-hand")?.parent).toBeNull();
      // Still its own running task: not folded, not waiting on, not stopped with the parent.
      expect(detached?.lane).toBe("running");
      expect(filterLanes(mounted.current.lanes, { ...EMPTY_FILTERS, hideSubtasks: true }).running.cards.map((card) => card.id)).toContain("child");

      // Restoring the parent does not reattach the child: the link stays history.
      await act(async () => {
        fake.upsertAgent(activeAgent("parent", { status: "idle", title: "Parent", updatedAt: at(14), archivedAt: null }));
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
      });
      const restored = mounted.current.byId.get("parent");
      expect(restored?.children.map((child) => child.id)).toEqual(["both"]);
      // Its only live child is idle; the running detached task does not keep it waiting.
      expect(restored?.waitingOnSubtasks).toBeUndefined();
      expect(mounted.current.byId.get("child")?.parent).toEqual({ id: "parent", title: "Parent", missing: false, archived: false, detached: true });

      // The former parent's rename reaches the child's link.
      await act(async () => {
        fake.upsertAgent(activeAgent("parent", { status: "idle", title: "Renamed parent", updatedAt: at(15), archivedAt: null }));
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
      });
      expect(mounted.current.byId.get("child")?.parent).toMatchObject({ title: "Renamed parent", detached: true });

      // Done, it stays a card when subtasks are hidden: hiding folds only live subtasks.
      await act(async () => {
        fake.upsertAgent(activeAgent("child", { status: "idle", title: "Child", updatedAt: at(16) }));
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
      });
      expect(mounted.current.byId.get("child")?.lane).not.toBe("running");
      const hidden = filterLanes(mounted.current.lanes, { ...EMPTY_FILTERS, hideSubtasks: true });
      expect(LANE_ORDER.flatMap((lane) => hidden[lane].cards.map((card) => card.id))).toContain("child");

      // The server forgets it (a live parent again elsewhere): the card follows.
      origins = origins.filter((origin) => origin.agentId !== "child");
      version = 3;
      await act(async () => {
        fake.upsertAgent(activeAgent("other", { status: "running" }));
      });
      await settle();
      expect(mounted.current.byId.get("child")?.parent).toBeNull();
    } finally {
      mounted.unmount();
      setSubagentLoader(null);
      setParentOriginsLoader(null);
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

    it("lands nothing from a refresh's list once the board that asked for it closes", async () => {
      const fake = createFakePaseo({
        agents: Array.from({ length: 230 }, (_, index) =>
          activeAgent(`unread-${index}`, { status: "idle", requiresAttention: true, attentionReason: "finished", updatedAt: recentIso(1_000 + index) })),
        workspaces: [workspace()],
      });
      // The sidebar counts running tasks only, and outlives the board.
      const counts = await mountCounts(fake, false);
      const board = await mountTasks(fake);
      try {
        await act(async () => { for (let index = 0; index < 16; index += 1) await Promise.resolve(); });
        expect(board.current.lanes.review.cards).toHaveLength(230);
        const release = fake.holdPages();
        await act(async () => {
          void board.current.refresh();
          for (let index = 0; index < 16; index += 1) await Promise.resolve();
        });
        board.unmount();
        expect(counts.current.review).toBe(0);
        const before = fake.pageCalls().length;
        await act(async () => {
          release();
          for (let index = 0; index < 24; index += 1) await Promise.resolve();
        });
        expect(counts.current.review).toBe(0);
        expect(fake.pageCalls()).toHaveLength(before);
      } finally {
        counts.unmount();
      }
    });

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

    it("exposes only visible question requests and follows changes without a count change", async () => {
      const asking = { id: "q", provider: "claude", name: "AskUserQuestion", kind: "question" as const, title: "Question", input: { questions: [{ header: "One", question: "Choose", options: [{ label: "Yes" }] }] } };
      const fake = createFakePaseo({ agents: [activeAgent("question", { status: "running", pendingPermissions: [asking] }), activeAgent("tool", { status: "running", pendingPermissions: [permission] })] });
      let current!: ReturnType<typeof useTaskCounts>;
      const scope = { filters: EMPTY_FILTERS };
      function Counts() { current = useTaskCounts(fake.paseo, false, scope, true); return null; }
      let renderer!: Renderer;
      await act(async () => { renderer = TestRenderer.create(React.createElement(Counts)); for (let i = 0; i < 8; i++) await Promise.resolve(); });
      try {
        expect(current.needsInput).toBe(2);
        expect(current.questions?.map((card) => card.id)).toEqual(["question"]);
        await act(async () => { fake.upsertAgent(activeAgent("question", { status: "running", pendingPermissions: [permission], updatedAt: at(12) })); await Promise.resolve(); });
        expect(current.needsInput).toBe(2);
        expect(current.questions).toEqual([]);
      } finally { act(() => renderer.unmount()); }
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
        expect(current.hidden?.map((card) => card.id)).toEqual([]);
        scope = claude;
        act(() => renderer.update(React.createElement(Counts)));
        expect(current.running).toBe(1);
        expect(current.hidden?.map((card) => card.id)).toEqual(["other"]);
        scope = { filters: { ...EMPTY_FILTERS, query: "no matching task" } };
        act(() => renderer.update(React.createElement(Counts)));
        expect(current.running).toBe(0);
        expect(current.hidden?.map((card) => card.id).sort()).toEqual(["child", "other", "parent"]);
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

    it("retains an old failure without failing a parent prompted after it", () => {
      const prompted = { ...doneCard(), timing: { ...doneCard().timing, lastUserMessageAt: "2026-10-22T09:30:00.000Z" } };
      expect(withSubagents(prompted, [subagent("a")])).toMatchObject({ lane: "done", status: "done", error: null, children: [{ id: "a", status: "failed" }] });
      const running = { ...doneCard(), lane: "running" as const, status: "running" as const };
      const shown = withSubagents(running, [subagent("a")]);
      expect(shown).toMatchObject({ lane: "running", status: "running", error: null });
      expect(shown.children.map((child) => child.status)).toEqual(["failed"]);
      // A failure of its own keeps its own reason.
      const failed = { ...doneCard(), lane: "review" as const, status: "failed" as const, error: "API error" };
      expect(withSubagents(failed, [subagent("a")]).error).toBe("API error");
    });

    it("retains completed and canceled provider subagents after a later prompt", () => {
      const parent = { ...doneCard(), timing: { ...doneCard().timing, lastUserMessageAt: "2026-10-22T09:30:00.000Z" } };
      const card = withSubagents(parent, [subagent("done", { status: "completed" }), subagent("canceled", { status: "canceled" })]);
      expect(card.children.map((child) => [child.id, child.status, child.lane])).toEqual([["done", "done", "done"], ["canceled", "done", "done"]]);
      expect(card).toMatchObject({ lane: "done", status: "done", error: null });
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
      archivedWorkspaceIds: ["ws-archived"],
    });
    const off = await mountArchived(fake, false);
    await settleWorkspaceCheck();
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
      archivedWorkspaceIds: ["ws-archived"],
    });
    const on = await mountArchived(fake, true);
    try {
      await settleWorkspaceCheck();
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
      archivedWorkspaceIds: ["ws-archived"],
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
    await settleWorkspaceCheck();
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

  it("hides title helpers even after their background workspace is archived", async () => {
    const fake = createFakePaseo({
      agents: [
        activeAgent("helper", { status: "closed", workspaceId: "ws-helper", archivedAt: recentIso(2_000), updatedAt: recentIso(2_000), labels: { "better-paseo.purpose": "title-generation" } }),
        activeAgent("ordinary", { status: "closed", workspaceId: "ws-helper", archivedAt: recentIso(2_000), updatedAt: recentIso(2_000) }),
      ],
      workspaces: [workspace()],
      archivedWorkspaceIds: ["ws-helper"],
    });
    const mounted = await mountArchived(fake, true);
    try {
      expect(ids(mounted.current.lanes.archived)).toEqual(["ordinary"]);
      expect(mounted.current.byId.has("helper")).toBe(false);
    } finally {
      mounted.unmount();
    }
  });

  it("hides timeline translation helpers even after their background workspace is archived", async () => {
    const fake = createFakePaseo({
      agents: [
        activeAgent("tl-helper", { status: "closed", workspaceId: "ws-tl", archivedAt: recentIso(2_000), updatedAt: recentIso(2_000), labels: { "better-paseo.purpose": "timeline-translation" } }),
        activeAgent("ordinary", { status: "closed", workspaceId: "ws-tl", archivedAt: recentIso(2_000), updatedAt: recentIso(2_000) }),
      ],
      workspaces: [workspace()],
      archivedWorkspaceIds: ["ws-tl"],
    });
    const mounted = await mountArchived(fake, true);
    try {
      expect(ids(mounted.current.lanes.archived)).toEqual(["ordinary"]);
      expect(mounted.current.byId.has("tl-helper")).toBe(false);
    } finally {
      mounted.unmount();
    }
  });

  it("archives a task of a workspace archived while disconnected when its list comes back after the workspaces", async () => {
    const fake = createFakePaseo({
      agents: [activeAgent("old", { status: "idle", requiresAttention: true, updatedAt: recentIso(5_000) })],
      workspaces: [workspace()],
      archivedWorkspaceIds: ["ws-gone"],
    });
    const mounted = await mountArchived(fake, true);
    try {
      await settleWorkspaceCheck();
      // Meanwhile, out of the board's sight: a task waits for review in a workspace that was then archived.
      fake.setAgentSilently(activeAgent("ghost", { status: "idle", requiresAttention: true, workspaceId: "ws-gone", updatedAt: recentIso(1_000), lastUserMessageAt: recentIso(1_000) }));
      // The workspaces come back first (complete, without it), then the unread list.
      await act(async () => {
        fake.reconnectOldestWorkspaceSubscription();
        for (let index = 0; index < 16; index += 1) await Promise.resolve();
      });
      await act(async () => {
        fake.reconnectAgentSubscriptionWhere((options) => options.filter?.requiresAttention === true);
        for (let index = 0; index < 16; index += 1) await Promise.resolve();
      });
      expect(ids(mounted.current.lanes.review)).not.toContain("ghost");
      await settleWorkspaceCheck();
      expect(mounted.current.byId.get("ghost")?.lane).toBe("archived");
      expect(ids(mounted.current.lanes.review)).not.toContain("ghost");
    } finally {
      mounted.unmount();
    }
  });

  it("does not flash a refreshed task of a new workspace into the archived lane while the workspaces' pages load", async () => {
    const fillers = Array.from({ length: 4 }, (_, index) => makeWorkspace({ id: `filler-${index}`, projectId: "project-id", name: `filler-${index}` }));
    const fake = createFakePaseo({
      agents: [activeAgent("old", { status: "idle", requiresAttention: true, updatedAt: recentIso(5_000) })],
      workspaces: [...fillers, workspace()],
      workspacePageSize: 2,
    });
    const mounted = await mountArchived(fake, true);
    try {
      await settleWorkspaceCheck();
      expect(mounted.current.byId.get("old")?.lane).toBe("review");
      // Made while the board was not looking: a workspace (on a later page) and a task running in it.
      fake.setWorkspaceSilently(makeWorkspace({ id: "z-new", projectId: "project-id", name: "z-new" }));
      fake.setAgentSilently(activeAgent("new-runner", { status: "running", workspaceId: "z-new", updatedAt: recentIso(0), lastUserMessageAt: recentIso(0) }));
      const release = fake.holdPages();
      let refreshed!: Promise<unknown>;
      await act(async () => {
        refreshed = mounted.current.refresh();
        for (let index = 0; index < 24; index += 1) await Promise.resolve();
      });
      expect(ids(mounted.current.lanes.archived)).not.toContain("new-runner");
      await settleWorkspaceCheck();
      expect(ids(mounted.current.lanes.archived)).not.toContain("new-runner");
      await act(async () => {
        release();
        for (let index = 0; index < 24; index += 1) await Promise.resolve();
      });
      await settleWorkspaceCheck();
      await act(async () => { await refreshed; });
      expect(mounted.current.byId.get("new-runner")?.lane).toBe("running");
    } finally {
      mounted.unmount();
    }
  });

  for (const which of ["workspaces", "agents"] as const) {
    it(`makes a list whose first subscription failed live again on its own (${which}), and clears the error`, async () => {
      const fake = createFakePaseo({
        agents: [
          activeAgent("live", { status: "idle", requiresAttention: true, updatedAt: recentIso(2_000) }),
          activeAgent("other", { status: "idle", requiresAttention: true, workspaceId: "ws-other", updatedAt: recentIso(3_000) }),
        ],
        workspaces: [workspace(), makeWorkspace({ id: "ws-other", projectId: "project-id", name: "ws-other" })],
      });
      // The first subscription request fails once; later ones answer.
      let failed = false;
      if (which === "workspaces") {
        const api = fake.paseo.workspaces as { list: (options: { subscribe?: unknown }) => Promise<unknown> };
        const list = api.list.bind(api);
        api.list = async (options) => {
          if (options.subscribe && !failed) { failed = true; throw new Error("list failed"); }
          return list(options);
        };
      } else {
        const api = fake.paseo.agents as { list: (options: { subscribe?: unknown; filter?: { requiresAttention?: boolean } }) => Promise<unknown> };
        const list = api.list.bind(api);
        api.list = async (options) => {
          if (options.subscribe && options.filter?.requiresAttention && !failed) { failed = true; throw new Error("list failed"); }
          return list(options);
        };
      }
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const mounted = await mountArchived(fake, true);
      try {
        expect(failed).toBe(true);
        expect(mounted.current.error).toBe("list failed");
        for (let round = 0; round < 4; round += 1) {
          await act(async () => {
            vi.advanceTimersByTime(round === 0 ? LIST_RECOVERY_DELAYS_MS[0]! + 10 : 10);
            for (let index = 0; index < 64; index += 1) await Promise.resolve();
          });
        }
        expect(mounted.current.error).toBeNull();
        // Live again: the daemon's next changes reach the board.
        await act(async () => {
          if (which === "workspaces") fake.removeWorkspace("ws-other");
          else fake.upsertAgent(activeAgent("fresh", { status: "idle", requiresAttention: true, updatedAt: recentIso(0) }));
          for (let index = 0; index < 16; index += 1) await Promise.resolve();
        });
        if (which === "workspaces") expect(mounted.current.byId.get("other")?.lane).toBe("archived");
        else expect(mounted.current.byId.get("fresh")?.lane).toBe("review");
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });
  }

  async function advanceRecovery(rounds: number, step: number) {
    for (let round = 0; round < rounds; round += 1) {
      await act(async () => {
        vi.advanceTimersByTime(step);
        for (let index = 0; index < 64; index += 1) await Promise.resolve();
      });
    }
  }

  it("keeps recovering a failed workspace subscription until it is live, though the first refresh skips it while the status list pages", async () => {
    const runners = Array.from({ length: 201 }, (_, index) => activeAgent(`run-${index}`, { status: "running", updatedAt: recentIso(10_000 + index), lastUserMessageAt: recentIso(10_000 + index) }));
    const fake = createFakePaseo({
      agents: [...runners, activeAgent("other", { status: "idle", requiresAttention: true, workspaceId: "ws-other", updatedAt: recentIso(3_000) })],
      workspaces: [workspace(), makeWorkspace({ id: "ws-other", projectId: "project-id", name: "ws-other" })],
    });
    const api = fake.paseo.workspaces as { list: (options: { subscribe?: unknown }) => Promise<unknown> };
    const list = api.list.bind(api);
    let subscribes = 0;
    api.list = async (options) => {
      if (options.subscribe) {
        subscribes += 1;
        if (subscribes === 1) throw new Error("list failed");
      }
      return list(options);
    };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // The status list's later page hangs: the board is still loading it when the first recovery runs.
    const release = fake.holdPages();
    const mounted = await mountArchived(fake, true);
    try {
      await advanceRecovery(1, LIST_RECOVERY_DELAYS_MS[0]! + 10);
      await advanceRecovery(3, 10);
      release();
      await advanceRecovery(1, 10);
      await advanceRecovery(1, LIST_RECOVERY_DELAYS_MS[1]! + 10);
      await advanceRecovery(3, 10);
      expect(subscribes).toBeGreaterThanOrEqual(2);
      await act(async () => {
        fake.removeWorkspace("ws-other");
        for (let index = 0; index < 16; index += 1) await Promise.resolve();
      });
      expect(mounted.current.byId.get("other")?.lane).toBe("archived");
    } finally {
      vi.useRealTimers();
      mounted.unmount();
    }
  });

  for (const which of ["status", "attention", "workspaces"] as const) {
    it(`recovers the ${which} list lost while its first pages were still loading`, async () => {
      const many = Array.from({ length: 201 }, (_, index) => activeAgent(`a-${index}`, which === "attention"
        ? { status: "idle", requiresAttention: true, updatedAt: recentIso(10_000 + index) }
        : { status: "running", updatedAt: recentIso(10_000 + index), lastUserMessageAt: recentIso(10_000 + index) }));
      const fillers = Array.from({ length: 4 }, (_, index) => makeWorkspace({ id: `filler-${index}`, projectId: "project-id", name: `filler-${index}` }));
      const fake = createFakePaseo({
        agents: many,
        workspaces: [...fillers, workspace()],
        ...(which === "workspaces" ? { workspacePageSize: 2 } : {}),
      });
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const release = fake.holdPages();
      const mounted = await mountArchived(fake, true);
      try {
        expect(mounted.current.ready).toBe(false);
        // The reconnect's re-subscribe fails while the first pages are still out.
        await act(async () => {
          if (which === "workspaces") fake.failWorkspaceResubscribe();
          else if (which === "attention") fake.failAgentResubscribeWhere((options) => options.filter?.requiresAttention === true);
          else fake.failAgentResubscribeWhere((options) => options.filter?.statuses?.includes("running") === true);
          for (let index = 0; index < 8; index += 1) await Promise.resolve();
        });
        release();
        fake.passNewPages();
        await advanceRecovery(3, 10);
        await advanceRecovery(1, LIST_RECOVERY_DELAYS_MS[0]! + 10);
        await advanceRecovery(4, 10);
        await advanceRecovery(1, LIST_RECOVERY_DELAYS_MS[1]! + 10);
        await advanceRecovery(4, 10);
        expect(mounted.current.ready).toBe(true);
        expect(mounted.current.error).toBeNull();
        expect(mounted.current.byId.has("a-0")).toBe(true);
        expect(mounted.current.byId.has("a-200")).toBe(true);
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });
  }

  for (const which of ["workspaces", "agents"] as const) {
    it(`recovers a live ${which} subscription whose reconnect's re-subscribe failed`, async () => {
      const fake = createFakePaseo({
        agents: [
          activeAgent("live", { status: "idle", requiresAttention: true, updatedAt: recentIso(2_000) }),
          activeAgent("other", { status: "idle", requiresAttention: true, workspaceId: "ws-other", updatedAt: recentIso(3_000) }),
        ],
        workspaces: [workspace(), makeWorkspace({ id: "ws-other", projectId: "project-id", name: "ws-other" })],
      });
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const mounted = await mountArchived(fake, true);
      try {
        expect(mounted.current.byId.get("other")?.lane).toBe("review");
        await act(async () => {
          if (which === "workspaces") fake.failWorkspaceResubscribe();
          else fake.failAgentResubscribeWhere((options) => options.filter?.requiresAttention === true);
          for (let index = 0; index < 8; index += 1) await Promise.resolve();
        });
        expect(mounted.current.error).toBe("resubscribe failed");
        await advanceRecovery(1, LIST_RECOVERY_DELAYS_MS[0]! + 10);
        await advanceRecovery(3, 10);
        expect(mounted.current.error).toBeNull();
        await act(async () => {
          if (which === "workspaces") fake.removeWorkspace("ws-other");
          else fake.upsertAgent(activeAgent("fresh", { status: "idle", requiresAttention: true, updatedAt: recentIso(0) }));
          for (let index = 0; index < 16; index += 1) await Promise.resolve();
        });
        if (which === "workspaces") expect(mounted.current.byId.get("other")?.lane).toBe("archived");
        else expect(mounted.current.byId.get("fresh")?.lane).toBe("review");
      } finally {
        vi.useRealTimers();
        mounted.unmount();
      }
    });
  }

  const HOST_GATE = "Update the host to use background workspaces.";

  /**
   * Inclusive lists throw the host gate until `accept` is true. Counts the fallback subscriptions.
   * `defer`, when it returns a promise, holds a list call until it resolves; the gate is checked after.
   */
  function gateBackgroundLists(fake: Fake, accept: () => boolean, defer?: (options: { subscribe?: unknown; filter?: { includeBackground?: boolean } }) => Promise<void> | undefined) {
    let inclusive = 0;
    let plainSubscribes = 0;
    const wrap = <T extends { subscribe?: unknown; filter?: { includeBackground?: boolean } }>(list: (options: T) => Promise<unknown>) => async (options: T) => {
      const held = defer?.(options);
      if (held) await held;
      if (options.subscribe && !options.filter?.includeBackground) plainSubscribes += 1;
      if (options.filter?.includeBackground && !accept()) {
        inclusive += 1;
        throw new Error(HOST_GATE);
      }
      return list(options);
    };
    const agents = fake.paseo.agents as { list: (options: { subscribe?: unknown; filter?: { includeBackground?: boolean } }) => Promise<unknown> };
    const workspaces = fake.paseo.workspaces as { list: (options: { subscribe?: unknown; filter?: { includeBackground?: boolean } }) => Promise<unknown> };
    agents.list = wrap(agents.list.bind(agents));
    workspaces.list = wrap(workspaces.list.bind(workspaces));
    return { get inclusive() { return inclusive; }, get plainSubscribes() { return plainSubscribes; } };
  }

  async function flushLists() {
    await act(async () => {
      for (let index = 0; index < 48; index += 1) await Promise.resolve();
    });
  }

  it("lists tasks without toasting when the host has not advertised background workspaces, and keeps that list", async () => {
    const fake = createFakePaseo({
      agents: [activeAgent("running", { status: "running" })],
      workspaces: [workspace()],
    });
    const gate = gateBackgroundLists(fake, () => false);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const mounted = await mountTasks(fake);
    try {
      await flushLists();
      expect(mounted.current.error).toBeNull();
      expect(mounted.current.byId.get("running")?.lane).toBe("running");
      const fallbacks = gate.plainSubscribes;
      expect(fallbacks).toBeGreaterThan(0);
      const refused = gate.inclusive;
      await advanceRecovery(1, LIST_RECOVERY_DELAYS_MS[0]! + 10);
      await advanceRecovery(4, 10);
      await advanceRecovery(1, LIST_RECOVERY_DELAYS_MS[1]! + 10);
      await advanceRecovery(4, 10);
      expect(mounted.current.error).toBeNull();
      expect(mounted.current.byId.get("running")?.lane).toBe("running");
      // The inclusive list is asked again. The fallback already serving is not opened again.
      expect(gate.inclusive).toBeGreaterThan(refused);
      expect(gate.plainSubscribes).toBe(fallbacks);
    } finally {
      vi.useRealTimers();
      mounted.unmount();
    }
  });

  it("asks for background workspaces again once the host advertises them", async () => {
    const fake = createFakePaseo({
      agents: [
        activeAgent("parent", { status: "running" }),
        activeAgent("child", { status: "running", workspaceId: "ws-bg", labels: { "paseo.parent-agent-id": "parent" } }),
      ],
      workspaces: [workspace(), makeWorkspace({ id: "ws-bg", projectId: "project-id", name: "background", background: true })],
    });
    let accept = false;
    gateBackgroundLists(fake, () => accept);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const mounted = await mountTasks(fake);
    try {
      await flushLists();
      expect(mounted.current.error).toBeNull();
      expect(mounted.current.byId.has("child")).toBe(false);
      expect(mounted.current.byId.get("parent")?.children.map((child) => child.id)).toEqual([]);
      accept = true;
      await advanceRecovery(1, LIST_RECOVERY_DELAYS_MS[0]! + 10);
      await advanceRecovery(8, 10);
      expect(mounted.current.error).toBeNull();
      expect(mounted.current.byId.get("parent")?.children.map((child) => child.id)).toContain("child");
      expect(mounted.current.lanes.running.cards.map((card) => card.id)).not.toContain("child");
    } finally {
      vi.useRealTimers();
      mounted.unmount();
    }
  });

  it("keeps the background child on its parent when the host gate rejects after an inclusive list landed", async () => {
    const fake = createFakePaseo({
      agents: [
        activeAgent("parent", { status: "idle", updatedAt: recentIso(5_000) }),
        activeAgent("child", { status: "running", workspaceId: "ws-bg", labels: { "paseo.parent-agent-id": "parent" } }),
      ],
      workspaces: [workspace(), makeWorkspace({ id: "ws-bg", projectId: "project-id", name: "background", background: true })],
    });
    let accept = true;
    const gate = gateBackgroundLists(fake, () => accept);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const mounted = await mountTasks(fake);
    try {
      await flushLists();
      expect(mounted.current.byId.get("parent")?.children.map((child) => child.id)).toContain("child");
      expect(mounted.current.byId.get("parent")?.lane).toBe("running");
      expect(mounted.current.lanes.running.cards.map((card) => card.id)).not.toContain("child");
      const plain = gate.plainSubscribes;
      // The client's hello flag goes away, then the status list's re-subscribe fails.
      accept = false;
      await act(async () => {
        fake.failAgentResubscribeWhere((options) => options.filter?.statuses?.includes("running") === true);
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      });
      await advanceRecovery(1, LIST_RECOVERY_DELAYS_MS[0]! + 10);
      await advanceRecovery(4, 10);
      // A refresh while the gate still rejects.
      await act(async () => {
        void mounted.current.refresh();
        for (let index = 0; index < 64; index += 1) await Promise.resolve();
      });
      await advanceRecovery(1, LIST_RECOVERY_DELAYS_MS[1]! + 10);
      await advanceRecovery(4, 10);
      expect(mounted.current.error).toBeNull();
      expect(mounted.current.byId.get("parent")?.children.map((child) => child.id)).toContain("child");
      expect(mounted.current.byId.get("parent")?.lane).toBe("running");
      expect(mounted.current.lanes.running.cards.map((card) => card.id)).not.toContain("child");
      expect(gate.plainSubscribes).toBe(plain);
    } finally {
      vi.useRealTimers();
      mounted.unmount();
    }
  });

  it("does not know a background workspace gone when the gate rejects a later page of the inclusive workspace list", async () => {
    // A parent whose provider subagent failed, read by id since no list holds it yet: in a background workspace.
    const prompted = "2026-10-22T09:10:56.339Z";
    setSubagentLoader(async () => ({
      version: "1",
      subagents: [{
        id: "sub",
        parentAgentId: "bg-task",
        provider: "claude",
        title: "general-purpose",
        description: "RRD-sub task",
        status: "failed",
        createdAt: "2026-10-22T09:12:00.000Z",
        updatedAt: "2026-10-22T09:18:55.000Z",
        subtitle: "general-purpose",
      }],
    }));
    const fake = createFakePaseo({
      agents: [activeAgent("bg-task", { status: "idle", workspaceId: "zz-bg", lastUserMessageAt: prompted, updatedAt: recentIso(60_000) })],
      // Two a page, by id: the background workspace is on the second.
      workspaces: [
        makeWorkspace({ id: "a-0", projectId: "project-id", name: "a-0" }),
        makeWorkspace({ id: "a-1", projectId: "project-id", name: "a-1" }),
        workspace(),
        makeWorkspace({ id: "zz-bg", projectId: "project-id", name: "background", background: true }),
      ],
      workspacePageSize: 2,
    });
    // The inclusive workspace subscription answers; the hello flag goes away before its next page.
    let inclusiveWorkspaces = 0;
    let rejecting = true;
    const workspacesApi = fake.paseo.workspaces as { list: (options: { subscribe?: unknown; filter?: { includeBackground?: boolean } }) => Promise<unknown> };
    const listWorkspaces = workspacesApi.list.bind(workspacesApi);
    workspacesApi.list = async (options) => {
      if (options.filter?.includeBackground) {
        inclusiveWorkspaces += 1;
        if (inclusiveWorkspaces > 1 && rejecting) throw new Error(HOST_GATE);
      }
      return listWorkspaces(options);
    };
    // The agent lists answer only once the flag is back: no inclusive agent list lands meanwhile.
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const agentsApi = fake.paseo.agents as { list: (options: unknown) => Promise<unknown> };
    const listAgents = agentsApi.list.bind(agentsApi);
    agentsApi.list = async (options) => {
      await held;
      return listAgents(options);
    };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const mounted = await mountArchived(fake, true);
    try {
      await flushLists();
      // The subagent read, the parent's read by id, and the check of its unplaced workspace.
      await advanceRecovery(8, 10);
      expect(inclusiveWorkspaces).toBeGreaterThan(2);
      expect(mounted.current.error).toBeNull();
      expect(mounted.current.byId.get("bg-task")?.lane).not.toBe("archived");
      rejecting = false;
      await act(async () => {
        release();
        for (let index = 0; index < 64; index += 1) await Promise.resolve();
      });
      await advanceRecovery(1, 5_010);
      await advanceRecovery(4, 10);
      expect(mounted.current.error).toBeNull();
      expect(mounted.current.byId.get("bg-task")?.lane).not.toBe("archived");
      expect(mounted.current.lanes.archived.cards.map((card) => card.id)).not.toContain("bg-task");
    } finally {
      vi.useRealTimers();
      mounted.unmount();
      setSubagentLoader(null);
    }
  });

  it("asks for the inclusive list of a list that fell back while a recovery refresh was in flight", async () => {
    const fake = createFakePaseo({
      agents: [
        activeAgent("running", { status: "running" }),
        activeAgent("done", { status: "idle", updatedAt: recentIso(5_000) }),
      ],
      workspaces: [workspace()],
    });
    let accept = false;
    let deferring = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    gateBackgroundLists(fake, () => accept, (options) => (deferring && options.subscribe ? held : undefined));
    const doneSubscribes = () => fake.calls.filter((call) => {
      const input = call.input as { subscribe?: unknown; filter?: { statuses?: string[]; includeBackground?: boolean } };
      return call.method === "agents.list" && input.subscribe && input.filter?.statuses?.includes("closed") && input.filter.includeBackground === true;
    }).length;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // A board without the done lane: the done list is opened later.
    const board = await mountTasks(fake, "24h", false);
    let doneBoard: Awaited<ReturnType<typeof mountTasks>> | null = null;
    try {
      await flushLists();
      expect(board.current.error).toBeNull();
      // The recovery refresh's inclusive lists hang on the wire.
      deferring = true;
      await advanceRecovery(1, LIST_RECOVERY_DELAYS_MS[0]! + 10);
      deferring = false;
      // The done list opens meanwhile, and the gate refuses it.
      doneBoard = await mountTasks(fake, "24h", true);
      await flushLists();
      expect(doneSubscribes()).toBe(0);
      // The host advertises the feature: the refresh's lists land inclusive.
      accept = true;
      await act(async () => {
        release();
        for (let index = 0; index < 64; index += 1) await Promise.resolve();
      });
      await advanceRecovery(1, LIST_RECOVERY_DELAYS_MS[1]! + 10);
      await advanceRecovery(4, 10);
      await advanceRecovery(1, LIST_RECOVERY_DELAYS_MS[2]! + 10);
      await advanceRecovery(4, 10);
      expect(doneSubscribes()).toBeGreaterThan(0);
      expect(board.current.error).toBeNull();
      expect(doneBoard.current.error).toBeNull();
    } finally {
      vi.useRealTimers();
      if (doneBoard) doneBoard.unmount();
      board.unmount();
    }
  });

  it("reads a workspace restored while the board was closed again, though the reopened board's first list fails", async () => {
    const fake = createFakePaseo({
      agents: [activeAgent("task", { status: "idle", requiresAttention: true, workspaceId: "ws-x", updatedAt: recentIso(1_000) })],
      workspaces: [workspace(), makeWorkspace({ id: "ws-x", projectId: "project-id", name: "ws-x" })],
    });
    const first = await mountArchived(fake, true);
    await settleWorkspaceCheck();
    expect(first.current.byId.get("task")?.lane).toBe("review");
    await act(async () => {
      fake.removeWorkspace("ws-x");
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    expect(first.current.byId.get("task")?.lane).toBe("archived");
    first.unmount();
    // Restored while no board is open; the reopened board's first workspace list fails.
    fake.setWorkspaceSilently(makeWorkspace({ id: "ws-x", projectId: "project-id", name: "ws-x" }));
    const workspacesApi = fake.paseo.workspaces as { list: (options: { subscribe?: unknown }) => Promise<unknown> };
    const list = workspacesApi.list.bind(workspacesApi);
    let failed = false;
    workspacesApi.list = async (options) => {
      if (options.subscribe && !failed) {
        failed = true;
        throw new Error("list failed");
      }
      return list(options);
    };
    const again = await mountArchived(fake, true);
    try {
      await settleWorkspaceCheck();
      expect(failed).toBe(true);
      expect(again.current.byId.get("task")?.lane).toBe("review");
    } finally {
      again.unmount();
    }
  });

  for (const [name, pageSize] of [["its first request", undefined], ["a later page", 2]] as const) {
    it(`settles a task of an unlisted workspace when the first workspace list fails (${name})`, async () => {
      const fillers = Array.from({ length: 4 }, (_, index) => makeWorkspace({ id: `filler-${index}`, projectId: "project-id", name: `filler-${index}` }));
      const fake = createFakePaseo({
        agents: [
          activeAgent("ghost", { status: "idle", requiresAttention: true, workspaceId: "ws-gone", updatedAt: recentIso(1_000) }),
          activeAgent("live", { status: "idle", requiresAttention: true, updatedAt: recentIso(2_000) }),
        ],
        workspaces: [...fillers, workspace()],
        archivedWorkspaceIds: ["ws-gone"],
        ...(pageSize ? { workspacePageSize: pageSize } : {}),
      });
      // One request of the subscription's fails (its first, or a later page); every other read answers.
      const workspacesApi = fake.paseo.workspaces as { list: (options: { subscribe?: unknown; page?: { cursor?: string } }) => Promise<unknown> };
      const list = workspacesApi.list.bind(workspacesApi);
      let failed = false;
      workspacesApi.list = async (options) => {
        const target = pageSize ? Boolean(options.page?.cursor) : Boolean(options.subscribe);
        if (target && !failed) {
          failed = true;
          throw new Error("list failed");
        }
        return list(options);
      };
      const mounted = await mountArchived(fake, true);
      try {
        await settleWorkspaceCheck();
        expect(failed).toBe(true);
        expect(mounted.current.byId.get("ghost")?.lane).toBe("archived");
        expect(mounted.current.byId.get("live")?.lane).toBe("review");
      } finally {
        mounted.unmount();
      }
    });
  }

  it("removes a restored background helper from the archived lane", async () => {
    const fake = createFakePaseo({
      agents: [activeAgent("helper", { status: "closed", workspaceId: "ws-helper", archivedAt: recentIso(2_000), updatedAt: recentIso(2_000) })],
      workspaces: [workspace()],
      archivedWorkspaceIds: ["ws-helper"],
    });
    const mounted = await mountArchived(fake, true);
    try {
      expect(ids(mounted.current.lanes.archived)).toEqual(["helper"]);
      await act(async () => {
        fake.upsertWorkspace(makeWorkspace({ id: "ws-helper", background: true }));
        fake.upsertAgent(activeAgent("helper", { status: "idle", workspaceId: "ws-helper", archivedAt: null, updatedAt: recentIso(0) }));
        await Promise.resolve();
      });
      expect(ids(mounted.current.lanes.archived)).toEqual([]);
      expect(mounted.current.byId.has("helper")).toBe(false);
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
