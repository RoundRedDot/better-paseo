import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginTimelineTransformResult } from "@getpaseo/plugin";
import type { PaseoAgentTimelineEvent, PaseoAgentTimelineHandle } from "@getpaseo/client";
import { completedTurnFooters } from "../../client/state/turn-duration";
import { createTurnFooterStore } from "../../client/state/turn-footers";
import { completedTurnWork, turnWorkCursorKey } from "../../client/state/turn-work";
import { projectTurnWork, resetTurnWorkProjection, subscribeTurnWorkProjection,
  turnWorkDisclosureKey, updateTurnWorkGroups } from "../../client/state/turn-work-projection";
import { resetDisclosureStore, setDisclosure } from "../../client/state/disclosure-store";
import { transformToolCall } from "../../client/tools/transform";
import { timelineEntry as entry, timelinePage as page, type TimelineEntry } from "./helpers/turn-timeline";

type Replacement = PluginTimelineTransformResult["items"][number];
interface HostCell { id: string; sourceId: string; kind: string; data: unknown }

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function enhance(item: TimelineEntry["item"], phase: "complete" | "streaming"): PluginTimelineTransformResult | undefined {
  if (item.type === "tool_call") return transformToolCall({ item, phase });
  if (item.type === "reasoning") return { items: [{ type: "plugin", kind: "omp-reasoning", version: 1,
    data: { text: item.text, phase } }] };
  return undefined;
}

/**
 * The relevant Paseo 0.15.4 host rules, after a registry publish invalidates its
 * transform-wrapper cache: clone/freeze every input, flat-map replacements,
 * and use an explicit id verbatim or default to sourceId/index. The identity
 * argument models the proposed additive host API; false models the old API.
 * This verifies projection/list identity, not DOM or native measurements.
 */
function hostProject(entries: TimelineEntry[], agentId: string, identity = true,
  phase: "complete" | "streaming" = "complete", epoch = "e") {
  const inputs: TimelineEntry["item"][] = [];
  const replacements: Replacement[] = [];
  const cells = entries.flatMap((source): HostCell[] => {
    const item = freeze(structuredClone(source.item));
    inputs.push(item);
    const sourceId = `source-${source.seqStart}`;
    const result = projectTurnWork(item, phase, enhance(item, phase),
      identity ? { agentId, sourceId, sourceCursor: { epoch, seq: source.seqEnd } } : undefined);
    if (!result) return [{ id: sourceId, sourceId, kind: item.type, data: item }];
    replacements.push(...result.items);
    return result.items.map((replacement, index) => ({
      id: `better-paseo/${replacement.id ?? `${sourceId}/${index}`}`,
      sourceId, kind: replacement.kind, data: replacement.data,
    }));
  });
  return { cells, inputs, replacements };
}

function fixture() {
  const entries: TimelineEntry[] = [];
  let seq = 1;
  for (const turnId of ["one", "two"]) {
    const add = (item: TimelineEntry["item"]) => { entries.push(entry(item, seq, seq++ * 1000, turnId)); };
    add({ type: "user_message", text: `Prompt ${turnId}` });
    add({ type: "reasoning", text: `Thinking ${turnId}` });
    for (let index = 0; index < 12; index++) {
      const failed = index === 3 || index === 8;
      add({ type: "tool_call", callId: `${turnId}-${index}`, name: "shell",
        ...(failed ? { status: "failed" as const, error: "Fixture failure" }
          : { status: "completed" as const, error: null }),
        detail: { type: "plain_text", text: `Distinct output ${turnId}-${index}` } });
    }
    add({ type: "assistant_message", text: `Final reply ${turnId}` });
  }
  const work = completedTurnWork(entries,
    completedTurnFooters(entries, false, null, { fromStart: true }), "e", { fromStart: true });
  return { entries, work };
}

afterEach(() => { resetTurnWorkProjection(); resetDisclosureStore(); });

