import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

const motion = vi.hoisted(() => ({ reduced: false, start: vi.fn(), stop: vi.fn(), timing: vi.fn() }));
vi.mock("../../client/ui/use-reduced-motion", () => ({ useReducedMotion: () => motion.reduced }));
vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { ...rn, Animated: { ...rn.Animated, timing: motion.timing, loop: () => ({ start: motion.start, stop: motion.stop }) } };
});
import { TitleLoading } from "../../client/tasks/cards/title-loading";

let tree: TestRenderer.ReactTestRenderer;
const title = "/Users/example/Downloads/飞书 20261027-193857.mp4";
const renderTitle = (animated = true, mutedColor = "#666666") => <TitleLoading title={title} highlightColor="#111111" mutedColor={mutedColor} style={{ fontSize: 16, lineHeight: 24 }} animated={animated} accessibilityLabel="正在更新标题…" />;
const host = (testID: string) => tree.root.find((node) => typeof node.type === "string" && node.props.testID === testID);
const hosts = (testID: string) => tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === testID);
const measure = async (width: number) => { await act(async () => host("task-title-update-shimmer").props.onLayout({ nativeEvent: { layout: { width, height: 48 } } })); };
const colorOf = (node: TestRenderer.ReactTestInstance) => [node.props.style].flat(Infinity).reduce((color, style) => style?.color ?? color, undefined);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  motion.reduced = false;
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

describe.each(["ios", "android"])("native title sweep (%s)", (os) => {
  beforeEach(() => { (globalThis as { __rnMockOS?: string }).__rnMockOS = os; });

  it("keeps the title in flow and fades clipped copies in and out across the band", async () => {
    await act(async () => { tree = TestRenderer.create(renderTitle()); });
    expect(host("task-card-title").props.numberOfLines).toBe(2);
    expect(host("task-card-title").children.join("")).toBe(title);
    expect(host("task-title-update-shimmer").props.accessibilityState).toEqual({ busy: true });
    expect(motion.start).not.toHaveBeenCalled();
    await measure(240);
    expect(motion.start).toHaveBeenCalledOnce();
    expect(motion.timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ useNativeDriver: true, isInteraction: false }));
    const sheen = host("task-title-update-sheen");
    expect(sheen.props.pointerEvents).toBe("none");
    expect(sheen.props["aria-hidden"]).toBe(true);
    expect(sheen.props.accessibilityElementsHidden).toBe(true);
    const copies = sheen.findAll((node) => String(node.type) === "Text");
    expect(copies.length).toBeGreaterThanOrEqual(12);
    expect(copies.every((node) => node.props.numberOfLines === 2 && node.children.join("") === title && colorOf(node) === "#111111" && !JSON.stringify(node.props.style).includes("textShadow"))).toBe(true);
    const opacities = sheen.findAll((node) => String(node.type) === "Animated.View" && typeof node.props.style?.opacity === "number").map((node) => node.props.style.opacity as number);
    expect(opacities).toHaveLength(copies.length);
    // A soft peak: faint at both ends, full in the middle, no step bigger than a fifth.
    expect(Math.max(opacities[0]!, opacities.at(-1)!)).toBeLessThan(0.05);
    expect(Math.max(...opacities)).toBeGreaterThan(0.95);
    expect(Math.max(...opacities.slice(1).map((value, index) => Math.abs(value - opacities[index]!)))).toBeLessThan(0.2);
    // The band leans from top left to bottom right; every copy shears back from the same top edge, so the glyphs stay upright.
    const skew = (style: { transform?: Array<Record<string, unknown>> }) => style.transform?.find((step) => "skewX" in step)?.skewX;
    expect(skew(sheen.props.style)).toBe("30deg");
    expect(sheen.props.style.transformOrigin).toBe("left top");
    const shifted = sheen.findAll((node) => String(node.type) === "Animated.View" && typeof node.props.style?.opacity === "number");
    expect(shifted.every((node) => skew(node.props.style) === "-30deg" && node.props.style.transformOrigin === "left top")).toBe(true);
    await measure(180);
    expect(motion.stop).toHaveBeenCalledOnce();
    expect(motion.start).toHaveBeenCalledTimes(2);
    await act(async () => tree.unmount());
    expect(motion.stop).toHaveBeenCalledTimes(2);
  });

  it.each(["disabled", "reduced"])("keeps a readable static title without a loop when motion is %s", async (reason) => {
    motion.reduced = reason === "reduced";
    await act(async () => { tree = TestRenderer.create(renderTitle(reason !== "disabled")); });
    await measure(240);
    expect(motion.start).not.toHaveBeenCalled();
    expect(hosts("task-title-update-sheen")).toHaveLength(0);
    expect(host("task-card-title").children.join("")).toBe(title);
    expect(host("task-title-update-shimmer").props.accessibilityState.busy).toBe(true);
  });
});

describe("web title sweep", () => {
  const elements = new Map<string, { id: string; textContent: string; remove: () => void }>();
  beforeEach(() => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    elements.clear();
    vi.stubGlobal("document", {
      getElementById: (id: string) => elements.get(id) ?? null,
      createElement: () => {
        const element = { id: "", textContent: "", remove: () => elements.delete(element.id) };
        return element;
      },
      head: { appendChild: (element: { id: string; textContent: string; remove: () => void }) => elements.set(element.id, element) },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("clips one CSS gradient to the title and drops the stylesheet with the last title", async () => {
    await act(async () => { tree = TestRenderer.create(renderTitle()); });
    const text = host("task-card-title");
    expect(text.props.dataSet).toEqual({ bctitlesweep: "" });
    expect(colorOf(text)).toBe("#111111");
    expect(text.children.join("")).toBe(title);
    expect(hosts("task-title-update-sheen")).toHaveLength(0);
    expect(motion.start).not.toHaveBeenCalled();
    const css = [...elements.values()][0]!.textContent;
    expect(css).toContain("background-clip: text");
    expect(css).toContain("linear-gradient(60deg");
    expect(css).toContain("#666666");
    expect(css).toContain("prefers-reduced-motion");
    await act(async () => tree.update(renderTitle(true, "#777777")));
    expect([...elements.values()][0]!.textContent).toContain("#777777");
    await act(async () => tree.unmount());
    expect(elements.size).toBe(0);
  });

  it.each(["disabled", "reduced"])("shows the muted title without the sweep when motion is %s", async (reason) => {
    motion.reduced = reason === "reduced";
    await act(async () => { tree = TestRenderer.create(renderTitle(reason !== "disabled")); });
    const text = host("task-card-title");
    expect(text.props.dataSet).toBeUndefined();
    expect(colorOf(text)).toBe("#666666");
    expect(elements.size).toBe(0);
  });
});
