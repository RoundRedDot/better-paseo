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
const renderTitle = (animated = true) => <TitleLoading title={title} color="#111111" mutedColor="#666666" style={{ fontSize: 16, lineHeight: 24 }} animated={animated} accessibilityLabel="正在更新标题…" />;
const host = (testID: string) => tree.root.find((node) => typeof node.type === "string" && node.props.testID === testID);
const measure = async (width: number) => { await act(async () => host("task-title-update-shimmer").props.onLayout({ nativeEvent: { layout: { width } } })); };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  motion.reduced = false;
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

describe.each(["ios", "android", "web"])("title light sweep (%s)", (os) => {
  beforeEach(() => { (globalThis as { __rnMockOS?: string }).__rnMockOS = os; });

  it("keeps the title in flow and clips decorative copies to a moving band", async () => {
    await act(async () => { tree = TestRenderer.create(renderTitle()); });
    expect(host("task-card-title").props.numberOfLines).toBe(2);
    expect(host("task-card-title").children.join("")).toBe(title);
    expect(host("task-title-update-shimmer").props.accessibilityState).toEqual({ busy: true });
    expect(motion.start).not.toHaveBeenCalled();
    await measure(240);
    expect(motion.start).toHaveBeenCalledOnce();
    expect(motion.timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ useNativeDriver: os !== "web", isInteraction: false }));
    const sheen = host("task-title-update-sheen");
    expect(sheen.props.pointerEvents).toBe("none");
    expect(sheen.props["aria-hidden"]).toBe(true);
    expect(sheen.props.accessibilityElementsHidden).toBe(true);
    const copies = sheen.findAll((node) => String(node.type) === "Text");
    expect(copies).toHaveLength(5);
    expect(copies.every((node) => node.props.numberOfLines === 2 && node.children.join("") === title)).toBe(true);
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
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-title-update-sheen")).toHaveLength(0);
    expect(host("task-card-title").children.join("")).toBe(title);
    expect(host("task-title-update-shimmer").props.accessibilityState.busy).toBe(true);
  });
});
