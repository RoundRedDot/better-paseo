import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useAgent, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useRevealedText } from "@getpaseo/plugin/client/react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { useThemeTokens } from "./components/theme-tokens";
import { ToolCallout } from "./components/tool-callouts";
import { ReasoningCard } from "./components/reasoning-trace";
import { createReasoningSegmenter } from "./reasoning/segment";
import { useReasoningKey } from "./reasoning/key";
import { observeReasoning, observedDurationMs } from "./reasoning/observed";
import { useDisclosure } from "./state/disclosure-store";
import { TaskList } from "./components/task-list";
import { UserMessage } from "./components/user-message";
import { itemRootFont } from "./components/host-font-escape";
import { promptRowAnchor } from "./components/prompt-anchor";
import { surfaceProps } from "./components/view-props";
import { useSelectionActions } from "./components/selection-actions";
import type { TurnUsage } from "./components/user-message";
import { NoticeCallout } from "./components/notice-callout";
import { useEnhancerPreferences } from "./preferences";
import { publishHubSnapshot } from "./hub-activity";
import { MarkdownView } from "./components/markdown/markdown-view";
import { TimelineTailHub } from "./components/hub-live";
import { AssistantFooter } from "./components/turn-footer";
import { SystemCard } from "./components/system-card";
import { parseSystemEnvelope } from "./system-envelope";
import { useIsTimelineTail } from "./timeline-tail";
import type { TaskListData, TaskItemData, NoticeCalloutData } from "../shared/contracts";
import { revealPathRpc } from "../shared/file-rpc";
import { useImageFile } from "./image-file";
import { classifyTool } from "./tools/classify";
import { defaultToolExpanded, toolDisclosureKey } from "./tools/disclosure";
import { PathContext, usePathContextValue } from "./ui/path-text";
import { probeCard, textItemKey } from "./debug/perf";
import {
  assistantPropsEqual,
  noticePropsEqual,
  reasoningPropsEqual,
  todoPropsEqual,
  toolPropsEqual,
  userMessagePropsEqual,
} from "./state/render-equality";

type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

function toJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

export interface LiveToolCallPayload {
  name: string;
  status: string;
  detail?: Record<string, unknown>;
  callId?: string;
  error?: string | null;
  phase?: string;
}

export interface LiveReasoningPayload {
  text: string;
  phase?: string;
}

export interface LiveTodoPayload {
  items: Array<Record<string, unknown>>;
  phase?: string;
}

export interface LiveNoticePayload {
  level: string;
  message: string;
  fatal?: boolean;
}

// Tool call classification lives in `tools/classify.ts` (plan §3.3).

function LiveToolCallRendererBody({
  agentId,
  item,
  theme,
  layout,
  timestamp,
}: PluginTimelineItemProps<LiveToolCallPayload>) {
  const probe = probeCard(
    "tool_call",
    item.data.callId ?? item.data.name,
    item.data.phase === undefined ? null : item.data.phase === "streaming",
  );
  const revealPath = useRpc(revealPathRpc);
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences, layout.platform);
  useSelectionActions(tokens, preferences.selectionActions);
  const data = item.data;

  const view = useMemo(() => classifyTool(data), [data]);

  // The daemon side owns the shell, so revealing a file is one RPC. Paths
  // arrive absolute (PathText resolves them); a path the daemon cannot stat
  // answers with an error the press simply ignores.
  const pathCwdRef = useRef<string | undefined>(undefined);
  const handleRevealPath = useCallback(
    (path: string) => {
      void revealPath({ cwd: pathCwdRef.current ?? "", path }).catch(() => {});
    },
    [revealPath],
  );
  // Roots for relative paths (plan §3.9): workspace, project, agent cwd.
  const pathContext = usePathContextValue(agentId, handleRevealPath);
  pathCwdRef.current = pathContext.cwd;

  // The dock has no access to the job manager, so the timeline is its only
  // source: every job snapshot that passes through a card is republished, and
  // the store drops the agent's entry once a snapshot reports nothing running.
  const hubData = view.hub;
  useEffect(() => {
    if (!hubData || hubData.kind !== "jobs") return;
    publishHubSnapshot(agentId, {
      at: timestamp.getTime(),
      running: hubData.data.jobs.filter((job) => job.status === "running"),
      agents: hubData.data.agents ?? [],
    });
  }, [hubData, agentId]);

  // Open state lives in the disclosure store, keyed by call id, so the
  // reader's choice survives the card moving from the live head into
  // history (a remount) and the call completing (plan §3.3 item 1).
  const [expanded, setExpanded] = useDisclosure(
    toolDisclosureKey(agentId, view),
    defaultToolExpanded(view, preferences.toolDetail),
  );

  // Only an open read or write of an image asks the daemon for bytes; the
  // hook itself refuses every other path, so a code read costs no RPC.
  const imageFile = useImageFile(
    expanded && (view.tool === "read" || view.tool === "write") ? view.filePath : undefined,
    pathContext.cwd ?? null,
  );

  return (
    <View {...itemRootFont(preferences.uiFont)} {...probe.viewProps}>
      {probe.node}
      <PathContext.Provider value={pathContext}>
        <ToolCallout
          data={view}
          tokens={tokens}
          compact={layout.compact}
          expanded={expanded}
          onExpandedChange={setExpanded}
          imageFile={imageFile}
        />
      </PathContext.Provider>
      <TimelineTailHub
        agentId={agentId}
        tokens={tokens}
        itemKey={`tool:${data.callId ?? view.title}:${timestamp.getTime()}`}
        at={timestamp.getTime()}
        kind="tool"
      />
    </View>
  );
}

