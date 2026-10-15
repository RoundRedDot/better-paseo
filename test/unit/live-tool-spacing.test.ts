import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { LiveReasoningPayload, LiveToolCallPayload } from "../../client/live-renderers";

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
vi.mock("../../client/components/reasoning-trace", () => ({ ReasoningCard: () => null }));
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
const { LiveReasoningRenderer, LiveToolCallRenderer } = await import("../../client/live-renderers");
const { registerTimelineEntry } = await import("../../client/timeline-order");
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

function thought(platform: "ios" | "android" | "web", text = "Allocating an ID", phase = "streaming") {
  const props: PluginTimelineItemProps<LiveReasoningPayload> = {
    agentId: "tool-spacing-agent",
    host: { id: "local", label: "Local" },
    layout: { compact: true, platform },
    theme: { colors: {} } as never,
    timestamp: new Date(1001),
    item: { type: "plugin", kind: "omp-reasoning", version: 1, data: { text, phase } },
  };
  return React.createElement(LiveReasoningRenderer, { ...props, key: "thought" });
}

describe("mobile streaming thought spacing", () => {
  it.each(["ios", "android"] as const)("reserves space above a %s thought across chunks, then releases it on completion", async (platform) => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    const render = (text: string, phase = "streaming") => React.createElement(React.Fragment, null,
      tool("before-thought", 1000, "completed"), thought(platform, text, phase));
    const thoughtStyle = () => StyleSheet.flatten(
      renderer.root.findAll((node) => (node.type as unknown) === "View")[1]!.props.style,
    );
    await act(async () => { renderer = TestRenderer.create(render("Allocating an ID")); });
    try {
      expect(thoughtStyle().paddingTop).toBe(8);
      expect(margins(renderer)).toEqual([-12, undefined]);
      await act(async () => { renderer.update(render("Allocating an ID for the block")); });
      expect(thoughtStyle().paddingTop).toBe(8);
      await act(async () => { renderer.update(render("Allocating an ID for the block", "complete")); });
      expect(thoughtStyle().paddingTop).toBeUndefined();
      expect(margins(renderer)).toEqual([-12, undefined]);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it("keeps web thought spacing unchanged even in a compact layout", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(thought("web")); });
    try {
      const root = renderer.root.findByType("View" as never);
      expect(StyleSheet.flatten(root.props.style).paddingTop).toBeUndefined();
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

describe("tool row spacing during streaming", () => {
  it("keeps the first Read compact when its completion timestamp passes the next Read", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      tool("pd-current-drawer", 1000), tool("pd-golden-drawer", 1001))); });
    expect(margins(renderer)).toEqual([-12, undefined]);
    await act(async () => { renderer.update(React.createElement(React.Fragment, null,
      tool("pd-current-drawer", 1002, "completed"), tool("pd-golden-drawer", 1001))); });
    expect(margins(renderer)).toEqual([-12, undefined]);
    await act(async () => { renderer.update(React.createElement(React.Fragment, null,
      tool("pd-current-drawer", 1002, "completed"), tool("pd-golden-drawer", 1003, "completed"))); });
    expect(margins(renderer)).toEqual([-12, undefined]);
    await act(async () => renderer.unmount());
  });

  it("keeps the newest call's bottom spacing through completion and until another call arrives", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      tool("newest", 1000))); });
    expect(margins(renderer)).toEqual([undefined]);
    await act(async () => { renderer.update(React.createElement(React.Fragment, null,
      tool("newest", 1002, "completed"))); });
    expect(margins(renderer)).toEqual([undefined]);
    await act(async () => { renderer.update(React.createElement(React.Fragment, null,
      tool("newest", 1002, "completed"), tool("next", 1003))); });
    expect(margins(renderer)).toEqual([-12, undefined]);
    await act(async () => { renderer.update(React.createElement(React.Fragment, null,
      tool("newest", 1002, "completed"))); });
    expect(margins(renderer)).toEqual([undefined]);
    await act(async () => renderer.unmount());
  });
});

describe("calls sent together in one message", () => {
  it("gives back the gap of every running call but the lowest of one millisecond", async () => {
    // Parallel calls leave the daemon in one burst and share a stamp; their
    // kind cannot order them, so where each is drawn does.
    let created = 0;
    const createNodeMock = () => {
      const y = 100 * ++created;
      return { measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) => callback(0, y, 300, 40) };
    };
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      tool("parallel-1", 8000), tool("parallel-2", 8000)), { createNodeMock }); });
    expect(margins(renderer)).toEqual([-12, undefined]);
    await act(async () => { renderer.update(React.createElement(React.Fragment, null,
      tool("parallel-1", 8003, "completed"), tool("parallel-2", 8000))); });
    expect(margins(renderer)).toEqual([-12, undefined]);
    await act(async () => renderer.unmount());
  });
});

describe("tool row spacing in replayed history", () => {
  it("compensates every finished call when the whole history shares one millisecond", async () => {
    // Grok's history after the daemon reloads it: no provider times, so
    // calls and the thoughts between them carry the same stamp.
    let renderer!: ReturnType<typeof TestRenderer.create>;
    const forget = registerTimelineEntry("tool-spacing-agent", 9000, "thought", "between");
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      tool("replayed-1", 9000, "completed"), tool("replayed-2", 9000, "completed"))); });
    expect(margins(renderer)).toEqual([-12, -12]);
    await act(async () => { renderer.unmount(); forget(); });
  });

  it("keeps the gap under the call a replayed history ends on", async () => {
    // Each row's root is the only view it draws here, so views are placed in
    // the order they are created: the second call is the lowest item.
    let created = 0;
    const createNodeMock = () => {
      const y = 100 * ++created;
      return { measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) => callback(0, y, 300, 40) };
    };
    let renderer!: ReturnType<typeof TestRenderer.create>;
    const forget = registerTimelineEntry("tool-spacing-agent", 9500, "thought", "between", () => ({ left: 0, top: 0, width: 300, height: 0 }));
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      tool("ending-1", 9500, "completed"), tool("ending-2", 9500, "completed")), { createNodeMock }); });
    expect(margins(renderer)).toEqual([-12, undefined]);
    await act(async () => { renderer.unmount(); forget(); });
  });
});
