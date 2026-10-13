import { describe, expect, it, vi } from "vitest";

// Tool rows sit one step behind the prose at rest and come back to full
// contrast on hover, press or when opened (docs/prototypes/quiet-tool-rows.md).

vi.mock("react-native", async () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined, useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null), usePaseo: () => ({}),
  useSettings: () => ({ status: "loading" }),
}));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, ScrollView: rn.ScrollView, TextInput: rn.TextInput, copyText: async () => {}, useToast: () => ({ show() {}, error() {} }) };
});

const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { DisclosureHeader } = await import("../../client/ui/disclosure-header");
const React = await import("react");
await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { StyleSheet } = await import("./helpers/rn-mock");
const { ToolCallout } = await import("../../client/components/tool-callouts");
const { classifyTool } = await import("../../client/tools/classify");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;


const tokens = buildThemeTokens({
  surface0: "#fff", surface1: "#f6f6f7", surface2: "#ededef", border: "#e2e2e6",
  foreground: "#18181b", foregroundMuted: "#62626b", accent: "#2563eb", accentForeground: "#fff",
  statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d92d20",
});
const calls = ["first", "second"].map((callId, index) => classifyTool({
  callId, name: "Edit", status: index ? "failed" : "completed", error: index ? "Permission denied" : null,
  detail: { type: "edit", filePath: "src/a.ts", unifiedDiff: "@@ -1 +1 @@\n-old\n+" + callId },
}));

describe("grouped tool card presentation", () => {
  it("shows a circular count, exposes it to accessibility, and preserves both expanded calls", () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(ToolCallout, {
      data: calls[0]!, groupCalls: calls, tokens,
    })); });
    const header = renderer.root.findByType(DisclosureHeader);
    expect(header.props.count).toBe(2);
    const badge = renderer.root.findAll((node) => (node.type as unknown) === "Text" && node.props.children === 2)[0]!;
    let parent = badge.parent;
    while (parent && StyleSheet.flatten(parent.props.style).width !== 22) parent = parent.parent;
    expect(parent).not.toBeNull();
    const circle = StyleSheet.flatten(parent!.props.style);
    expect(circle.width).toBe(circle.height);
    expect(circle.borderRadius).toBe(circle.width as number / 2);
    const button = renderer.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel?.includes("2 operations"))[0]!;
    expect(button).toBeDefined();
    expect(renderer.root.findAllByType(ToolCallout)).toHaveLength(1);
    act(() => button.props.onPress());
    const children = renderer.root.findAllByType(ToolCallout).slice(1);
    expect(children.map((child) => child.props.data.callId)).toEqual(["first", "second"]);
    expect(children.every((child) => child.props.defaultExpanded)).toBe(true);
    act(() => renderer.unmount());
  });
});
