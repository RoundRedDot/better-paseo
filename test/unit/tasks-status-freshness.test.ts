import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { useTasks, type TasksHandle } from "../../client/tasks/data";
import { at, createFakePaseo, makeAgent } from "./helpers/fake-paseo";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps a running task when an older done snapshot arrives, then accepts its completion", async () => {
  const idle = makeAgent({ id: "task", status: "idle", updatedAt: at(10) });
  const fake = createFakePaseo({ agents: [idle] });
  const list = fake.paseo.agents.list.bind(fake.paseo.agents);
  let resolveList!: () => void;
  const delayed = new Promise<void>((resolve) => { resolveList = resolve; });
  vi.spyOn(fake.paseo.agents, "list").mockImplementation(async (options) => {
    const result = await list(options);
    if (options?.filter?.statuses?.includes("idle")) await delayed;
    return result;
  });
  let tasks!: TasksHandle;
  function Probe() {
    tasks = useTasks(fake.paseo, { doneWindow: "all", includeDone: true });
    return null;
  }
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); });
  try {
    const running = { ...idle, status: "running" as const, updatedAt: at(11), activeTurn: { turnId: "turn", startedAt: at(11) } };
    act(() => fake.upsertAgent(running));
    expect(tasks.byId.get("task")).toMatchObject({ lane: "running", status: "running" });
    await act(async () => { resolveList(); });
    expect(tasks.byId.get("task")).toMatchObject({ lane: "running", status: "running", stoppable: true });
    expect(tasks.counts).toMatchObject({ running: 1, done: 0 });

    // A delayed incremental upsert must not undo the running state either.
    act(() => fake.upsertAgent(idle));
    expect(tasks.byId.get("task")).toMatchObject({ lane: "running", status: "running" });
    act(() => fake.upsertAgent({ ...idle, updatedAt: at(12) }));
    expect(tasks.byId.get("task")).toMatchObject({ lane: "done", status: "done", stoppable: false });
    expect(tasks.counts).toMatchObject({ running: 0, done: 1 });
  } finally {
    resolveList();
    act(() => renderer.unmount());
    vi.restoreAllMocks();
  }
});
