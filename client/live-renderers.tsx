import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import { useAgent, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useRevealedText } from "./ui/use-revealed-text";
import { ChatComposerContext, type ComposerTimelineItemProps as PluginTimelineItemProps } from "./ui/chat-composer";
import type { PluginTheme } from "@getpaseo/plugin";
import { useThemeTokens } from "./components/theme-tokens";
import { ToolCallout } from "./components/tool-callouts";
import { ToolRollup, ToolRollupControls } from "./components/tool-rollup";
import { useToolRollupPosition, type ToolRollupPosition } from "./state/tool-rollup-order";
import { ReasoningCard } from "./components/reasoning-trace";
import { createReasoningSegmenter } from "./reasoning/segment";
import { useReasoningKey } from "./reasoning/key";
import { observeReasoning, observedDurationMs } from "./reasoning/observed";
import { useDisclosure } from "./state/disclosure-store";
import { TaskList, TaskListPanel, useTaskListPanel } from "./components/task-list";
import { TaskActivityRow } from "./components/task-activity-row";
import { HOST_ITEM_GAP, deriveTodoActivities, todoTaskStatus, useLatestTodoItems, useTodoTimeline, type EmptyGapTakeBack, type TodoTask } from "./state/todo-timeline";
import { UserMessage } from "./components/user-message";
import { itemRootFont } from "./components/host-font-escape";
import { pluginRoot } from "./components/focus-ring";
import { promptAnchorIds, promptAnchorMarker } from "./components/prompt-anchor";
import { surfaceProps } from "./components/view-props";
import { useSelectionActions } from "./components/selection-actions";
import { TurnUsageRow, type TurnUsage } from "./components/user-message";
import { NoticeCallout } from "./components/notice-callout";
import { useEnhancerPreferences } from "./preferences";
import { PreferenceSyncSlot } from "./state/preference-sync-slot";
import { useIsLatestPrompt } from "./state/latest-prompt";
import { useTurnFooter } from "./state/turn-footers";
import { useAgentMessageSender } from "./state/agent-message-senders";
import { useFooterModel } from "./state/footer-model";
import type { AssistantRowData } from "./assistant-transform";
import { HOST_REWIND_MENU } from "./ui/host-rewind";
import { publishHubSnapshot } from "./hub-activity";
import { MarkdownView } from "./components/markdown/markdown-view";
import { TimelineTailHub } from "./components/hub-live";
import { AssistantFooter } from "./components/turn-footer";
import { SystemCard } from "./components/system-card";
import { parseSystemEnvelope } from "./system-envelope";
import { useTextItemTailKey } from "./timeline-tail";
import { useHasEntryAfter, useNextEntryIsRow, useTimelineEntry, useTimelineToolGroup } from "./timeline-order";
import { useHostStacksRows } from "./host-row-gap";
import { BlockPlacementContext, type BlockKind } from "./details/contracts";
import { DetailsHostSlot } from "./details/shell/details-host-slot";
import type { TaskListData, TaskItemData, NoticeCalloutData } from "../shared/contracts";
import { revealPathRpc } from "../shared/file-rpc";
import { isImagePath, useImageFile } from "./image-file";
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
  agentMessage?: import("./tools/agent-message").AgentMessage;
  name: string;
  status: string;
  detail?: Record<string, unknown>;
  callId?: string;
  error?: string | null;
  phase?: string;
  approved?: boolean;
  questionData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
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

/**
 * How much of Paseo's 16pt gap under a plugin item a tool or thought row
 * takes back (`compactRowSpacing`). The 4pt left is the host's own gap between
 * a thought and a tool row. A negative bottom margin pulls the next item up into
 * the gap the host hangs under this one; the newest row has nothing below it
 * but the list's own padding or the working indicator, so it keeps its gap.
 * A reply can take the same 12 back, but only above a row and only by choice
 * (`compactReplySpacing`, `timeline-order.ts`): Paseo's own reply keeps 16pt
 * there.
 *
 * A host that stacks rows itself (`host-row-gap.ts`) leaves no gap between two
 * rows, so a row takes nothing back above another row, only above a reply or
 * a prompt, where the 16pt stays.
 *
 * An empty slot (a member a merged row draws, a todo item another item of
 * its update draws) cannot take its gap back: a negative margin on a view
 * with no height leaves the host's wrapper at zero, not below it, so the 16pt
 * under it stays on a host that spaces rows. A checklist takes its empty
 * siblings' gaps back itself (`state/todo-timeline.ts`).
 */
export const ROW_GAP_COMPENSATION = 12;

