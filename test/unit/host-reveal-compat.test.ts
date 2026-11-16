/**
 * Paseo 0.13 (getpaseo/paseo#7474) maps the old `client/react-native` entry onto
 * its UI runtime, which no longer carries `useRevealedText`; a live reply calling
 * the missing hook drew "Plugin failed" on iOS and Android. Paseo 0.16 deprecates
 * the entry and removes it after 2027-04-20. The plugin now carries the reveal
 * itself, so a host without the entry (or without the hook in it) still draws
 * live replies and thoughts.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined,
  usePaseo: () => ({}),
  useRpc: () => () => Promise.resolve(null),
  useWorkspace: () => null,
  useSettings: () => ({ data: undefined, status: "loading" }),
}));
// The 0.13 runtime behind the compatibility alias: everything but `useRevealedText`.
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
    TextInput: rn.TextInput,
    ScrollView: rn.ScrollView,
    FlatList: rn.ScrollView,
    Modal: rn.View,
    copyText: () => Promise.resolve(true),
    useToast: () => ({ show() {}, error() {} }),
  };
});
// A host without the old `client/react-native` entry, or with it but without the hook.
vi.mock("../../client/ui/legacy-host-entry", () => ({ LEGACY_HOST_ENTRY: {} }));
vi.mock("../../client/components/hub-live", () => ({ TimelineTailHub: () => null }));
vi.mock("../../client/state/preference-sync-slot", () => ({ PreferenceSyncSlot: () => null }));
vi.mock("../../client/components/selection-actions", () => ({ useSelectionActions: () => {} }));
vi.mock("../../client/components/markdown/markdown-view", async () => {
  const rn = await import("./helpers/rn-mock");
  return { MarkdownView: ({ text }: { text: string }) => React.createElement(rn.Text, null, text) };
});

const { LiveAssistantRenderer, LiveReasoningRenderer } = await import("../../client/live-renderers");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const theme = {
  colors: {
    surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc", foreground: "#111",
    foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff", statusSuccess: "#198754",
    statusWarning: "#a36a00", statusDanger: "#d92d20",
  },
};

function props<T>(kind: string, data: T, agentId: string): PluginTimelineItemProps<T> {
  return {
    agentId, theme, host: { id: "local", label: "Local" }, layout: { platform: "ios", compact: true },
    timestamp: new Date(1000), item: { type: "plugin", kind, version: 1, data },
  } as PluginTimelineItemProps<T>;
}

function texts(renderer: ReturnType<typeof TestRenderer.create>): string {
  return renderer.root.findAllByType("Text" as never).map((node) => String(node.props.children ?? "")).join("|");
}

describe("live renderers on a host without the old entry", () => {
  it("draws a streaming reply whole", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer,
        props("omp-assistant", { text: "Streaming reply so far", phase: "streaming" }, "reply")));
    });
    try {
      expect(texts(renderer)).toContain("Streaming reply so far");
    } finally {
      act(() => renderer.unmount());
    }
  });

  it("draws a streaming thought without throwing", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(LiveReasoningRenderer,
        props("omp-reasoning", { text: "Weighing the options", phase: "streaming" }, "thought")));
    });
    try {
      expect(renderer.toJSON()).not.toBeNull();
    } finally {
      act(() => renderer.unmount());
    }
  });
});
