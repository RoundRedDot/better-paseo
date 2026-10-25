import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import { Toggle, type PageLook } from "../../client/settings-controls";

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
