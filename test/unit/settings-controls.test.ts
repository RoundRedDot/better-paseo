import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import { SettingsTips, Toggle, type PageLook } from "../../client/settings-controls";
import { measureHostTree } from "./helpers/yoga-host-layout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const globals = globalThis as { __rnMockOS?: string };
const look = { tokens: { v2: {} } } as PageLook;
let renderer: TestRenderer.ReactTestRenderer;
function mount(os = "web") {
  globals.__rnMockOS = os;
  const onChange = vi.fn();
  act(() => { renderer = TestRenderer.create(React.createElement(Toggle, { value: false, onChange, label: "Option", look })); });
  const toggle = renderer.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "switch");
  return { toggle, onChange };
}
function key(extra: Record<string, unknown> = {}) {
  const target = {};
  return { key: " ", target, currentTarget: target, nativeEvent: {}, preventDefault: vi.fn(), ...extra };
}
afterEach(() => {
  act(() => renderer?.unmount());
  delete globals.__rnMockOS;
});

describe("settings switch Space activation", () => {
  it("prevents scrolling on keydown and repeats, then toggles once on keyup", () => {
    const { toggle, onChange } = mount();
    const down = key();
    act(() => toggle.props.onKeyDown(down));
    expect(down.preventDefault).toHaveBeenCalledOnce();
    for (let i = 0; i < 3; i++) {
      const repeat = key({ repeat: true });
      act(() => toggle.props.onKeyDown(repeat));
      expect(repeat.preventDefault).toHaveBeenCalledOnce();
    }
    expect(onChange).not.toHaveBeenCalled();
    act(() => toggle.props.onKeyUp(key()));
    expect(onChange.mock.calls).toEqual([[true]]);
    act(() => toggle.props.onKeyUp(key()));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it.each([
    { metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true },
    { nativeEvent: { isComposing: true } }, { target: {} },
  ])("ignores modified, composing or nested Space (%j)", (flags) => {
    const { toggle, onChange } = mount();
    const event = key(flags);
    act(() => { toggle.props.onKeyDown(event); toggle.props.onKeyUp(event); });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("cancels on blur or a modified release and ignores a repeat without an initial press", () => {
    const { toggle, onChange } = mount();
    act(() => { toggle.props.onKeyDown(key()); toggle.props.onBlur(); toggle.props.onKeyUp(key()); });
    act(() => { toggle.props.onKeyDown(key()); toggle.props.onKeyUp(key({ shiftKey: true })); });
    const repeat = key({ repeat: true });
    act(() => { toggle.props.onKeyDown(repeat); toggle.props.onKeyUp(key()); });
    expect(repeat.preventDefault).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("leaves Enter to RNW's existing onPress path", () => {
    const { toggle, onChange } = mount();
    const enter = key({ key: "Enter" });
    act(() => { toggle.props.onKeyDown(enter); toggle.props.onKeyUp(enter); });
    expect(enter.preventDefault).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    act(() => toggle.props.onPress());
    expect(onChange.mock.calls).toEqual([[true]]);
  });

  it.each(["ios", "android"])("adds no keyboard or blur props on %s", (os) => {
    const { toggle } = mount(os);
    for (const prop of ["onKeyDown", "onKeyUp", "onBlur"]) expect(toggle.props).not.toHaveProperty(prop);
  });
});

describe("settings tips layout", () => {
  it.each([320, 390])("keeps long mobile tips within %i points", (width) => {
    const mobileLook = { compact: true, tokens: { typography: { ui: { size: 16 } }, v2: {} } } as PageLook;
    const text = "生成标题时，对话摘录和标题提示词会发送给辅助 Agent。默认使用卡片的 Provider 和模型。";
    act(() => { renderer = TestRenderer.create(React.createElement(SettingsTips, { items: [{ label: "生成方式", text }], look: mobileLook, inset: true })); });
    const root = renderer.root.find((node) => node.type === ("View" as React.ElementType));
    const frames = measureHostTree(root, { width, wrapText: true });
    const body = renderer.root.find((node) => node.type === ("Text" as React.ElementType) && node.children.includes(text));
    const frame = frames.get(body)!;
    expect(frame.left + frame.width).toBeLessThanOrEqual(width);
    expect(frame.height).toBeGreaterThan(22);
  });
});
