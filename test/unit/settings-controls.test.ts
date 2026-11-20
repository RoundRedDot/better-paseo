import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import { Section, SectionFooter, Segmented, ResetRow, SettingRow, SettingsTips, Toggle, type PageLook } from "../../client/settings-controls";
import { measureHostTree } from "./helpers/yoga-host-layout";
import { SETTINGS_STRINGS } from "../../client/i18n/settings-page-strings";

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

describe("wrapped settings choices", () => {
  it.each([320, 390])("keeps all options inside a %i-point mobile row", (width) => {
    const mobileLook = { compact: true, tokens: { foreground: "#000", foregroundMuted: "#555", fontUi: "System", typography: { ui: { size: 16 } }, v2: { border: "#aaa", surface0: "#fff", surface2: "#eee" } } } as PageLook;
    const options = ["System app", "Cursor", "VS Code", "Zed", "Sublime Text"].map((value) => ({ value, label: value }));
    act(() => { renderer = TestRenderer.create(React.createElement(Segmented, { label: "Open files with", value: "Zed", options, onChange() {}, look: mobileLook, wrap: true })); });
    const root = renderer.root.find((node) => node.props.accessibilityRole === "radiogroup");
    const frames = measureHostTree(root, { width, wrapText: true });
    const radios = root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "radio");
    for (const radio of radios) {
      const frame = frames.get(radio)!;
      expect(frame.left + frame.width).toBeLessThanOrEqual(width);
      expect(frame.width).toBeGreaterThanOrEqual(140);
    }
    expect(radios.map((radio) => radio.props.accessibilityState.checked)).toEqual([false, false, false, true, false]);
  });
});

describe("settings section footer", () => {
  it.each([[true, 320], [true, 390], [false, 280], [false, 440]])("aligns its labels with the rows (compact %s, width %i)", (compact, width) => {
    const look = { compact, tokens: { typography: { ui: { size: 16 } }, v2: { border: "#aaa" } } } as PageLook;
    const text = "生成标题时，对话摘录和标题提示词会发送给辅助 Agent。默认使用卡片的 Provider 和模型。";
    const footer = React.createElement(SectionFooter, { look, children:
      React.createElement(SettingsTips, { items: [{ label: "生成方式", text }], look }),
    });
    act(() => { renderer = TestRenderer.create(React.createElement(Section, { title: "设置", look, children: [
      React.createElement(SettingRow, { key: "row", title: "选项", look, first: true }),
      React.cloneElement(footer, { key: "footer" }),
    ] })); });
    const root = renderer.root.find((node) => node.type === ("View" as React.ElementType));
    const frames = measureHostTree(root, { width, wrapText: true });
    const textFrame = (value: string) => frames.get(renderer.root.find((node) => typeof node.type === "string" && node.children.includes(value)))!;
    const row = textFrame("选项");
    const label = textFrame("生成方式");
    const frame = textFrame(text);
    expect(label.left).toBe(row.left);
    expect(frame.left + frame.width).toBeLessThanOrEqual(width - 16);
    expect(frame.height).toBeGreaterThan(22);
    expect(frame.left === label.left).toBe(compact || width < 300);
    const rule = renderer.root.findByType(SectionFooter).find((node) =>
      typeof node.type === "string" && Array.isArray(node.props.style) && node.props.style.some((style: { borderTopWidth?: number } | null) => style?.borderTopWidth === 1),
    );
    expect(frames.get(rule)!.left).toBe(compact ? row.left : 1);
  });
});

describe("settings reset row", () => {
  it("requires confirmation and disarms on cancellation or after four seconds", async () => {
    vi.useFakeTimers();
    try {
      const onReset = vi.fn();
      const resetLook = { t: SETTINGS_STRINGS.en, tokens: { typography: { ui: { size: 14 } }, v2: {}, warning: "#a60" } } as PageLook;
      act(() => { renderer = TestRenderer.create(React.createElement(ResetRow, {
        look: resetLook, title: "Defaults", description: "Restore this group", confirmDescription: "Confirm restore",
        onReset,
      })); });
      const buttons = (label: string) => renderer.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === `${label} · Defaults`);
      const press = async (label: string) => { await act(async () => buttons(label)[0]!.props.onPress()); };
      expect(buttons("Reset")[0]!.findByType("Text" as never).children).toEqual(["Reset"]);
      await press("Reset");
      expect(onReset).not.toHaveBeenCalled();
      expect(buttons("Confirm")).toHaveLength(1);
      expect(buttons("Confirm")[0]!.findByType("Text" as never).children).toEqual(["Confirm"]);
      expect(buttons("Cancel")[0]!.findByType("Text" as never).children).toEqual(["Cancel"]);
      await press("Cancel");
      expect(onReset).not.toHaveBeenCalled();
      expect(buttons("Confirm")).toHaveLength(0);
      await press("Reset");
      act(() => { vi.advanceTimersByTime(3999); });
      expect(buttons("Confirm")).toHaveLength(1);
      act(() => { vi.advanceTimersByTime(1); });
      expect(buttons("Confirm")).toHaveLength(0);
      expect(onReset).not.toHaveBeenCalled();
      await press("Reset");
      await press("Confirm");
      expect(onReset).toHaveBeenCalledOnce();
      expect(buttons("Reset")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps confirmation busy while reset is pending and separates the touch targets", async () => {
    vi.useFakeTimers();
    try {
      let finish!: () => void;
      const onReset = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
      const onArmedChange = vi.fn();
      const resetLook = { compact: true, t: SETTINGS_STRINGS.zh, tokens: { typography: { ui: { size: 16 } }, v2: {} } } as PageLook;
      act(() => { renderer = TestRenderer.create(React.createElement(ResetRow, {
        look: resetLook, title: "翻译", description: "恢复本组默认值", confirmDescription: "确认恢复",
        onReset, onArmedChange,
      })); });
      const button = (label: string) => renderer.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === `${label} · 翻译`);
      act(() => button("重置").props.onPress());
      const cancel = button("取消");
      const confirm = button("确认");
      expect(cancel.findByType("Text" as never).children).toEqual(["取消"]);
      expect(confirm.findByType("Text" as never).children).toEqual(["确认"]);
      const actions = renderer.root.find((node) => (node.type as unknown) === "View" && "aria-busy" in node.props);
      const frames = measureHostTree(actions, { width: 288, textScale: 1.4 });
      const left = frames.get(cancel)!;
      const right = frames.get(confirm)!;
      expect(right.left - left.left - left.width).toBeGreaterThanOrEqual(cancel.props.hitSlop + confirm.props.hitSlop);
      act(() => confirm.props.onPress());
      expect(onReset).toHaveBeenCalledOnce();
      expect(onArmedChange.mock.calls).toEqual([[true]]);
      act(() => { vi.advanceTimersByTime(4000); });
      expect(button("确认").props.disabled).toBe(true);
      expect(button("取消").props.disabled).toBe(true);
      expect(actions.props["aria-busy"]).toBe(true);
      await act(async () => { finish(); });
      expect(onArmedChange.mock.calls).toEqual([[true], [false]]);
      expect(button("重置").props.disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
