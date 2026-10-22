/**
 * The desktop hover panel with block details on: "Open in panel" left of
 * maximize moves the row's preview into the side panel. With the flag off, or
 * for a preview with no block behind it, the bar is as it was.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: "Icon" }));
vi.mock("../../client/ui/use-input-capabilities", () => ({ useInputCapabilities: () => ({ hover: true, native: false }), noteHover: vi.fn() }));
vi.mock("../../client/web", () => ({
  bindRowHover: () => () => {},
  bindPreviewMaximize: () => () => {},
  dropSelectionIn: () => {},
  bindPreviewPointer: () => () => {},
  watchNextPointerMove: () => () => {},
  watchPointerOutside: () => () => {},
  openPreviewLayer: () => () => {},
}));
import { HoverPreview, HoverPreviewHeader, useHoverPreview } from "../../client/ui/hover-preview";
import { BlockPlacementContext } from "../../client/details/contracts";
import { detailsApi } from "../../client/details/details-store";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });

let preview!: ReturnType<typeof useHoverPreview>;
let renderer: ReturnType<typeof TestRenderer.create> | undefined;
beforeEach(() => {
  resetEnhancerPreferences();
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

function Row({ memoryKey, agentId }: { memoryKey?: string; agentId?: string }) {
  preview = useHoverPreview(true, memoryKey, agentId ? { agentId } : undefined);
  return React.createElement(React.Fragment, null, preview.open ? React.createElement(HoverPreview, { preview, tokens,
    children: React.createElement(HoverPreviewHeader, { tokens, iconLabel: "Bash" }) }) : null);
}

function open(element: React.ReactElement) {
  act(() => { renderer = TestRenderer.create(element, { createNodeMock: () => ({ addEventListener() {}, removeEventListener() {} }) }); });
  act(() => preview.pop!());
  return renderer!.root;
}
const labels = (root: TestRenderer.ReactTestInstance) => root.findAll((node) => (node.type as unknown) === "Pressable")
  .map((node) => node.props.accessibilityLabel as string);
const placed = (child: React.ReactElement) => React.createElement(BlockPlacementContext.Provider,
  { value: { agentId: "agent-1", at: 1, kind: "tool" } }, child);

describe("hover panel: open in panel", () => {
  it("is not offered while block details is off", () => {
    updateEnhancerPreferences({ blockDetails: false });
    const root = open(placed(React.createElement(Row, { memoryKey: "agent-1:tool:1:preview" })));
    expect(labels(root)).toContain("Maximize preview");
    expect(labels(root)).not.toContain("Open in panel");
  });

  it("sits left of maximize with block details on, and moves the preview into the side panel", () => {
    updateEnhancerPreferences({ blockDetails: true });
    const opened = vi.spyOn(detailsApi, "open");
    const root = open(placed(React.createElement(Row, { memoryKey: "agent-1:tool:1:preview" })));
    const names = labels(root);
    expect(names.indexOf("Open in panel")).toBe(names.indexOf("Maximize preview") - 1);
    act(() => root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Open in panel").props.onPress());
    expect(opened).toHaveBeenCalledWith("agent-1", "agent-1:tool:1:preview", { form: "side" });
    expect(preview.open).toBe(false);
  });

  it("takes the agent from the caller when no placement is given", () => {
    updateEnhancerPreferences({ blockDetails: true });
    const opened = vi.spyOn(detailsApi, "open");
    const root = open(React.createElement(Row, { memoryKey: "k", agentId: "agent-2" }));
    act(() => root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Open in panel").props.onPress());
    expect(opened).toHaveBeenCalledWith("agent-2", "k", { form: "side" });
  });

  it("is not offered without a block to open: no memory key, or no agent", () => {
    updateEnhancerPreferences({ blockDetails: true });
    expect(labels(open(placed(React.createElement(Row, {}))))).not.toContain("Open in panel");
    act(() => renderer?.unmount());
    expect(labels(open(React.createElement(Row, { memoryKey: "k" })))).not.toContain("Open in panel");
  });
});