const rowGapStyles = StyleSheet.create({
  compensated: { marginBottom: -ROW_GAP_COMPENSATION },
  // Reserve the compact header's 8pt top hit slop inside the item while
  // thinking, so a long press stays clear of the preceding tool row.
  mobileStreamingThought: { paddingTop: 8 },
});

// The host reveal hook settles collapsed text in a second parent render.
// Its card props are unchanged then; keep that commit out of the native subtree
// while still tracking the full text for a card opened in the middle of a stream.
const ReasoningCardMemo = memo(ReasoningCard);

/**
 * The row's own take-back, plus the host's gap under each hidden copy of its
 * call right below it (`countCopiesBelow`). The host's wrapper stops at zero
 * height, so the row takes back no more than its own height.
 */
function rowGapStyle(compensated: boolean, copiesBelow: number, height: number): ViewStyle | undefined {
  if (copiesBelow === 0) return compensated ? rowGapStyles.compensated : undefined;
  const take = (compensated ? ROW_GAP_COMPENSATION : 0) + copiesBelow * HOST_ITEM_GAP;
  return { marginBottom: -Math.min(take, height) };
}

/** Whether a row with something below it takes back the gap under it. */
function compensatesRow(compactRowSpacing: boolean, anythingBelow: boolean, rowBelow: boolean, hostStacks: boolean): boolean {
  return compactRowSpacing && anythingBelow && !(hostStacks && rowBelow);
}

function BlockPlacement({ agentId, timestamp, kind, children }: {
  agentId: string;
  timestamp: Date;
  kind: BlockKind;
  children: React.ReactNode;
}) {
  const at = timestamp.getTime();
  const value = useMemo(() => ({ agentId, at, kind }), [agentId, at, kind]);
  return <BlockPlacementContext.Provider value={value}>{children}</BlockPlacementContext.Provider>;
}

type ToolRendererProps = PluginTimelineItemProps<LiveToolCallPayload> & { rollup?: ToolRollupPosition | null };

