/**
 * The fold under the agent's note, a card's title and a message body, laid out
 * by Yoga as Fabric lays it out, with text measured the way iOS measures it:
 * no taller than the height its box offers (`clampText`). Measuring the text
 * under the fold's own clip read it as one fold tall, so the fold dropped, the
 * text measured whole, the fold came back, and the fold and its "Show all" row
 * flickered for good; an opening fold re-measured every frame and stopped
 * partway. `settleHostLayout` throws when the frames never settle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { useState } from "react";

vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const motion = vi.hoisted(() => ({ reduced: true }));

/**
 * An `Animated` that animates only when a test steps it: an interpolation
 * resolves to its number when an Animated.View renders, and every step
 * re-renders the Animated.Views, as each frame lays the fold out again.
 */
const anim = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let version = 0;
  const tick = () => { version++; for (const listener of listeners) listener(); };
  class Interpolation {
    constructor(readonly value: { current: number }, readonly input: number[], readonly output: number[]) {}
    resolve() {
      const [a, b] = this.input as [number, number];
      const [c, d] = this.output as [number, number];
      return c + (d - c) * ((this.value.current - a) / (b - a));
    }
  }
  type Run = { value: { current: number }; from: number; to: number; done?: (result: { finished: boolean }) => void; active: boolean };
  const runs: Run[] = [];
  class Value {
    current: number;
    constructor(initial: number) { this.current = initial; }
    setValue(next: number) {
      for (const run of runs) if (run.active && run.value === this) { run.active = false; run.done?.({ finished: false }); }
      this.current = next;
      tick();
    }
    stopAnimation(callback?: (value: number) => void) { callback?.(this.current); }
    interpolate(config: { inputRange: number[]; outputRange: number[] }) { return new Interpolation(this, config.inputRange, config.outputRange); }
    addListener() { return "listener"; }
    removeListener() {}
  }
  const timing = (value: Value, config: { toValue: number }) => {
    const run: Run = { value, from: value.current, to: config.toValue, active: false };
    return {
      start(done?: (result: { finished: boolean }) => void) {
        for (const other of runs) if (other.active && other.value === value) { other.active = false; other.done?.({ finished: false }); }
        run.from = value.current;
        run.done = done;
        run.active = true;
        runs.push(run);
      },
      stop() { if (run.active) { run.active = false; run.done?.({ finished: false }); } },
    };
  };
  /** Move every running animation to `fraction` of its way. */
  const step = (fraction: number) => {
    for (const run of runs) if (run.active) run.value.current = run.from + (run.to - run.from) * fraction;
    tick();
  };
  const finish = () => {
    for (const run of runs.splice(0)) if (run.active) { run.value.current = run.to; run.active = false; run.done?.({ finished: true }); }
    tick();
  };
  const active = () => runs.filter((run) => run.active).length;
  return { listeners, tick, Interpolation, Value, timing, step, finish, active, version: () => version, reset: () => { runs.splice(0); } };
});

vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  const react = await import("react");
  function AnimatedView(props: Record<string, unknown> & { children?: React.ReactNode }) {
    react.useSyncExternalStore((listener) => { anim.listeners.add(listener); return () => anim.listeners.delete(listener); }, anim.version);
    const flat = rn.StyleSheet.flatten(props.style) as Record<string, unknown>;
    const style = Object.fromEntries(Object.entries(flat).map(([key, value]) => [key, value instanceof anim.Interpolation ? value.resolve() : value]));
    return react.createElement("Animated.View", { ...props, style }, props.children);
  }
  return {
    ...rn,
    Animated: { ...rn.Animated, View: AnimatedView, Value: anim.Value, timing: anim.timing },
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(motion.reduced),
      addEventListener: () => ({ remove() {} }),
    },
  };
});

vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const react = await import("react");
  return { Icon: (props: Record<string, unknown>) => react.createElement("Icon", props) };
});

import "./helpers/quiet-renderer";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Text, View } from "react-native";
import { FoldedText } from "../../client/tasks/cards/folded-text";
import { taskTokens } from "../../client/tasks/cards/tokens";
import { settleHostLayout, measureHostTree, wrapLines, type Frame } from "./helpers/yoga-host-layout";

const LINE = 20;
const LIMIT = 4;
const THEME = {
  colors: {
    surface0: "#ffffff", surface1: "#f7f7f8", surface2: "#efeff1", border: "#e2e2e6", foreground: "#1b1b1f", foregroundMuted: "#6b6b75",
    accent: "#3b6fe0", accentForeground: "#ffffff", statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d93636",
  },
};
const SENTENCE = "The agent wrote a plan before it asked, and the note keeps going past the fold so the reader opens the rest.";
const LONG = `${SENTENCE} ${SENTENCE} ${SENTENCE} ${SENTENCE}`;
const SHORT = "A short note.";

