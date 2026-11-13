import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginTimelineTransformResult } from "@getpaseo/plugin";
import { followTurnWorkProjection, invalidateTurnWorkProjection, projectTurnWork, resetTurnWorkProjection,
  subscribeTurnWorkProjection, turnWorkDisclosureKey, updateTurnWorkGroups,
  type TurnWorkSourceIdentity } from "../../client/state/turn-work-projection";
import { resetDisclosureStore, setDisclosure } from "../../client/state/disclosure-store";
import type { TurnWorkGroup } from "../../client/state/turn-work";
import { applyStoredPreferences, getEnhancerPreferences, storedPart, updateEnhancerPreferences } from "../../client/preferences";

const original: PluginTimelineTransformResult = { items: [{ type: "plugin", kind: "omp-reasoning", version: 1, data: { text: "thought" } }] };
const item = (text = "thought") => ({ type: "reasoning" as const, text });
const group: TurnWorkGroup = { epoch: "e", key: "e:1", anchor: "1:thought:thought", members: ["1:thought:thought", "2:thought:second"], failed: 1 };
const identity = (sourceId = "one", agentId = "a", seq = sourceId === "two" ? 2 : 1, epoch = "e"): TurnWorkSourceIdentity =>
  ({ agentId, sourceId, sourceCursor: { epoch, seq } });
const work = (value = group) => new Map(value.members.map((key) => [key, value]));
const initial = storedPart(getEnhancerPreferences());
afterEach(() => { resetTurnWorkProjection(); resetDisclosureStore(); applyStoredPreferences(initial); });