function LiveToolCallRendererBody({
  agentId,
  item,
  theme,
  layout,
  timestamp,
  rollup,
}: ToolRendererProps) {
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

  const view = useMemo(() => ({ ...classifyTool(data), rollupStatus: data.status }), [data]);
  // The host rewrites a call's timestamp as its result arrives, but keeps
  // its timeline slot. Ordering by that update time can move the gap from
  // this row onto the call below it while the turn is still streaming.
  const arrivalRef = useRef({ agentId, callId: data.callId, at: timestamp.getTime() });
  if (arrivalRef.current.agentId !== agentId || arrivalRef.current.callId !== data.callId) {
    arrivalRef.current = { agentId, callId: data.callId, at: timestamp.getTime() };
  }
  const at = arrivalRef.current.at;
  const itemKey = `tool:${data.callId ?? view.title}:${at}`;
  // Not the tail: a thought takes no part in it, and a call with a thought
  // below it kept its gap as if it were the newest row. A call already
  // finished as its row mounts is replayed history (see `timeline-order.ts`).
  const rootRef = useRef<View>(null);
  // Only a stacking host's compensation depends on whether a row comes next.
  const hostStacks = useHostStacksRows();
  const { group, anythingBelow, rowBelow, copiesBelow, copiesBelowHeight, rollupHead } = useTimelineToolGroup(
    agentId, at, view, data.phase === "complete", rootRef, hostStacks && preferences.compactRowSpacing,
    rollup,
  );
  const [rollupExpanded, setRollupExpanded] = useDisclosure(`${agentId}:tool-rollup:${rollupHead ?? data.callId}`, false);
  const [rollupControlsVisible, setRollupControlsVisible] = useState(false);
  const showCard = rollupHead ? rollupExpanded || rollupControlsVisible : group !== null;
  const showSummary = Boolean(rollupHead && group);
  const groupFailed = group?.some((call) => call.status === "failed") ?? false;

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
  const disclosureKey = toolDisclosureKey(agentId, view);
  const [expanded, setExpanded] = useDisclosure(
    disclosureKey,
    defaultToolExpanded(groupFailed ? { ...view, status: "failed" } : view, preferences.toolDetail),
  );

  // Only a read or write of an image that is open, or has been previewed or
  // long-pressed for the viewer, asks the daemon for bytes; the hook itself refuses every other path, so a
  // code read costs no RPC. A previewed image stays loaded, so hovering the
  // row again does not read the file again.
  const readsImage = (view.tool === "read" || view.tool === "write") && isImagePath(view.filePath);
  const [previewed, setPreviewed] = useState(false);
  const markPreviewed = useCallback(() => setPreviewed(true), []);
  const imageFile = useImageFile(
    readsImage && (expanded || previewed) ? view.filePath : undefined,
    pathContext.cwd ?? null,
  );

  return (
    <View
      ref={rootRef}
      {...surfaceProps(itemRootFont(preferences.uiFont), pluginRoot,
        Platform.OS === "web" && rollupHead && !showCard && !showSummary
          ? { dataSet: { bcrollupempty: "true" } } as import("react-native").ViewProps : {})}
      {...probe.viewProps}
      style={!showCard && !showSummary ? undefined : rowGapStyle(
        compensatesRow(preferences.compactRowSpacing, anythingBelow, rowBelow, hostStacks),
        hostStacks ? 0 : copiesBelow, copiesBelowHeight,
      )}
    >
      {rollupHead ? <ToolRollupControls view={view} onChange={setRollupControlsVisible} /> : null}
      {showCard || showSummary ? (
        <>
          {probe.node}
          <PreferenceSyncSlot />
          {showSummary && group ? <ToolRollup calls={group} expanded={rollupExpanded}
            onExpandedChange={setRollupExpanded} tokens={tokens} compact={layout.compact} /> : null}
          <PathContext.Provider value={pathContext}>
            {showCard ? <ToolCallout
              data={view}
              previewKey={`${disclosureKey}:preview`}
              groupCalls={!rollupHead && group && group.length > 1 ? group : undefined}
              tokens={tokens}
              compact={layout.compact}
              expanded={expanded || rollupControlsVisible}
              onExpandedChange={setExpanded}
              imageFile={imageFile}
              requestImage={readsImage ? markPreviewed : undefined}
            /> : null}
          </PathContext.Provider>
        </>
      ) : null}
      <DetailsHostSlot agentId={agentId} itemKey={itemKey} tokens={tokens} compact={layout.compact} />
      <TimelineTailHub
        agentId={agentId}
        tokens={tokens}
        itemKey={itemKey}
        at={at}
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
  const settledKey = streaming ? undefined : `thought:${text}`;
  const rootRef = useRef<View>(null);
  useTimelineEntry(agentId, timestamp.getTime(), "thought", settledKey, rootRef);
  const anythingBelow = useHasEntryAfter(agentId, timestamp.getTime(), "thought", settledKey);
  const hostStacks = useHostStacksRows();
  const rowBelow = useNextEntryIsRow(agentId, timestamp.getTime(), "thought", hostStacks && preferences.compactRowSpacing);

  // Collapsed by default, streaming or not (plan §3.4 item 3); the reader's
  // choice survives the remount into history through the disclosure store.
  const storeKey = useReasoningKey(agentId, text);
  const [expanded, setExpanded] = useDisclosure(storeKey, false);
  const toggle = useCallback(() => setExpanded(!expanded), [expanded, setExpanded]);

  // The host's reveal runs a frame loop only for "streaming". A collapsed card
  // shows one line, so it takes the text whole. The hook still follows the text,
  // so a card opened mid-stream picks up the reveal where the text stands; but
  // its "complete" output lands a commit late (`useRevealedText` settles in a
  // passive effect), so an unpaced card draws `text` itself.
  const paced = expanded && streaming;
  const pacedText = useRevealedText(text, paced ? "streaming" : "complete");
  const revealed = paced ? pacedText : text;

  const [segmenter] = useState(createReasoningSegmenter);
  const segmentation = useMemo(
    () => segmenter.update(revealed, { streaming }),
    [segmenter, revealed, streaming],
  );

  // Duration only from what this client saw stream (see reasoning/observed.ts).
  observeReasoning(storeKey, streaming, timestamp.getTime());
  const durationMs = streaming ? null : observedDurationMs(storeKey);
  const hostSlotKey = useRef(`thought:${agentId}:${timestamp.getTime()}`).current;

  // A thought gives up its gap once something of this agent's arrived below
  // it, whatever its phase: the host can mark a thought loading again while
  // it catches up. A turn that ends on a thought keeps the gap, or the
  // thought would sit 12pt into the list's bottom padding, under the composer.
  return (
    <View
      ref={rootRef}
      {...surfaceProps(itemRootFont(preferences.uiFont), pluginRoot)}
      {...probe.viewProps}
      style={[
        compensatesRow(preferences.compactRowSpacing, anythingBelow, rowBelow, hostStacks) ? rowGapStyles.compensated : undefined,
        streaming && layout.platform !== "web" ? rowGapStyles.mobileStreamingThought : undefined,
      ]}
    >
      {probe.node}
      <PreferenceSyncSlot />
      <ReasoningCardMemo
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
      <DetailsHostSlot agentId={agentId} itemKey={hostSlotKey} tokens={tokens} compact={layout.compact} />
    </View>
  );
}

/** Negative margins taking back the gaps of a checklist's empty siblings. */
function emptyGapStyle({ above, below }: EmptyGapTakeBack): ViewStyle | undefined {
  if (above === 0 && below === 0) return undefined;
  return { ...(above > 0 ? { marginTop: -above } : null), ...(below > 0 ? { marginBottom: -below } : null) };
}

/** A host todo list as the checklist draws it. */
function todoTaskListData(items: readonly TodoTask[]): TaskListData {
  const tasks: TaskItemData[] = (items || []).map((task, idx) => {
    const status = todoTaskStatus(task);
    const text = typeof task.text === "string" ? task.text : "Untitled task";
    return {
      id: typeof task.id === "string" ? task.id : `todo-${idx}`,
      // As Paseo does: the task in progress reads as what is happening now.
      title: status === "in_progress" && typeof task.activeForm === "string" && task.activeForm ? task.activeForm : text,
      phase: "Execution",
      status,
    };
  });

  return {
    id: "live-todo",
    phaseName: "Checklist Progress",
    tasks,
  };
}

function LiveTodoRendererBody({
  agentId,
  item,
  theme,
  layout,
  timestamp,
}: PluginTimelineItemProps<LiveTodoPayload>) {
  const probe = probeCard("todo", String(timestamp.getTime()), item.data.phase === "streaming");
  useTimelineEntry(agentId, timestamp.getTime(), "tool");
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences, layout.platform);
  useSelectionActions(tokens, preferences.selectionActions);
  const data = item.data;
  const items = data.items as unknown as TodoTask[];
  // Paseo hands over one item per change of an update, each with the whole
  // list: only one of them draws, and only the newest update draws open.
  const rootRef = useRef<View>(null);
  const { role, previous, emptyGaps, measureEmptyGaps } = useTodoTimeline(agentId, timestamp.getTime(), items, rootRef);
  const hostStacks = useHostStacksRows();
  const activities = useMemo(
    () => (role === "summary" ? deriveTodoActivities(previous, items) : []),
    [role, previous, items],
  );

  const taskListData = useMemo(() => todoTaskListData(items), [items]);
  const hostSlotKey = `todo:${agentId}:${timestamp.getTime()}`;

  // The checklist's panel lives here, not in the list: when the next update
  // arrives this item folds to a row and its list unmounts, but the item
  // stays, and so does a panel the reader opened from it, now showing the
  // agent's newest list. A transient hover panel goes with the list.
  const panel = useTaskListPanel(role !== "hidden");
  const latest = useLatestTodoItems(agentId, panel.open);
  const panelData = useMemo(() => (latest && latest !== items ? todoTaskListData(latest) : taskListData), [latest, items, taskListData]);
  const transient = panel.open && Platform.OS === "web" && !panel.popped && !panel.placed && !panel.maximized;
  const transientRef = useRef(transient);
  transientRef.current = transient;
  const { close: closePanel } = panel;
  useEffect(() => {
    if (role !== "full" && transientRef.current) closePanel();
  }, [role, closePanel]);
  const rowHeight = layout.compact ? tokens.typography.block.rowHeight.compact : tokens.typography.block.rowHeight.desktop;

  // Empty plugin slots still carry the host's 16pt gap; the item drawing the
  // update takes it back for them, unless the host stacks rows and hangs none.
  if (role === "hidden") return <View ref={rootRef}>
    <DetailsHostSlot agentId={agentId} itemKey={hostSlotKey} tokens={tokens} compact={layout.compact} />
  </View>;

  return (
    <View
      ref={rootRef}
      {...surfaceProps(itemRootFont(preferences.uiFont), pluginRoot)}
      {...probe.viewProps}
      onLayout={(event: LayoutChangeEvent) => {
        probe.viewProps.onLayout?.(event);
        measureEmptyGaps();
      }}
      style={hostStacks ? undefined : emptyGapStyle(emptyGaps)}
    >
      {probe.node}
      <PreferenceSyncSlot />
      {/* The panel's anchor: the checklist's header, or the row it folds to, in the same place. */}
      <View ref={panel.anchorRef} pointerEvents="none" style={[todoStyles.anchor, { height: rowHeight }]} />
      {role === "full" ? (
        <TaskList data={taskListData} tokens={tokens} compact={layout.compact} panel={panel} />
      ) : (
        <TaskActivityRow activities={activities} data={taskListData} tokens={tokens} compact={layout.compact} />
      )}
      <TaskListPanel panel={panel} data={panelData} tokens={tokens} compact={layout.compact} />
      <DetailsHostSlot agentId={agentId} itemKey={hostSlotKey} tokens={tokens} compact={layout.compact} />
    </View>
  );
}

