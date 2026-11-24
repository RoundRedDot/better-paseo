import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { PaseoAgentTimelineEvent, PaseoAgentTimelineHandle, PaseoProviderModelsResult } from "@getpaseo/client";
import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import "./helpers/quiet-renderer";
import { Dimensions } from "./helpers/rn-mock";
import { timelineEntry as entry, timelinePage as page, type TimelineEntry } from "./helpers/turn-timeline";

const runtime = vi.hoisted(() => ({
  agent: { status: "running", cwd: "/workspace", provider: "codex", model: "sol", thinkingOptionId: "medium" },
  listeners: new Set<() => void>(),
  api: {} as unknown,
}));

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("../../client/state/home-directory", () => ({ useHomeDirectory: () => "/home/test" }));
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
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
    TextInput: rn.TextInput, ScrollView: rn.ScrollView, FlatList: rn.ScrollView, Modal: rn.View,
    copyText: async () => {}, useToast: () => ({ show() {}, error() {} }) };
});
vi.mock("../../client/components/hub-live", () => ({ TimelineTailHub: () => null }));
vi.mock("../../client/state/preference-sync-slot", () => ({ PreferenceSyncSlot: () => null }));
vi.mock("../../client/components/selection-actions", () => ({ useSelectionActions: () => {}, selectionSurface: {} }));
vi.mock("../../client/components/tool-callouts", () => ({ ToolCallout: () => null, FileEditsPreview: () => null }));
vi.mock("../../client/components/markdown/markdown-view", async () => {
  const rn = await import("./helpers/rn-mock");
  return { TimelineProseContext: React.createContext(false), MarkdownView: ({ text }: { text: string }) => React.createElement(rn.Text, { testID: "reply-markdown" }, text) };
});

import { LiveAssistantRenderer, LiveUserMessageRenderer, type LiveAssistantPayload, type LiveUserMessagePayload } from "../../client/live-renderers";
import { TurnWorkCard } from "../../client/components/turn-work-card";
import { AssistantFooter } from "../../client/components/turn-footer";
import { DisclosureHeader } from "../../client/ui/disclosure-header";
import { resetTimelineTailsForTests } from "../../client/timeline-tail";
import { getBlock } from "../../client/details/block-registry";
import { detailsApi, readDetails } from "../../client/details/details-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const theme = { colors: { surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" } };
const catalog: PaseoProviderModelsResult = { provider: "codex", fetchedAt: "now", requestId: "r",
  models: [{ provider: "codex", id: "sol", label: "GPT-6.1-Sol", thinkingOptions: [{ id: "medium", label: "Medium" }] }] };

const edit = (callId: string, path: string, status: ToolCallTimelineItem["status"] = "completed") =>
  ({ type: "tool_call", name: "Edit", callId, status, error: null,
    detail: { type: "edit", filePath: path, unifiedDiff: "@@\n-a\n+b\n+c" } }) as ToolCallTimelineItem;
const shell = (callId: string, status: ToolCallTimelineItem["status"], exitCode?: number) =>
  ({ type: "tool_call", name: "Bash", callId, status, error: null,
    detail: { type: "shell", command: "npm test", output: "", ...(exitCode === undefined ? {} : { exitCode }) } }) as ToolCallTimelineItem;
const prompt = (seq: number, turnId: string) => entry({ type: "user_message", text: `prompt ${seq}`, messageId: `m${seq}` }, seq, seq * 1000, turnId);
const reply = (seq: number, text: string, turnId: string) => entry({ type: "assistant_message", text }, seq, seq * 1000, turnId);
const call = (item: TimelineEntry["item"], seq: number, turnId: string) => entry(item, seq, seq * 1000, turnId);
const flush = async () => { for (let index = 0; index < 5; index++) await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); };

let agentSeq = 0;
function setup(initial: TimelineEntry[]) {
  const agentId = `live-work-${++agentSeq}`;
  let entries = initial;
  let handler: Parameters<PaseoAgentTimelineHandle["subscribe"]>[0] | null = null;
  const release = Object.assign(vi.fn(), { ready: Promise.resolve(), subscriptionId: "s", release: async () => {} });
  let gate: Promise<void> | null = null;
  const refetch = vi.fn<PaseoAgentTimelineHandle["refetch"]>(async () => { if (gate) await gate; return page(entries); });
  const subscribe = vi.fn<PaseoAgentTimelineHandle["subscribe"]>((next) => { handler = next; return release; });
  runtime.api = { agents: { ref: () => ({ timeline: { refetch, subscribe } }) }, providers: { listModels: async () => catalog } };
  const emit = (event: PaseoAgentTimelineEvent["event"]) => handler?.({ agentId, event } as PaseoAgentTimelineEvent);
  return {
    agentId,
    setEntries(next: TimelineEntry[]) { entries = next; },
    /** Reads wait until the returned function runs. */
    holdReads() { let open!: () => void; gate = new Promise((resolve) => { open = resolve; }); return () => { gate = null; open(); }; },
    live: (item: ToolCallTimelineItem, turnId: string) =>
      emit({ type: "timeline", provider: "codex", item, turnId } as PaseoAgentTimelineEvent["event"]),
    emit,
  };
}

