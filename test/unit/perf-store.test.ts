import { describe, expect, it } from "vitest";
import { createPerfStore, createSeries, percentile } from "../../client/debug/store";

describe("percentile", () => {
  it("uses nearest rank over an ascending array", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 0.5)).toBe(5);
    expect(percentile(sorted, 0.95)).toBe(10);
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe("Series", () => {
  it("summarises count, total, mean, percentiles and max", () => {
    const series = createSeries();
    for (const value of [4, 1, 3, 2]) series.add(value);
    expect(series.summary()).toEqual({ count: 4, total: 10, mean: 2.5, p50: 2, p95: 4, max: 4 });
  });

  it("reports zeros when empty", () => {
    expect(createSeries().summary().count).toBe(0);
  });
});

describe("PerfStore", () => {
  it("counts renders per kind and per item, and commit time per kind", () => {
    const store = createPerfStore();
    store.render("tool_call", "a");
    store.render("tool_call", "a");
    store.render("tool_call", "b");
    store.render("assistant", undefined);
    store.commit("tool_call", 2);
    store.commit("tool_call", 6);
    const snap = store.snapshot();
    expect(snap.renders.byKind).toEqual({ tool_call: 3, assistant: 1 });
    expect(snap.renders.byItem).toEqual({ "tool_call:a": 2, "tool_call:b": 1 });
    expect(snap.commitMs.tool_call).toMatchObject({ count: 2, total: 8, max: 6 });
  });

  it("counts a flip when the block kind at the same index changes", () => {
    const store = createPerfStore();
    store.markdownBlocks("m", ["paragraph", "plain"]);
    store.markdownBlocks("m", ["paragraph", "code"]);
    store.markdownBlocks("m", ["paragraph", "code", "paragraph"]);
    store.markdownBlocks("other", ["list"]);
    const { markdown } = store.snapshot();
    expect(markdown.formatFlips).toBe(1);
    expect(markdown.flipsByBlockIndex).toEqual({ "1": 1 });
  });

  it("records a height decrease only when a card gets shorter", () => {
    const store = createPerfStore();
    store.height("c", 100, true);
    store.height("c", 140, true);
    store.height("c", 90, true);
    store.height("c", 60, false);
    store.height("d", 50, null);
    const { heightDecreases } = store.snapshot();
    expect(heightDecreases.count).toBe(2);
    expect(heightDecreases.whileStreaming).toBe(1);
    expect(heightDecreases.totalPx).toBe(80);
    expect(heightDecreases.events[0]).toEqual({ key: "c", from: 140, to: 90, streaming: true });
  });

  it("counts highlight RPCs by language", () => {
    const store = createPerfStore();
    store.highlightRpc("ts");
    store.highlightRpc("ts");
    store.highlightRpc(undefined);
    expect(store.snapshot().highlightRpc).toEqual({ count: 3, byLanguage: { ts: 2, "(none)": 1 } });
  });

  it("counts image RPC calls and in-flight duplicates", () => {
    const store = createPerfStore();
    store.imageRpc(false);
    store.imageRpc(true);
    store.imageRpc(false);
    expect(store.snapshot().imageRpc).toEqual({ count: 3, duplicatesInFlight: 1 });
  });

  it("tracks mounted animations with a peak", () => {
    const store = createPerfStore();
    store.animationMount("PulseDot");
    store.animationMount("Glow");
    store.animationUnmount("PulseDot");
    const { animations } = store.snapshot();
    expect(animations).toMatchObject({ mounted: 1, peak: 2, mountsTotal: 2, byName: { Glow: 1 } });
  });

  it("derives dropped frames from the frame interval", () => {
    const store = createPerfStore();
    const frame = 1000 / 60;
    store.frame(frame, frame);
    store.frame(frame, frame);
    store.frame(frame * 3, frame); // two frames missed
    store.frame(5000, frame); // suspended tab, not a drop
    const { frames } = store.snapshot();
    expect(frames.count).toBe(3);
    expect(frames.dropped).toBe(2);
    expect(frames.droppedRatio).toBe(0.4);
    expect(frames.longestMs).toBe(50);
    expect(frames.suspendedGaps).toBe(1);
  });

  it("reset clears counters but keeps mounted animations", () => {
    const store = createPerfStore();
    store.render("x", "1");
    store.animationMount("Glow");
    store.reset();
    const snap = store.snapshot();
    expect(snap.renders.byKind).toEqual({});
    expect(snap.animations.mounted).toBe(1);
    expect(snap.animations.mountsTotal).toBe(0);
  });
});