const todoStyles = StyleSheet.create({
  anchor: { position: "absolute", top: 0, left: 0, right: 0 },
});

export interface LiveAssistantPayload extends AssistantRowData {}

/**
 * Whether a streamed reply reveals at the host's own cadence
 * (`useRevealedText`, plan §3.1 item 8) or draws each chunk as it arrives.
 * Decided by an A/B (F1, 3+ alternating runs, markdown-long and
 * table-streaming): on the iOS simulator the reveal changed total assistant
 * commit time by +3% / -5% and dropped frames by +4% / +17%, so it stays; on
 * the web production build it tripled the work (commit time +222% / +319%,
 * parse time +262% / +321%) for no frame gain, so web draws per chunk.
 * Android follows native (not measured).
 */
const ASSISTANT_REVEAL = { web: false, native: true } as const;

/**
 * The assistant's own reply, drawn with the plugin's markdown renderer.
 *
 * The host's renderer carries a pipeline this plugin cannot import — mermaid,
 * images, its own file-path links — so `assistantMarkdown` exists to hand the
 * turn back when a reply needs any of that.
 */
function LiveAssistantRendererBody(props: PluginTimelineItemProps<LiveAssistantPayload>) {
  return props.item.data.blockIndex !== undefined && props.item.data.messageText === undefined
    ? <AssistantBlockRenderer {...props} /> : <LiveAssistantMessageRenderer {...props} />;
}

