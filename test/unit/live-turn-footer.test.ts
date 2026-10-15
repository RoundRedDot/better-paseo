import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { PaseoAgentTimelineHandle, PaseoProviderModelsResult } from "@getpaseo/client";
import "./helpers/quiet-renderer";
import { timelineEntry as entry, timelinePage as page, type TimelinePage } from "./helpers/turn-timeline";

const runtime = vi.hoisted(() => ({
  agent: { status: "idle", cwd: "/workspace", provider: "codex", model: "sol", thinkingOptionId: "medium" },
  listeners: new Set<() => void>(),
  api: {} as unknown,
  copyText: vi.fn(async (_text: string) => {}),
}));

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: (_id: string, selector: (agent: typeof runtime.agent) => unknown) => React.useSyncExternalStore(
    (listener) => { runtime.listeners.add(listener); return () => { runtime.listeners.delete(listener); }; },
    () => selector(runtime.agent),
  ),
  usePaseo: () => runtime.api,
  useRpc: () => () => Promise.resolve(null),
  useWorkspace: () => null,
  useSettings: () => ({ data: undefined, status: "loading" }),
}));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
    TextInput: rn.TextInput, ScrollView: rn.ScrollView, FlatList: rn.ScrollView, Modal: rn.View,
    useRevealedText: (text: string) => text, copyText: runtime.copyText,
    useToast: () => ({ show() {}, error() {} }) };
});
vi.mock("../../client/components/hub-live", () => ({ TimelineTailHub: () => null }));
vi.mock("../../client/state/preference-sync-slot", () => ({ PreferenceSyncSlot: () => null }));
vi.mock("../../client/components/selection-actions", () => ({ useSelectionActions: () => {} }));
vi.mock("../../client/components/markdown/markdown-view", async () => {
  const rn = await import("./helpers/rn-mock");
  return { MarkdownView: ({ text }: { text: string }) => React.createElement(rn.Text, null, text) };
});

