import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { LiveToolCallPayload } from "../../client/live-renderers";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: () => null,
  useRevealedText: (text: string) => text,
}));
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined,
  useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null),
}));
vi.mock("../../client/preferences", async (original) => ({
  ...await original<object>(),
  useEnhancerPreferences: () => ({ compactRowSpacing: true, uiFont: "system" }),
}));
vi.mock("../../client/components/theme-tokens", async (original) => ({
  ...await original<object>(),
  useThemeTokens: () => ({}),
}));
vi.mock("../../client/components/selection-actions", () => ({ useSelectionActions() {} }));
vi.mock("../../client/components/tool-callouts", () => ({ ToolCallout: () => null }));
vi.mock("../../client/components/hub-live", () => ({ TimelineTailHub: () => null }));
vi.mock("../../client/state/preference-sync-slot", () => ({ PreferenceSyncSlot: () => null }));
vi.mock("../../client/state/disclosure-store", async (original) => ({
  ...await original<object>(),
  useDisclosure: () => [false, () => {}],
}));
vi.mock("../../client/ui/path-text", async (original) => ({
  ...await original<object>(),
  usePathContextValue: () => ({ roots: [], mode: "relative" }),
}));
vi.mock("../../client/image-file", async (original) => ({
  ...await original<object>(),
  useImageFile: () => null,
}));

await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { StyleSheet } = await import("./helpers/rn-mock");
const { LiveToolCallRenderer } = await import("../../client/live-renderers");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function tool(callId: string, at: number, status = "running") {
  const props: PluginTimelineItemProps<LiveToolCallPayload> = {
    agentId: "tool-spacing-agent",
    host: { id: "local", label: "Local" },
    layout: { compact: false, platform: "web" },
    theme: { colors: {} } as never,
    timestamp: new Date(at),
    item: { type: "plugin", kind: "omp-tool-call", version: 1, data: {
      name: "Read", callId, status, phase: status === "running" ? "streaming" : "complete",
      detail: { type: "read", filePath: `/tmp/${callId}.png` },
    } },
  };
  return React.createElement(LiveToolCallRenderer, { ...props, key: callId });
}

function margins(renderer: ReturnType<typeof TestRenderer.create>) {
  return renderer.root.findAll((node) => (node.type as unknown) === "View")
    .map((view) => StyleSheet.flatten(view.props.style).marginBottom);
}

describe("tool row spacing during streaming", () => {
  it("keeps the first Read compact when its completion timestamp passes the next Read", () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      tool("pd-current-drawer", 1000), tool("pd-golden-drawer", 1001))); });
    expect(margins(renderer)).toEqual([-12, undefined]);
    act(() => { renderer.update(React.createElement(React.Fragment, null,
      tool("pd-current-drawer", 1002, "completed"), tool("pd-golden-drawer", 1001))); });
    expect(margins(renderer)).toEqual([-12, undefined]);
    act(() => { renderer.update(React.createElement(React.Fragment, null,
      tool("pd-current-drawer", 1002, "completed"), tool("pd-golden-drawer", 1003, "completed"))); });
    expect(margins(renderer)).toEqual([-12, undefined]);
    act(() => renderer.unmount());
  });

  it("keeps the newest call's bottom spacing through completion and until another call arrives", () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      tool("newest", 1000))); });
    expect(margins(renderer)).toEqual([undefined]);
    act(() => { renderer.update(React.createElement(React.Fragment, null,
      tool("newest", 1002, "completed"))); });
    expect(margins(renderer)).toEqual([undefined]);
    act(() => { renderer.update(React.createElement(React.Fragment, null,
      tool("newest", 1002, "completed"), tool("next", 1003))); });
    expect(margins(renderer)).toEqual([-12, undefined]);
    act(() => { renderer.update(React.createElement(React.Fragment, null,
      tool("newest", 1002, "completed"))); });
    expect(margins(renderer)).toEqual([undefined]);
    act(() => renderer.unmount());
  });
});
