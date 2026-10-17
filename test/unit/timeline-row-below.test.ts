import React from "react";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { LiveReasoningPayload, LiveToolCallPayload } from "../../client/live-renderers";

// Every renderer body calls `useSelectionActions` once per render: that is
// the render count. Layout is asserted on the real root views.
const renders = vi.hoisted(() => ({ count: 0 }));
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
vi.mock("../../client/components/theme-tokens", async (original) => ({
  ...await original<object>(),
  useThemeTokens: () => ({}),
}));
vi.mock("../../client/components/selection-actions", () => ({ useSelectionActions() { renders.count++; } }));
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
const { noteRowGap, hostStacksRows } = await import("../../client/host-row-gap");
const { resetEnhancerPreferences, updateEnhancerPreferences } = await import("../../client/preferences");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => resetEnhancerPreferences());

const frame = {
  host: { id: "local", label: "Local" },
  layout: { compact: true, platform: "ios" as const },
  theme: { colors: {} } as never,
};

function tool(agentId: string, at: number) {
  const props: PluginTimelineItemProps<LiveToolCallPayload> = { ...frame, agentId, timestamp: new Date(at),
    item: { type: "plugin", kind: "omp-tool-call", version: 1, data: {
      name: "Read", callId: `call-${at}`, status: "completed", phase: "complete",
      detail: { type: "read", filePath: "/tmp/a.ts", content: "x" },
    } } };
  return React.createElement(LiveToolCallRenderer, props);
}

function thought(agentId: string, at: number) {
  const props: PluginTimelineItemProps<LiveReasoningPayload> = { ...frame, agentId, timestamp: new Date(at),
    item: { type: "plugin", kind: "omp-reasoning", version: 1, data: { text: "Considering", phase: "complete" } } };
  return React.createElement(LiveReasoningRenderer, props);
}

function marginBottom(renderer: ReturnType<typeof TestRenderer.create>) {
  return StyleSheet.flatten(renderer.root.findAllByType("View" as never)[0]!.props.style).marginBottom;
}

/**
 * The row under test with a reply always below it, and a row between them
 * that mounts and unmounts as the list's window moves: what lies below stays
 * the same, only whether a row comes first changes.
 */
async function windowMoves(agentId: string, element: React.ReactElement) {
  const forgetReply = registerTimelineEntry(agentId, 3000, "reply", "reply:below");
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await act(async () => { renderer = TestRenderer.create(element); });
  let forgetRow: (() => void) | null = null;
  const rowBelow = async (mounted: boolean) => {
    await act(async () => {
      if (mounted) forgetRow = registerTimelineEntry(agentId, 2000, "tool", undefined, undefined, "between");
      else { forgetRow?.(); forgetRow = null; }
    });
  };
  const done = async () => { await act(async () => { renderer.unmount(); forgetRow?.(); forgetReply(); }); };
  return { renderer, rowBelow, done };
}

describe("a row below that mounts and unmounts, on a host that spaces rows", () => {
  it("leaves a finished tool row alone and keeps its compensation", async () => {
    expect(hostStacksRows()).toBeNull();
    const { renderer, rowBelow, done } = await windowMoves("spacing-tool", tool("spacing-tool", 1000));
    try {
      expect(marginBottom(renderer)).toBe(-12);
      const before = renders.count;
      for (const mounted of [true, false, true, false]) await rowBelow(mounted);
      expect(renders.count - before).toBe(0);
      expect(marginBottom(renderer)).toBe(-12);
    } finally { await done(); }
  });

  it("leaves a finished thought alone and keeps its compensation", async () => {
    const { renderer, rowBelow, done } = await windowMoves("spacing-thought", thought("spacing-thought", 1000));
    try {
      expect(marginBottom(renderer)).toBe(-12);
      const before = renders.count;
      for (const mounted of [true, false, true, false]) await rowBelow(mounted);
      expect(renders.count - before).toBe(0);
      expect(marginBottom(renderer)).toBe(-12);
    } finally { await done(); }
  });

  it("follows the compact spacing preference when it changes at runtime", async () => {
    const { renderer, rowBelow, done } = await windowMoves("spacing-pref", tool("spacing-pref", 1000));
    try {
      await act(async () => updateEnhancerPreferences({ compactRowSpacing: false }));
      expect(marginBottom(renderer)).toBeUndefined();
      await rowBelow(true);
      expect(marginBottom(renderer)).toBeUndefined();
      await act(async () => updateEnhancerPreferences({ compactRowSpacing: true }));
      expect(marginBottom(renderer)).toBe(-12);
    } finally { await done(); resetEnhancerPreferences(); }
  });
});

describe("a row below that mounts and unmounts, on a host that stacks rows", () => {
  it("keeps following the row below: no compensation above a row, compensation above a reply", async () => {
    noteRowGap(0);
    expect(hostStacksRows()).toBe(true);
    for (const [agentId, element] of [["stacking-tool", tool("stacking-tool", 1000)], ["stacking-thought", thought("stacking-thought", 1000)]] as const) {
      const { renderer, rowBelow, done } = await windowMoves(agentId, element);
      try {
        expect(marginBottom(renderer)).toBe(-12);
        await rowBelow(true);
        expect(marginBottom(renderer)).toBeUndefined();
        await rowBelow(false);
        expect(marginBottom(renderer)).toBe(-12);
      } finally { await done(); }
    }
  });

  it("stops compensating when compact spacing is turned off, and resumes when it is turned on", async () => {
    const { renderer, rowBelow, done } = await windowMoves("stacking-pref", tool("stacking-pref", 1000));
    try {
      await act(async () => updateEnhancerPreferences({ compactRowSpacing: false }));
      expect(marginBottom(renderer)).toBeUndefined();
      await act(async () => updateEnhancerPreferences({ compactRowSpacing: true }));
      expect(marginBottom(renderer)).toBe(-12);
      await rowBelow(true);
      expect(marginBottom(renderer)).toBeUndefined();
    } finally { await done(); resetEnhancerPreferences(); }
  });
});
