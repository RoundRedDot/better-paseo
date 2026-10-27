import { act, createElement } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../../client/ui/use-reduced-motion", () => ({ useReducedMotion: () => motion.reduced }));
import { REVEAL_TICK_MS, revealStep, useRevealedTitle } from "../../client/tasks/cards/title-reveal";

/** One act per tick: act renders a timer's update only when it ends. */
async function tick(times = 1) {
  for (let index = 0; index < times; index += 1) await act(async () => { await vi.advanceTimersByTimeAsync(REVEAL_TICK_MS); });
}

afterEach(() => {
  vi.useRealTimers();
  motion.reduced = false;
});

function Probe(props: { target: string; streaming: boolean; animated?: boolean; seen: string[] }) {
  props.seen.push(useRevealedTitle(props.target, props.streaming, props.animated));
  return null;
}

describe("streamed title reveal", () => {
  it("shows a share of what is left each tick, whole characters only", () => {
    expect(revealStep("", "ab")).toBe("a");
    expect(revealStep("", "x".repeat(24))).toBe("xx");
    expect(revealStep("流式", "流式输出标题")).toBe("流式输");
    expect(revealStep("", "\u{1F525}a")).toBe("\u{1F525}");
  });

  it("types a streamed title from nothing, continues it as chunks land, and finishes after the stream ends", async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => { tree = TestRenderer.create(createElement(Probe, { target: "Old title", streaming: false, seen })); });
    expect(seen.at(-1)).toBe("Old title");
    await act(async () => tree.update(createElement(Probe, { target: "Fix", streaming: true, seen })));
    expect(seen.at(-1)).toBe("");
    await tick();
    expect(seen.at(-1)).toBe("F");
    await act(async () => tree.update(createElement(Probe, { target: "Fix the card title", streaming: true, seen })));
    expect(seen.at(-1)).toBe("F");
    // The stream ends with the reveal under way: it still types to the end.
    await act(async () => tree.update(createElement(Probe, { target: "Fix the card title", streaming: false, seen })));
    await tick(3);
    expect(seen.at(-1)!.length).toBeGreaterThan(1);
    expect(seen.at(-1)).not.toBe("Fix the card title");
    await tick(40);
    expect(seen.at(-1)).toBe("Fix the card title");
    // Every frame on the way was a prefix of the title: no flash of the old one.
    expect(seen.slice(seen.indexOf("")).every((text) => "Fix the card title".startsWith(text))).toBe(true);
  });

  it("shows a rename outside a stream, or with animation or motion off, at once", async () => {
    const seen: string[] = [];
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => { tree = TestRenderer.create(createElement(Probe, { target: "Fix", streaming: false, seen })); });
    await act(async () => tree.update(createElement(Probe, { target: "Fix the bug", streaming: false, seen })));
    expect(seen.at(-1)).toBe("Fix the bug");
    await act(async () => tree.update(createElement(Probe, { target: "Generated", streaming: true, animated: false, seen })));
    expect(seen.at(-1)).toBe("Generated");
    motion.reduced = true;
    await act(async () => tree.update(createElement(Probe, { target: "Reduced", streaming: true, seen })));
    expect(seen.at(-1)).toBe("Reduced");
  });
});
