import { afterEach, describe, expect, it } from "vitest";
import {
  disablePerf,
  enablePerf,
  perfOn,
  perfSnapshot,
  probeAnimationLoop,
  probeCard,
  probeHighlightRpc,
  probeMarkdown,
  resetPerf,
} from "../../client/debug/perf";

afterEach(() => {
  disablePerf();
  resetPerf();
});

describe("perf probes while disabled", () => {
  it("are off by default and return a shared inert card probe", () => {
    expect(perfOn()).toBe(false);
    const first = probeCard("tool_call", "a");
    const second = probeCard("assistant", "b");
    expect(first).toBe(second);
    expect(first.node).toBeNull();
    expect(first.viewProps).toEqual({});
    expect(perfSnapshot().renders.byKind).toEqual({});
  });

  it("parse the markdown once and record nothing", () => {
    let calls = 0;
    const blocks = probeMarkdown("m", "x", () => {
      calls += 1;
      return [{ kind: "paragraph" }];
    });
    expect(calls).toBe(1);
    expect(blocks).toHaveLength(1);
    probeHighlightRpc("ts");
    probeAnimationLoop("Glow")();
    const snap = perfSnapshot();
    expect(snap.markdown.parses).toBe(0);
    expect(snap.highlightRpc.count).toBe(0);
    expect(snap.animations.mountsTotal).toBe(0);
  });
});

describe("perf probes while enabled", () => {
  it("count renders, parses, flips, highlight RPCs and animations", () => {
    enablePerf();
    expect(perfOn()).toBe(true);

    const probe = probeCard("assistant", "turn-1", true);
    expect(probe.node).not.toBeNull();
    expect(typeof probe.viewProps.onLayout).toBe("function");
    probeCard("assistant", "turn-1", true);

    probeMarkdown("turn-1", "a", () => [{ kind: "plain" }]);
    probeMarkdown("turn-1", "ab", () => [{ kind: "code" }]);
    probeHighlightRpc("ts");
    const release = probeAnimationLoop("PulseDot");

    const snap = perfSnapshot();
    expect(snap.renders.byKind).toEqual({ assistant: 2 });
    expect(snap.markdown.parses).toBe(2);
    expect(snap.markdown.formatFlips).toBe(1);
    expect(snap.highlightRpc.count).toBe(1);
    expect(snap.animations.mounted).toBe(1);
    release();
    expect(perfSnapshot().animations.mounted).toBe(0);
  });

  it("exposes the handle on globalThis", () => {
    const handle = (globalThis as { __bcPerf?: { enabled(): boolean } }).__bcPerf;
    expect(handle?.enabled()).toBe(false);
  });
});