let renderer: ReactTestRenderer | null = null;
beforeEach(() => { anim.reset(); });
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = null;
  motion.reduced = true;
});

function Note(props: { text: string; long?: boolean; total?: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View testID="note">
      <FoldedText id="fold" language="en" tokens={taskTokens(THEME as never)} line={LINE} limit={LIMIT} expanded={expanded}
        long={props.long} total={props.total} fadeColor="#ffffff" touch onToggle={() => setExpanded((open) => !open)}>
        <Text style={{ fontSize: 14, lineHeight: LINE }}>{props.text}</Text>
      </FoldedText>
    </View>
  );
}

const host = (testID: string) => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === testID);
const hosts = (testID: string) => renderer!.root.findAll((node) => typeof node.type === "string" && node.props.testID === testID);
const textOf = (node: ReactTestInstance): string => node.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");

async function mount(element: React.ReactElement) {
  await act(async () => { renderer = TestRenderer.create(element); });
  // Reduce motion arrives from AccessibilityInfo after the subscription.
  await act(async () => { await Promise.resolve(); });
}

const options = (width: number, clampText = true) => ({ width, wrapText: true, wordWrap: true, clampText });
const settle = (width: number, clampText = true) => settleHostLayout(() => host("note"), options(width, clampText));
/** Lay out once and answer each `onLayout`, as one native frame does. */
async function frame(width: number, clampText = true): Promise<Map<ReactTestInstance, Frame>> {
  const frames = measureHostTree(host("note"), options(width, clampText));
  await act(async () => {
    for (const [instance, box] of frames) {
      const onLayout = instance.props.onLayout as ((event: unknown) => void) | undefined;
      onLayout?.({ nativeEvent: { layout: { x: 0, y: 0, width: box.width, height: box.height } } });
    }
  });
  return frames;
}
const press = () => act(async () => host("fold-more").props.onPress());
const fullLines = (frames: Map<ReactTestInstance, Frame>) => Math.round(frames.get(host("fold-measure"))!.height / LINE);