function LiveReasoningRendererBody({
  agentId,
  item,
  theme,
  layout,
  timestamp,
}: PluginTimelineItemProps<LiveReasoningPayload>) {
  const probe = probeCard(
    "reasoning",
    textItemKey("reasoning", item.data.text),
    item.data.phase === undefined ? null : item.data.phase === "streaming",
  );
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences, layout.platform);
  useSelectionActions(tokens, preferences.selectionActions);
  const text = item.data.text || "";
  const streaming = item.data.phase === "streaming";

  // Collapsed by default, streaming or not (plan §3.4 item 3); the reader's
  // choice survives the remount into history through the disclosure store.
  const storeKey = useReasoningKey(agentId, text);
  const [expanded, setExpanded] = useDisclosure(storeKey, false);
  const toggle = useCallback(() => setExpanded(!expanded), [expanded, setExpanded]);

  // The host's reveal runs a frame loop only for "streaming". A collapsed card
  // shows one line, so it takes the text whole and renders once per chunk.
  const revealed = useRevealedText(text, expanded && streaming ? "streaming" : "complete");

  const [segmenter] = useState(createReasoningSegmenter);
  const segmentation = useMemo(
    () => segmenter.update(revealed, { streaming }),
    [segmenter, revealed, streaming],
  );

  // Duration only from what this client saw stream (see reasoning/observed.ts).
  observeReasoning(storeKey, streaming, timestamp.getTime());
  const durationMs = streaming ? null : observedDurationMs(storeKey);

  return (
    <View {...itemRootFont(preferences.uiFont)} {...probe.viewProps}>
      {probe.node}
      <ReasoningCard
        segmentation={segmentation}
        streaming={streaming}
        durationMs={durationMs}
        expanded={expanded}
        onToggle={toggle}
        tokens={tokens}
        compact={layout.compact}
        storeKey={storeKey}
        copyText={text}
      />
    </View>
  );
}

function LiveTodoRendererBody({
  item,
  theme,
  layout,
  timestamp,
}: PluginTimelineItemProps<LiveTodoPayload>) {
  const probe = probeCard("todo", String(timestamp.getTime()), item.data.phase === "streaming");
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences, layout.platform);
  useSelectionActions(tokens, preferences.selectionActions);
  const data = item.data;

  const taskListData: TaskListData = useMemo(() => {
    const tasks: TaskItemData[] = (data.items || []).map((task, idx) => ({
      id: typeof task.id === "string" ? task.id : `todo-${idx}`,
      title: typeof task.text === "string" ? task.text : "Untitled task",
      phase: "Execution",
      status:
        task.completed === true
          ? "completed"
          : task.status === "in_progress"
            ? "in_progress"
            : "pending",
    }));

    return {
      id: "live-todo",
      phaseName: "Checklist Progress",
      tasks,
    };
  }, [data]);

  return (
    <View {...itemRootFont(preferences.uiFont)} {...probe.viewProps}>
      {probe.node}
      <TaskList data={taskListData} tokens={tokens} />
    </View>
  );
}

export interface LiveAssistantPayload {
  text: string;
  /** The host's phase for the item; absent from transformers before S2. */
  phase?: string;
}

