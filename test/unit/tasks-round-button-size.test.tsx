import React from "react";
import { describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const react = await import("react");
  const rn = await import("./helpers/rn-mock");
  return { Icon: (props: Record<string, unknown>) => react.createElement("Icon", props), ScrollView: rn.ScrollView, copyText: async () => {}, useToast: () => ({ show() {}, error() {} }) };
});
import "./helpers/quiet-renderer";
import TestRenderer, { act } from "react-test-renderer";
import { RoundButton } from "../../client/tasks/board/board-parts";
import type { PluginTheme } from "@getpaseo/plugin";

describe("RoundButton", () => {
  it("renders an explicitly sized circle and icon independently", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    const theme = { colors: { border: "gray", foreground: "black" } } as PluginTheme;
    act(() => { renderer = TestRenderer.create(<RoundButton icon="Bolt" label="Settings" theme={theme} onPress={() => {}} size={26} iconSize={16} />); });
    const circle = renderer.root.findAll((node) => (node.type as unknown) === "View").find((node) => node.props.style?.borderRadius === 13);
    expect(circle?.props.style).toMatchObject({ width: 26, height: 26 });
    expect(renderer.root.find((node) => (node.type as unknown) === "Icon").props.size).toBe(16);
    act(() => renderer.unmount());
  });
});