/** Interior blocks have no message footer, tail registration or timing reads. */
function AssistantBlockRenderer({ item, theme, layout, agentId, timestamp }: PluginTimelineItemProps<LiveAssistantPayload>) {
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences, layout.platform);
  useSelectionActions(tokens, preferences.selectionActions);
  const revealPath = useRpc(revealPathRpc);
  const cwd = useAgent(agentId, (agent) => agent.cwd);
  const onRevealPath = useCallback((path: string) => {
    void revealPath({ cwd: cwd ?? "", path }).catch(() => {});
  }, [cwd, revealPath]);
  const probe = probeCard("assistant", textItemKey("assistant", item.data.text), false);
  const hostSlotKey = useRef(`assistant:${agentId}:${timestamp.getTime()}:${item.data.blockIndex ?? "block"}`).current;
  return <View {...surfaceProps(itemRootFont(preferences.uiFont), pluginRoot)} {...probe.viewProps}
    style={assistantBlockStyles.continuation}>
    {probe.node}
    <PreferenceSyncSlot />
    <MarkdownView text={item.data.text} tokens={tokens} variant={preferences.markdownVariant}
      compact={layout.compact} firstBlock={item.data.blockIndex === 0} onRevealPath={onRevealPath}
      listContinuation={item.data.listContinuation}
      probeId={`assistant:${timestamp.getTime()}:${item.data.blockIndex}`} />
    <DetailsHostSlot agentId={agentId} itemKey={hostSlotKey} tokens={tokens} compact={layout.compact} />
  </View>;
}

const assistantBlockStyles = StyleSheet.create({
  // The next block supplies the Markdown gap; cancel the host's item gap.
  continuation: { marginBottom: -16 },
});

