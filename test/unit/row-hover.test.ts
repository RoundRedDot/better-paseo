import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";
vi.mock("react-native", async () => ({ ...await import("./helpers/rn-mock"), Platform: { OS: "web" } }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: "Icon" }));
vi.mock("../../client/ui/use-input-capabilities", () => ({ noteHover() {}, useInputCapabilities: () => ({ hover: true, touch: false }) }));
import { DisclosureHeader } from "../../client/ui/disclosure-header";
import { buildThemeTokens } from "../../client/components/theme-tokens";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc", foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff", statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });
let renderer: ReturnType<typeof TestRenderer.create>;
let node: EventTarget & { ownerDocument: EventTarget & { defaultView: EventTarget; elementFromPoint: () => unknown }; contains: (target: unknown) => boolean };
let hit: unknown;
const child = {};
function fire(target: EventTarget, type: string, eventTarget?: unknown, pointerType = "mouse") {
  const event = new Event(type);
  Object.assign(event, { pointerType, clientX: 10, clientY: 10 });
  if (eventTarget) Object.defineProperty(event, "target", { value: eventTarget });
  act(() => { target.dispatchEvent(event); });
}
const row = () => renderer.root.findByType("Pressable" as never);
const lit = () => (row().props.style as unknown[]).some(style => (style as { backgroundColor?: string })?.backgroundColor === tokens.v2.surface1);
function enter() {
  // Both versions enter the real row; the regression begins after entry.
  if (row().props.onMouseEnter) act(() => row().props.onMouseEnter());
  else fire(node, "pointerenter");
  expect(lit()).toBe(true);
  expect(renderer.root.findAllByType("Action" as never)).toHaveLength(1);
}
function expectRest() {
  expect(lit()).toBe(false);
  expect(renderer.root.findAllByType("Action" as never)).toHaveLength(0);
  expect(renderer.root.findAllByType("Icon" as never)).toHaveLength(0);
}
beforeEach(() => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  const view = new EventTarget();
  const doc = Object.assign(new EventTarget(), { defaultView: view, elementFromPoint: () => hit });
  node = Object.assign(new EventTarget(), { ownerDocument: doc, contains: (target: unknown) => target === node || target === child });
  hit = node;
  act(() => { renderer = TestRenderer.create(React.createElement(DisclosureHeader, { expanded: false, onToggle() {}, tokens, verb: "Edit", target: "src/a.ts", actions: React.createElement("Action") }), { createNodeMock: () => node }); });
});
afterEach(() => {
  act(() => renderer.unmount());
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});
describe("row hover recovery", () => {
  it("clears background, chevron and actions on window blur without mouseleave", () => {
    enter();
    fire(node.ownerDocument.defaultView, "blur");
    expectRest();
  });
  it("recovers a lost leave on the next pointer move outside the row", () => {
    enter();
    fire(node.ownerDocument, "pointermove", child);
    expect(lit()).toBe(true);
    fire(node.ownerDocument, "pointermove", {});
    expectRest();
  });
  it("keeps hover on child actions but clears it when scrolling moves the row away", () => {
    enter();
    hit = child;
    fire(node.ownerDocument.defaultView, "scroll");
    expect(lit()).toBe(true);
    hit = null;
    fire(node.ownerDocument.defaultView, "scroll");
    expectRest();
  });
  it("can re-enter after blur and leave normally", () => {
    enter();
    fire(node.ownerDocument.defaultView, "blur");
    expectRest();
    fire(node, "pointermove");
    expect(lit()).toBe(true);
    fire(node, "pointerleave");
    expectRest();
  });
  it("ignores touch pointer entry", () => {
    fire(node, "pointerenter", undefined, "touch");
    expectRest();
  });
  it("shows only its actions on hover, and takes no presses, when the row has nothing to open", () => {
    act(() => renderer.update(React.createElement(DisclosureHeader, { expanded: true, inert: true, onToggle() {}, tokens, verb: "Agent", target: "截图并读取界面", actions: React.createElement("Action"), previewContent: () => "body" })));
    fire(node, "pointerenter");
    expect(lit()).toBe(false);
    expect(renderer.root.findAllByType("Icon" as never)).toHaveLength(0);
    expect(renderer.root.findAllByType("Action" as never)).toHaveLength(1);
    fire(node, "pointerleave");
    expectRest();
    expect(row().props.disabled).toBe(true);
    expect(row().props.accessibilityRole).toBeUndefined();
  });
  it("lets the mouse select the words of a row that has nothing to open", () => {
    const texts = () => renderer.root.findAllByType("Text" as never).filter((text) => typeof text.props.children === "string");
    const userSelect = (text: { props: { style?: unknown } }) =>
      ([text.props.style].flat(3) as Array<{ userSelect?: string } | null>).reduce<string | undefined>((value, style) => style?.userSelect ?? value, undefined);
    expect(texts().every((text) => text.props.selectable === false)).toBe(true);
    act(() => renderer.update(React.createElement(DisclosureHeader, { expanded: false, inert: true, onToggle() {}, tokens, verb: "Task", target: "选文件后取消并切回主题" })));
    const [target] = texts();
    expect(target!.props.selectable).toBe(true);
    expect(userSelect(target!)).toBe("text");
    expect(target!.props.children).toBe("选文件后取消并切回主题");
  });
  it("removes active listeners on unmount", () => {
    enter();
    const remove = vi.spyOn(node.ownerDocument, "removeEventListener");
    act(() => renderer.unmount());
    expect(remove).toHaveBeenCalledWith("pointermove", expect.any(Function), true);
  });
});
