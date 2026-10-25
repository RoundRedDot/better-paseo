import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

type Run = { value: { setValue(value: number): void; __value: number }; to: number; stop: ReturnType<typeof vi.fn>; finish(): void };
const motion = vi.hoisted(() => ({ reduced: false, runs: [] as Run[], layouts: vi.fn() }));
vi.mock("../../client/ui/use-reduced-motion", () => ({ useReducedMotion: () => motion.reduced }));
vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { ...rn, LayoutAnimation: { configureNext: motion.layouts }, Animated: { ...rn.Animated,
    Value: class {
      constructor(public __value: number) {}
      setValue(value: number) { this.__value = value; }
      interpolate({ outputRange }: { outputRange: number[] }) {
        const source = this;
        return { get __value() { return outputRange[0]! + (outputRange[1]! - outputRange[0]!) * source.__value; } };
      }
    },
    timing(value: Run["value"], config: { toValue: number; useNativeDriver: boolean }) {
      expect(config.useNativeDriver).toBe(false);
      let callback: ((result: { finished: boolean }) => void) | undefined;
      const run: Run = { value, to: config.toValue, stop: vi.fn(), finish() { value.setValue(config.toValue); callback?.({ finished: true }); } };
      motion.runs.push(run);
      return { start(done: typeof callback) { callback = done; }, stop: run.stop };
    },
  } };
});
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, TextInput: rn.TextInput };
});
vi.mock("../../client/tasks/typography", () => ({ HOST_FONT: { base: 14 }, useTasksFontScale: () => 1 }));
import { PhoneSearch } from "../../client/tasks/board/phone-search";

let renderer: TestRenderer.ReactTestRenderer;
const onChange = vi.fn();
const element = (visible: boolean) => <PhoneSearch visible={visible} autoFocus={visible} query="" onChange={onChange} placeholder="Search tasks" theme={{ colors: {} } as never} />;
const nodes = (id: string) => renderer.root.findAll(node => typeof node.type === "string" && node.props.testID === id);
const panel = () => nodes("phone-search-reveal")[0]!;
const last = () => motion.runs.at(-1)!;
const update = (visible: boolean) => act(() => renderer.update(element(visible)));
const measure = () => act(() => nodes("phone-search-measure")[0]!.props.onLayout({ nativeEvent: { layout: { height: 46 } } }));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  motion.reduced = false;
  motion.runs.length = 0;
  motion.layouts.mockClear();
});
afterEach(() => { act(() => renderer?.unmount()); });

describe.each(["ios", "android", "web"])("phone search reveal (%s)", os => {
  beforeEach(() => { (globalThis as { __rnMockOS?: string }).__rnMockOS = os; });
  afterEach(() => { delete (globalThis as { __rnMockOS?: string }).__rnMockOS; });

  it("starts collapsed, measures before opening, and keeps the input through its exit", () => {
    act(() => { renderer = TestRenderer.create(element(false)); });
    expect(nodes("phone-search-measure")).toHaveLength(0);
    update(true);
    expect(panel().props.style.height.__value).toBe(0);
    expect(motion.runs).toHaveLength(0);
    measure();
    expect(last().to).toBe(1);
    expect(panel().props.style.opacity).toBe(last().value);
    act(() => last().value.setValue(0.5));
    expect(panel().props.style.height.__value).toBe(23);
    expect(panel().props.style.opacity.__value).toBe(0.5);
    act(() => { last().value.setValue(1); last().finish(); });
    expect(panel().props.style.height.__value).toBe(46);
    update(false);
    expect(last().to).toBe(0);
    expect(nodes("phone-search-measure")).toHaveLength(1);
    expect(panel().props.pointerEvents).toBe("none");
    act(() => last().finish());
    expect(nodes("phone-search-measure")).toHaveLength(0);
    expect(motion.layouts).not.toHaveBeenCalled();
  });

  it("reverses a closing animation without letting its stale completion remove the field", () => {
    act(() => { renderer = TestRenderer.create(element(true)); });
    measure();
    expect(motion.runs).toHaveLength(0);
    update(false);
    const closing = last();
    closing.value.setValue(0.4);
    update(true);
    expect(closing.stop).toHaveBeenCalledOnce();
    expect(last().value.__value).toBe(0.4);
    expect(last().to).toBe(1);
    act(() => closing.finish());
    expect(nodes("phone-search-measure")).toHaveLength(1);
    expect(panel().props.pointerEvents).toBe("auto");
  });

  it("settles immediately when reduced motion is enabled during an exit", () => {
    act(() => { renderer = TestRenderer.create(element(true)); });
    measure();
    update(false);
    const closing = last();
    motion.reduced = true;
    update(false);
    expect(closing.stop).toHaveBeenCalledOnce();
    expect(nodes("phone-search-measure")).toHaveLength(0);
    update(true);
    expect(panel().props.style).toMatchObject({ height: undefined, opacity: 1 });
    expect(motion.runs).toHaveLength(1);
  });
});
