import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";
import { unavailableTask, type TaskAvailability } from "../../shared/task-availability";
import type { TasksHandle } from "../../client/tasks/data";
import { LANE_ORDER, type LaneModel } from "../../client/tasks/model";
import { sampleCards } from "../../client/tasks/sample-cards";
import { TASK_AVAILABILITY_REFRESH_MS, useTaskAvailability } from "../../client/tasks/availability";

const rpc = vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  return { load: vi.fn() };
});
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => rpc.load }));

function fixture() {
  const cards = sampleCards(0);
  return {
    lanes: Object.fromEntries(LANE_ORDER.map((id) => [id, { id, cards: cards.filter((card) => card.lane === id), hasMore: false, loading: false }])) as Record<(typeof LANE_ORDER)[number], LaneModel>,
    byId: new Map(cards.map((card) => [card.id, card])), counts: { needsInput: 0, running: 0, review: 0, done: 0, archived: 0 },
    workspaces: [], providers: [], labels: [], ready: true, error: null,
    refresh() {}, loadMoreDone() {}, resolveParent() {}, refreshParent: async () => false, refreshReads() {}, requestProjectIcon() {},
  } satisfies TasksHandle;
}

let tree: ReactTestRenderer;
let state: ReturnType<typeof useTaskAvailability>;
function Harness(props: { tasks: TasksHandle; visible: boolean; hostId?: string }) {
  state = useTaskAvailability(props.tasks, props.visible, props.hostId ?? "test-host");
  return null;
}
let states: Map<string, TaskAvailability>;
beforeEach(() => {
  vi.useFakeTimers();
  states = new Map();
  rpc.load.mockReset().mockImplementation(async ({ agentIds }: { agentIds: string[] }) => ({ entries: agentIds.map((agentId) => ({ agentId, availability: states.get(agentId) ?? { issue: null, blocked: {} } })) }));
});
afterEach(async () => { await act(async () => tree?.unmount()); vi.useRealTimers(); });

describe("board availability checks", () => {
  it("keeps a late response from the previous host from enabling writes on the selected host", async () => {
    const tasks = fixture();
    let finish!: (result: { entries: Array<{ agentId: string; availability: TaskAvailability }> }) => void;
    rpc.load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => { tree = TestRenderer.create(<Harness tasks={tasks} visible hostId="host-a" />); });
    const first = [...tasks.byId.keys()][0]!;
    states.set(first, unavailableTask({ code: "directory_missing", detail: "/host-b/removed" }));
    await act(async () => tree.update(<Harness tasks={tasks} visible hostId="host-b" />));
    await act(async () => finish({ entries: [...tasks.byId.keys()].map((agentId) => ({ agentId, availability: { issue: null, blocked: {} } })) }));
    expect(state.tasks.byId.get(first)?.availability?.issue?.detail).toBe("/host-b/removed");
  });
  it("updates only changed cards and re-enables actions after the directory recovers", async () => {
    const tasks = fixture();
    const first = [...tasks.byId.keys()][0]!;
    const second = [...tasks.byId.keys()][1]!;
    states.set(first, unavailableTask({ code: "directory_missing", detail: "/removed/worktree" }));
    await act(async () => { tree = TestRenderer.create(<Harness tasks={tasks} visible />); });
    expect(state.tasks.byId.get(first)?.availability?.blocked.rename?.code).toBe("directory_missing");
    expect(state.tasks.byId.get(second)).toBe(tasks.byId.get(second));
    const held = state.tasks.byId.get(first);
    await act(async () => { await vi.advanceTimersByTimeAsync(TASK_AVAILABILITY_REFRESH_MS); });
    expect(state.tasks.byId.get(first)).toBe(held);
    states.delete(first);
    await act(async () => { await vi.advanceTimersByTimeAsync(TASK_AVAILABILITY_REFRESH_MS); });
    expect(state.tasks.byId.get(first)).toBe(tasks.byId.get(first));
  });

  it("pauses checks while hidden and performs a fresh check when shown", async () => {
    const tasks = fixture();
    await act(async () => { tree = TestRenderer.create(<Harness tasks={tasks} visible />); });
    expect(rpc.load).toHaveBeenCalledTimes(1);
    await act(async () => tree.update(<Harness tasks={tasks} visible={false} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(TASK_AVAILABILITY_REFRESH_MS * 2); });
    expect(rpc.load).toHaveBeenCalledTimes(1);
    await act(async () => tree.update(<Harness tasks={tasks} visible />));
    expect(rpc.load).toHaveBeenCalledTimes(2);
  });

  it("rechecks at activation so a recycled workspace cannot use an earlier enabled menu", async () => {
    const tasks = fixture();
    const first = [...tasks.byId.keys()][0]!;
    await act(async () => { tree = TestRenderer.create(<Harness tasks={tasks} visible />); });
    states.set(first, unavailableTask({ code: "directory_missing", detail: "/removed/worktree" }));
    await act(async () => { expect((await state.check(first, "archive"))?.code).toBe("directory_missing"); });
    expect(rpc.load).toHaveBeenLastCalledWith({ agentIds: [first] });
  });

  it("labels a failed connection as temporary and recovers without calling it a missing workspace", async () => {
    const tasks = fixture();
    rpc.load.mockRejectedValueOnce(new Error("Host disconnected"));
    await act(async () => { tree = TestRenderer.create(<Harness tasks={tasks} visible />); });
    for (const card of state.tasks.byId.values()) expect(card.availability?.issue?.code).toBe("host_unavailable");
    await act(async () => { await vi.advanceTimersByTimeAsync(TASK_AVAILABILITY_REFRESH_MS); });
    for (const [id, card] of state.tasks.byId) expect(card).toBe(tasks.byId.get(id));
  });
});