function replyRow(agentId: string, seq: number, text: string, phase: "streaming" | "complete") {
  return React.createElement(LiveAssistantRenderer, {
    agentId, theme, host: { id: "local", label: "Local" }, layout: { platform: "web", compact: false },
    timestamp: new Date(seq * 1000), item: { type: "plugin", kind: "omp-assistant", version: 1, data: { text, phase } },
  } satisfies PluginTimelineItemProps<LiveAssistantPayload>);
}

function promptRow(agentId: string, seq: number) {
  return React.createElement(LiveUserMessageRenderer, {
    agentId, theme, host: { id: "local", label: "Local" }, layout: { platform: "web", compact: false },
    timestamp: new Date(seq * 1000), item: { type: "plugin", kind: "omp-user-message", version: 1,
      data: { text: `prompt ${seq}`, messageId: `m${seq}` } },
  } satisfies PluginTimelineItemProps<LiveUserMessagePayload>);
}

/** Each row's work cards, by the row's position in `rows`. */
function cards(renderer: TestRenderer.ReactTestRenderer) {
  // `memo` wraps the card; the tree holds its inner component.
  return renderer.root.findAllByType((TurnWorkCard as unknown as { type: React.ComponentType }).type);
}

function setStatus(status: "running" | "idle") {
  runtime.agent = { ...runtime.agent, status };
  for (const listener of runtime.listeners) listener();
}

beforeEach(() => { runtime.agent = { ...runtime.agent, status: "running" }; resetTimelineTailsForTests(); });
afterEach(() => { expect(runtime.listeners.size).toBe(0); });

