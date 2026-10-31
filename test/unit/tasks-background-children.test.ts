import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { useTaskCounts, useTasks, type TasksHandle } from "../../client/tasks/data";
import { stopTargets } from "../../client/tasks/actions/stop-targets";
import { at, createFakePaseo, makeAgent, makeWorkspace } from "./helpers/fake-paseo";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("background child tasks", () => {
  it("counts a parent outside the done pages and excludes unrelated background work in the sidebar", async () => {
    const fake = createFakePaseo({
      agents: [
        makeAgent({ id: "parent", workspaceId: "visible" }),
        makeAgent({ id: "child", workspaceId: "hidden", status: "running", labels: { "paseo.parent-agent-id": "parent" } }),
        makeAgent({ id: "unrelated", status: "running", workspaceId: "hidden" }),
      ],
      workspaces: [makeWorkspace({ id: "visible" }), makeWorkspace({ id: "hidden", background: true })],
    });
    let counts!: ReturnType<typeof useTaskCounts>;
    function Probe() {
      counts = useTaskCounts(fake.paseo, false);
      return null;
    }
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); });
    try {
      expect(counts).toEqual({ needsInput: 0, running: 1, review: 0, ready: true });
      await act(async () => { fake.upsertAgent(makeAgent({ id: "child", status: "idle", workspaceId: "hidden", updatedAt: at(11), labels: { "paseo.parent-agent-id": "parent" } })); });
      expect(counts.running).toBe(0);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it("keeps the visible parent running while its hidden child runs, including stale updates and reconnects", async () => {
    const parent = makeAgent({ id: "parent", workspaceId: "visible", updatedAt: at(10) });
    const child = makeAgent({ id: "child", workspaceId: "background", status: "running", updatedAt: at(20), labels: { "paseo.parent-agent-id": "parent" } });
    const fake = createFakePaseo({
      agents: [parent, child, makeAgent({ id: "unrelated", workspaceId: "background", status: "running" })],
      workspaces: [makeWorkspace({ id: "visible" }), makeWorkspace({ id: "background", background: true })],
    });
    let tasks!: TasksHandle;
    let counts!: ReturnType<typeof useTaskCounts>;
    function Probe() {
      tasks = useTasks(fake.paseo, { doneWindow: "all", includeDone: true });
      counts = useTaskCounts(fake.paseo, true);
      return null;
    }
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); });
    try {
      const assertRunning = () => {
        expect(tasks.lanes.running.cards.map((card) => card.id)).toEqual(["parent"]);
        expect(tasks.lanes.done.cards).toEqual([]);
        expect(tasks.byId.get("parent")).toMatchObject({ waitingOnSubtasks: true, children: [expect.objectContaining({ id: "child", status: "running" })] });
        expect(tasks.byId.has("unrelated")).toBe(false);
        expect(tasks.workspaces.map((workspace) => workspace.id)).toEqual(["visible"]);
        expect(counts).toMatchObject({ running: 1, review: 0 });
        expect(stopTargets(tasks.byId.get("parent")!, true, (id) => tasks.byId.get(id))).toEqual(["child"]);
      };
      assertRunning();
      await act(async () => { fake.pushAgentSnapshot({ ...child, status: "idle", updatedAt: at(19) }); });
      assertRunning();
      await act(async () => { fake.reconnectSubscriptions(); });
      assertRunning();
      await act(async () => { fake.upsertAgent({ ...child, status: "idle", updatedAt: at(21) }); });
      expect(tasks.lanes.running.cards).toEqual([]);
      expect(tasks.lanes.done.cards.map((card) => card.id)).toEqual(["parent"]);
      expect(counts.running).toBe(0);
      await act(async () => { fake.upsertAgent({ ...child, updatedAt: at(22) }); });
      assertRunning();
      await act(async () => { fake.removeWorkspace("background"); });
      expect(tasks.lanes.running.cards).toEqual([]);
      expect(tasks.lanes.done.cards.map((card) => card.id)).toEqual(["parent"]);
    } finally {
      act(() => renderer.unmount());
    }
    expect(fake.openSubscriptions()).toBe(0);
  });

  it.each([true, false])("propagates a running grandchild through an idle background child (includeDone: %s)", async (includeDone) => {
    const fake = createFakePaseo({
      agents: [
        makeAgent({ id: "parent", workspaceId: "visible" }),
        makeAgent({ id: "child", workspaceId: "background", labels: { "paseo.parent-agent-id": "parent" } }),
        makeAgent({ id: "grandchild", workspaceId: "background", status: "running", labels: { "paseo.parent-agent-id": "child" } }),
      ],
      workspaces: [makeWorkspace({ id: "visible" }), makeWorkspace({ id: "background", background: true })],
    });
    let tasks!: TasksHandle;
    function Probe() {
      tasks = useTasks(fake.paseo, { doneWindow: "all", includeDone });
      return null;
    }
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); });
    try {
      expect(tasks.lanes.running.cards.map((card) => card.id)).toEqual(["parent"]);
      expect(stopTargets(tasks.byId.get("parent")!, true, (id) => tasks.byId.get(id))).toEqual(["grandchild"]);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