function LiveAssistantMessageRenderer({
  agentId,
  item,
  theme,
  layout,
  timestamp,
}: PluginTimelineItemProps<LiveAssistantPayload>) {
  const messageText = item.data.messageText ?? item.data.text;
  const streaming = item.data.phase === "streaming";
  const probe = probeCard(
    "assistant",
    textItemKey("assistant", item.data.text),
    item.data.phase === undefined ? null : streaming,
  );
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences, layout.platform);
  useSelectionActions(tokens, preferences.selectionActions);

  // The jobs hub still follows the conversation tail. Completed-turn footers
  // are independent: each turn keeps one under its last model reply.
  const itemKey = useTextItemTailKey(agentId, "assistant", timestamp.getTime(), messageText);
  const hostSlotKey = useRef(`assistant:${agentId}:${timestamp.getTime()}`).current;

  // Paseo's own reply sits 16pt above the tool row that follows it (its 12pt
  // padding plus a 4pt gap), the same 16pt the host hangs under a plugin item.
  // `compactReplySpacing` takes 12 of it back when a row is next, as a tool
  // row does. Above a prompt or another reply the 16 stays.
  const rootRef = useRef<View>(null);
  useTimelineEntry(agentId, timestamp.getTime(), "reply", streaming ? undefined : `reply:${messageText}`, rootRef);
  const rowBelow = useNextEntryIsRow(agentId, timestamp.getTime(), "reply");

  // Job results, IRC relays and reminders arrive as replies because the host
  // files any unclaimed `custom` message under this item kind. They are not
  // the model's words, so they are drawn as a card, not as prose.
  const envelope = useMemo(() => parseSystemEnvelope(item.data.text), [item.data.text]);
  const reveal = ASSISTANT_REVEAL[layout.platform === "web" ? "web" : "native"];
  // Where the reply is not paced, it bypasses the host's hook: that hook shows
  // a longer text one commit late (it settles in a passive effect), and Paseo's
  // web list follows the bottom in the commit that brings the stream data, so a
  // reply growing a commit later was painted pushed down for a frame, then
  // scrolled back, and rendered twice per chunk. The hook gets a constant then.
  const pacedText = useRevealedText(reveal ? item.data.text : "", reveal && streaming ? "streaming" : "complete");
  const revealed = reveal ? pacedText : item.data.text;

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
    <View
      ref={rootRef}
      {...surfaceProps(itemRootFont(preferences.uiFont), pluginRoot)}
      {...probe.viewProps}
      style={
        preferences.compactReplySpacing && !streaming && rowBelow ? rowGapStyles.compensated : undefined
      }
    >
      {probe.node}
      <PreferenceSyncSlot />
      {envelope ? (
        <SystemCard envelope={envelope} tokens={tokens} compact={layout.compact} />
      ) : (
        <MarkdownView
          text={revealed}
          firstBlock={item.data.blockIndex === undefined || item.data.blockIndex === 0}
          listContinuation={item.data.listContinuation}
          tokens={tokens}
          variant={preferences.markdownVariant}
          compact={layout.compact}
          streaming={streaming}
          onRevealPath={handleRevealPath}
          probeId={`assistant:${timestamp.getTime()}`}
        />
      )}
      {/* A streaming row only observes completion usage; the visible footer
          still belongs exclusively to the final reply of a completed turn. */}
      {!envelope ? (
        <TurnFooter
          agentId={agentId}
          text={messageText}
          at={timestamp}
          tokens={tokens}
          compact={layout.compact}
          streaming={streaming}
        />
      ) : null}
      <DetailsHostSlot agentId={agentId} itemKey={hostSlotKey} tokens={tokens} compact={layout.compact} />
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
 * One footer per completed turn, including history while another turn runs.
 * Timeline reads and completion subscriptions are shared by the agent's rows.
 * Only a row selected as its turn's final reply mounts the metadata hooks.
 */
const TurnFooter = memo(function TurnFooter({
  agentId,
  text,
  at,
  tokens,
  compact,
  streaming,
}: {
  agentId: string;
  text: string;
  at: Date;
  tokens: ReturnType<typeof useThemeTokens>;
  compact: boolean;
  streaming: boolean;
}) {
  const running = useAgent(agentId, (agent) => agent.status === "running");
  const paseo = usePaseo();
  const timing = useTurnFooter(paseo, agentId, at.getTime(), text, running, streaming);
  if (!timing) return null;
  return <CompletedReplyFooter agentId={agentId} text={text} at={new Date(timing.completedAt)} tokens={tokens}
    compact={compact} durationMs={timing.durationMs} startedAt={timing.startedAt} usage={timing.usage} />;
});

function CompletedReplyFooter({ agentId, text, at, tokens, compact, durationMs, startedAt, usage }: {
  agentId: string;
  text: string;
  at: Date;
  tokens: ReturnType<typeof useThemeTokens>;
  compact: boolean;
  durationMs: number | null;
  startedAt: number | null;
  usage?: TurnUsage;
}) {
  const agentName = useAgent(agentId, (agent) => agent.provider);
  const modelId = useAgent(agentId, (agent) => agent.model);
  const thinkingOptionId = useAgent(agentId, (agent) => agent.thinkingOptionId);
  const cwd = useAgent(agentId, (agent) => agent.cwd);
  const paseo = usePaseo();
  const model = useFooterModel(paseo, agentName, modelId, thinkingOptionId, cwd);
  return <AssistantFooter text={text} at={at} agentName={agentName} modelId={modelId} modelName={model.modelName}
    thinkingLabel={model.thinkingLabel}
    durationMs={durationMs} startedAt={startedAt} usage={usage} tokens={tokens} compact={compact} />;
}

/**
 * The host draws a `notification` or `error` item as bare text with an icon,
 * which reads as a different product beside the plugin's callouts. Both carry
 * only a level and a message, so the card is a badge plus that message.
 */