describe("completed work projection", () => {
  it("leaves unsupported hosts exactly unchanged without scheduling a refresh", async () => {
    const refresh = vi.fn();
    const stop = subscribeTurnWorkProjection(refresh);
    try {
      for (const context of [undefined, {}, { agentId: "a" }, { sourceId: "one" }, { agentId: "a", sourceId: "" },
        { agentId: "a", sourceId: "one" }, { ...identity(), sourceCursor: null },
        identity("one", "a", -1), identity("one", "a", NaN), identity("one", "a", 1, "")]) {
        expect(projectTurnWork(item(), "complete", original, context)).toBe(original);
      }
      await Promise.resolve();
      expect(refresh).not.toHaveBeenCalled();
    } finally { stop(); }
  });

  it("converges across new input objects and semantically equal store snapshots", async () => {
    const refresh = vi.fn();
    const stop = subscribeTurnWorkProjection(refresh);
    try {
      for (let pass = 0; pass < 8; pass++) {
        updateTurnWorkGroups("a", work({ ...group, members: [...group.members] }));
        const source = Object.freeze(item());
        expect(projectTurnWork(source, "complete", original, identity())?.items.map((row) => row.kind)).toEqual(["omp-turn-work"]);
        await Promise.resolve();
      }
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally { stop(); }
  });

  it("removes hidden host cells and emits a self-contained summary without fixed ids", () => {
    updateTurnWorkGroups("a", work());
    expect(projectTurnWork(item(), "complete", original, identity())?.items).toEqual([
      { type: "plugin", kind: "omp-turn-work", version: 1,
        data: { groupKey: "e:1", anchor: "1:thought:thought", count: 2, failed: 1 } },
    ]);
    expect(projectTurnWork(item("second"), "complete", original, identity("two"))?.items).toEqual([]);
  });

  it("restores originals when expanded and leaves output ids to the host", () => {
    updateTurnWorkGroups("a", work());
    setDisclosure(turnWorkDisclosureKey("a", group.key), true);
    const anchor = projectTurnWork(item(), "complete", original, identity())!;
    const member = projectTurnWork(item("second"), "complete", original, identity("two"))!;
    expect(anchor.items.map((row) => row.kind)).toEqual(["omp-turn-work", "omp-reasoning"]);
    expect(member.items.map((row) => row.kind)).toEqual(["omp-reasoning"]);
    expect([...anchor.items, ...member.items].every((row) => row.id === undefined)).toBe(true);
    expect(anchor.items[1]!.data).toEqual({ text: "thought", workSource: identity() });
    setDisclosure(turnWorkDisclosureKey("a", group.key), false);
    expect(projectTurnWork(item("second"), "complete", original, identity("two"))?.items).toEqual([]);
  });

  it("never shares membership across agents with the same text and source id", () => {
    updateTurnWorkGroups("a", work());
    expect(projectTurnWork(item("second"), "complete", original, identity("two"))?.items).toEqual([]);
    expect(projectTurnWork(item("second"), "complete", original, identity("two", "b"))?.items[0]?.kind).toBe("omp-reasoning");
    const other = { ...group, key: "other:1", failed: 0 };
    updateTurnWorkGroups("b", work(other));
    setDisclosure(turnWorkDisclosureKey("a", group.key), true);
    expect(projectTurnWork(item("second"), "complete", original, identity("two"))?.items[0]?.kind).toBe("omp-reasoning");
    expect(projectTurnWork(item("second"), "complete", original, identity("two", "b"))?.items).toEqual([]);
  });

  it("restores every row when the owning store loses or clears its history", () => {
    updateTurnWorkGroups("a", work());
    updateTurnWorkGroups("b", work());
    updateTurnWorkGroups("a", new Map());
    expect(projectTurnWork(item(), "complete", original, identity())?.items[0]?.kind).toBe("omp-reasoning");
    expect(projectTurnWork(item("second"), "complete", original, identity("two"))?.items[0]?.kind).toBe("omp-reasoning");
    expect(projectTurnWork(item("second"), "complete", original, identity("two", "b"))?.items).toEqual([]);
  });

  it("does not hide any member when a published group lacks its anchor", () => {
    updateTurnWorkGroups("a", new Map([["2:thought:second", group]]));
    expect(projectTurnWork(item("second"), "complete", original, identity("two"))?.items[0]?.kind).toBe("omp-reasoning");
  });

  it("never transforms streaming, running or pending work, even with stale membership", () => {
    updateTurnWorkGroups("a", work());
    expect(projectTurnWork(item(), "streaming", original, identity())).toBe(original);
    const tools = { ...group, anchor: "1:tool:call", members: ["1:tool:call", "2:thought:second"] };
    updateTurnWorkGroups("a", work(tools));
    const tool = { type: "tool_call" as const, callId: "call", name: "shell", status: "running" as const,
      detail: { type: "plain_text" as const, label: "run", text: "command" }, error: null };
    expect(projectTurnWork(tool, "complete", original, identity())).toBe(original);
    expect(projectTurnWork({ ...tool, status: "completed", metadata: { approved: false } }, "complete", original, identity())).toBe(original);
    expect(projectTurnWork({ ...tool, status: "completed", metadata: { questions: [] } }, "complete", original, identity())).toBe(original);
    expect(projectTurnWork(item(), "complete", undefined, identity())).toBeUndefined();
    const empty = { items: [] };
    expect(projectTurnWork(item(), "complete", empty, identity())).toBe(empty);
  });

  it("batches independent store commits and ignores unchanged empty stores", async () => {
    const refresh = vi.fn();
    const stop = subscribeTurnWorkProjection(refresh);
    try {
      updateTurnWorkGroups("empty", new Map());
      await Promise.resolve();
      expect(refresh).not.toHaveBeenCalled();
      for (let index = 0; index < 100; index++) updateTurnWorkGroups(`agent-${index}`, work());
      invalidateTurnWorkProjection();
      await Promise.resolve();
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally { stop(); }
  });

  it("does not hide identical text from an older page or a later turn of the same agent", () => {
    updateTurnWorkGroups("a", work());
    expect(projectTurnWork(item("second"), "complete", original, identity("two"))?.items).toEqual([]);
    // Both sources have the same text and may even have the same timestamp.
    // Only the canonical epoch/seqEnd pair establishes membership.
    expect(projectTurnWork(item("second"), "complete", original, identity("older", "a", 0))?.items[0]?.kind).toBe("omp-reasoning");
    expect(projectTurnWork(item("second"), "complete", original, identity("later", "a", 99))?.items[0]?.kind).toBe("omp-reasoning");
    expect(projectTurnWork(item("second"), "complete", original, identity("two", "a", 2, "replacement"))?.items[0]?.kind).toBe("omp-reasoning");
    expect(projectTurnWork(item("different text"), "complete", original, identity("two"))?.items[0]?.kind).toBe("omp-reasoning");
  });

  it("invalidates a replaced epoch even when every other group field is unchanged", async () => {
    updateTurnWorkGroups("a", work());
    await Promise.resolve();
    const refresh = vi.fn();
    const stop = subscribeTurnWorkProjection(refresh);
    try {
      updateTurnWorkGroups("a", work({ ...group, epoch: "replacement" }));
      await Promise.resolve();
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(projectTurnWork(item("second"), "complete", original, identity("two"))?.items[0]?.kind).toBe("omp-reasoning");
      expect(projectTurnWork(item("second"), "complete", original, identity("two", "a", 2, "replacement"))?.items).toEqual([]);
    } finally { stop(); }
  });

  it("fails open when its bounded registry has no capacity, without refresh churn", async () => {
    for (let index = 0; index < 128; index++) updateTurnWorkGroups(`agent-${index}`, work());
    await Promise.resolve();
    const refresh = vi.fn();
    const stop = subscribeTurnWorkProjection(refresh);
    try {
      for (let pass = 0; pass < 8; pass++) {
        expect(updateTurnWorkGroups("overflow", work({ ...group, members: [...group.members] }))).toBe(false);
        expect(projectTurnWork(item("second"), "complete", original, identity("two", "overflow"))?.items[0]?.kind).toBe("omp-reasoning");
        await Promise.resolve();
      }
      expect(refresh).not.toHaveBeenCalled();
      expect(updateTurnWorkGroups("agent-0", new Map())).toBe(false);
      expect(updateTurnWorkGroups("overflow", work())).toBe(true);
      expect(projectTurnWork(item("second"), "complete", original, identity("two", "overflow"))?.items).toEqual([]);
    } finally { stop(); }
  });

  it("cancels a queued refresh when the plugin is reset", async () => {
    const refresh = vi.fn();
    const stop = subscribeTurnWorkProjection(refresh);
    try {
      updateTurnWorkGroups("a", work());
      resetTurnWorkProjection();
      await Promise.resolve();
      expect(refresh).not.toHaveBeenCalled();
      expect(projectTurnWork(item(), "complete", original, identity())?.items[0]?.kind).toBe("omp-reasoning");
    } finally { stop(); }
  });

  it("does not re-register a transformer for group changes while folding is off", async () => {
    updateEnhancerPreferences({ autoCollapseTurnWork: false });
    const register = vi.fn(() => vi.fn());
    const stop = followTurnWorkProjection(register);
    try {
      updateTurnWorkGroups("a", work());
      await Promise.resolve();
      expect(register).toHaveBeenCalledTimes(1);
      updateEnhancerPreferences({ autoCollapseTurnWork: true });
      expect(register).toHaveBeenCalledTimes(2);
      invalidateTurnWorkProjection();
      await Promise.resolve();
      expect(register).toHaveBeenCalledTimes(3);
      updateEnhancerPreferences({ autoCollapseTurnWork: false });
      expect(register).toHaveBeenCalledTimes(4);
      updateTurnWorkGroups("a", new Map());
      await Promise.resolve();
      expect(register).toHaveBeenCalledTimes(4);
    } finally { stop(); }
  });
});
