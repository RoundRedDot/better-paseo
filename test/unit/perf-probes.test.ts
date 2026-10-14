import { afterEach, describe, expect, it } from "vitest";
import {
  disablePerf,
  enablePerf,
  perfOn,
  perfSnapshot,
  probeAnimationLoop,
  probeCard,
  probeHighlightRpc,
  probeImageRpc,
  probeMarkdown,
  textItemKey,
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
    probeImageRpc("/workspace", "image.png", Promise.resolve());
    probeAnimationLoop("Glow")();
    const snap = perfSnapshot();
    expect(snap.markdown.parses).toBe(0);
    expect(snap.highlightRpc.count).toBe(0);
    expect(snap.imageRpc).toEqual({ count: 0, duplicatesInFlight: 0 });
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

  it("counts an image RPC and a repeated in-flight cwd/path pair", async () => {
    enablePerf();
    let resolve!: () => void;
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    probeImageRpc("/workspace", "same.png", pending);
    probeImageRpc("/workspace", "same.png", pending);
    expect(perfSnapshot().imageRpc).toEqual({ count: 2, duplicatesInFlight: 1 });

    resolve();
    await pending;
    await Promise.resolve();
    probeImageRpc("/workspace", "same.png", Promise.resolve());
    await Promise.resolve();
    expect(perfSnapshot().imageRpc).toEqual({ count: 3, duplicatesInFlight: 1 });
  });

  it("does not merge image requests with a different cwd or path", async () => {
    enablePerf();
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    let resolveThird!: () => void;
    const first = new Promise<void>((done) => { resolveFirst = done; });
    const second = new Promise<void>((done) => { resolveSecond = done; });
    const third = new Promise<void>((done) => { resolveThird = done; });
    probeImageRpc("/workspace-a", "same.png", first);
    probeImageRpc("/workspace-b", "same.png", second);
    probeImageRpc("/workspace-a", "other.png", third);
    expect(perfSnapshot().imageRpc).toEqual({ count: 3, duplicatesInFlight: 0 });

    resolveFirst();
    resolveSecond();
    resolveThird();
    await Promise.all([first, second, third]);
  });

  it("handles a rejected image promise without an unhandled rejection", async () => {
    enablePerf();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      let reject!: (error: unknown) => void;
      const pending = new Promise<void>((_resolve, no) => {
        reject = no;
      });
      probeImageRpc("/workspace", "reject.png", pending);
      reject(new Error("read failed"));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expect(perfSnapshot().imageRpc).toEqual({ count: 1, duplicatesInFlight: 0 });
    } finally {
      process.off("unhandledRejection", listener);
    }
  });
});

describe("textItemKey", () => {
  it("is empty while disabled", () => {
    expect(textItemKey("reasoning", "hello")).toBe("");
  });

  it("keeps one id while the text grows, and splits unrelated texts", () => {
    enablePerf();
    const first = textItemKey("reasoning", "Consid");
    expect(textItemKey("reasoning", "Considering the request")).toBe(first);
    expect(textItemKey("reasoning", "Considering the request. " + "x".repeat(200))).toBe(first);
    expect(textItemKey("reasoning", "Another thought")).not.toBe(first);
    expect(textItemKey("assistant", "Considering")).not.toBe(first);
    expect(textItemKey("reasoning", "")).toBe("reasoning");
  });
});