function LiveNoticeRendererBody({
  agentId,
  item,
  theme,
  layout,
  timestamp,
}: PluginTimelineItemProps<LiveNoticePayload>) {
  const probe = probeCard("notice", String(timestamp.getTime()));
  const rootRef = useRef<View>(null);
  useTimelineEntry(agentId, timestamp.getTime(), "notice", `notice:${item.data.message}`, rootRef);
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
  const hostSlotKey = useRef(`notice:${agentId}:${timestamp.getTime()}`).current;

  return (
    <View ref={rootRef} {...surfaceProps(itemRootFont(preferences.uiFont), pluginRoot)} {...probe.viewProps}>
      {probe.node}
      <PreferenceSyncSlot />
      <NoticeCallout data={noticeData} tokens={tokens} at={timestamp} compact={layout.compact} />
      <DetailsHostSlot agentId={agentId} itemKey={hostSlotKey} tokens={tokens} compact={layout.compact} />
    </View>
  );
}

export interface LiveUserMessagePayload {
  text: string;
  images?: string[];
  /** The host's own id for this message, when the provider gave one. */
  messageId?: string;
  /** The id this window gave the prompt when it sent it. */
  clientMessageId?: string;
}

/**
 * Usage is reported on the agent, not on the timeline item, so it is read from
 * the live agent handle while the turn runs and frozen once the agent leaves
 * `running`. A turn this client never observed live has no recoverable usage,
 * so its footer is omitted rather than filled with the current session total.
 */
const LIVE_WINDOW_MS = 5 * 60 * 1000;

/**
 * The usage row of a prompt observed live, in a child of its own (F2):
 * the agent subscription and the refresh RPC live here, so agent updates
 * re-render this row and never the prompt card's body.
 *
 * Only the newest prompt of the agent follows it (defect D3): an older
 * turn's figures are final, and subscribing every prompt to the agent
 * re-rendered all of them, with one refresh RPC each, on every agent update.
 * The selector returns a primitive, and a constant null once the card stops
 * tracking, so agent updates never reach older prompts at all.
 */
const LivePromptUsage = memo(function LivePromptUsage({
  agentId,
  promptKey,
  at,
  tokens,
}: {
  agentId: string;
  promptKey: string;
  at: number;
  tokens: ReturnType<typeof useThemeTokens>;
}) {
  const paseo = usePaseo();
  const handle = useMemo(() => paseo.agents.ref(agentId), [paseo, agentId]);
  const latest = useIsLatestPrompt(agentId, promptKey, at);
  const [usage, setUsage] = useState<TurnUsage | null>(null);
  const [frozen, setFrozen] = useState(false);
  const tracking = latest && !frozen;
  const liveKey = useAgent(agentId, (agent) =>
    tracking ? `${agent.status}|${agent.updatedAt}` : null,
  );
  const running = liveKey !== null && liveKey.startsWith("running|");

  useEffect(() => {
    if (!tracking) return;
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
  }, [handle, tracking, running, liveKey]);

  return <TurnUsageRow usage={usage} pending={running && tracking} tokens={tokens} />;
});