import { LiveAssistantRenderer, type LiveAssistantPayload } from "../../client/live-renderers";
import { AssistantFooter } from "../../client/components/turn-footer";
import { assistantRows } from "../../client/assistant-transform";
import { formatFullStamp } from "../../client/ui/time";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const theme = { colors: { surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" } };
const catalog: PaseoProviderModelsResult = { provider: "codex", fetchedAt: "now", requestId: "r",
  models: [{ provider: "codex", id: "sol", label: "GPT-6.1-Sol", thinkingOptions: [{ id: "medium", label: "Medium" }] }] };

beforeEach(() => { vi.clearAllMocks(); runtime.agent.status = "idle"; });
afterEach(() => { expect(runtime.listeners.size).toBe(0); });

describe.each(["web", "ios"] as const)("completed-turn toolbar on %s", (platform) => {
  it("loads canonical numbering when details open and keeps it on reopening", async () => {
    const tail = page([
      entry({ type: "user_message", text: "second prompt" }, 4, 4000, "two"),
      entry({ type: "assistant_message", text: "second answer" }, 5, 5000, "two"),
      entry({ type: "reasoning", text: "later activity" }, 6, 6000, "two"),
    ], { hasOlder: true });
    const refetch = vi.fn<PaseoAgentTimelineHandle["refetch"]>(async (request) => request?.direction === "before"
      ? page([entry({ type: "user_message", text: "first prompt" }, 1, 1000, "one"),
        entry({ type: "assistant_message", text: "first answer" }, 3, 3000, "one")]) : tail);
    const release = Object.assign(vi.fn(), { ready: Promise.resolve(), subscriptionId: "s", release: async () => {} });
    runtime.api = { agents: { ref: () => ({ timeline: { refetch, subscribe: () => release } }) },
      providers: { listModels: async () => catalog } };
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer, {
      agentId: "numbering", theme, host: { id: "local", label: "Local" }, layout: { platform, compact: true },
      timestamp: new Date(5000), item: { type: "plugin", kind: "omp-assistant", version: 1,
        data: { text: "second answer", phase: "complete" } },
    } satisfies PluginTimelineItemProps<LiveAssistantPayload>)); });
    try {
      const toolbar = () => renderer.root.findAllByType("Pressable" as never)
        .find((node) => node.props.testID === "footer-toolbar")!;
      const title = () => renderer.root.findAllByType("Text" as never)
        .find((node) => node.props.accessibilityRole === "header")!.props.children;
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(renderer.root.findByType(AssistantFooter).props.turnNumber).toBeUndefined();
      await act(async () => { toolbar().props.onLongPress(); });
      expect(title()).toBe("Turn 2/2 details");
      expect(renderer.root.findByType(AssistantFooter).props.at.getTime()).toBe(6000);
      expect(refetch).toHaveBeenCalledTimes(3);
      const close = renderer.root.findAllByType("Pressable" as never)
        .find((node) => node.props.accessibilityLabel === "Close preview")!;
      act(() => close.props.onPress());
      await act(async () => { toolbar().props.onLongPress(); });
      expect(title()).toBe("Turn 2/2 details");
      expect(refetch).toHaveBeenCalledTimes(3);
    } finally { act(() => renderer.unmount()); }
  });

  it("shows the turn end time while matching the reply by its original timestamp", async () => {
    const startedAt = new Date(2026, 9, 16, 9, 1, 0).getTime();
    const replyAt = startedAt + 10000;
    const endedAt = startedAt + 82000;
    const refetch = vi.fn<PaseoAgentTimelineHandle["refetch"]>(async () => page([
      entry({ type: "user_message", text: "prompt" }, 1, startedAt, "one"),
      entry({ type: "assistant_message", text: "answer" }, 2, replyAt, "one"),
      entry({ type: "reasoning", text: "later activity" }, 3, endedAt, "one"),
    ]));
    const release = Object.assign(vi.fn(), { ready: Promise.resolve(), subscriptionId: "s", release: async () => {} });
    runtime.api = { agents: { ref: () => ({ timeline: { refetch, subscribe: () => release } }) },
      providers: { listModels: async () => catalog } };
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer, {
      agentId: "end-time", theme, host: { id: "local", label: "Local" }, layout: { platform, compact: platform !== "web" },
      timestamp: new Date(replyAt), item: { type: "plugin", kind: "omp-assistant", version: 1,
        data: { text: "answer", phase: "complete" } },
    } satisfies PluginTimelineItemProps<LiveAssistantPayload>)); });
    try {
      const footer = renderer.root.findByType(AssistantFooter);
      expect(footer.props.at.getTime()).toBe(endedAt);
      expect(footer.props.startedAt).toBe(startedAt);
      expect(footer.props.durationMs).toBe(82000);
      expect(footer.findByProps({ accessibilityLabel: formatFullStamp(new Date(endedAt)) })).toBeDefined();
      expect(refetch).toHaveBeenCalledTimes(1);
    } finally { act(() => renderer.unmount()); }
  });

  it("keeps one full-message copy and timing footer after a long streaming reply splits into rows", async () => {
    const text = Array.from({ length: 60 }, (_, index) => `## Part ${index}\n\n${"Paragraph. ".repeat(40)}\n\n`).join("");
    const refetch = vi.fn<PaseoAgentTimelineHandle["refetch"]>(async () => page([
      entry({ type: "user_message", text: "prompt" }, 1, 1000, "long"),
      entry({ type: "assistant_message", text }, 2, 2000, "long"),
    ]));
    const release = Object.assign(vi.fn(), { ready: Promise.resolve(), subscriptionId: "s", release: async () => {} });
    runtime.api = { agents: { ref: () => ({ timeline: { refetch, subscribe: () => release } }) },
      providers: { listModels: async () => catalog } };
    const render = (phase: string) => React.createElement(React.Fragment, null,
      ...assistantRows(text, phase).map((item, index) => React.createElement(LiveAssistantRenderer, {
        key: index, agentId: "long", theme, host: { id: "local", label: "Local" },
        layout: { platform, compact: platform !== "web" }, timestamp: new Date(2000), item,
      })));
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(render("streaming")); });
    try {
      await act(async () => renderer.update(render("complete")));
      const footers = renderer.root.findAllByType(AssistantFooter);
      expect(footers).toHaveLength(1);
      expect(footers[0]!.props).toMatchObject({ text, durationMs: 1000 });
      expect(refetch).toHaveBeenCalledTimes(1);
      await act(async () => footers[0]!.findByProps({ accessibilityLabel: "Copy reply" }).props.onPress());
      expect(runtime.copyText).toHaveBeenCalledExactlyOnceWith(text);
    } finally { await act(async () => renderer.unmount()); }
  });

  it.each([true, false])("forwards final usage without fetching per chunk (completion carries usage=%s)", async (completionUsage) => {
    runtime.agent.status = "running";
    const entries = [entry({ type: "user_message", text: "first" }, 1, 1000, "one"),
      entry({ type: "assistant_message", text: "answer" }, 2, 2000, "one")];
    const usage = { inputTokens: 12000, cachedInputTokens: 0, outputTokens: 345 };
    const snapshot = { status: "idle", activeTurn: null, lastUserMessageAt: new Date(1000).toISOString(),
      lastUsage: usage } as NonNullable<TimelinePage["agent"]>;
    const refetch = vi.fn<PaseoAgentTimelineHandle["refetch"]>(async () => page(entries, { agent: snapshot }));
    let onEvent!: Parameters<PaseoAgentTimelineHandle["subscribe"]>[0];
    const release = Object.assign(vi.fn(), { ready: Promise.resolve(), subscriptionId: "s", release: async () => {} });
    const subscribe = vi.fn<PaseoAgentTimelineHandle["subscribe"]>((handler) => { onEvent = handler; return release; });
    runtime.api = { agents: { ref: () => ({ timeline: { refetch, subscribe } }) }, providers: { listModels: async () => catalog } };
    const row = (text: string, phase: string, at = 2000) => React.createElement(LiveAssistantRenderer, {
      agentId: "a", theme, host: { id: "local", label: "Local" }, layout: { platform, compact: platform !== "web" },
      timestamp: new Date(at), item: { type: "plugin", kind: "omp-assistant", version: 1, data: { text, phase } },
    } satisfies PluginTimelineItemProps<LiveAssistantPayload>);
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(row("a", "streaming")); });
    try {
      await act(async () => { renderer.update(row("ans", "streaming", 2500)); });
      expect(renderer.root.findAllByType(AssistantFooter)).toHaveLength(0);
      expect(refetch).not.toHaveBeenCalled();
      expect(subscribe).toHaveBeenCalledTimes(1);
      await act(async () => {
        onEvent({ agentId: "a", timestamp: new Date(2000).toISOString(),
          event: { type: "turn_completed", provider: "codex", turnId: "one", ...(completionUsage ? { usage } : {}) } });
        runtime.agent.status = "idle";
        for (const listener of runtime.listeners) listener();
        renderer.update(row("answer", "complete"));
      });
      expect(renderer.root.findByType(AssistantFooter).props.usage).toEqual(usage);
      expect(refetch).toHaveBeenCalledTimes(1);
    } finally { act(() => renderer.unmount()); }
  });

  it("keeps historical toolbars during the next turn and adds only its final reply on completion", async () => {
    let entries = [entry({ type: "user_message", text: "one" }, 1, 1000, "one"),
      entry({ type: "assistant_message", text: "intermediate" }, 2, 2000, "one"),
      entry({ type: "assistant_message", text: "first final" }, 3, 3000, "one"),
      entry({ type: "user_message", text: "two" }, 4, 4000, "two"),
      entry({ type: "assistant_message", text: "second final" }, 5, 5000, "two")];
    const refetch = vi.fn<PaseoAgentTimelineHandle["refetch"]>(async () => page(entries));
    const release = Object.assign(vi.fn(), { ready: Promise.resolve(), subscriptionId: "s", release: async () => {} });
    const subscribe = vi.fn<PaseoAgentTimelineHandle["subscribe"]>(() => release);
    const listModels = vi.fn(async () => catalog);
    runtime.api = { agents: { ref: () => ({ timeline: { refetch, subscribe } }) }, providers: { listModels } };
    const row = (text: string, at: number, phase = "complete") => React.createElement(LiveAssistantRenderer, {
      agentId: "a", theme, host: { id: "local", label: "Local" },
      layout: { platform, compact: platform !== "web" }, timestamp: new Date(at),
      item: { type: "plugin", kind: "omp-assistant", version: 1, data: { text, phase } }, key: at,
    } satisfies PluginTimelineItemProps<LiveAssistantPayload> & { key: number });
    const render = (current?: React.ReactElement) => React.createElement(React.Fragment, null,
      row("intermediate", 2000), row("first final", 3000), row("second final", 5000), current);
    const status = (next: string) => { runtime.agent.status = next; for (const listener of runtime.listeners) listener(); };
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(render()); });
    const footers = () => renderer.root.findAllByType(AssistantFooter);
    try {
      expect(footers().map((footer) => footer.props.text)).toEqual(["first final", "second final"]);
      expect(footers().map((footer) => footer.props.durationMs)).toEqual([2000, 1000]);
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(listModels).toHaveBeenCalledTimes(1);

      entries = [...entries, entry({ type: "user_message", text: "three" }, 6, 6000, "three"),
        entry({ type: "assistant_message", text: "working" }, 7, 7000, "three")];
      await act(async () => { status("running"); renderer.update(render(row("working", 7000, "streaming"))); });
      expect(footers().map((footer) => footer.props.text)).toEqual(["first final", "second final"]);
      await act(async () => { renderer.update(render(row("working", 7000))); });
      expect(footers()).toHaveLength(2);
      expect(refetch).toHaveBeenCalledTimes(2);

      entries = [...entries.slice(0, -1), entry({ type: "assistant_message", text: "third final" }, 7, 7000, "three")];
      await act(async () => { status("idle"); renderer.update(render(row("third final", 7000))); });
      expect(footers().map((footer) => footer.props.text)).toEqual(["first final", "second final", "third final"]);
      expect(refetch).toHaveBeenCalledTimes(3);
      await act(async () => { footers()[0]!.findByProps({ accessibilityLabel: "Copy reply" }).props.onPress(); });
      expect(runtime.copyText).toHaveBeenCalledExactlyOnceWith("first final");
    } finally {
      act(() => renderer.unmount());
    }
    expect(release).toHaveBeenCalledTimes(1);
  });
});