describe("folded text, measured as iOS measures text", () => {
  it("settles a long note under the fold with a steady row, instead of flickering", async () => {
    await mount(<Note text={LONG} />);
    const frames = await settle(300);
    const lines = fullLines(frames);
    expect(lines).toBeGreaterThan(LIMIT);
    expect(frames.get(host("fold-text"))!.height).toBe(LIMIT * LINE);
    expect(hosts("fold-fade")).toHaveLength(1);
    expect(textOf(host("fold-more"))).toBe(`Show all · ${lines} lines`);
    // Further frames change nothing: the row neither drops nor returns.
    for (let pass = 0; pass < 4; pass++) {
      const again = await frame(300);
      expect(again.get(host("fold-text"))!.height).toBe(LIMIT * LINE);
      expect(hosts("fold-more")).toHaveLength(1);
    }
  });

  it("keeps a short note whole, with no fold row", async () => {
    await mount(<Note text={SHORT} />);
    const frames = await settle(300);
    expect(frames.get(host("fold-text"))!.height).toBe(LINE);
    expect(frames.get(host("fold-measure"))!.height).toBe(LINE);
    expect(hosts("fold-more")).toHaveLength(0);
    expect(hosts("fold-fade")).toHaveLength(0);
  });

  it("keeps a note exactly at the fold whole", async () => {
    // The widest column that draws the sentence in exactly four lines.
    const width = [...Array(400).keys()].map((step) => 400 - step).find((candidate) => wrapLines(SENTENCE, 14, candidate).length === LIMIT)!;
    await mount(<Note text={SENTENCE} />);
    const frames = await settle(width);
    expect(fullLines(frames)).toBe(LIMIT);
    expect(frames.get(host("fold-text"))!.height).toBe(frames.get(host("fold-measure"))!.height);
    expect(hosts("fold-more")).toHaveLength(0);
  });

  it("folds when the column narrows and unfolds when it widens", async () => {
    const text = `${SENTENCE} ${SENTENCE}`;
    await mount(<Note text={text} />);
    let frames = await settle(900);
    expect(hosts("fold-more")).toHaveLength(0);
    expect(frames.get(host("fold-text"))!.height).toBe(frames.get(host("fold-measure"))!.height);

    frames = await settle(160);
    const lines = fullLines(frames);
    expect(lines).toBeGreaterThan(LIMIT);
    expect(frames.get(host("fold-text"))!.height).toBe(LIMIT * LINE);
    expect(textOf(host("fold-more"))).toBe(`Show all · ${lines} lines`);

    frames = await settle(900);
    expect(hosts("fold-more")).toHaveLength(0);
    expect(frames.get(host("fold-text"))!.height).toBe(frames.get(host("fold-measure"))!.height);
  });

  it("opens and closes on every press, the row staying put", async () => {
    await mount(<Note text={LONG} />);
    let frames = await settle(300);
    const full = frames.get(host("fold-measure"))!.height;
    // The row's offset under the text, folded.
    const gap = frames.get(host("fold-more"))!.top - frames.get(host("fold-text"))!.height;
    for (let press_ = 0; press_ < 6; press_++) {
      const opening = press_ % 2 === 0;
      await press();
      frames = await settle(300);
      expect(frames.get(host("fold-text"))!.height).toBe(opening ? full : LIMIT * LINE);
      expect(frames.get(host("fold-measure"))!.height).toBe(full);
      expect(host("fold-more").props.accessibilityState).toEqual({ expanded: opening });
      expect(textOf(host("fold-more"))).toBe(opening ? "Show less" : `Show all · ${Math.round(full / LINE)} lines`);
      expect(hosts("fold-fade")).toHaveLength(opening ? 0 : 1);
      expect(frames.get(host("fold-more"))!.top).toBeCloseTo((opening ? full : LIMIT * LINE) + gap, 3);
    }
  });

  it("animates the fold open and shut without re-measuring the text it clips", async () => {
    motion.reduced = false;
    await mount(<Note text={LONG} />);
    let frames = await settle(300);
    const full = frames.get(host("fold-measure"))!.height;
    expect(frames.get(host("fold-text"))!.height).toBe(LIMIT * LINE);

    await press();
    expect(anim.active()).toBe(1);
    for (const fraction of [0.25, 0.5, 0.75]) {
      await act(async () => anim.step(fraction));
      frames = await frame(300);
      // Each frame lays the half-open fold out; the text under it stays whole.
      expect(frames.get(host("fold-measure"))!.height).toBe(full);
      expect(frames.get(host("fold-text"))!.height).toBeCloseTo(LIMIT * LINE + (full - LIMIT * LINE) * fraction, 0);
      expect(anim.active()).toBe(1);
    }
    await act(async () => anim.finish());
    frames = await settle(300);
    expect(frames.get(host("fold-text"))!.height).toBe(full);
    expect(textOf(host("fold-more"))).toBe("Show less");

    // Shut it, then open it again before the first animation ends: it ends open.
    await press();
    await act(async () => anim.step(0.5));
    await frame(300);
    await press();
    expect(anim.active()).toBe(1);
    await act(async () => anim.finish());
    frames = await settle(300);
    expect(frames.get(host("fold-text"))!.height).toBe(full);
  });

  // Without the clamp too: a new height mid-animation used to stop the
  // animation for good, leaving the fold stuck partway open.
  it.each([true, false])("finishes opening when the column narrows mid-animation (clampText %s)", async (clampText) => {
    motion.reduced = false;
    await mount(<Note text={LONG} />);
    await settle(300, clampText);
    await press();
    await act(async () => anim.step(0.5));
    // The column narrows: the text measures taller while the fold opens.
    let frames = await frame(220, clampText);
    expect(anim.active()).toBe(1);
    await act(async () => anim.finish());
    frames = await settle(220, clampText);
    const full = frames.get(host("fold-measure"))!.height;
    expect(frames.get(host("fold-text"))!.height).toBe(full);
    expect(textOf(host("fold-more"))).toBe("Show less");
  });

  it("clips with a scroll box natively, and with a hidden one on the web", async () => {
    await mount(<Note text={LONG} />);
    await settle(300);
    expect(host("fold-text").props.style.overflow).toBe("scroll");
    await act(async () => renderer!.unmount());
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    try {
      await mount(<Note text={LONG} />);
      // A browser measures text without its box's limit.
      const frames = await settle(300, false);
      expect(host("fold-text").props.style.overflow).toBe("hidden");
      expect(frames.get(host("fold-text"))!.height).toBe(LIMIT * LINE);
      expect(hosts("fold-more")).toHaveLength(1);
    } finally {
      delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
    }
  });

  it("clips a known-long body by its own measure and leaves a known-short one in flow", async () => {
    await mount(<Note text={LONG} long total={9} />);
    let frames = await settle(300);
    expect(frames.get(host("fold-text"))!.height).toBe(LIMIT * LINE);
    expect(textOf(host("fold-more"))).toBe("Show all · 9 lines");
    await act(async () => renderer!.update(<Note text={SHORT} long={false} total={1} />));
    frames = await settle(300);
    expect(frames.get(host("fold-text"))!.height).toBe(LINE);
    expect(hosts("fold-more")).toHaveLength(0);
  });
});