describe("standard level work card while a turn runs", () => {
  // The rows mount the details shell, which takes its form from the window: a phone's drawer, a desktop's side panel.
  it.each([[390, "drawer"], [1280, "side"]] as const)(
    "shows finished edits on the streaming reply, and keeps that card in place when the turn ends (%s pt, %s)", async (width, form) => {
    vi.spyOn(Dimensions, "get").mockReturnValue({ width, height: 844, scale: 2, fontScale: 1 });
    const turn = [prompt(1, "t"), call(edit("e1", "a.ts"), 2, "t")];
    const harness = setup(turn);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(replyRow(harness.agentId, 3, "Fix", "streaming")); });
    await act(flush);
    try {
      // The edit's own row is gone at this level: the card must show it now, not after the turn.
      let [card] = cards(renderer);
      expect(card?.props.work).toMatchObject({ running: true, files: [{ path: "a.ts", callIds: ["e1"] }] });
      // A second edit and a running command arrive over the subscription.
      await act(async () => {
        harness.live(edit("e2", "b.ts"), "t");
        harness.live(shell("c1", "running"), "t");
      });
      [card] = cards(renderer);
      expect(card?.props.work.files.map((file: { path: string }) => file.path)).toEqual(["a.ts", "b.ts"]);
      expect(card?.props.work.current).toEqual({ callId: "c1", verb: "command", target: "npm test" });
      // The work title opens the independent details directly.
      await act(async () => card!.findAllByType(DisclosureHeader)[0]!.props.onToggle());
      expect(cards(renderer)[0]!.findAllByType(DisclosureHeader)[0]!.props.detailsMarker.selected).toBe(true);
      // The file card too, though the running card's key is not the settled one's.
      const filesHeader = () => renderer.root.findAll((node) => node.props?.testID?.startsWith?.("work-files:") &&
        typeof node.props.onPress === "function").at(-1)!;
      await act(async () => filesHeader().props.onPress());
      expect(filesHeader().props.accessibilityState).toEqual({ expanded: true });

      // The reply settles while the turn still runs: same card.
      await act(async () => renderer.update(replyRow(harness.agentId, 3, "Fixed it.", "complete")));
      expect(cards(renderer)).toHaveLength(1);

      // The turn ends; the read now holds everything, and the card turns into the settled one in place.
      harness.setEntries([...turn, call(edit("e2", "b.ts"), 4, "t"), call(shell("c1", "completed", 0), 5, "t"),
        reply(3, "Fixed it.", "t")].sort((a, b) => a.seqStart - b.seqStart));
      await act(async () => {
        setStatus("idle");
        harness.emit({ type: "turn_completed", provider: "codex", turnId: "t" } as PaseoAgentTimelineEvent["event"]);
      });
      await act(flush);
      const settled = cards(renderer);
      expect(settled).toHaveLength(1);
      expect(settled[0]!.props.work).toMatchObject({ running: false, files: [{ path: "a.ts" }, { path: "b.ts" }] });
      expect(filesHeader().props.accessibilityState).toEqual({ expanded: true });
      // The details opened from the running card stay with it: selected, attached, and showing the settled steps.
      const title = () => cards(renderer)[0]!.findAllByType(DisclosureHeader)[0]!;
      expect(title().props.detailsMarker.selected).toBe(true);
      const open = getBlock(harness.agentId, title().props.detailsMarker.id)!;
      expect(open.mounted).toBe(true);
      expect(open.title).toBe("Worked for 4s · Edited files · Ran commands");
      expect(readDetails(harness.agentId)).toMatchObject({ openId: open.id, form });
      await act(async () => title().props.onToggle());
      // A tap on the current title leaves the phone drawer open, as on any row; a side panel closes in one press.
      expect(readDetails(harness.agentId).openId).toBe(form === "drawer" ? open.id : null);
    } finally { await act(async () => renderer.unmount()); vi.restoreAllMocks(); }
  });

  it("moves the running card to each newer reply, and never onto an earlier turn's reply", async () => {
    const harness = setup([prompt(1, "old"), call(edit("o1", "old.ts"), 2, "old"), reply(3, "Old answer", "old"),
      prompt(4, "t"), call(edit("e1", "a.ts"), 5, "t")]);
    let renderer!: TestRenderer.ReactTestRenderer;
    const rows = (...children: React.ReactElement[]) => React.createElement(React.Fragment, null, ...children);
    await act(async () => { renderer = TestRenderer.create(rows(replyRow(harness.agentId, 3, "Old answer", "complete"))); });
    await act(flush);
    try {
      // The earlier turn's reply keeps its own settled card even though it is the newest reply so far.
      expect(cards(renderer).map((card) => card.props.work.files.map((file: { path: string }) => file.path))).toEqual([["old.ts"]]);
      await act(async () => renderer.update(rows(replyRow(harness.agentId, 3, "Old answer", "complete"),
        replyRow(harness.agentId, 6, "Looking", "streaming"))));
      await act(flush);
      expect(cards(renderer).map((card) => card.props.work.files.map((file: { path: string }) => file.path))).toEqual([["old.ts"], ["a.ts"]]);
      // A newer reply of the same turn takes the running card over.
      await act(async () => renderer.update(rows(replyRow(harness.agentId, 3, "Old answer", "complete"),
        replyRow(harness.agentId, 6, "Looking at it.", "complete"), replyRow(harness.agentId, 7, "Now", "streaming"))));
      const shown = cards(renderer);
      expect(shown).toHaveLength(2);
      expect(shown[1]!.props.work.running).toBe(true);
      const cardType = (TurnWorkCard as unknown as { type: React.ComponentType }).type;
      expect(renderer.root.findAllByType(LiveAssistantRenderer).map((row) => row.findAllByType(cardType).length))
        .toEqual([1, 0, 1]);
    } finally { await act(async () => renderer.unmount()); }
  });

  it("holds the running card under the prompt until the turn's first reply arrives", async () => {
    const harness = setup([prompt(1, "t"), call(edit("e1", "a.ts"), 2, "t")]);
    let renderer!: TestRenderer.ReactTestRenderer;
    const rows = (...children: React.ReactElement[]) => React.createElement(React.Fragment, null, ...children);
    await act(async () => { renderer = TestRenderer.create(rows(promptRow(harness.agentId, 1))); });
    await act(flush);
    try {
      expect(cards(renderer).map((card) => card.props.work.running)).toEqual([true]);
      await act(async () => renderer.update(rows(promptRow(harness.agentId, 1), replyRow(harness.agentId, 3, "On it", "streaming"))));
      await act(flush);
      expect(cards(renderer)).toHaveLength(1);
      // The card now sits on the reply, not the prompt.
      const reply = renderer.root.findAllByType(LiveAssistantRenderer)[0]!;
      expect(reply.findAllByType((TurnWorkCard as unknown as { type: React.ComponentType }).type)).toHaveLength(1);
    } finally { await act(async () => renderer.unmount()); }
  });
});

