import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => ({
  ...await import("./helpers/rn-mock"),
  Icon: (props: object) => React.createElement("Icon", props),
}));

import { Dimensions, StyleSheet } from "react-native";
import { CardMenuPopover } from "../../client/tasks/cards/card-menu-popover";
import { MenuBoundsContext } from "../../client/tasks/board/menu";
import { MENU } from "../../client/tasks/board/menu-model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const theme = { colors: { surface0: "#fff", surface1: "#fafafa", surface2: "#eee", border: "#ddd", foreground: "#111", foregroundMuted: "#777", accent: "#36f" } } as never;
let tree: ReturnType<typeof TestRenderer.create> | undefined;

afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  vi.restoreAllMocks();
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

describe("tablet long press menu scrolling", () => {
  it.each(["android", "ios"])("uses native scrolling within full %s touch bounds without JS scroll updates", (platform) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    vi.spyOn(Dimensions, "get").mockReturnValue({ width: 1200, height: 800, scale: 2, fontScale: 1 });
    const select = vi.fn();
    const close = vi.fn();
    const bounds = { current: { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(0, 150, 1200, 300) } } as unknown as React.RefObject<import("react-native").View>;
    act(() => {
      tree = TestRenderer.create(<MenuBoundsContext.Provider value={bounds}>
        <CardMenuPopover point={{ x: 500, y: 200 }} theme={theme} closeLabel="Close menu" onClose={close} sections={[{
          key: "actions", items: Array.from({ length: 30 }, (_, index) => ({ key: String(index), label: `Row ${index}`, onSelect: () => select(index) })),
        }]} />
      </MenuBoundsContext.Provider>, {
        createNodeMock: (element) => (element.props as { testID?: string }).testID === "task-card-menu-stage"
          ? { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(0, 0, 1200, 800) }
          : null,
      });
    });
    const host = (id: string) => tree!.root.find((node) => typeof node.type === "string" && node.props.testID === id);
    act(() => host("task-card-menu-stage").props.onLayout());
    const scroll = tree!.root.find((node) => (node.type as unknown) === "ScrollView");
    const frame = StyleSheet.flatten(host("task-card-menu-popover").props.style);
    expect(frame.height).toBe(284);
    expect(frame.top).toBeGreaterThanOrEqual(150);
    expect(Number(frame.top) + Number(frame.height)).toBeLessThanOrEqual(450);
    expect(StyleSheet.flatten(scroll.props.style).maxHeight).toBe(frame.height);
    expect(scroll.props.onScroll).toBeUndefined();
    expect(host("menu-panel").props.onResponderMove).toBeUndefined();
    expect(tree!.root.findAll((node) => typeof node.type === "string" && node.props.onMoveShouldSetResponderCapture)).toHaveLength(0);
    act(() => tree!.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "Row 29").props.onPress());
    expect(select).toHaveBeenCalledExactlyOnceWith(29);
    expect(close).toHaveBeenCalledOnce();
  });

  it("gives a short menu its actual height rather than an invisible zero-height native ancestor", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "android";
    act(() => {
      tree = TestRenderer.create(<CardMenuPopover point={{ x: 100, y: 100 }} theme={theme} closeLabel="Close" onClose={() => {}} sections={[{ key: "one", items: [{ key: "one", label: "One action" }] }]} />, {
        createNodeMock: (element) => (element.props as { testID?: string }).testID === "task-card-menu-stage"
          ? { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(0, 0, 1200, 800) }
          : null,
      });
    });
    act(() => tree!.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-menu-stage").props.onLayout());
    const frame = tree!.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-menu-popover").props.style;
    expect(frame.height).toBe(44 + MENU.padV * 2 + StyleSheet.hairlineWidth * 2);
    expect(tree!.root.findAll((node) => (node.type as unknown) === "ScrollView")).toHaveLength(0);
  });
});