/**
 * Streamed replies reveal at the host's own cadence (`useRevealedText`, plan
 * §3.1 item 8), so only the tail block re-renders, once per frame. Set false
 * to draw each chunk as it arrives instead, if per-frame renders measure too
 * expensive on a device.
 */
const ASSISTANT_REVEAL = true;

/**
 * The assistant's own reply, drawn with the plugin's markdown renderer.
 *
 * The host's renderer carries a pipeline this plugin cannot import — mermaid,
 * images, its own file-path links — so `assistantMarkdown` exists to hand the
 * turn back when a reply needs any of that.
 */
function LiveAssistantRendererBody({
  agentId,
  item,
  theme,
  layout,
  timestamp,
}: PluginTimelineItemProps<LiveAssistantPayload>) {
  const streaming = item.data.phase === "streaming";
  const probe = probeCard(
    "assistant",
    textItemKey("assistant", item.data.text),
    item.data.phase === undefined ? null : streaming,
  );
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences, layout.platform);
  useSelectionActions(tokens, preferences.selectionActions);

  // Replacing the reply costs the host's footer, which the stream layout hangs
  // off an `assistant_message` item that no longer exists. Rebuild it where the
  // host puts it: under the newest message, once, not under every reply.
  const itemKey = `assistant:${timestamp.getTime()}`;
  const isTail = useIsTimelineTail(itemKey);

  // Job results, IRC relays and reminders arrive as replies because the host
  // files any unclaimed `custom` message under this item kind. They are not
  // the model's words, so they are drawn as a card, not as prose.
  const envelope = useMemo(() => parseSystemEnvelope(item.data.text), [item.data.text]);
  const revealed = useRevealedText(
    item.data.text,
    ASSISTANT_REVEAL && streaming ? "streaming" : "complete",
  );

  // A path in the prose reveals like a path in a tool card: one daemon RPC,
  // relative to the agent's directory.
  const revealPath = useRpc(revealPathRpc);
  const cwd = useAgent(agentId, (agent) => agent.cwd);
  const handleRevealPath = useCallback(
    (path: string) => {
      void revealPath({ cwd: cwd ?? "", path }).catch(() => {});
    },
    [cwd, revealPath],
  );

  return (
    <View {...itemRootFont(preferences.uiFont)} {...probe.viewProps}>
      {probe.node}
      {envelope ? (
        <SystemCard envelope={envelope} tokens={tokens} compact={layout.compact} />
      ) : (
        <MarkdownView
          text={revealed}
          tokens={tokens}
          variant={preferences.markdownVariant}
          streaming={streaming}
          onRevealPath={handleRevealPath}
          probeId={itemKey}
        />
      )}
      {isTail && !envelope ? (
        <AssistantFooter text={item.data.text} at={timestamp} tokens={tokens} />
      ) : null}
      <TimelineTailHub
        agentId={agentId}
        tokens={tokens}
        itemKey={itemKey}
        at={timestamp.getTime()}
        kind="reply"
      />
    </View>
  );
}

/**
 * The host draws a `notification` or `error` item as bare text with an icon,
 * which reads as a different product beside the plugin's callouts. Both carry
 * only a level and a message, so the card is a badge plus that message.
 */
function LiveNoticeRendererBody({
  item,
  theme,
  layout,
  timestamp,
}: PluginTimelineItemProps<LiveNoticePayload>) {
  const probe = probeCard("notice", String(timestamp.getTime()));
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences, layout.platform);
  useSelectionActions(tokens, preferences.selectionActions);
  const data = item.data;
  const level = data.level === "warning" || data.level === "error" ? data.level : "info";

  const noticeData: NoticeCalloutData = useMemo(
    () => ({
      id: `notice-${data.message.length}-${level}`,
      level,
      message: data.message,
      ...(data.fatal ? { fatal: true } : {}),
    }),
    [data.message, data.fatal, level],
  );

  return (
    <View {...itemRootFont(preferences.uiFont)} {...probe.viewProps}>
      {probe.node}
      <NoticeCallout data={noticeData} tokens={tokens} />
    </View>
  );
}

export interface LiveUserMessagePayload {
  text: string;
  images?: string[];
  /** The host's own id for this message, when the provider gave one. */
  messageId?: string;
}

