import React, { useMemo } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { filterLanes, useTasks } from "../../client/tasks/data";
import { EMPTY_FILTERS, LANE_ORDER } from "../../client/tasks/model";
import { at, createFakePaseo, makeAgent } from "./helpers/fake-paseo";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("live title search", () => {
  it.each(["running", "review", "done"] as const)("refreshes an active query after renaming a %s card and ignores an older title snapshot", async (lane) => {
    const original = makeAgent({
      id: "renamed-task",
      title: "Original task title",
      status: lane === "running" ? "running" : "idle",
      requiresAttention: lane === "review",
      attentionReason: lane === "review" ? "finished" : null,
    });
    const fake = createFakePaseo({ agents: [original] });
    let query = "沙箱 OOM";
    let matches: string[] = [];
    function Probe() {
      const tasks = useTasks(fake.paseo, { doneWindow: "all", includeDone: true });
      const filtered = useMemo(() => filterLanes(tasks.lanes, { ...EMPTY_FILTERS, query }), [tasks.lanes, query]);
      matches = LANE_ORDER.flatMap((id) => filtered[id].cards.map((card) => card.title));
      return null;
    }
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => { tree = TestRenderer.create(<Probe />); });
    try {
      expect(matches).toEqual([]);
      await act(async () => {
        fake.upsertAgent({ ...original, title: "飞书通知 ray：沙箱 OOM", updatedAt: at(11) });
      });
      expect(matches).toEqual(["飞书通知 ray：沙箱 OOM"]);
      await act(async () => { fake.pushAgentSnapshot(original); });
      expect(matches).toEqual(["飞书通知 ray：沙箱 OOM"]);
      query = "Original task title";
      await act(async () => { tree.update(<Probe />); });
      expect(matches).toEqual([]);
    } finally {
      await act(async () => { tree.unmount(); });
    }
  });
});
