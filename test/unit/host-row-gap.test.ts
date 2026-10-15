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
const { registerTimelineEntry } = await import("../../client/timeline-order");
const { classifyRowGap, hostStacksRows, noteRowGap, resetHostRowGap } = await import("../../client/host-row-gap");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AGENT = "host-gap-agent";

function tool(callId: string, at: number, path = `/tmp/${callId}.ts`) {
  const props: PluginTimelineItemProps<LiveToolCallPayload> = {
    agentId: AGENT,
    host: { id: "local", label: "Local" },
    layout: { compact: false, platform: "web" },
    theme: { colors: {} } as never,
    timestamp: new Date(at),
    item: { type: "plugin", kind: "omp-tool-call", version: 1, data: {
      name: "Edit", callId, status: "completed", phase: "complete",
      detail: { type: "edit", filePath: path },
    } },
  };
  return React.createElement(LiveToolCallRenderer, { ...props, key: callId });
}

function margins(renderer: ReturnType<typeof TestRenderer.create>) {
  return renderer.root.findAll((node) => (node.type as unknown) === "View")
    .map((view) => StyleSheet.flatten(view.props.style).marginBottom);
}

/** Row roots drawn 40 tall at these tops, in the order they are created. */
function drawnAt(...tops: number[]) {
  let created = 0;
  return () => {
    const top = tops[created++] ?? 0;
    return { measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) => callback(0, top, 300, 40) };
  };
}

describe("the host's gap between rows", () => {
  it("reads a stacking host off a row pulled into the one above, and a spacing host off the 4pt left", async () => {
    expect(classifyRowGap(-12)).toBe(true);
    expect(classifyRowGap(0)).toBe(true);
    expect(classifyRowGap(4)).toBe(false);
    expect(classifyRowGap(16)).toBe(false);
    expect(classifyRowGap(60)).toBeNull();
    expect(classifyRowGap(8)).toBeNull();
  });

  it("stops taking a row's gap back above another row once the host is seen stacking them", async () => {
    resetHostRowGap();
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      tool("stack-1", 1000), tool("stack-2", 1001)), { createNodeMock: drawnAt(100, 128) }); });
    expect(hostStacksRows()).toBe(true);
    expect(margins(renderer)).toEqual([undefined, undefined]);
    await act(async () => renderer.unmount());
  });

  it("keeps taking it back on a host that spaces plugin items", async () => {
    resetHostRowGap();
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      tool("space-1", 2000), tool("space-2", 2001)), { createNodeMock: drawnAt(100, 144) }); });
    expect(hostStacksRows()).toBe(false);
    expect(margins(renderer)).toEqual([-12, undefined]);
    await act(async () => renderer.unmount());
  });

  it("decides nothing from rows a native item or a long gap separates", async () => {
    resetHostRowGap();
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      tool("apart-1", 3000), tool("apart-2", 3001)), { createNodeMock: drawnAt(100, 200) }); });
    expect(hostStacksRows()).toBeNull();
    expect(margins(renderer)).toEqual([-12, undefined]);
    await act(async () => renderer.unmount());
  });

  it("still takes the gap back above a reply on a stacking host, where the host keeps 16pt", async () => {
    resetHostRowGap();
    noteRowGap(0);
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      tool("reply-1", 4000), tool("reply-2", 4001))); });
    expect(margins(renderer)).toEqual([undefined, undefined]);
    let forget!: () => void;
    await act(async () => { forget = registerTimelineEntry(AGENT, 4002, "reply"); });
    expect(margins(renderer)).toEqual([undefined, -12]);
    await act(async () => { renderer.unmount(); forget(); });
  });

  it("gives a merged row's gap back by what follows its last member on a stacking host", async () => {
    resetHostRowGap();
    noteRowGap(0);
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      tool("merged-1", 5000, "/tmp/same.ts"), tool("merged-2", 5001, "/tmp/same.ts"), tool("after", 5002))); });
    expect(margins(renderer)).toEqual([undefined, undefined, undefined]);
    await act(async () => renderer.update(React.createElement(React.Fragment, null,
      tool("merged-1", 5000, "/tmp/same.ts"), tool("merged-2", 5001, "/tmp/same.ts"))));
    let forget!: () => void;
    await act(async () => { forget = registerTimelineEntry(AGENT, 5003, "reply"); });
    expect(margins(renderer)).toEqual([-12, undefined]);
    await act(async () => { renderer.unmount(); forget(); });
    resetHostRowGap();
  });
});
