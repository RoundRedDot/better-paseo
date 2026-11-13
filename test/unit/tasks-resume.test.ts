import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { useTasks, type TasksHandle } from "../../client/tasks/data";
import { at, createFakePaseo, makeAgent } from "./helpers/fake-paseo";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Tasks history resume", () => {
  it.each(["idle", "closed"] as const)("keeps a %s task in done through repeated history restores, then follows a real turn", async (status) => {
    const agent = makeAgent({ id: "history", provider: "grok", status, updatedAt: at(10), lastUserMessageAt: at(1), activeTurn: null });
    const neighbor = makeAgent({ id: "neighbor", status: "idle", updatedAt: at(20), lastUserMessageAt: at(2) });
    const fake = createFakePaseo({ agents: [agent, neighbor] });
    let current!: TasksHandle;
    const shown: Array<string | undefined> = [];
    function Probe() {
      current = useTasks(fake.paseo, { doneWindow: "all", includeDone: true });
      if (current.ready) shown.push(current.byId.get(agent.id)?.lane);
      return null;
    }
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(Probe));
    });
    const push = async (next: typeof agent) => {
      await act(async () => { fake.upsertAgent(next); });
    };
    try {
      const order = current.lanes.done.cards.map((card) => card.id);
      const neighborCard = current.byId.get(neighbor.id);
      expect(order).toEqual([neighbor.id, agent.id]);
      shown.length = 0;
      for (let restore = 0; restore < 2; restore += 1) {
        // Restoring retains updatedAt and lastUserMessageAt, and has no active turn.
        await push({ ...agent, status: "initializing" });
        expect(current.byId.get(agent.id)).toMatchObject({ lane: "done", status: "done", stoppable: false });
        expect(current.counts.running).toBe(0);
        expect(current.lanes.done.cards.map((card) => card.id)).toEqual(order);
        await push({ ...agent, status: "idle" });
        expect(current.lanes.done.cards.map((card) => card.id)).toEqual(order);
        expect(current.byId.get(neighbor.id)).toBe(neighborCard);
      }
      expect(shown.length).toBeGreaterThan(0);
      expect(shown.every((lane) => lane === "done")).toBe(true);

      const running = { ...agent, status: "running" as const, updatedAt: at(30), lastUserMessageAt: at(30), activeTurn: { turnId: "next", startedAt: at(30) } };
      await push(running);
      expect(current.byId.get(agent.id)).toMatchObject({ lane: "running", status: "running", stoppable: true });
      expect(current.counts.running).toBe(1);
      expect(current.lanes.done.cards.map((card) => card.id)).not.toContain(agent.id);
      // A delayed initializing snapshot from the history read cannot undo the real turn.
      await act(async () => { fake.pushAgentSnapshot({ ...agent, status: "initializing" }); });
      expect(current.byId.get(agent.id)).toMatchObject({ lane: "running", status: "running" });
      await push({ ...running, status: "idle", activeTurn: null, updatedAt: at(31) });
      expect(current.byId.get(agent.id)).toMatchObject({ lane: "done", status: "done", stoppable: false });
    } finally {
      act(() => renderer.unmount());
    }
  });

  it("classifies a restored task correctly when first loaded during initialization", async () => {
    const fake = createFakePaseo({ agents: [makeAgent({ id: "restoring", status: "initializing", lastUserMessageAt: at(1), activeTurn: null })] });
    let current!: TasksHandle;
    function Probe() {
      current = useTasks(fake.paseo, { doneWindow: "all", includeDone: true });
      return null;
    }
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); });
    try {
      expect(current.byId.get("restoring")).toMatchObject({ lane: "done", status: "done", stoppable: false });
      expect(current.counts.running).toBe(0);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