/**
 * Usage is reported on the agent, not on the timeline item, so it is read from
 * the live agent handle while the turn runs and frozen once the agent leaves
 * `running`. A turn this client never observed live has no recoverable usage,
 * so its footer is omitted rather than filled with the current session total.
 */
const LIVE_WINDOW_MS = 5 * 60 * 1000;

function LiveUserMessageRendererBody({
  item,
  theme,
  layout,
  agentId,
  timestamp,
}: PluginTimelineItemProps<LiveUserMessagePayload>) {
  const probe = probeCard("user_message", item.data.messageId ?? String(timestamp.getTime()));
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences, layout.platform);
  useSelectionActions(tokens, preferences.selectionActions);
  const paseo = usePaseo();
  const handle = useMemo(() => paseo.agents.ref(agentId), [paseo, agentId]);

  // Decided once, on mount: a replayed turn must not borrow later figures.
  const observedLive = useMemo(
    () => Date.now() - timestamp.getTime() < LIVE_WINDOW_MS,
    [timestamp],
  );

  const snapshot = useAgent(agentId, (agent) => ({
    status: agent.status,
    updatedAt: agent.updatedAt,
  }));
  const running = snapshot?.status === "running";

  const [usage, setUsage] = useState<TurnUsage | null>(null);
  const [frozen, setFrozen] = useState(false);

  useEffect(() => {
    if (!observedLive || frozen) return;
    let cancelled = false;
    handle
      .refresh()
      .then((result) => {
        if (cancelled || !result) return;
        const next = result.agent.lastUsage;
        if (next) setUsage(next);
        // The turn has settled, so this reading is final.
        if (next && !running) setFrozen(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [handle, observedLive, frozen, running, snapshot?.updatedAt]);

  // The same envelopes reach this item kind on some hosts and on history
  // replay. A job result is not something the user said, so it never takes the
  // user bubble.
  const envelope = useMemo(() => parseSystemEnvelope(item.data.text), [item.data.text]);

  return (
    <View
      {...surfaceProps(itemRootFont(preferences.uiFont), promptRowAnchor(item.data.messageId))}
      {...probe.viewProps}
    >
      {probe.node}
      {envelope ? (
        <SystemCard envelope={envelope} tokens={tokens} compact={layout.compact} />
      ) : (
        <UserMessage
          text={item.data.text}
          images={item.data.images}
          timestamp={timestamp}
          tokens={tokens}
          usage={observedLive ? usage : null}
          pending={running && !frozen}
        />
      )}
    </View>
  );
}

// The registered renderers, behind semantic memo (plan §3.2): Paseo 0.11.2
// gives every row a fresh theme and data object on every streamed chunk, so
// reference equality never holds. See `state/render-equality.ts` for what
// each comparator treats as "unchanged".
//
// Each export is a plain function around its memoised body: the host's
// `addTimelineRenderer` requires `typeof Component === "function"` and
// rejects the object `memo` returns, which drops every contribution in
// `contribute`. The wrapper renders one element; the body bails out.
const ToolCallMemo = memo(LiveToolCallRendererBody, toolPropsEqual);
const ReasoningMemo = memo(LiveReasoningRendererBody, reasoningPropsEqual);
const TodoMemo = memo(LiveTodoRendererBody, todoPropsEqual);
const AssistantMemo = memo(LiveAssistantRendererBody, assistantPropsEqual);
const NoticeMemo = memo(LiveNoticeRendererBody, noticePropsEqual);
const UserMessageMemo = memo(LiveUserMessageRendererBody, userMessagePropsEqual);

export function LiveToolCallRenderer(props: PluginTimelineItemProps<LiveToolCallPayload>) {
  return <ToolCallMemo {...props} />;
}

export function LiveReasoningRenderer(props: PluginTimelineItemProps<LiveReasoningPayload>) {
  return <ReasoningMemo {...props} />;
}

export function LiveTodoRenderer(props: PluginTimelineItemProps<LiveTodoPayload>) {
  return <TodoMemo {...props} />;
}

export function LiveAssistantRenderer(props: PluginTimelineItemProps<LiveAssistantPayload>) {
  return <AssistantMemo {...props} />;
}

export function LiveNoticeRenderer(props: PluginTimelineItemProps<LiveNoticePayload>) {
  return <NoticeMemo {...props} />;
}

export function LiveUserMessageRenderer(props: PluginTimelineItemProps<LiveUserMessagePayload>) {
  return <UserMessageMemo {...props} />;
}