function LiveUserMessageRendererBody({
  item,
  theme,
  layout,
  host,
  agentId,
  timestamp,
}: PluginTimelineItemProps<LiveUserMessagePayload>) {
  const probe = probeCard("user_message", item.data.messageId ?? String(timestamp.getTime()));
  const rootRef = useRef<View>(null);
  useTimelineEntry(agentId, timestamp.getTime(), "prompt", `prompt:${item.data.messageId ?? item.data.text}`, rootRef);
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences, layout.platform);
  useSelectionActions(tokens, preferences.selectionActions);
  // Decided once, on mount: a replayed turn must not borrow later figures.
  const observedLive = useMemo(
    () => Date.now() - timestamp.getTime() < LIVE_WINDOW_MS,
    [timestamp],
  );
  const atMs = timestamp.getTime();
  const promptKey = item.data.messageId ?? `at:${atMs}`;
  const hostSlotKey = useRef(`prompt:${agentId}:${item.data.messageId ?? atMs}`).current;

  // The same envelopes reach this item kind on some hosts and on history
  // replay. A job result is not something the user said, so it never takes the
  // user bubble.
  const envelope = useMemo(() => parseSystemEnvelope(item.data.text), [item.data.text]);

  return (
    <View
      ref={rootRef}
      {...surfaceProps(itemRootFont(preferences.uiFont), pluginRoot)}
      {...probe.viewProps}
    >
      {promptAnchorIds(item.data.messageId, item.data.clientMessageId).map((id) => (
        <View key={id} {...promptAnchorMarker(id)} />
      ))}
      {probe.node}
      <PreferenceSyncSlot />
      {envelope ? (
        <SystemCard envelope={envelope} tokens={tokens} compact={layout.compact} />
      ) : (
        <UserMessage
          text={item.data.text}
          images={item.data.images}
          timestamp={timestamp}
          tokens={tokens}
          compact={layout.compact}
          actions={
            HOST_REWIND_MENU ? (
              <HOST_REWIND_MENU
                hostId={host.id}
                agentId={agentId}
                messageId={item.data.messageId}
                text={item.data.text}
              />
            ) : null
          }
          footer={
            observedLive ? (
              <LivePromptUsage agentId={agentId} promptKey={promptKey} at={atMs} tokens={tokens} />
            ) : null
          }
        />
      )}
      <DetailsHostSlot agentId={agentId} itemKey={hostSlotKey} tokens={tokens} compact={layout.compact} />
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
const ToolCallMemo = memo(LiveToolCallRendererBody, (a, b) => a.rollup === b.rollup && toolPropsEqual(a, b));
const ReasoningMemo = memo(LiveReasoningRendererBody, reasoningPropsEqual);
const TodoMemo = memo(LiveTodoRendererBody, todoPropsEqual);
const AssistantMemo = memo(LiveAssistantRendererBody, assistantPropsEqual);
const NoticeMemo = memo(LiveNoticeRendererBody, noticePropsEqual);
const UserMessageMemo = memo(LiveUserMessageRendererBody, userMessagePropsEqual);

/** A plain agent message reaches the transformer without its sender; its row reads it back. */
function SenderlessAgentMessage(props: PluginTimelineItemProps<LiveToolCallPayload> & { callId: string; rollups: boolean }) {
  const { callId, rollups, ...rest } = props;
  const sender = useAgentMessageSender(props.agentId, callId);
  const item = useMemo(() => (sender ? { ...props.item, data: { ...props.item.data, agentMessage: sender } } : props.item),
    [props.item, sender]);
  return rollups ? <RollupToolCall {...rest} item={item} /> : <ToolCallMemo {...rest} item={item} />;
}

export function LiveToolCallRenderer(props: PluginTimelineItemProps<LiveToolCallPayload>) {
  const preferences = useEnhancerPreferences();
  const data = props.item.data;
  return <BlockPlacement agentId={props.agentId} timestamp={props.timestamp} kind="tool">
    <ChatComposerContext.Provider value={props.composer}>
      {data.name === "agent_message" && !data.agentMessage && data.callId
        ? <SenderlessAgentMessage {...props} callId={data.callId} rollups={preferences.toolCallRollups} />
        : preferences.toolCallRollups ? <RollupToolCall {...props} /> : <ToolCallMemo {...props} />}
    </ChatComposerContext.Provider>
  </BlockPlacement>;
}

function RollupToolCall(props: PluginTimelineItemProps<LiveToolCallPayload>) {
  const position = useToolRollupPosition(props.agentId, props.item.data.callId);
  return <ToolCallMemo {...props} rollup={position} />;
}

export function LiveReasoningRenderer(props: PluginTimelineItemProps<LiveReasoningPayload>) {
  return <BlockPlacement agentId={props.agentId} timestamp={props.timestamp} kind="thought">
    <ChatComposerContext.Provider value={props.composer}><ReasoningMemo {...props} /></ChatComposerContext.Provider>
  </BlockPlacement>;
}

export function LiveTodoRenderer(props: PluginTimelineItemProps<LiveTodoPayload>) {
  return <BlockPlacement agentId={props.agentId} timestamp={props.timestamp} kind="todo">
    <ChatComposerContext.Provider value={props.composer}><TodoMemo {...props} /></ChatComposerContext.Provider>
  </BlockPlacement>;
}

export function LiveAssistantRenderer(props: PluginTimelineItemProps<LiveAssistantPayload>) {
  return <BlockPlacement agentId={props.agentId} timestamp={props.timestamp} kind="activity">
    <ChatComposerContext.Provider value={props.composer}><AssistantMemo {...props} /></ChatComposerContext.Provider>
  </BlockPlacement>;
}

export function LiveNoticeRenderer(props: PluginTimelineItemProps<LiveNoticePayload>) {
  return <BlockPlacement agentId={props.agentId} timestamp={props.timestamp} kind="activity">
    <ChatComposerContext.Provider value={props.composer}><NoticeMemo {...props} /></ChatComposerContext.Provider>
  </BlockPlacement>;
}

export function LiveUserMessageRenderer(props: PluginTimelineItemProps<LiveUserMessagePayload>) {
  return <BlockPlacement agentId={props.agentId} timestamp={props.timestamp} kind="activity">
    <ChatComposerContext.Provider value={props.composer}><UserMessageMemo {...props} /></ChatComposerContext.Provider>
  </BlockPlacement>;
}