const cardType = (TurnWorkCard as unknown as { type: React.ComponentType }).type;
/** Per reply row, top to bottom: "card", "text" and "footer" in the order they are drawn. */
function layoutOf(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAllByType(LiveAssistantRenderer).map((row) =>
    row.findAll((node) => node.type === cardType || node.type === AssistantFooter
      || (typeof node.type === "string" && node.props?.testID === "reply-markdown"))
      .map((node) => node.type === cardType ? "card" : node.type === AssistantFooter ? "footer" : "text"));
}

describe("standard level running card under the newest row", () => {
  it("draws the running card under the streaming reply, so the reply's text above it never moves", async () => {
    const harness = setup([prompt(1, "t"), call(edit("e1", "a.ts"), 2, "t")]);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(replyRow(harness.agentId, 3, "Fix", "streaming")); });
    await act(flush);
    try {
      expect(layoutOf(renderer)).toEqual([["text", "card"]]);
      // The reply's opening grows, so its tail key changes chunk by chunk: the card stays, not remounted.
      const card = cards(renderer)[0]!;
      await act(async () => renderer.update(replyRow(harness.agentId, 3, "Fix the path", "streaming")));
      expect(cards(renderer)[0]).toBe(card);
      // The card grows as steps finish: below the text, which stays where it is.
      await act(async () => { harness.live(shell("c1", "running"), "t"); });
      expect(layoutOf(renderer)).toEqual([["text", "card"]]);
      expect(cards(renderer)[0]!.props.work.current).toEqual({ callId: "c1", verb: "command", target: "npm test" });
    } finally { await act(async () => renderer.unmount()); }
  });

  it("passes the card to a newer reply without taking any off the reply above it", async () => {
    const harness = setup([prompt(1, "t"), call(edit("e1", "a.ts"), 2, "t")]);
    let renderer!: TestRenderer.ReactTestRenderer;
    const rows = (...children: React.ReactElement[]) => React.createElement(React.Fragment, null, ...children);
    await act(async () => { renderer = TestRenderer.create(rows(replyRow(harness.agentId, 3, "Looking", "streaming"))); });
    await act(flush);
    try {
      // A live call delivered over the subscription, not yet in any read.
      await act(async () => { harness.live(edit("e2", "b.ts"), "t"); });
      await act(async () => renderer.update(rows(replyRow(harness.agentId, 3, "Looking at it.", "complete"),
        replyRow(harness.agentId, 6, "Now", "streaming"))));
      await act(flush);
      // Above a reply the card moved down the list with each newer reply; now
      // the older reply never held one above its text.
      expect(layoutOf(renderer)).toEqual([["text"], ["text", "card"]]);
      // The row that took the card still has the live call: the store kept it.
      expect(cards(renderer)[0]!.props.work.files.map((file: { path: string }) => file.path)).toEqual(["a.ts", "b.ts"]);
    } finally { await act(async () => renderer.unmount()); }
  });

  it("keeps the card under the final reply as the agent stops, and settles it there in place", async () => {
    const turn = [prompt(1, "t"), call(edit("e1", "a.ts"), 2, "t")];
    const harness = setup(turn);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(replyRow(harness.agentId, 3, "Fixed it.", "complete")); });
    await act(flush);
    try {
      expect(layoutOf(renderer)).toEqual([["text", "card"]]);
      harness.setEntries([...turn, reply(3, "Fixed it.", "t")]);
      // The agent reports idle; the read of the ended turn has not landed yet.
      const land = harness.holdReads();
      await act(async () => { setStatus("idle"); });
      // The reply's own card takes over where the running one was: nothing above or below it moves.
      expect(layoutOf(renderer)).toEqual([["text", "card"]]);
      const pending = cards(renderer)[0]!;
      expect(pending.props.work.running).toBe(true);
      await act(async () => {
        harness.emit({ type: "turn_completed", provider: "codex", turnId: "t" } as PaseoAgentTimelineEvent["event"]);
        land();
      });
      await act(flush);
      // The footer arrives under the card, so the card does not move for it either.
      expect(layoutOf(renderer)).toEqual([["text", "card", "footer"]]);
      const settled = cards(renderer)[0]!;
      expect(settled.props.work.running).toBe(false);
      // The same card, not a remount.
      expect(settled).toBe(pending);
    } finally { await act(async () => renderer.unmount()); }
  });
});