describe("completed work with host projection semantics", () => {
  it("keeps every original cell and never refreshes on a host without identity context", async () => {
    const { entries, work } = fixture();
    updateTurnWorkGroups("a", work);
    await Promise.resolve();
    const refresh = vi.fn();
    const stop = subscribeTurnWorkProjection(refresh);
    try {
      for (let pass = 0; pass < 8; pass++) {
        const { cells, replacements } = hostProject(entries, "a", false);
        expect(cells).toHaveLength(entries.length);
        expect(new Set(cells.map((cell) => cell.id)).size).toBe(cells.length);
        expect(cells.some((cell) => cell.kind === "omp-turn-work")).toBe(false);
        for (const replacement of replacements) expect(replacement.data).not.toHaveProperty("workSource");
        await Promise.resolve();
      }
      expect(refresh).not.toHaveBeenCalled();
    } finally { stop(); }
  });

  it("returns the exact original result when agent and source ids arrive without a canonical cursor", () => {
    const { entries, work } = fixture();
    updateTurnWorkGroups("a", work);
    for (const source of entries) {
      const item = freeze(structuredClone(source.item));
      const original = enhance(item, "complete");
      expect(projectTurnWork(item, "complete", original, { agentId: "a", sourceId: `source-${source.seqStart}` }))
        .toBe(original);
    }
  });

  it("converges with fresh frozen inputs and fresh equivalent groups after every registry publish", async () => {
    const { entries, work } = fixture();
    await Promise.resolve();
    const refresh = vi.fn();
    const stop = subscribeTurnWorkProjection(refresh);
    let previous: ReturnType<typeof hostProject> | undefined;
    try {
      for (let pass = 0; pass < 8; pass++) {
        // Clone the snapshot graph, retaining the model's shared group within
        // each snapshot while replacing every object between passes.
        updateTurnWorkGroups("a", structuredClone(work));
        await Promise.resolve();
        const next = hostProject(entries, "a");
        expect(next.cells).toHaveLength(6);
        expect(next.cells.filter((cell) => cell.kind === "omp-turn-work").map((cell) => cell.data))
          .toEqual([
            expect.objectContaining({ count: 13, failed: 2 }),
            expect.objectContaining({ count: 13, failed: 2 }),
          ]);
        if (previous) {
          expect(next.inputs[1]).not.toBe(previous.inputs[1]);
          expect(Object.isFrozen(next.inputs[1])).toBe(true);
          expect(next.cells).toEqual(previous.cells);
        }
        previous = next;
      }
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally { stop(); }
  });

  it("removes hidden host cells and uses unique default ids across turns and disclosure changes", () => {
    const { entries, work } = fixture();
    updateTurnWorkGroups("a", work);
    const collapsed = hostProject(entries, "a");
    expect(collapsed.cells.map((cell) => cell.kind)).toEqual([
      "user_message", "omp-turn-work", "assistant_message", "user_message", "omp-turn-work", "assistant_message",
    ]);
    // Each removed member has no cell at all, so no host wrapper can retain its gap.
    expect(collapsed.cells.some((cell) => cell.sourceId === "source-4")).toBe(false);
    expect(collapsed.cells.filter((cell) => cell.kind === "assistant_message").map((cell) => cell.data))
      .toEqual([{ type: "assistant_message", text: "Final reply one" }, { type: "assistant_message", text: "Final reply two" }]);
    const summaryIds = collapsed.cells.filter((cell) => cell.kind === "omp-turn-work").map((cell) => cell.id);
    for (const group of new Set(work.values())) setDisclosure(turnWorkDisclosureKey("a", group.key), true);
    const expanded = hostProject(entries, "a");
    expect(expanded.cells).toHaveLength(entries.length + 2);
    expect(new Set(expanded.cells.map((cell) => cell.id)).size).toBe(expanded.cells.length);
    expect(expanded.cells.filter((cell) => cell.kind === "omp-turn-work").map((cell) => cell.id)).toEqual(summaryIds);
    expect(expanded.replacements.every((replacement) => replacement.id === undefined)).toBe(true);
    expect(expanded.cells.filter((cell) => cell.kind === "omp-tool-call").map((cell) => (cell.data as { callId: string }).callId))
      .toEqual(entries.flatMap(({ item }) => item.type === "tool_call" ? [item.callId] : []));
    for (const group of new Set(work.values())) setDisclosure(turnWorkDisclosureKey("a", group.key), false);
    expect(hostProject(entries, "a").cells).toEqual(collapsed.cells);
  });

  it("does not fold a second agent with identical text, call ids, and host source ids", () => {
    const { entries, work } = fixture();
    updateTurnWorkGroups("a", work);
    expect(hostProject(entries, "a").cells).toHaveLength(6);
    const other = hostProject(entries, "b");
    expect(other.cells).toHaveLength(entries.length);
    expect(other.cells.some((cell) => cell.kind === "omp-turn-work")).toBe(false);
    updateTurnWorkGroups("b", work);
    const oneGroup = work.values().next().value!;
    setDisclosure(turnWorkDisclosureKey("b", oneGroup.key), true);
    expect(hostProject(entries, "b").cells).toHaveLength(19);
    expect(hostProject(entries, "a").cells).toHaveLength(6);
  });

  it("leaves older-page and newly idle records with repeated content outside the recorded group", () => {
    const { entries } = fixture();
    const recorded = entries.map((source) => ({ ...source, seqStart: source.seqStart + 100, seqEnd: source.seqEnd + 100 }));
    const work = completedTurnWork(recorded,
      completedTurnFooters(recorded, false, null, { fromStart: true }), "e", { fromStart: true });
    updateTurnWorkGroups("a", work);
    expect(hostProject(recorded, "a").cells).toHaveLength(6);

    // No store refresh has observed these records yet. Both the thought text
    // and call id intentionally match already folded work in the same agent.
    const thought = recorded[1]!.item;
    const tool = recorded[2]!.item;
    const older = [entry(structuredClone(thought), 1, 100, "older"), entry(structuredClone(tool), 2, 200, "older")];
    const newlyIdle = [entry(structuredClone(thought), 201, 201000, "new"), entry(structuredClone(tool), 202, 202000, "new")];
    for (const unknown of [older, newlyIdle]) {
      const projected = hostProject(unknown, "a");
      expect(projected.cells.map((cell) => cell.kind)).toEqual(["omp-reasoning", "omp-tool-call"]);
      expect(projected.cells.some((cell) => cell.kind === "omp-turn-work")).toBe(false);
    }
    // A replacement epoch can reuse both the source id and sequence too.
    expect(hostProject(recorded, "a", true, "complete", "replacement").cells).toHaveLength(recorded.length);
    expect(hostProject(recorded, "a").cells).toHaveLength(6);
  });

  it("restores all host cells on history invalidation and keeps streaming rows visible", () => {
    const { entries, work } = fixture();
    updateTurnWorkGroups("a", work);
    expect(hostProject(entries, "a", true, "streaming").cells).toHaveLength(entries.length);
    expect(hostProject(entries, "a").cells).toHaveLength(6);
    updateTurnWorkGroups("a", new Map());
    const restored = hostProject(entries, "a");
    expect(restored.cells).toHaveLength(entries.length);
    expect(restored.cells.some((cell) => cell.kind === "omp-turn-work")).toBe(false);
    expect(new Set(restored.cells.map((cell) => cell.id)).size).toBe(restored.cells.length);
  });

  it("publishes footer-store invalidation to projection even when no summary renderer is mounted", async () => {
    const { entries } = fixture();
    let onEvent: Parameters<PaseoAgentTimelineHandle["subscribe"]>[0] = () => {};
    const release = Object.assign(vi.fn(), { ready: Promise.resolve(), subscriptionId: "fixture", release: async () => {} });
    const refetch = vi.fn<PaseoAgentTimelineHandle["refetch"]>().mockResolvedValue(page(entries));
    const subscribe = vi.fn<PaseoAgentTimelineHandle["subscribe"]>().mockImplementation((handler) => { onEvent = handler; return release; });
    const store = createTurnFooterStore(() => ({ refetch, subscribe }), undefined, undefined,
      (work) => updateTurnWorkGroups("a", work));
    store.setRunning(false);
    const stop = store.retain(2000, "", turnWorkCursorKey("thought:Thinking one", 2));
    try {
      await store.refresh();
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(hostProject(entries, "a").cells).toHaveLength(6);

      refetch.mockRejectedValue(new Error("Fixture offline"));
      onEvent({ agentId: "a", event: { type: "replacement" } } as PaseoAgentTimelineEvent);
      expect(hostProject(entries, "a").cells).toHaveLength(entries.length);
      await store.refresh();
      expect(hostProject(entries, "a").cells).toHaveLength(entries.length);

      refetch.mockResolvedValue(page(entries));
      await store.refresh();
      expect(hostProject(entries, "a").cells).toHaveLength(6);
      refetch.mockRejectedValue(new Error("Fixture refetch failed"));
      await store.refresh();
      expect(hostProject(entries, "a").cells).toHaveLength(entries.length);
    } finally { stop(); }
    expect(release).toHaveBeenCalledTimes(1);
  });
});
