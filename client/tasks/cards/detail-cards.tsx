import React, { useCallback, useMemo, useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { createDetailChrome, useDetailChrome, type DetailChrome, type DetailChromeState } from "./detail-chrome";
import { Animated, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type TextStyle, type ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView as SheetScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { revealPathRpc } from "../../../shared/file-rpc";
import { openLink } from "../../components/open-link";
import { MarkdownView } from "../../components/markdown/markdown-view";
import { variantMetrics } from "../../components/markdown/render/styles";
import { mix, useThemeTokens, withAlpha } from "../../components/theme-tokens";
import { useEnhancerPreferences } from "../../preferences";
import { TaskText as Text, TASK_MONO as MONO, HOST_FONT as F, HOST_LINE, useTasksFontScale, useTasksFontAdjustment, taskControlHeight } from "../typography";
import { HoverPreviewContext } from "../../ui/hover-preview";
import { useHover } from "../../ui/use-hover";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { useInputCapabilities } from "../../ui/use-input-capabilities";
import { useCopy } from "../../ui/use-copy";
import { formatFullStamp } from "../../ui/time";
import type { TasksLanguage } from "../i18n";
import type { SessionTokens } from "../../../shared/tasks-rpc";
import { opensInPaseo, parentOpensInPaseo, remoteCard, turnRunning, type PermissionKind, type TaskCard, type TaskChild } from "../model";
import type { PermissionButton, StopPhase } from "../actions";
import { useTitleUpdateState, type TitleUpdateControl } from "../actions/title-update";
import type { FirstPrompt } from "../data/first-prompt";
import type { LastHumanMessage } from "../data/last-human-message";
import type { LastMessage } from "../data/last-message";
import { formatClockTime, formatDuration, formatRelative, formatTokenTotal, since, tildePath } from "./format";
import { cardStrings } from "./strings";
import { taskTokens, type TaskTokens } from "./tokens";
import { TagMark } from "./tag-mark";
import { SheetFoot, SheetScrollRoom, useAfterSheetMotion } from "../sheet-motion";
import { modeIcon, THINKING_ICON } from "./mode-icons";
import { BrandMark } from "./brand-mark";
import { SubtaskRow } from "./subtask-row";
import { SubagentLabel } from "./subagent-label";
import { TitleUndo } from "./title-undo";
import { TitleLoading } from "./title-loading";
import { useRevealedTitle } from "./title-reveal";
import { ArchivedTag, parentTag, type ParentTag } from "./archived-tag";
import { useTime, type TimeSource } from "./clock";
import { ProjectIcon } from "./project-icon";
import { SpinnerRing, StatusIcon } from "./status-icon";
import { UnreadIcon } from "./unread-icon";
import { cardTimer } from "./card-time";
import {
  branchHint,
  breakable,
  foldPath,
  NARROW_SUBTASKS,
  pathTokens,
  sortSubtasks,
  SUBTASK_ROWS,
  subtaskFinished,
  subtaskHeading,
  type SubtaskSummaryPart,
} from "./details-format";
import { ActionRow, layoutCeil, useActionFit } from "./action-row";
import { CardButton } from "./action-buttons";
import { ActionPressable } from "./action-pressable";
import { liftedButtonOutline, liftStyle, scaleStyle, surfaceLift } from "./surface-lift";
import { arrowInset, buttonHue, CONFIRM_STOP_ICON, requestLook, webTransition, type CardButtonLook } from "./action-style";
import { buttonOutline, MOTION } from "../board/board-style";
import { useBreathing, useFlash } from "../board/breathing";
import {
  contextView,
  detailHero,
  detailSections,
  replyBeforeHuman,
  errorLines,
  formatSpan,
  formatTurnClock,
  summaryTiles,
  timeline,
  tokenMix,
  usageSummary,
  type DetailSection,
} from "./detail-model";
import { Chip, ContextBar, SummaryTiles, TimelineChart, TokenBar, TurnHero, detailColors, statusColor } from "./detail-charts";
import { detailGutter, detailScrollProps, outsideIndicator } from "./detail-scrollbar";
import { sectionClosed, useSectionChoices, useSearchSectionChoices } from "./detail-collapse";
import { prepareSubtaskToggle, SubtaskPanel } from "./subtask-panel";
import { tipProps } from "./card-hints";
import { AvailabilityTag } from "./availability-tag";
import { highlightText } from "./search-highlight";
import { detailSearchHits, searchRanges, taskSearchHits } from "../data/search-hits";
import { taskOperationIssue } from "../availability";
import { TaskInlineQuestions } from "./question-dialog";
import type { QuestionDialogState, QuestionDialogStore } from "../actions/question-dialog";
import { TASK_TOOLBAR_METRICS } from "../toolbar-metrics";

/**
 * The details as one raised card, after Linear's issue panel
 * (`https://github.com/RoundRedDot/better-paseo/blob/f2ab453297c4ccb88a08e2129af0cb3528c4e628/docs/prototypes/task-details-rich.md`): the header (status, title, the
 * agent's chips and labels, the actions), then the block the card needs
 * first (the running turn, the permission request, the error, or a summary),
 * then collapsible sections: the first prompt, the last message a person sent, the latest reply, properties, subtasks, usage and activity, in an
 * order that follows the state. The desktop sidebar draws it at desktop
 * sizes; the phone's sheet and a tablet's touch sidebar at touch sizes.
 */
export const DETAIL_CARD = {
  radius: 12,
  gap: 8,
  padH: 12,
  padV: 6,
  row: 32,
  listRow: 30,
  heading: 32,
  /** Body text: the host's base step. */
  font: F.sm,
  /** The card's title: the host's large step. */
  title: F.base,
  icon: 16,
  chip: 20,
  button: 34,
  round: 28,
} as const;

const TOUCH_CARD = { ...DETAIL_CARD, row: 44, listRow: 44, heading: 44, icon: 18, chip: 24, button: 36, round: 36 } as const;

type Metrics = typeof DETAIL_CARD | typeof TOUCH_CARD;

/** Code lines (a permission's command, an error), 1.5 of their size as the host spaces its diff lines. */
const CODE_LINE = Math.round(F.sm * 1.5);

/** The properties get a label column from this width and lose it under `hide`: the 8 between keeps a drag from flickering it. */
const LABEL_COLUMN = { show: 448, hide: 440 } as const;

/**
 * On the web a row with buttons inside is a focusable `group`, not a button:
 * a `<button>` inside another is invalid HTML (see `task-card.tsx`).
 */
const ROW_ROLE = Platform.OS === "web" ? ({ role: "group" } as const) : ({ accessibilityRole: "button" } as const);

export function detailCardFrame(tokens: TaskTokens): ViewStyle {
  return {
    backgroundColor: tokens.card.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.card.border,
    borderRadius: DETAIL_CARD.radius,
    boxShadow: tokens.card.shadow,
  } as ViewStyle;
}

/** One raised card of the sidebar. */
export function DetailCard(props: { tokens: TaskTokens; style?: ViewStyle; testID?: string; children: React.ReactNode }) {
  return (
    <View testID={props.testID} style={[detailCardFrame(props.tokens), { paddingVertical: DETAIL_CARD.padV }, props.style]}>
      {props.children}
    </View>
  );
}

export interface DetailCardsStrings {
  close: string;
  searchMatches?: string;
  back(title: string): string;
  stopRun: string;
  openTab: string;
  property: { project: string; parent: string; branch: string; cwd: string; pr: string; labels: string };
}

export interface DetailNotice {
  icon: string;
  text: string;
  action?: { label: string; onPress(): void };
}

export type DetailScrollOffsets = { info: number; messages: number };

export interface TaskDetailCardsProps extends TimeSource {
  searchQuery?: string;
  card: TaskCard;
  theme: PluginTheme;
  language: TasksLanguage;
  strings: DetailCardsStrings;
  /** Touch sizes: the phone's sheet, a tablet's sidebar. */
  touch?: boolean;
  /** Match the phone board's pills; tablet and desktop cards use the regular size. */
  compact?: boolean;
  onClose?(): void;
  onSheetClose?(): void;
  /** Put question controls beside the question instead of in the sheet footer. */
  questionActionsInHeader?: boolean;
  onMenu?(point: { x: number; y: number }): void;
  sheetToggle?: { full: boolean; label: string; onPress(): void };
  /** Park the native indicator in the sheet's existing horizontal padding. The phone sheet has that padding and no `sheetToggle`. */
  indicatorOutside?: boolean;
  /** The card to go back to after a parent or subtask jump. */
  back?: { title: string; onPress(): void } | null;
  notice?: DetailNotice | null;
  onOpen?(agentId: string): void;
  /** Stop, when the card can be stopped; its phase names the button. */
  stop?: { phase: StopPhase; onPress(): void } | null;
  permissionButtons?: PermissionButton[];
  onPermission?(button: PermissionButton): void;
  submitQuestions?(state: QuestionDialogState): Promise<void>;
  questionDialog?: QuestionDialogStore;
  /** A parent or subtask row: show that card. */
  onJump?(agentId: string): void;
  /** A phone navigation captures both pages before the card unmounts. */
  onJumpWithScroll?(agentId: string, offsets: DetailScrollOffsets): void;
  onSubtaskMenu?(agentId: string, point: { x: number; y: number }): void;
  titleUpdates?: TitleUpdateControl;
  /** The task's first prompt, read from its timeline; absent leaves the section out (the settings preview). */
  firstPrompt?: { prompt: FirstPrompt; load(): void } | null;
  /** The last message a person sent, read back from the timeline's tail; absent (or the first prompt again) leaves the section out. */
  humanMessage?: { prompt: LastHumanMessage; load(): void } | null;
  /** The agent's latest reply, read from its timeline's tail; absent leaves the section out. */
  lastMessage?: { prompt: LastMessage; load(): void } | null;
  /** A running task's whole session's tokens, from the provider's session files; absent leaves them out of the running turn. */
  sessionTokens?: SessionTokens | null;
  /** Unarchive for an archived parent, and for an archived card itself; absent where this host cannot. */
  unarchive?: { pending(agentId: string): boolean; press(agentId: string): void } | null;
  /** Archive for a done task; absent where the board has none (the settings preview). */
  archive?: { pending(agentId: string): boolean; press(agentId: string): void } | null;
  /** Mark read for a card in review, as on its card; absent where this host cannot. */
  markRead?: DetailRead | null;
  /** Mark unread for a done card, to the left of Archive. */
  markUnread?: DetailRead | null;
  /** The sections scroll under the fixed header (the sidebar); else the card grows with them (the sheet). */
  scrollBody?: boolean;
  /**
   * Two columns that scroll on their own: the header, properties and subtasks
   * on the left, the other sections on the right. A
   * tablet's wide bottom sheet, where one column ran tall and sparse. The
   * card fills its parent.
   */
  columns?: boolean;
  /** The sidebar separates task information and messages. */
  tabs?: boolean;
  /** Restore the selected page when returning to this card. */
  initialTab?: "info" | "messages";
  initialScrollOffsets?: DetailScrollOffsets;
  onTabChange?(tab: "info" | "messages"): void;
  /** Touch and short sidebars scroll the header, with sticky tabs and fixed actions. */
  scrollHeader?: boolean;
  /** False when the actions live elsewhere (the phone's bar under the sheet). */
  actions?: boolean;
  /** The page still runs under the action bar. The phone's bar lives outside this card. */
  onScrollEdge?(contentUnderBar: boolean): void;
  testID?: string;
}

const MINUTE = 60_000;

/** Retain the last established order while independent reads have incomparable positions. */
function createMessageOrder() {
  let value: { id: string; replyFirst: boolean } | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    set(id: string, replyFirst: boolean) {
      if (value?.id === id && value.replyFirst === replyFirst) return;
      value = { id, replyFirst };
      for (const listener of listeners) listener();
    },
  };
}

/** The details card: the header and the lead block, then the sections. */
export function TaskDetailCards(given: TaskDetailCardsProps) {
  // An archived task has no Open, here or on its subtasks: Paseo would show another tab.
  const opened = withoutServerActions(opensInPaseo(given.card) ? given : { ...given, onOpen: undefined });
  // A person's only message is the first prompt, which its own section shows.
  const humanMessage = repeatsFirstPrompt(opened.humanMessage?.prompt, opened.firstPrompt?.prompt) ? null : opened.humanMessage;
  const props = humanMessage === opened.humanMessage ? opened : { ...opened, humanMessage };
  const { card } = props;
  const tokens = taskTokens(props.theme);
  const m: Metrics = props.touch ? TOUCH_CARD : DETAIL_CARD;
  // Minutes are enough for "8 分钟前"; the running timer reads the clock itself.
  const now = useTime(props, (time) => Math.floor(time / MINUTE) * MINUTE);
  // The caller's source, for what ticks each second: `now` below is whole minutes.
  const time: TimeSource = { now: props.now, clock: props.clock };
  const choices = useSectionChoices();
  const [tabState, selectTab] = useReducer(
    (state: { tab: "info" | "messages"; infoVisited: boolean }, tab: "info" | "messages") => ({ tab, infoVisited: state.infoVisited || tab === "info" }),
    { tab: props.initialTab ?? "messages", infoVisited: props.initialTab === "info" },
  );
  const tab = tabState.tab;
  // What layout and scrolling decide (pinned tabs, edges, a page's least height): only the parts that show it draw again.
  const [chrome] = useState(createDetailChrome);
  // Each fixed tab keeps its own scroller, so both edges follow the page on screen.
  const bodyEdges = useRef({ info: emptyScrollEdge(), messages: emptyScrollEdge() });
  const headerEdge = useRef(emptyScrollEdge());
  useEffect(() => {
    bodyEdges.current = { info: emptyScrollEdge(), messages: emptyScrollEdge() };
    headerEdge.current = emptyScrollEdge();
    chrome.set({ tabsPinned: false, bodyScrolled: false, bodyUnderBar: false, headerUnderBar: false });
  }, [chrome, card.id, props.scrollHeader]);
  const tabScroll = useRef<ScrollView>(null);
  // Native scroll bookkeeping does not need to redraw the card on every frame.
  const tabOffsets = useRef({ info: props.initialScrollOffsets?.info ?? 0, messages: props.initialScrollOffsets?.messages ?? 0, restoring: false });
  const initialRestore = useRef({ pending: !!props.initialScrollOffsets && props.initialScrollOffsets[tab] > 0, page: false, content: false });
  const restoreInitial = () => {
    const restore = initialRestore.current;
    if (!restore.pending || !restore.page || !restore.content) return;
    const offset = tabOffsets.current[tab];
    tabScroll.current?.scrollTo({ y: offset, animated: false });
    chrome.set({ tabsPinned: offset > 0 && offset >= chrome.get().tabTop });
    restore.pending = false;
  };
  const query = props.searchQuery?.trim().toLowerCase() ?? "";
  const prompt = props.firstPrompt?.prompt;
  const metadataHits = taskSearchHits(card, query, { title: true, project: true, workspace: true, branch: true, folder: true, path: true, modelPill: true, model: true, pullRequest: true, labels: card.labels.length, labelLimit: Infinity });
  const matching: DetailSection[] = [];
  if (metadataHits.some((hit) => hit.field !== "title" && hit.field !== "label")) matching.push("properties");
  if (prompt?.state === "ready" && searchRanges(prompt.text, query).length) matching.push("prompt");
  const searchChoices = useSearchSectionChoices(card.id, query, matching);
  const [messageOrder] = useState(createMessageOrder);
  const previousOrder = useSyncExternalStore(messageOrder.subscribe, messageOrder.get, messageOrder.get);
  const comparison = replyBeforeHuman(props.humanMessage?.prompt, props.lastMessage?.prompt);
  const replyFirst = comparison ?? (previousOrder?.id === card.id && previousOrder.replyFirst);
  useLayoutEffect(() => {
    if (comparison !== null) messageOrder.set(card.id, comparison);
  }, [messageOrder, card.id, comparison]);
  const replyStreaming = turnRunning(card) && (props.lastMessage?.prompt.state !== "ready" || !props.humanMessage || comparison === false);
  const waitingAfterHuman = turnRunning(card) && comparison === true;
  const { order, closed } = detailSections(card, !!props.firstPrompt, !!props.lastMessage, !!props.humanMessage, replyFirst);
  // Two columns: properties precede subtasks under the header; the other sections sit on the right.
  const leftSections: DetailSection[] = props.columns ? order.filter((section) => section === "properties" || section === "subtasks") : [];
  const rightOrder = order.filter((section) => !leftSections.includes(section));
  // A scroller's content gives its scrollbar the right edge of its padding (`detail-scrollbar.ts`).
  const gutter = props.columns || props.scrollBody || props.tabs ? detailGutter("inset") : 0;
  const sectionView = (section: DetailSection, divider: boolean) => (
    <Section
      key={section}
      section={section}
      replyStreaming={replyStreaming}
      waitingAfterHuman={waitingAfterHuman}
      divider={divider}
      closed={searchChoices.closed(section, sectionClosed(choices, section, closed.includes(section)))}
      onToggleSection={(closed) => searchChoices.toggle(section, closed)}
      {...props}
      onJump={props.onJumpWithScroll ? (id) => props.onJumpWithScroll?.(id, { info: tabOffsets.current.info, messages: tabOffsets.current.messages }) : props.onJump}
      m={m}
      tokens={tokens}
      now={now}
      time={time}
      gutter={gutter}
    />
  );
  const sections = order.map((section) => sectionView(section, true));
  const publishBody = (id: "info" | "messages", patch: Partial<ScrollEdge>) => {
    const next = { ...bodyEdges.current[id], ...patch };
    bodyEdges.current[id] = next;
    if (id !== tab) return;
    chrome.set({ bodyScrolled: next.y > 0, bodyUnderBar: contentUnderBar(next) });
  };
  const noteHeaderEdge = (patch: Partial<ScrollEdge>) => {
    const next = { ...headerEdge.current, ...patch };
    headerEdge.current = next;
    chrome.set({ headerUnderBar: contentUnderBar(next) });
  };
  // A sheet changing height resizes the scroller on every frame: its viewport (a page's least height) follows once it stands still.
  const noteViewport = useAfterSheetMotion((viewport: number) => {
    chrome.set({ viewport });
    noteHeaderEdge({ viewport });
  });
  const edgeListener = useRef(props.onScrollEdge);
  edgeListener.current = props.onScrollEdge;
  const questionInHeader = card.permission?.kind === "question" && !!props.onPermission && (props.permissionButtons?.length ?? 0) > 0 && (props.questionActionsInHeader === true || props.tabs === true && props.actions !== false);
  const tabs = props.tabs === true;
  const scrollHeader = props.scrollHeader === true;
  useEffect(() => {
    let last = tabs && (scrollHeader ? chrome.get().headerUnderBar : chrome.get().bodyUnderBar);
    edgeListener.current?.(last);
    return chrome.subscribe(() => {
      const next = tabs && (scrollHeader ? chrome.get().headerUnderBar : chrome.get().bodyUnderBar);
      if (next === last) return;
      last = next;
      edgeListener.current?.(next);
    });
  }, [chrome, tabs, scrollHeader]);
  if (props.tabs) {
    const messages: DetailSection[] = order.filter((section) => section === "prompt" || section === "human" || section === "message");
    // Info mounts on its first visit, then stays. Mounted with the card, the
    // hidden page took about a third of a touch card's render on an Android
    // foldable, at its opening and at every board update after it.
    const info: DetailSection[] = tabState.infoVisited
      ? (["properties", "subtasks", "usage", "activity"] as const).filter((section) => order.includes(section))
      : [];
    const TabPages = props.touch ? React.Fragment : View;
    const tabBar = (
      // Sticky headers replace their direct child's style and call its onLayout: both stay props of the anchor element.
      <DetailTabBar chrome={chrome} scrollHeader={scrollHeader} tokens={tokens} onLayout={props.scrollHeader ? (event) => {
        const { y, height } = event.nativeEvent.layout;
        chrome.set({ tabTop: y, tabHeight: height });
      } : undefined}>
          {(["info", "messages"] as const).map((id) => (
            <DetailTab key={id} id={id} selected={tab === id} tokens={tokens} touch={props.touch === true} label={id === "info" ? (props.language === "zh" ? "基本信息" : "Info") : (props.language === "zh" ? "消息" : "Messages")} onPress={() => {
              if (id === tab) return;
              initialRestore.current.pending = false;
              // Switching pages must not reveal a header the reader already scrolled past.
              if (props.scrollHeader) tabOffsets.current[id] = Math.max(tabOffsets.current[id], Math.min(tabOffsets.current[tab], chrome.get().tabTop));
              tabOffsets.current.restoring = props.scrollHeader === true;
              if (!props.scrollHeader) chrome.set({ bodyScrolled: bodyEdges.current[id].y > 0, bodyUnderBar: contentUnderBar(bodyEdges.current[id]) });
              selectTab(id);
              props.onTabChange?.(id);
            }} />
          ))}
      </DetailTabBar>
    );
    const parked = outsideIndicator(props.sheetToggle != null || props.indicatorOutside === true);
    return (
      <View testID={props.testID ?? "detail-cards"} style={[detailCardFrame(tokens), { flex: 1, minHeight: 0 }]}>
        {props.scrollHeader ? (
          <>
          <DetailStatusRow {...props} m={m} tokens={tokens} now={now} time={time} fixed />
          <SheetScrollRoom>
          <SheetScrollView
            key={card.id}
            ref={tabScroll}
            style={{ flex: 1, marginRight: parked?.marginRight ?? 0 }}
            contentContainerStyle={parked ? { paddingRight: parked.paddingRight } : undefined}
            stickyHeaderIndices={[1]}
            scrollEventThrottle={16}
            onLayout={(event) => noteViewport(event.nativeEvent.layout.height)}
            onContentSizeChange={(_width, height) => {
              noteHeaderEdge({ content: height });
              if (height > 0) initialRestore.current.content = true;
              restoreInitial();
            }}
            onScroll={(event) => {
              const native = event.nativeEvent;
              const offset = Math.max(0, native.contentOffset.y);
              noteHeaderEdge({
                y: offset,
                ...(native.layoutMeasurement ? { viewport: native.layoutMeasurement.height } : null),
                ...(native.contentSize ? { content: native.contentSize.height } : null),
              });
              if (tabOffsets.current.restoring || initialRestore.current.pending) return;
              tabOffsets.current[tab] = offset;
              chrome.set({ tabsPinned: offset > 0 && offset >= chrome.get().tabTop });
            }}
            {...detailScrollProps("inset")}
            testID="detail-tab-short-scroll"
          >
            <DetailHeader {...props} questionActionsInHeader={questionInHeader} actions={false} m={m} tokens={tokens} now={now} time={time} gutter={gutter} hideStatus />
            {tabBar}
            {(["info", "messages"] as const).map((id) => (
              <DetailTabPage
                key={id}
                id={id}
                chrome={chrome}
                active={tab === id}
                touch={props.touch === true}
                onLayout={() => {
                  if (tab === id && initialRestore.current.pending) {
                    initialRestore.current.page = true;
                    restoreInitial();
                    return;
                  }
                  if (tab !== id || !tabOffsets.current.restoring) return;
                  // Restore after the newly visible page has its native layout.
                  tabScroll.current?.scrollTo({ y: tabOffsets.current[id], animated: false });
                  chrome.set({ tabsPinned: tabOffsets.current[id] > 0 && tabOffsets.current[id] >= chrome.get().tabTop });
                  tabOffsets.current.restoring = false;
                }}
              >
                {(id === "info" ? info : messages).map((section, index) => sectionView(section, index > 0))}
                {id === "messages" ? <PendingQuestions card={card} tokens={tokens} language={props.language} theme={props.theme} compact={props.compact} submit={props.submitQuestions} source={props.questionDialog} /> : null}
              </DetailTabPage>
            ))}
          </SheetScrollView>
          </SheetScrollRoom>
          </>
        ) : (
          <>
            <DetailHeader {...props} questionActionsInHeader={questionInHeader} actions={false} m={m} tokens={tokens} now={now} time={time} />
            {tabBar}
            <TabPages {...(!props.touch ? { style: { flex: 1, minHeight: 0 } } : {})}>
              <View style={props.touch ? { flex: 1, minHeight: 0, display: tab === "info" ? "flex" : "none" } : { position: "absolute", inset: 0, ...({ visibility: tab === "info" ? "visible" : "hidden" } as object) }}>
                <ScrollView key={`${card.id}-info`} style={{ flex: 1 }} {...detailScrollProps("inset")} scrollEventThrottle={16} onScroll={(event) => publishBody("info", scrollEdgePatch(event.nativeEvent))} onLayout={(event) => publishBody("info", { viewport: event.nativeEvent.layout.height })} onContentSizeChange={(_width, height) => publishBody("info", { content: height })} testID="detail-tab-info-scroll">
                  {info.map((section, index) => sectionView(section, index > 0))}
                </ScrollView>
              </View>
              <View style={props.touch ? { flex: 1, minHeight: 0, display: tab === "messages" ? "flex" : "none" } : { position: "absolute", inset: 0, ...({ visibility: tab === "messages" ? "visible" : "hidden" } as object) }}>
                <ScrollView key={`${card.id}-messages`} style={{ flex: 1 }} {...detailScrollProps("inset")} scrollEventThrottle={16} onScroll={(event) => publishBody("messages", scrollEdgePatch(event.nativeEvent))} onLayout={(event) => publishBody("messages", { viewport: event.nativeEvent.layout.height })} onContentSizeChange={(_width, height) => publishBody("messages", { content: height })} testID="detail-tab-messages-scroll">
                  {messages.map((section, index) => sectionView(section, index > 0))}
                  <PendingQuestions card={card} tokens={tokens} language={props.language} theme={props.theme} compact={props.compact} submit={props.submitQuestions} source={props.questionDialog} />
                </ScrollView>
              </View>
            </TabPages>
          </>
        )}
        {props.actions !== false && !questionInHeader ? (
          <SheetFoot card={{ background: tokens.card.background, border: tokens.card.border, radius: DETAIL_CARD.radius }}>
            <View testID="detail-action-bar-frame" style={{ paddingBottom: props.touch && props.sheetToggle && Platform.OS === "android" ? 6 : 10 }}><EdgeActionBar {...props} chrome={chrome} scrollHeader={scrollHeader} onClose={props.onSheetClose} sidebar smallTablet={!!(props.touch && props.sheetToggle && Platform.OS === "android")} /></View>
          </SheetFoot>
        ) : null}
      </View>
    );
  }
  if (props.columns) {
    return (
      <View testID={props.testID ?? "detail-cards"} style={[detailCardFrame(tokens), { flex: 1, minHeight: 0, flexDirection: "row" }]}>
        {/* Plain views share the width (a ScrollView's own flex is not honoured on iOS); each scroll fills its half. */}
        <View style={{ flex: 1.2, minWidth: 0 }}>
          <ScrollView key={`${card.id}-head`} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 4 }} {...detailScrollProps("inset")} testID="detail-column-head">
            <DetailHeader {...props} m={m} tokens={tokens} now={now} time={time} gutter={gutter} />
            {leftSections.map((section) => sectionView(section, true))}
          </ScrollView>
        </View>
        <View style={{ width: StyleSheet.hairlineWidth, marginVertical: 12, backgroundColor: tokens.card.border }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <ScrollView key={`${card.id}-sections`} style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 2, paddingBottom: 4 }} {...detailScrollProps("inset")} testID="detail-column-sections">
            {rightOrder.map((section, index) => sectionView(section, index > 0))}
            <PendingQuestions card={card} tokens={tokens} language={props.language} theme={props.theme} compact={props.compact} submit={props.submitQuestions} source={props.questionDialog} />
          </ScrollView>
        </View>
      </View>
    );
  }
  return (
    <View testID={props.testID ?? "detail-cards"} style={[detailCardFrame(tokens), props.scrollBody ? { flexShrink: 1, minHeight: 0 } : null]}>
      <DetailHeader {...props} m={m} tokens={tokens} now={now} time={time} />
      {props.scrollBody ? (
        <ScrollView key={card.id} style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 4 }} {...detailScrollProps("inset")} testID="detail-body-scroll">
          {sections}
          <PendingQuestions card={card} tokens={tokens} language={props.language} theme={props.theme} compact={props.compact} submit={props.submitQuestions} source={props.questionDialog} />
        </ScrollView>
      ) : (
        <View style={{ paddingBottom: 4 }}>{sections}<PendingQuestions card={card} tokens={tokens} language={props.language} theme={props.theme} compact={props.compact} submit={props.submitQuestions} source={props.questionDialog} /></View>
      )}
    </View>
  );
}

type ScrollEdge = { y: number; viewport: number; content: number };

const tabsPinnedOf = (state: DetailChromeState) => state.tabsPinned;
const bodyScrolledOf = (state: DetailChromeState) => state.bodyScrolled;
const headerUnderBarOf = (state: DetailChromeState) => state.headerUnderBar;
const bodyUnderBarOf = (state: DetailChromeState) => state.bodyUnderBar;
const leastPageOf = (state: DetailChromeState) => Math.max(0, state.viewport - state.tabHeight);

/** The tab row: sticky tabs cast their shadow once they pin, fixed tabs once their page has scrolled under them. */
function DetailTabBar(props: { chrome: DetailChrome; scrollHeader: boolean; tokens: TaskTokens; style?: ViewStyle; onLayout?(event: LayoutChangeEvent): void; children: React.ReactNode }) {
  const shadowed = useDetailChrome(props.chrome, props.scrollHeader ? tabsPinnedOf : bodyScrolledOf);
  const tabShadow = shadowed ? scrollEdgeShadow(props.tokens.isDark, "down") : undefined;
  return (
    // Sticky headers replace their direct child's style; keep the row one level inside.
    <View testID="detail-tab-anchor" style={props.style ?? (tabShadow && !props.scrollHeader ? { position: "relative", zIndex: 1 } : undefined)} onLayout={props.onLayout}>
      <View accessibilityRole="tablist" testID="detail-tabs" style={{ flexDirection: "row", paddingHorizontal: 10, paddingTop: props.scrollHeader ? 8 : 0, paddingBottom: 8, gap: 6, backgroundColor: props.tokens.card.background, boxShadow: tabShadow }}>
        {props.children}
      </View>
    </View>
  );
}

/** A sticky-tab page: at least the scroller's height under the tabs, so switching pages does not jump. */
function DetailTabPage(props: { id: "info" | "messages"; chrome: DetailChrome; active: boolean; touch: boolean; onLayout(): void; children: React.ReactNode }) {
  const least = useDetailChrome(props.chrome, leastPageOf);
  return (
    <View
      testID={`detail-tab-${props.id}-content`}
      // Keep desktop panel measurements alive while clipping the inactive page out of the shared scroll range.
      style={!props.touch && !props.active ? { height: 0, minHeight: 0, overflow: "hidden", ...({ visibility: "hidden" } as object) } : { display: props.active ? "flex" : "none", minHeight: least }}
      onLayout={props.onLayout}
    >
      {props.children}
    </View>
  );
}

/** The card's action bar, casting its edge while content runs under it. */
export function EdgeActionBar(props: React.ComponentProps<typeof DetailActionBar> & { chrome: DetailChrome; scrollHeader: boolean }) {
  const { chrome, scrollHeader, ...bar } = props;
  const under = useDetailChrome(chrome, scrollHeader ? headerUnderBarOf : bodyUnderBarOf);
  return <DetailActionBar {...bar} contentUnder={under} />;
}

function PendingQuestions({ card, tokens, language, theme, compact, submit, source }: { card: TaskCard; tokens: TaskTokens; language: TasksLanguage; theme: PluginTheme; compact?: boolean; submit?: (state: QuestionDialogState) => Promise<void>; source?: QuestionDialogStore }) {
  const questions = card.lane === "needs_input" ? card.permission?.questions : undefined;
  if (!questions?.length) return null;
  if (submit && source) return <View testID="detail-pending-questions" style={{ paddingTop: 12 }}>
    <Text style={{ paddingHorizontal: 12, fontSize: F.sm, fontWeight: "600", color: tokens.foreground }}>{language === "zh" ? "待回答问题" : "Questions awaiting an answer"}</Text>
    <TaskInlineQuestions card={card} source={source} submit={submit} theme={theme} language={language} compact={compact} />
  </View>;
  return <View testID="detail-pending-questions" style={{ paddingHorizontal: 12, paddingVertical: 12, gap: 12 }}>
    <Text style={{ fontSize: F.sm, fontWeight: "600", color: tokens.foreground }}>{language === "zh" ? "待回答问题" : "Questions awaiting an answer"}</Text>
    {questions.map((question, index) => <View key={index} testID="detail-pending-question" style={{ gap: 16, padding: 12, borderWidth: 1, borderColor: tokens.border, borderRadius: 8, backgroundColor: tokens.surface1 }}>
      <Text style={{ fontSize: F.base, color: tokens.foreground }}>{question.question}</Text>
      {question.options.map((option, optionIndex) => <View key={optionIndex} testID="detail-pending-option" style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <View style={{ paddingTop: 2 }}><Icon name={question.multiSelect ? "Square" : "Circle"} size={16} color={tokens.foregroundMuted} /></View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={{ fontSize: F.sm, color: tokens.foreground }}>{option.label}</Text>
          {option.description ? <Text style={{ fontSize: F.sm, color: tokens.foregroundMuted }}>{option.description}</Text> : null}
        </View>
      </View>)}
    </View>)}
  </View>;
}

function emptyScrollEdge(): ScrollEdge {
  return { y: 0, viewport: 0, content: 0 };
}

/** Content still runs past the bottom of the scroller, so it sits under the action bar. */
function contentUnderBar(edge: ScrollEdge): boolean {
  return edge.viewport > 0 && edge.y + edge.viewport < edge.content - 1;
}

function scrollEdgePatch(native: { contentOffset: { y: number }; layoutMeasurement?: { height: number }; contentSize?: { height: number } }): Partial<ScrollEdge> {
  return {
    y: Math.max(0, native.contentOffset.y),
    ...(native.layoutMeasurement ? { viewport: native.layoutMeasurement.height } : null),
    ...(native.contentSize ? { content: native.contentSize.height } : null),
  };
}

/** The same soft edge on every detail scroller: down from the tabs, up from the action bar. */
function scrollEdgeShadow(isDark: boolean, direction: "down" | "up"): string {
  return `0px ${direction === "down" ? 5 : -5}px 8px -4px rgba(0, 0, 0, ${isDark ? 0.36 : 0.14})`;
}

/** `gutter`: the room a scroller's scrollbar takes from the right padding (0 outside one). */
type Inner = TaskDetailCardsProps & { m: Metrics; tokens: TaskTokens; now: number; time: TimeSource; gutter?: number };

function DetailTab(props: { id: "info" | "messages"; selected: boolean; tokens: TaskTokens; touch: boolean; label: string; onPress(): void }) {
  const scale = useTasksFontScale();
  const { hovered, hoverProps } = useHover();
  const color = props.selected ? props.tokens.foreground : props.tokens.foregroundMuted;
  return (
    <Pressable
      {...hoverProps}
      testID={`detail-tab-${props.id}`}
      accessibilityRole="tab"
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      style={({ pressed }) => {
        const lift = surfaceLift(hovered, pressed);
        return { flex: 1, minWidth: 0, height: taskControlHeight(props.touch ? 30 : 32, scale), borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, backgroundColor: props.selected ? props.tokens.surface2 : "transparent", flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 4, paddingHorizontal: 6, ...liftStyle(props.tokens, lift, { border: props.selected ? props.tokens.surface2 : props.tokens.card.pillBorder }), ...scaleStyle(lift.scale) };
      }}
    >
      <Icon name={props.id === "info" ? "Info" : "MessageSquare"} size={props.touch ? 12 : 14} color={color} />
      <Text numberOfLines={1} style={{ fontSize: props.touch ? F.sm : F.base, fontWeight: "500", color, flexShrink: 1 }}>{props.label}</Text>
    </Pressable>
  );
}

function stopLabel(props: TaskDetailCardsProps): string | null {
  if (!props.stop) return null;
  const cardText = cardStrings(props.language);
  // Stopping keeps the rest label; the button's spinner says it is working.
  if (props.stop.phase === "confirming") return props.card.stoppable ? cardText.confirmStop : cardText.confirmStopAll;
  return props.card.stoppable ? props.strings.stopRun : cardText.stopChildren;
}


/** The header: status, title, the agent's chips and labels, the actions, then the block the card needs first. */
function DetailStatusRow(props: Inner & { fixed?: boolean }) {
  const { card, m, tokens, touch = false } = props;
  const scale = useTasksFontScale();
  const controls = touch ? TASK_TOOLBAR_METRICS.touch : TASK_TOOLBAR_METRICS.desktop;
  const menuRef = useRef<View>(null);
  const cardText = cardStrings(props.language);
  // The corner control (close, or the sheet's size switch) sits on the card
  // corner's diagonal: its centre as far from the card's right edge as from
  // its top. The row's padding put it 6 points further in than down on touch
  // (28 against 22) and 4 on the desktop; the menu beside it moves with it.
  const atCorner = props.fixed === true || (!props.back && !props.notice);
  const rowCentre = props.fixed ? 8 + (m.round - 8) / 2 : 8 + m.round / 2;
  const toCorner = atCorner ? Math.min(0, rowCentre - (m.padH + taskControlHeight(controls.button, scale) / 2)) : 0;
  return (
    <View testID="detail-status-row" style={[{ minHeight: m.round, flexDirection: "row", alignItems: "center", gap: 6 }, props.fixed ? { paddingHorizontal: m.padH, paddingTop: 8, backgroundColor: tokens.card.background, borderTopLeftRadius: DETAIL_CARD.radius, borderTopRightRadius: DETAIL_CARD.radius } : null]}>
      <StatusIcon kind={card.stoppedManually ? "stopped" : card.status} size={14} theme={props.theme} />
      <Text style={{ fontSize: F.sm, fontWeight: "500", color: tokens.foreground }}>
        {card.stoppedManually ? cardText.details.stoppedTitle : cardText.status[card.status]}
      </Text>
      <StatusSub {...props} small={F.sm} />
      <View style={{ flex: 1 }} />
      <View testID="detail-header-controls" style={{ flexDirection: "row", alignItems: "center", gap: TASK_TOOLBAR_METRICS.touch.gap, marginRight: toCorner }}>
        {props.onMenu ? <View ref={menuRef} collapsable={false}><RoundIcon icon="MoreVertical" label={props.language === "zh" ? "卡片菜单" : "Card menu"} size={taskControlHeight(controls.button, scale)} iconSize={touch ? controls.icon : taskControlHeight(controls.icon, scale)} tokens={tokens} testID="detail-menu" onPress={() => menuRef.current?.measureInWindow((x, y, width, height) => props.onMenu?.({ x: x + width, y: y + height }))} /></View> : null}
        {props.sheetToggle ? <RoundIcon icon={props.sheetToggle.full ? "Minimize2" : "Maximize2"} label={props.sheetToggle.label} size={taskControlHeight(controls.button, scale)} iconSize={touch ? controls.icon : taskControlHeight(controls.icon, scale)} tokens={tokens} testID="detail-sheet-toggle" onPress={props.sheetToggle.onPress} /> : null}
        {props.onClose && !props.onSheetClose ? <RoundIcon icon="X" label={props.strings.close} size={taskControlHeight(controls.button, scale)} iconSize={touch ? controls.icon : taskControlHeight(controls.icon, scale)} tokens={tokens} onPress={props.onClose} testID="detail-close" /> : null}
      </View>
    </View>
  );
}

function DetailHeader(props: Inner & { hideStatus?: boolean }) {
  const { card, m, tokens, touch = false } = props;
  const titleUpdate = useTitleUpdateState(props.titleUpdates, card.id);
  const streamedTitle = titleUpdate.state === "running" ? titleUpdate.text?.replace(/\s+/g, " ").trim() : undefined;
  const shownTitle = useRevealedTitle(streamedTitle || (titleUpdate.state === "done" ? titleUpdate.title : card.title), Boolean(streamedTitle) || titleUpdate.state === "done");
  const updatingTitle = titleUpdate.state === "running" || titleUpdate.state === "done" && shownTitle !== titleUpdate.title || titleUpdate.state === "idle" && shownTitle !== card.title;
  // A title that overflows opens folded on every card, as the sidebar's messages do.
  const [foldedTitle, setFoldedTitle] = useState<{ id: string; open: boolean }>({ id: card.id, open: false });
  const titleOpen = foldedTitle.id === card.id && foldedTitle.open;
  const titleLine = Math.round(HOST_LINE.base * useTasksFontScale());
  useEffect(() => {
    if (titleUpdate.state === "done" && shownTitle === titleUpdate.title) props.titleUpdates?.showUndo(card.id);
  }, [titleUpdate, shownTitle, card.id, props.titleUpdates]);
  const cardText = cardStrings(props.language);
  const { pair } = cardText.hint;
  const small = F.sm;
  const chipFont = F.sm * (11 / 12);
  const iconSize = props.compact ? 12 : 11;
  const chipHeight = props.compact ? TOUCH_CARD.chip : DETAIL_CARD.chip;
  const hero = detailHero(card);
  const questionInHeader = props.questionActionsInHeader === true && card.permission?.kind === "question" && !!props.onPermission && (props.permissionButtons?.length ?? 0) > 0;
  const mode = card.modeLabel ? modeIcon(card.provider, card.modeLabel) : null;
  const stop = stopLabel(props);
  // An archived task can be brought back; one of an archived workspace has nothing of its own to unarchive.
  const unarchive = card.archived === "agent" ? props.unarchive ?? null : null;
  const archive = archivable(card) ? props.archive ?? null : null;
  const unread = unreadable(card) ? props.markUnread ?? null : null;
  const read = readable(card, stop, props.markRead);
  // A provider subagent has no tab of its own (its Open would open the
  // parent's), so, as on its card, "Open parent" is its only open button.
  const parentOpens = !!props.onOpen && parentOpensInPaseo(card);
  const ownOpen = !!props.onOpen && !card.subagent;
  const showActions = props.actions !== false && (ownOpen || parentOpens || !!stop || !!read || !!unread || !!unarchive || !!archive);
  // Open tab takes the row's room: first on desktop, last on touch, where the
  // phone's bar and the cards end with it too. Its label is the card's.
  const openButton = ownOpen ? (
    <OutlineButton
      label={cardText.openTab}
      look="primary"
      hint={card.openTab ? <OpenHint tokens={tokens} label={cardText.details.tabOpen} /> : null}
      trailing="ArrowUpRight"
      height={m.button}
      font={m.font}
      tokens={tokens}
      grow
      onPress={() => props.onOpen?.(card.id)}
      testID="detail-open"
    />
  ) : null;
  // An archived task has no Open tab (Paseo would show another tab), so Unarchive takes its place.
  const unarchiveButton = unarchive ? (
    <OutlineButton
      icon="ArchiveRestore"
      label={cardText.details.unarchive}
      busy={unarchive.pending(card.id)}
      height={m.button}
      font={m.font}
      tokens={tokens}
      grow={!openButton && !parentOpens}
      onPress={() => unarchive.press(card.id)}
      testID="detail-unarchive"
      disabled={!!taskOperationIssue(card, "unarchive")}
    />
  ) : null;
  // Mark unread sits immediately left of Archive. The frame and label are the review lane's green; the dot is that lane's mark.
  const unreadButton = unread ? (
    <OutlineButton
      glyph={(color, size) => <UnreadIcon size={size} color={color} />}
      look="unread"
      label={cardText.markUnread}
      busy={unread.pending(card.id)}
      height={m.button}
      font={m.font}
      tokens={tokens}
      grow={!openButton && !parentOpens}
      onPress={() => unread.press(card)}
      testID="detail-unread"
    />
  ) : null;
  // A done task's Archive sits beside Open tab.
  const archiveButton = archive ? (
    <OutlineButton
      icon="Archive"
      look="archive"
      label={cardText.details.archive}
      busy={archive.pending(card.id)}
      height={m.button}
      font={m.font}
      tokens={tokens}
      grow={!openButton && !parentOpens}
      onPress={() => archive.press(card.id)}
      testID="detail-archive"
      disabled={!!taskOperationIssue(card, "archive")}
    />
  ) : null;
  // A subtask's "Open parent" comes before Open tab, as on its card.
  const openParent = parentOpens ? (
    <OutlineButton
      icon="CornerLeftUp"
      label={cardText.openParent}
      look="primary"
      height={m.button}
      font={m.font}
      tokens={tokens}
      // A subagent's only open button takes the row's room, as Open tab does.
      grow={!openButton}
      onPress={() => props.onOpen?.(card.parent!.id)}
      testID="detail-open-parent"
    />
  ) : null;
  const opens = !!openButton || !!openParent;
  const lead = opens ? (
    <>
      {openParent}
      {openButton}
    </>
  ) : unarchiveButton;
  return (
    <View style={{ paddingLeft: m.padH, paddingRight: m.padH - (props.gutter ?? 0), paddingTop: props.hideStatus ? 0 : 8, paddingBottom: 12 }} testID="detail-header">
      {props.back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.strings.back(props.back.title)}
          {...tipProps(props.strings.back(props.back.title))}
          onPress={props.back.onPress}
          testID="detail-back"
          style={{ minHeight: touch ? 36 : 24, flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}
        >
          <Icon name="ArrowLeft" size={14} color={tokens.foregroundMuted} />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: small, color: tokens.foregroundMuted }}>
            {props.strings.back(props.back.title)}
          </Text>
          {Platform.OS === "web" && !touch ? <KeyCap label="Esc" tokens={tokens} /> : null}
        </Pressable>
      ) : null}
      {props.notice ? (
        <View testID="detail-notice" style={{ minHeight: touch ? 36 : 28, marginBottom: 4, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, borderRadius: 6, backgroundColor: tokens.surface1 }}>
          <Icon name={props.notice.icon} size={14} color={tokens.foregroundMuted} />
          <Text numberOfLines={2} style={{ flex: 1, fontSize: small, color: tokens.foregroundMuted }}>
            {props.notice.text}
          </Text>
          {props.notice.action ? (
            <Pressable accessibilityRole="button" {...tipProps(props.notice.action.label)} onPress={props.notice.action.onPress} hitSlop={6}>
              <Text style={{ fontSize: small, fontWeight: "500", color: tokens.accentText }}>{props.notice.action.label}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {props.hideStatus ? null : <DetailStatusRow {...props} />}
      <View style={{ marginTop: 2, flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
        {card.subagent ? <SubagentLabel language={props.language} tokens={tokens} testID="detail-session-label" /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          {updatingTitle
            ? <TitleLoading title={shownTitle} mutedColor={tokens.foregroundMuted} highlightColor={tokens.isDark ? tokens.foreground : mix(tokens.card.background, tokens.foregroundMuted, 0.45)} accessibilityLabel={cardText.autoTitlePending} style={{ fontSize: m.title, lineHeight: HOST_LINE.base, fontWeight: "600" }} />
            : <FoldedText
                id="detail-title"
                language={props.language}
                tokens={tokens}
                line={titleLine}
                limit={TITLE_LINES}
                expanded={titleOpen}
                fadeColor={tokens.card.background}
                touch={touch}
                onToggle={() => setFoldedTitle({ id: card.id, open: !titleOpen })}
              >
                <Text style={{ minWidth: 0, fontSize: m.title, lineHeight: HOST_LINE.base, fontWeight: "600", color: tokens.foreground }} testID="detail-title">
                  {highlightText(shownTitle, props.searchQuery ?? "", tokens.isDark)}
                </Text>
              </FoldedText>}
        </View>
        <View pointerEvents="box-none" style={{ position: "absolute", right: 0, top: 0 }}>
          <TitleUndo agentId={card.id} control={props.titleUpdates} tokens={tokens} language={props.language} touch={touch} fadeColor={tokens.card.background} />
        </View>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }} testID="detail-agent">
        <Chip
          tokens={tokens}
          compact={props.compact}
          height={chipHeight}
          font={chipFont}
          lead={card.providerMark !== null ? <BrandMark provider={card.provider} size={iconSize} tokens={tokens} /> : null}
          // A provider subagent's model comes from its facts line; a line that names neither model nor effort stands in whole.
          text={card.modelLabel ?? (card.thinkingLabel ? null : card.subagent?.subtitle) ?? card.providerLabel}
          tip={pair(cardText.hint.model, card.modelLabel ? `${card.providerLabel} ${card.modelLabel}` : card.providerLabel)}
          renderText={props.searchQuery ? (text) => highlightText(text, props.searchQuery!, tokens.isDark) : undefined}
          testID="detail-model"
        />
        {card.thinkingLabel ? (
          <Chip tokens={tokens} compact={props.compact} height={chipHeight} font={chipFont} muted lead={<Icon name={THINKING_ICON} size={iconSize} color={tokens.foregroundMuted} />} text={card.thinkingLabel} tip={pair(cardText.hint.thinking, card.thinkingLabel)} testID="detail-thinking" />
        ) : null}
        {card.modeLabel && mode ? (
          <Chip
            tokens={tokens}
            compact={props.compact}
            height={chipHeight}
            font={chipFont}
            muted
            // Bypassing permissions is worth a glance: its shield wears the warning colour.
            lead={<Icon name={mode} size={iconSize} color={mode === "ShieldOff" ? tokens.warning : tokens.foregroundMuted} />}
            text={card.modeLabel}
            tip={pair(cardText.details.mode, card.modeLabel)}
            testID="detail-mode"
          />
        ) : null}
        {card.labels.map((tag) => (
          <Chip
            key={tag.name}
            tokens={tokens}
            compact={props.compact}
            height={chipHeight}
            font={chipFont}
            lead={<TagMark size={iconSize} color={tag.color ?? tokens.foregroundMuted} hole={tokens.card.background} />}
            text={tag.name}
            tip={pair(cardText.hint.label, tag.name)}
            testID={`detail-label-${tag.name}`}
            renderText={props.searchQuery ? (text) => highlightText(text, props.searchQuery!, tokens.isDark) : undefined}
          />
        ))}
      </View>
      <AvailabilityTag issue={card.availability?.issue} language={props.language} tokens={tokens} theme={props.theme} compact={touch} />
      {showActions ? (
        <ActionRow style={{ marginTop: 12, ...(touch && Platform.OS !== "web" ? { paddingVertical: 4, alignItems: "center" } : null) }} testID="detail-actions">
          {touch ? null : lead}
          {stop && props.stop ? (
            <OutlineButton
              icon={props.stop.phase === "confirming" ? CONFIRM_STOP_ICON : "Power"}
              look="danger"
              label={stop}
              busy={props.stop.phase === "stopping"}
              height={m.button}
              font={m.font}
              tokens={tokens}
              onPress={props.stop.onPress}
              testID="detail-stop"
            />
          ) : null}
          {read ? (
            <OutlineButton
              icon="CheckCheck"
              // An unread card's green; a failed card's stays plain, as on the card.
              look={card.status === "failed" ? "plain" : "read"}
              label={cardText.markRead}
              busy={read.pending(card.id)}
              height={m.button}
              font={m.font}
              tokens={tokens}
              onPress={() => read.press(card)}
              testID="detail-read"
              disabled={!!taskOperationIssue(card, "read")}
            />
          ) : null}
          {unreadButton}
          {archiveButton}
          {opens ? unarchiveButton : null}
          {touch ? lead : null}
        </ActionRow>
      ) : null}
      {questionInHeader ? <DetailActionBar {...props} controlsOnly onClose={props.onSheetClose} /> : null}
      <View testID={card.permission?.kind === "question" ? "detail-question-section" : undefined} style={{ marginTop: 12, ...(card.permission?.kind === "question" ? { paddingTop: 12, borderTopWidth: 0.5, borderTopColor: tokens.border } : null) }}>
        {hero === "turn" ? <RunningTurn {...props} /> : null}
        {hero === "permission" ? <PermissionBlock {...props} actions={questionInHeader ? true : props.actions} /> : null}
        {hero === "error" ? <ErrorBlock {...props} /> : null}
        {hero === "summary" ? <SummaryTiles tiles={summaryTiles(card, props.now, props.language)} tokens={tokens} touch={touch} /> : null}
      </View>
    </View>
  );
}

/** Beside the status: the running turn's clock, else the card's timer ("等待 3m", "8m · 12 分钟前"). */
function StatusSub(props: Inner & { small: number }) {
  const { card, tokens } = props;
  const running = turnRunning(card) && card.timing.turnStartedAt !== null;
  const text = useTime(props.time, (time) => {
    const ran = running ? since(card.timing.turnStartedAt, time) : null;
    if (ran !== null) return cardStrings(props.language).details.turnClock(formatTurnClock(ran));
    return cardTimer(card, props.now, props.language)?.text ?? "";
  });
  if (!text) return null;
  return (
    <Text numberOfLines={2} style={{ flexShrink: 1, fontSize: props.small, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>
      {text}
    </Text>
  );
}

/** The running turn: its clock (ticking each second), the session's tokens so far and the context ring. */
function RunningTurn(props: Inner) {
  const { card } = props;
  const timer = useTime(props.time, (time) => {
    const ran = since(card.timing.turnStartedAt, time);
    return ran === null ? cardStrings(props.language).starting : formatTurnClock(ran);
  });
  return (
    <TurnHero
      timer={timer}
      lastTurn={card.timing.lastTurnMs !== null ? formatDuration(card.timing.lastTurnMs) : null}
      total={sessionTotal(props.sessionTokens ?? null, props.language)}
      context={contextView(card)}
      tokens={props.tokens}
      theme={props.theme}
      touch={props.touch === true}
      language={props.language}
      timerOnly={!!card.subagent}
    />
  );
}

/** The session's tokens as the running turn shows them: the total over the cached share. */
function sessionTotal(tokens: SessionTokens | null, language: TasksLanguage): { value: string; sub: string } | null {
  if (!tokens || tokens.total <= 0) return null;
  const words = cardStrings(language).details;
  return {
    value: formatTokenTotal(tokens.total),
    sub: tokens.cached > 0 ? words.cacheShare(`${Math.round((tokens.cached / tokens.total) * 100)}%`) : words.total,
  };
}

const PERMISSION_ICONS: Record<PermissionKind, string> = {
  tool: "SquareTerminal",
  plan: "ClipboardList",
  question: "MessageCircleQuestion",
  mode: "ShieldQuestion",
  other: "CircleHelp",
};

/** Needs input: the request, its command, and its buttons (unless the phone's bar has them). */
function PermissionBlock(props: Inner) {
  const { card, tokens, m } = props;
  const colors = detailColors(tokens);
  const words = cardStrings(props.language).details;
  const permission = card.permission!;
  const small = F.sm;
  const waited = since(card.timing.attentionAt, props.now) ?? since(card.timing.turnStartedAt, props.now);
  const buttons = props.actions !== false && props.onPermission ? (props.permissionButtons ?? []) : [];
  return (
    <View testID="detail-permission" style={{ borderWidth: 1, borderColor: tokens.border, borderRadius: 10, backgroundColor: colors.sunk }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 10 }}>
        <Icon name={PERMISSION_ICONS[permission.kind]} size={m.icon} color={tokens.status.warning} />
        <Text numberOfLines={2} style={{ flex: 1, fontSize: m.font, fontWeight: "500", color: tokens.foreground }}>
          {permission.title}
        </Text>
        {permission.remaining > 0 ? <Text style={{ fontSize: small, color: tokens.foregroundMuted }}>{words.moreRequests(permission.remaining)}</Text> : null}
      </View>
      {permission.summary ? (
        <View style={{ marginHorizontal: 12, marginTop: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: tokens.border, backgroundColor: tokens.card.background }}>
          <Text style={{ fontSize: permission.kind === "question" ? F.base : F.sm, lineHeight: permission.kind === "question" ? HOST_LINE.base : CODE_LINE, fontFamily: MONO, color: tokens.foreground }}>{permission.summary}</Text>
        </View>
      ) : null}
      {buttons.length > 0 ? (
        <View testID="detail-permission-buttons" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12 }}>
          <ActionRow style={{ width: "auto", flexGrow: 1, flexShrink: 1, flexBasis: 0, ...(props.touch && Platform.OS !== "web" ? { paddingVertical: 4, alignItems: "center" } : null) }} testID="detail-permission-actions">
            {buttons.map((button) => (
              <RequestButton key={button.key} button={button} tokens={tokens} disabled={button.kind === "respond" && !!taskOperationIssue(card, "permission")} height={props.touch ? 36 : 34} onPress={() => props.onPermission?.(button)} />
            ))}
          </ActionRow>
          {waited !== null ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Icon name="Hourglass" size={12} color={tokens.foregroundMuted} />
              <Text style={{ fontSize: F.sm, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{formatSpan(waited)}</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={{ height: 12 }} />
      )}
    </View>
  );
}

/** The card's permission buttons, by `requestLook`: Allow's accent, Deny's danger, "Answer"'s amber, the rest plain. */
function RequestButton(props: { button: PermissionButton; tokens: TaskTokens; height: number; disabled?: boolean; onPress(): void }) {
  const { button, tokens } = props;
  const { hovered, hoverProps } = useHover();
  const hue = buttonHue(tokens, requestLook(button));
  const scale = useTasksFontScale();
  const height = taskControlHeight(props.height, scale);
  // A question's option is shown as written: no Check or X reads a meaning into it, and its label never folds.
  const option = !!button.answers;
  const fit = useActionFit(button.label, `${scale}|${useWindowDimensions().fontScale}`, props.height, 28 + (option ? 0 : 13 + 4) + 1, false, requestLook(button) === "primary", option);
  const icon = option ? null : button.kind === "question" ? "MessageCircleQuestion" : button.kind === "open" ? "ArrowUpRight" : button.action.behavior === "allow" ? "Check" : "X";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={button.label}
      hitSlop={Platform.OS !== "web" ? 4 : undefined}
      disabled={props.disabled}
      accessibilityState={{ disabled: props.disabled }}
      {...tipProps(button.label)}
      onPress={props.onPress}
      {...hoverProps}
      style={({ pressed }) => {
        const lift = surfaceLift(hovered && !props.disabled, pressed && !props.disabled);
        return {
          // A written option may wrap, so it grows taller rather than wider.
          ...(option ? { minHeight: height, paddingVertical: 4 } : { height }),
          flexDirection: "row" as const,
          gap: 4,
          paddingHorizontal: 14,
          borderRadius: 6,
          ...liftedButtonOutline(tokens, hue.border, requestLook(button) === "plain", lift),
          opacity: props.disabled ? 0.5 : 1,
          backgroundColor: tokens.card.background,
          alignItems: "center" as const,
          justifyContent: "center" as const,
          ...fit.style,
          ...scaleStyle(lift.scale),
        };
      }}
    >
      {icon ? <Icon name={icon} size={13} color={hue.color} /> : null}
      {fit.iconOnly ? null : <Text onLayout={fit.labelLayout} numberOfLines={option ? undefined : 1} style={{ flexShrink: option ? 1 : 0, ...(option ? { textAlign: "center" as const } : null), fontSize: F.sm, fontWeight: "500", color: hue.color }}>
        {button.label}
      </Text>}
    </Pressable>
  );
}

/** Failed or stopped: the full error, copyable. */
function ErrorBlock(props: Inner) {
  const { card, tokens, m } = props;
  const colors = detailColors(tokens);
  const words = cardStrings(props.language).details;
  const { copied, copy } = useCopy();
  const stopped = card.stoppedManually === true;
  const text = card.error ?? "";
  const lines = errorLines(text);
  // A manual stop has no original to show: one line, in grey.
  const body = stopped && lines.length <= 1 ? null : text;
  return (
    <View
      testID="detail-error"
      style={{
        borderWidth: 1,
        borderColor: stopped ? tokens.border : colors.errorBorder,
        backgroundColor: stopped ? colors.sunk : colors.errorFill,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: body ? 10 : 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 }}>
        <Icon name={stopped ? "OctagonX" : "CircleAlert"} size={m.icon} color={stopped ? tokens.foregroundMuted : tokens.danger} />
        <Text style={{ flex: 1, fontSize: m.font, fontWeight: "500", color: tokens.foreground }}>{stopped ? words.stoppedTitle : words.failedTitle}</Text>
        {body ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={words.copyError}
            {...tipProps(words.copyError)}
            onPress={() => void copy(text, { label: "Copy error" })}
            hitSlop={6}
            style={{ width: 24, height: 24, marginRight: -6, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
          >
            <Icon name={copied ? "Check" : "Copy"} size={14} color={copied ? tokens.success : tokens.foregroundMuted} />
          </Pressable>
        ) : null}
      </View>
      {body ? (
        <Text style={{ marginTop: 4, fontSize: F.sm, lineHeight: CODE_LINE, fontFamily: MONO, color: tokens.foreground }}>
          {body}
        </Text>
      ) : null}
    </View>
  );
}

// ---- Sections --------------------------------------------------------------

function Section(props: Inner & { section: DetailSection; replyStreaming: boolean; waitingAfterHuman: boolean; closed: boolean; divider: boolean; onToggleSection(closed: boolean): void }) {
  const { card, m, tokens, section, gutter = 0 } = props;
  const words = cardStrings(props.language).details;
  const reducedMotion = useReducedMotion();
  const { copied, copy } = useCopy();
  const title = { prompt: words.prompt, human: words.human, message: words.message, properties: words.properties, subtasks: words.subtasks, usage: words.usage, activity: words.activity }[section];
  // A narrow card abbreviates the subtasks heading; its rows keep their shared metadata.
  const [narrow, setNarrow] = useState(false);
  const onLayout =
    section === "subtasks"
      ? (event: LayoutChangeEvent) => {
          const next = event.nativeEvent.layout.width <= NARROW_SUBTASKS;
          setNarrow((was) => (was === next ? was : next));
        }
      : undefined;
  const created = since(card.timing.createdAt, props.now);
  const heading = section === "subtasks" ? subtaskHeading(card.children, props.language, narrow) : null;
  const read = section === "prompt" ? props.firstPrompt : section === "human" ? props.humanMessage : section === "message" ? props.lastMessage : null;
  const timestamp = read?.prompt.state === "ready" ? read.prompt.timestamp : undefined;
  const at = timestamp ? Date.parse(timestamp) : NaN;
  const messageTime = Number.isFinite(at) ? formatClockTime(at, props.now) : "";
  const summary = {
    prompt: messageTime,
    human: messageTime,
    message: messageTime,
    properties: "",
    subtasks: heading && heading.parts.length > 0 ? <SubtaskSummaryText parts={heading.parts} tokens={tokens} /> : "",
    usage: usageSummary(card, props.language),
    activity: created !== null ? words.createdAgo(formatRelative(created, props.language)) : "",
  }[section];
  const messageSection = section === "prompt" || section === "human" || section === "message";
  const copyLabel = section === "prompt" ? words.copyPrompt : section === "human" ? words.copyHuman : words.copyMessage;
  const copyToast = section === "prompt" ? "Copy prompt" : section === "human" ? "Copy sent message" : "Copy message";
  const testID = { prompt: "detail-prompt", human: "detail-human", message: "detail-message", properties: "detail-location", subtasks: "detail-subtasks", usage: "detail-usage", activity: "detail-activity" }[section];
  // The last subtask row keeps 8 (touch 10) above the next hairline.
  const bottom = section === "subtasks" && m === TOUCH_CARD ? 10 : 8;
  const toggle = () => { if (!reducedMotion) prepareSubtaskToggle(props.closed); props.onToggleSection(!props.closed); };
  return (
    <View testID={testID} onLayout={onLayout}>
      {props.divider ? <View style={{ height: StyleSheet.hairlineWidth, marginLeft: m.padH, marginRight: m.padH - gutter, backgroundColor: tokens.card.border }} /> : null}
      <View style={{ paddingTop: 4, paddingBottom: bottom, paddingLeft: m.padH - 6, paddingRight: m.padH - 6 - gutter }}>
        {messageSection ? (
          <Pressable {...ROW_ROLE} accessibilityLabel={props.closed ? words.expand(title) : words.collapse(title)} {...tipProps(props.closed ? words.expand(title) : words.collapse(title))} accessibilityState={{ expanded: !props.closed }} onPress={toggle} testID={`${testID}-heading`} style={{ flexDirection: "row", alignItems: "center", paddingLeft: 6 }}>
            <View style={{ width: 23, height: 24, paddingLeft: 5, alignItems: "flex-start", justifyContent: "center" }}>
              <Icon name={section === "message" ? "MessageSquareText" : section === "human" ? "Send" : "MessageCircle"} size={14} color={tokens.foregroundMuted} />
            </View>
            <Text style={{ flex: 1, fontSize: F.sm, fontWeight: "600", color: tokens.foreground }} numberOfLines={1}>{title}</Text>
            {messageTime ? <Text {...tipProps(formatFullStamp(new Date(at)))} numberOfLines={1} style={{ flexShrink: 1, fontSize: F.sm, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{messageTime}</Text> : null}
            {read?.prompt.state === "ready" ? (
              <Pressable accessibilityRole="button" accessibilityLabel={copyLabel} {...tipProps(copyLabel)} onPress={(event) => { event.stopPropagation(); void copy(read.prompt.state === "ready" ? read.prompt.text : "", { label: copyToast }); }} hitSlop={4} testID={`${testID}-copy`} style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
                <Icon name={copied ? "Check" : "Copy"} size={14} color={copied ? tokens.success : tokens.foregroundMuted} />
              </Pressable>
            ) : null}
            <View style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
              <SectionChevron closed={props.closed} color={tokens.foregroundMuted} />
            </View>
          </Pressable>
        ) : (
          <SectionHeading m={m} tokens={tokens} title={title} summary={summary} summaryTip={messageTime ? formatFullStamp(new Date(at)) : undefined} trailing={heading?.check ? <Icon name="CircleCheck" size={14} color={tokens.success} /> : undefined} closed={props.closed} language={props.language} onPress={toggle} />
        )}
        <SubtaskPanel expanded={!props.closed} testID={`${testID}-panel`}>
          {section === "prompt" ? (
          <TimelineTextBody {...props} read={props.firstPrompt} id="detail-prompt" none={words.promptNone} error={words.promptError} copyLabel={words.copyPrompt} copyToast="Copy prompt" />
        ) : section === "human" ? (
          <TimelineTextBody {...props} read={props.humanMessage} id="detail-human" none={words.humanNone} error={words.humanError} copyLabel={words.copyHuman} copyToast="Copy sent message" waitingAfter={props.waitingAfterHuman} />
        ) : section === "message" ? (
          <TimelineTextBody {...props} read={props.lastMessage} id="detail-message" none={words.messageNone} error={words.messageError} copyLabel={words.copyMessage} copyToast="Copy message" streaming={props.replyStreaming} flash />
          ) : section === "properties" ? (
            <Properties {...props} />
          ) : section === "subtasks" ? (
            <Subtasks {...props} />
          ) : section === "usage" ? (
            <Usage {...props} />
          ) : (
            <Activity {...props} />
          )}
        </SubtaskPanel>
      </View>
    </View>
  );
}

/** "1 needs input · 2 running · 4/8 done": each count in its status's colour and the words muted; a lone status word in its colour. */
function SubtaskSummaryText(props: { parts: SubtaskSummaryPart[]; tokens: TaskTokens }) {
  const { tokens } = props;
  return (
    <>
      {props.parts.map((part, index) => {
        const color = part.tone ? statusColor(part.tone, tokens) : undefined;
        return (
          <React.Fragment key={index}>
            {index > 0 ? " \u00b7 " : null}
            {part.count !== null ? <Text style={{ color }}>{part.count}</Text> : null}
            {part.count !== null ? ` ${part.text}` : color ? <Text style={{ color }}>{part.text}</Text> : part.text}
          </React.Fragment>
        );
      })}
    </>
  );
}

function SectionHeading(props: { m: Metrics; tokens: TaskTokens; title: string; summary: React.ReactNode; summaryTip?: string; trailing?: React.ReactNode; closed: boolean; language: TasksLanguage; onPress(): void }) {
  const { m, tokens } = props;
  const scale = useTasksFontScale();
  const { hovered, hoverProps } = useHover();
  const words = cardStrings(props.language).details;
  const color = hovered ? tokens.foreground : tokens.foregroundMuted;
  const font = F.sm;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.closed ? words.expand(props.title) : words.collapse(props.title)}
      {...tipProps(props.closed ? words.expand(props.title) : words.collapse(props.title))}
      accessibilityState={{ expanded: !props.closed }}
      onPress={props.onPress}
      {...hoverProps}
      style={{ height: taskControlHeight(m.heading, scale), paddingHorizontal: 6, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 4 }}
    >
      <Text style={{ fontSize: font, fontWeight: "500", color }}>{props.title}</Text>
      <SectionChevron closed={props.closed} color={color} />
      <View style={{ flex: 1 }} />
      {props.summary ? (
        <Text {...tipProps(props.summaryTip)} numberOfLines={1} style={[{ flexShrink: 1, fontSize: font, color, fontVariant: ["tabular-nums"] }]}>
          {props.summary}
        </Text>
      ) : null}
      {props.trailing ? <View style={{ marginLeft: 2 }}>{props.trailing}</View> : null}
    </Pressable>
  );
}

function SectionChevron(props: { closed: boolean; color: string }) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(props.closed ? 0 : 1)).current;
  useEffect(() => {
    if (reduced) { progress.setValue(props.closed ? 0 : 1); return; }
    const animation = Animated.timing(progress, { toValue: props.closed ? 0 : 1, duration: props.closed ? 140 : 180, easing: MOTION.ease, useNativeDriver: true, isInteraction: false });
    animation.start();
    return () => animation.stop();
  }, [props.closed, reduced, progress]);
  return <Animated.View style={{ transform: [{ rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "0deg"] }) }] }}><Icon name="ChevronDown" size={14} color={props.color} /></Animated.View>;
}

/**
 * The properties (`https://github.com/RoundRedDot/better-paseo/blob/f2ab453297c4ccb88a08e2129af0cb3528c4e628/docs/prototypes/task-details-properties.md`): one row per
 * field, icon 16 · value · trailing 16, no label column until the card is
 * wide (≥ 448, gone under 440). Every state the old badges carried is a
 * muted note line under the value; values wrap to a few lines instead of
 * cutting off.
 */
function Properties(props: Inner) {
  const { card, m, tokens } = props;
  const words = props.strings.property;
  const cardText = cardStrings(props.language);
  const details = cardText.details;
  const location = card.location;
  const input = useInputCapabilities();
  // The folder is on the plugin's own host: another host's is not there to open.
  const canOpenFolder = Platform.OS === "web" && !props.touch && !input.touch && !remoteCard(card);
  const revealPath = useRpc(revealPathRpc);
  const toast = useToast();
  const openFolder = async () => {
    try {
      const result = await revealPath({ cwd: location.cwd, path: location.cwd });
      if (result.error) toast.error(details.openFolderError(result.error));
    } catch (error) {
      toast.error(details.openFolderError(error instanceof Error ? error.message : String(error)));
    }
  };
  const [wide, setWide] = useState(false);
  const onLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setWide((was) => (width >= LABEL_COLUMN.show ? true : width < LABEL_COLUMN.hide ? false : was));
  };
  const common = { m, tokens, language: props.language, wide, searchQuery: props.searchQuery };
  const rows: React.ReactNode[] = [];

  const placeName = location.projectName ?? location.workspaceName;
  if (placeName) {
    const kind = location.workspaceKind;
    const notes: Note[] = [];
    if (location.projectName && location.workspaceName) notes.push({ text: location.workspaceName });
    if (kind) notes.push({ text: cardText.kind[kind] });
    rows.push(<PropertyRow {...common} key="place" label={words.project} lead={<ProjectIcon location={location} size={16} />} value={placeName} strong hyphens lines={2} notes={notes} testID="detail-place" />);
  }

  if (location.branch) {
    const hint = branchHint(location.git);
    const notes: Note[] = [];
    if (hint.sync) {
      const { ahead, behind } = hint.sync;
      notes.push({
        text: `↑${ahead} ↓${behind}`,
        parts: [
          { text: `↑${ahead}`, color: ahead > 0 ? tokens.success : undefined },
          { text: ` ↓${behind}`, color: behind > 0 ? tokens.warning : undefined },
        ],
      });
    }
    if (hint.dirty) notes.push({ text: details.uncommittedNote, warn: true });
    rows.push(
      <PropertyRow
        {...common}
        key="branch"
        label={words.branch}
        icon="GitBranch"
        value={location.branch}
        mono="branch"
        lines={3}
        notes={notes}
        copy={{ text: location.branch, toast: "Copy branch name", label: details.copyBranch }}
        testID="detail-branch"
      />,
    );
  } else if (location.git === null) {
    rows.push(<PropertyRow {...common} key="branch" label={words.branch} icon="GitBranch" value={details.notGit} muted lines={1} testID="detail-branch" />);
  }

  rows.push(
    <PropertyRow
      {...common}
      key="cwd"
      label={words.cwd}
      icon="Folder"
      value={props.searchQuery ? location.cwd : tildePath(location.cwd)}
      mono="path"
      lines={2}
      action={canOpenFolder ? { icon: "FolderOpen", label: details.openFolder, onPress: () => void openFolder() } : undefined}
      copy={{ text: location.cwd, toast: "Copy path", label: details.copyPath }}
      testID="detail-cwd"
    />,
  );

  if (location.pullRequest) {
    const pr = location.pullRequest;
    rows.push(
      <PropertyRow
        {...common}
        key="pr"
        label={words.pr}
        icon="GitPullRequest"
        pre={pr.number !== null ? `#${pr.number}` : null}
        value={pr.title}
        lines={2}
        link={pr.url}
        copy={{ text: pr.url, toast: "Copy URL", label: details.copyLink }}
        testID="detail-pr"
      />,
    );
  }

  if (props.searchQuery) {
    for (const hit of detailSearchHits(card, props.searchQuery)) {
      rows.push(<PropertyRow {...common} key={`search-${hit.field}`} label={cardText.searchHits.fields[hit.field]} accessibilityLabel={`${props.strings.searchMatches ?? cardText.searchHits.dialog}: ${cardText.searchHits.fields[hit.field]}: ${hit.text}`} icon="Search" value={hit.text} lines={20} mono={hit.mono ? "branch" : undefined} testID={`detail-search-${hit.field}`} />);
    }
  }
  if (card.parent) {
    const parent = card.parent;
    const archived = parent.missing && parent.archived === true;
    // Off the board but not archived: an old done task the window left out, or one whose workspace is archived. Its tab still opens.
    const offBoard = parent.missing && parent.archived === false;
    const title = parent.title ?? cardText.parentUnknown;
    let jump: (() => void) | undefined;
    if (!parent.missing) jump = props.onJump ? () => props.onJump?.(parent.id) : undefined;
    else if (offBoard) jump = props.onOpen ? () => props.onOpen?.(parent.id) : undefined;
    const unarchive = archived ? props.unarchive : null;
    const unarchiving = unarchive?.pending(parent.id) === true;
    let notes: Note[] = [];
    let archive: string | null = null;
    // An archived parent can be brought back; once it is, the row turns into a jump.
    // An archived parent is tagged, itself or with its workspace, off the board or in the archived lane.
    if (parent.archivedAs === "workspace") archive = cardText.workspaceArchived;
    else if (archived || parent.archivedAs === "agent") archive = cardText.archived;
    if (archived && !unarchive) notes = [{ text: details.cannotJump }];
    else if (offBoard && !archive) notes = [{ text: details.offBoard }];
    const tag = parentTag(archive, parent.detached ? { label: cardText.parentHistory, tip: cardText.parentHistoryHint(archive, parent.archived) } : null);
    rows.push(
      <PropertyRow
        {...common}
        key="parent"
        label={words.parent}
        icon="CornerLeftUp"
        value={title}
        lines={3}
        muted={parent.missing}
        notes={notes}
        tag={tag ?? undefined}
        button={
          unarchive ? (
            <CardButton
              look="primary"
              icon="ArchiveRestore"
              label={details.unarchive}
              busy={unarchiving}
              tokens={tokens}
              compact={false}
              onPress={() => unarchive.press(parent.id)}
              testID="detail-parent-unarchive"
            />
          ) : undefined
        }
        onPress={jump}
        tip={offBoard ? cardText.openParent : cardText.revealParent}
        buttonTip={details.unarchive}
        accessibilityLabel={parent.detached && tag ? `${words.parent}: ${title}, ${tag.label}, ${tag.tip}` : `${words.parent}: ${title}`}
        testID="detail-parent"
      />,
    );
  }
  return (
    <View onLayout={onLayout} testID="detail-properties">
      {rows}
    </View>
  );
}

/** A part of a property's note line: workspace, kind, ahead/behind, uncommitted, archived. */
interface Note {
  text: string;
  /** Uncommitted changes: the warning colour after a dot. */
  warn?: boolean;
  /** Runs of the text in their own colour: ahead in green, behind in orange, a zero left muted. */
  parts?: { text: string; color?: string }[];
}

/**
 * One property: [label 72 when wide] · icon 16 · the value over its note
 * line · trailing 16. The value wraps to `lines` lines; a branch breaks after
 * "/" and "-", a path after "/" and folds its middle into "…/" past two
 * lines. With a pointer, hovering an actionable row shows its buttons at the
 * top right; on touch its trailing mark (copy, ↗, ›) always shows and a tap
 * on the row runs it. A copy is confirmed by the host's toast.
 */
function PropertyRow(props: {
  searchQuery?: string;
  m: Metrics;
  tokens: TaskTokens;
  language: TasksLanguage;
  wide: boolean;
  label: string;
  icon?: string;
  lead?: React.ReactNode;
  pre?: string | null;
  value: string;
  strong?: boolean;
  muted?: boolean;
  mono?: "branch" | "path";
  /** A name ("ideashell-android") that may break after its hyphens, as a branch does. */
  hyphens?: boolean;
  lines: number;
  notes?: Note[];
  /** An archived or inferred parent's tag, ahead of the notes. */
  tag?: ParentTag;
  /** A button at the row's end, in the card's style: an archived parent's Unarchive. */
  button?: React.ReactNode;
  buttonTip?: string;
  action?: { icon: string; label: string; onPress(): void };
  copy?: { text: string; toast: string; label: string };
  link?: string;
  onPress?(): void;
  tip?: string;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { m, tokens } = props;
  const words = cardStrings(props.language).details;
  const scale = useTasksFontScale();
  const colors = detailColors(tokens);
  // DOM hover includes the whole row and its actions; RNW's nested Pressables lock synthetic hover.
  const rowRef = useRef<View>(null);
  const { hovered, hoverProps } = useHover(rowRef);
  const { copy } = useCopy();
  const [columns, setColumns] = useState(36);
  const touch = m === TOUCH_CARD;
  // The host's steps: base for the value (as the usage rows and subtasks), small for code and the note.
  const font = F.sm;
  const line = HOST_LINE.smRead;
  const monoFont = F.sm;
  const noteFont = F.sm;
  const rowHeight = taskControlHeight(touch ? 36 : 30, scale);
  // The host's toast confirms a copy; the row itself does not change.
  const doCopy = props.copy ? () => void copy(props.copy!.text, { label: props.copy!.toast, feedback: "toast" }) : undefined;
  const doOpen = props.link ? () => openLink(props.link!) : undefined;
  // The row's own action: open a PR, jump to the parent, else copy.
  const press = props.onPress ?? doOpen ?? doCopy;
  // With a pointer, the copy / open buttons take a slot of their own at the row's end, kept while
  // they are hidden, so they never cover the value's last word and the value does not reflow on hover.
  const actionSlot = (props.action ? 26 : 0) + (touch ? 0 : (props.copy ? 24 : 0) + (props.link ? 26 : 0));
  const showActions = actionSlot > 0 && (touch || hovered);
  let shown = props.value;
  if (!props.searchQuery && (props.mono === "branch" || props.hyphens)) shown = breakable(props.value);
  // A path wraps as runs in a row, so its breaks are the layout's on every platform.
  const runs = props.mono === "path" && !props.searchQuery ? pathTokens(foldPath(props.value, columns, props.lines), columns) : null;
  const onValueLayout =
    props.mono === "path"
      ? (event: LayoutChangeEvent) => {
          // A monospace glyph measures 0.62 em (ui-monospace, Menlo); one column spare absorbs the rest.
          const next = Math.max(12, Math.floor(event.nativeEvent.layout.width / (monoFont * scale * 0.62)) - 1);
          setColumns((was) => (was === next ? was : next));
        }
      : undefined;
  let color = tokens.foreground;
  if (props.muted) color = tokens.foregroundMuted;
  const valueStyle: TextStyle = {
    fontSize: props.mono ? monoFont : font,
    lineHeight: line,
    color,
    fontWeight: props.strong ? "500" : "400",
    ...(props.mono ? { fontFamily: MONO } : null),
  };
  let trailing: React.ReactNode = null;
  if (props.onPress) trailing = <Icon name="ChevronRight" size={14} color={tokens.foregroundMuted} />;
  else if (touch && props.link) trailing = <Icon name="ArrowUpRight" size={16} color={tokens.foregroundMuted} />;
  else if (touch && props.copy) trailing = <Icon name="Copy" size={14} color={tokens.foregroundMuted} />;
  const notes = props.notes ?? [];
  // One run of text, so a long workspace name wraps and the next part follows it on the same line.
  const noteText: TextStyle = { fontSize: noteFont, lineHeight: HOST_LINE.sm, color: tokens.foregroundMuted, marginTop: 1 };
  const noteRun =
    notes.length > 0 ? (
      <Text style={noteText} testID={props.testID ? `${props.testID}-note` : undefined}>
        {notes.map((note, index) => (
          <Text key={note.text} style={note.warn ? { color: tokens.warning } : note.parts ? { fontVariant: ["tabular-nums"] } : undefined}>
            {index > 0 ? <Text style={{ color: tokens.foregroundMuted }}>{" \u00b7 "}</Text> : null}
            {note.warn ? "\u25cf " : null}
            {note.parts ? note.parts.map((part) => (part.color ? <Text key={part.text} style={{ color: part.color }}>{part.text}</Text> : part.text)) : highlightText(note.text, props.searchQuery ?? "", tokens.isDark)}
          </Text>
        ))}
      </Text>
    ) : null;
  const noteLine = props.tag ? (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 6, marginTop: 3 }}>
      <ArchivedTag tokens={tokens} label={props.tag.label} icon={props.tag.icon} tip={props.tag.tip} testID={props.testID ? `${props.testID}-tag` : undefined} />
      {noteRun}
    </View>
  ) : noteRun;
  const content = (
    <>
      {props.wide ? (
        <Text numberOfLines={1} style={{ width: 72, fontSize: F.sm, lineHeight: line, color: tokens.foregroundMuted }}>
          {props.label}
        </Text>
      ) : null}
      <View style={{ width: 16, height: line, alignItems: "center", justifyContent: "center" }}>
        {props.lead ?? (props.icon ? <Icon name={props.icon} size={16} color={tokens.foregroundMuted} /> : null)}
      </View>
      <View style={{ flex: 1, minWidth: 0 }} onLayout={onValueLayout}>
        {runs ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap" }} testID={props.testID ? `${props.testID}-value` : undefined}>
            {runs.map((token, index) => (
              <Text key={index} style={valueStyle}>
                {token}
              </Text>
            ))}
          </View>
        ) : (
          <Text numberOfLines={props.searchQuery ? undefined : props.lines} style={valueStyle} testID={props.testID ? `${props.testID}-value` : undefined}>
            {props.pre ? <Text style={{ fontSize: font, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{highlightText(`${props.pre}\u2002`, props.searchQuery ?? "", tokens.isDark)}</Text> : null}
            {highlightText(shown, props.searchQuery ?? "", tokens.isDark, props.icon === "GitBranch")}
          </Text>
        )}
        {noteLine}
      </View>
      {actionSlot > 0 ? (
        <View style={{ width: actionSlot, height: line, marginRight: -4, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
          {showActions && props.action ? <RowAction {...props.action} tokens={tokens} /> : null}
          {showActions && !touch && props.copy ? <RowAction icon="Copy" label={props.copy.label} tokens={tokens} onPress={doCopy!} /> : null}
          {showActions && !touch && props.link ? <RowAction icon="ExternalLink" label={words.openLink} tokens={tokens} onPress={doOpen!} /> : null}
        </View>
      ) : null}
      {trailing ? <View style={{ width: 16, height: line, alignItems: "center", justifyContent: "center" }}>{trailing}</View> : null}
      {props.button ? <View {...tipProps(props.buttonTip)} style={{ alignSelf: "center" }}>{props.button}</View> : null}
    </>
  );
  const style: ViewStyle = {
    minHeight: rowHeight,
    paddingHorizontal: 8,
    paddingVertical: Math.max(4, Math.floor((rowHeight - line) / 2)),
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  };
  if (!press) {
    return (
      <View testID={props.testID} accessibilityLabel={props.accessibilityLabel ?? `${props.label}: ${props.value}`} style={style}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      {...(props.copy || props.link ? ROW_ROLE : { accessibilityRole: "button" as const })}
      accessibilityLabel={props.accessibilityLabel ?? (props.copy ? `${props.copy.label}: ${props.copy.text}` : props.label)}
      {...tipProps(props.tip ?? (props.link ? words.openLink : props.copy?.label))}
      onPress={press}
      onLongPress={touch && props.link ? doCopy : undefined}
      delayLongPress={450}
      ref={rowRef}
      {...(Platform.OS === "web" ? null : hoverProps)}
      testID={props.testID}
      style={({ pressed }) => ({ ...style, backgroundColor: hovered || pressed ? colors.rowHover : "transparent" })}
    >
      {content}
    </Pressable>
  );
}

function RowAction(props: { icon: string; label: string; tokens: TaskTokens; onPress(): void }) {
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      {...tipProps(props.label)}
      onPress={(event) => {
        event.stopPropagation();
        props.onPress();
      }}
      {...hoverProps}
      style={({ pressed }) => {
        const lift = surfaceLift(hovered, pressed);
        return { width: 24, height: 24, borderRadius: 5, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: "transparent", ...liftStyle(props.tokens, lift), ...scaleStyle(lift.scale) };
      }}
    >
      <Icon name={props.icon} size={14} color={hovered ? props.tokens.foreground : props.tokens.foregroundMuted} />
    </Pressable>
  );
}

/**
 * The children (`docs/prototypes/task-subtasks.md`), most urgent first: each
 * row's status icon beside its single-line title, the time and metadata
 * under it, using the same icon-led metadata as expanded board cards. The
 * first ten show; the rest open on demand, closed again on the next card.
 */
function Subtasks(props: Inner) {
  const { card, m, tokens } = props;
  const scale = useTasksFontScale();
  const reducedMotion = useReducedMotion();
  const cardText = cardStrings(props.language);
  const words = cardText.details;
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === card.id;
  const sorted = sortSubtasks(card.children);
  const hidden = sorted.slice(SUBTASK_ROWS);
  // Finished rows step back while others still need a look; all finished, none does.
  const mixed = card.children.some((child) => !subtaskFinished(child));
  const time = props.time;
  const touch = m === TOUCH_CARD;
  const row = (child: TaskChild) => (
        <SubtaskRow
          key={child.id}
          tokens={tokens}
          theme={props.theme}
          language={props.language}
          child={child}
          titleUpdates={props.titleUpdates}
          touch={props.touch === true || Platform.OS !== "web"}
          backdrop={tokens.card.background}
          testIDPrefix="detail-subtask"
          muted={mixed && child.status === "done"}
          {...time}
          accessibilityLabel={`${child.title} ${cardText.status[child.status]}`}
          openLabel={child.kind === "provider" ? cardText.openParentTab : props.strings.openTab}
          pressTip={child.kind === "provider" ? cardText.openParentTab : words.locate}
          openTip={child.kind === "provider" ? cardText.openParentTab : props.strings.openTab}
          onPress={subtaskPress(props, child)}
          onContextMenu={props.onSubtaskMenu ? (point) => props.onSubtaskMenu?.(child.id, point) : undefined}
          onLongPress={touch && props.onOpen ? () => props.onOpen?.(child.kind === "provider" ? card.id : child.id) : undefined}
          onOpen={props.onOpen ? () => props.onOpen?.(child.kind === "provider" ? card.id : child.id) : undefined}
        />
  );
  return (
    <View style={{ marginRight: props.gutter }}>
      {sorted.slice(0, SUBTASK_ROWS).map(row)}
      {hidden.length > 0 ? <SubtaskPanel expanded={open} testID="detail-subtasks-extra-panel">{hidden.map(row)}</SubtaskPanel> : null}
      {hidden.length > 0 ? (
        <MoreRow
          tokens={tokens}
          label={open ? cardText.showFewer : words.subtasksShowAll(sorted.length)}
          note={open ? null : hidden.every(subtaskFinished) ? words.subtasksHiddenDone(hidden.length) : words.subtasksHidden(hidden.length)}
          open={open}
          onPress={() => { if (!reducedMotion) prepareSubtaskToggle(!open); setOpenFor(open ? null : card.id); }}
          height={taskControlHeight(touch ? 44 : 32, scale)}
        />
      ) : null}
    </View>
  );
}

/** A Paseo child jumps to its card; a provider subagent has none, so it opens the parent's tab. */
function subtaskPress(props: Inner, child: TaskChild): (() => void) | undefined {
  if (child.kind === "provider") return props.onOpen ? () => props.onOpen?.(props.card.id) : undefined;
  return props.onJump ? () => props.onJump?.(child.id) : undefined;
}

/** "Show all 14" and what the hidden rows are, or "Show fewer"; the chevron in the rows' status column. */
function MoreRow(props: { tokens: TaskTokens; label: string; note: string | null; open: boolean; height: number; onPress(): void }) {
  const { tokens } = props;
  const { hovered, hoverProps } = useHover();
  const colors = detailColors(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.note ? `${props.label} ${props.note}` : props.label}
      {...tipProps(props.label)}
      accessibilityState={{ expanded: props.open }}
      onPress={props.onPress}
      {...hoverProps}
      testID="detail-subtasks-more"
      style={({ pressed }) => ({
        minHeight: props.height,
        marginHorizontal: -2,
        paddingHorizontal: 8,
        borderRadius: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: pressed ? colors.rowPress : hovered ? colors.rowHover : "transparent",
      })}
    >
      <View style={{ width: 16, alignItems: "center" }}>
        <Icon name={props.open ? "ChevronUp" : "ChevronDown"} size={14} color={tokens.foregroundMuted} />
      </View>
      <View style={{ flexShrink: 1, flexDirection: "row", flexWrap: "wrap", columnGap: 6 }}>
        <Text style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, fontWeight: "500", color: tokens.foregroundMuted }}>{props.label}</Text>
        {props.note ? <Text style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: tokens.foregroundMuted }}>{props.note}</Text> : null}
      </View>
    </Pressable>
  );
}

/** The last message a person sent is the first prompt: the timeline's first, or the same text sent at the same time. */
function repeatsFirstPrompt(human: LastHumanMessage | undefined, first: FirstPrompt | undefined): boolean {
  if (human?.state === "first") return true;
  return human?.state === "ready" && first?.state === "ready" && human.text === first.text && human.timestamp === first.timestamp;
}

/** The lines a prompt or reply shows before "show all". */
const PROMPT_LINES = 10;
/** A card's title folds after five lines; anything shorter stays whole. */
const TITLE_LINES = 5;
const FADE_STEPS = 6;

/**
 * Text read from the task's timeline: the first prompt in full (the title
 * being only its first line), the last message a person sent, or the agent's
 * latest reply. Drawn as Markdown and copyable as written. The sidebar opens
 * the sent message and the reply in full; the first prompt stays folded.
 * "Load" retries a read that has not started or failed.
 */
function TimelineTextBody(props: Inner & {
  read: { prompt: FirstPrompt | LastHumanMessage; load(): void } | null | undefined;
  id: string;
  none: string;
  error: string;
  copyLabel: string;
  copyToast: string;
  /** The text box's fill flashes once each time the card's text changes (the latest reply moving). */
  flash?: boolean;
  streaming?: boolean;
  waitingAfter?: boolean;
}) {
  const { tokens, id } = props;
  const words = cardStrings(props.language).details;
  const [open, setOpen] = useState(props.tabs === true && props.id !== "detail-prompt");
  const query = props.id === "detail-prompt" ? props.searchQuery ?? "" : "";
  const [searchFold, setSearchFold] = useState({ query: "", closed: false });
  const expanded = query ? searchFold.query === query ? !searchFold.closed : true : open;
  const preferences = useEnhancerPreferences();
  const prose = useThemeTokens(props.theme, preferences);
  const adjustment = useTasksFontAdjustment();
  const first = props.read;
  const breathing = useBreathing(first?.prompt.state === "loading");
  const streaming = props.streaming === true;
  const changes = useTextChanges(props.card.id, props.flash === true && !streaming && first?.prompt.state === "ready" ? first.prompt.text : null);
  const flashOpacity = useFlash(changes, 0, 1);
  // A file link opens in its default app (a folder in Finder) on the daemon's
  // machine, as the chat's do, instead of copying its path.
  const revealPath = useRpc(revealPathRpc);
  const toast = useToast();
  // Kept the same across renders: a new one would draw the prose again.
  const reveal = useRef({ revealPath, toast, words, cwd: props.card.location.cwd });
  reveal.current = { revealPath, toast, words, cwd: props.card.location.cwd };
  const onRevealPath = useCallback((path: string) => {
    const { revealPath: open, toast: notice, words: text, cwd } = reveal.current;
    const fail = (error: string) => notice.error(text.openLinkError(error));
    open({ cwd, path })
      .then((result) => {
        if (result.error) fail(result.error);
      })
      .catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
  }, []);
  const renderText = useMemo(() => query ? (text: string) => highlightText(text, query, tokens.isDark) : undefined, [query, tokens.isDark]);
  if (!first) return null;
  const font = Math.round(prose.typography.content.size * 0.9 * adjustment);
  const line = variantMetrics(preferences.markdownVariant, font, props.touch === true).bodyLineHeight;
  const small = F.sm;
  const prompt = first.prompt;
  if (streaming && (prompt.state === "loading" || prompt.state === "none")) return <ReplyLoading tokens={tokens} language={props.language} waiting />;
  if (prompt.state === "loading") {
    return <TimelineTextSkeleton tokens={tokens} id={id} line={line} font={font} touch={props.touch === true} opacity={breathing} label={words.promptLoading} />;
  }
  if (prompt.state !== "ready") {
    const retry = prompt.state === "idle" || prompt.state === "error";
    const note = prompt.state === "none" ? props.none : prompt.state === "error" ? props.error : null;
    return (
      <View style={{ minHeight: props.touch ? 36 : 28, paddingHorizontal: 6, flexDirection: "row", alignItems: "center", gap: 8 }} testID={`${id}-state`}>
        {note ? <Text style={{ flexShrink: 1, fontSize: small, color: tokens.foregroundMuted }}>{note}</Text> : null}
        {retry ? (
          <Pressable accessibilityRole="button" {...tipProps(words.promptLoad)} onPress={first.load} hitSlop={6} testID={`${id}-load`}>
            <Text style={{ fontSize: small, fontWeight: "500", color: tokens.accentText }}>{words.promptLoad}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  const text = prompt.text;
  const lines = errorLines(text);
  const long = lines.length > PROMPT_LINES || text.length > 600;
  return (
    <View style={{ paddingHorizontal: 6, paddingTop: 4 }}>
      <View>
        {props.flash ? (
          <Animated.View pointerEvents="none" testID={`${id}-flash`} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 8, backgroundColor: props.theme.colors.accent, opacity: flashOpacity }} />
        ) : null}
        <FoldedText
          id={id}
          language={props.language}
          tokens={tokens}
          line={line}
          limit={PROMPT_LINES}
          total={lines.length}
          long={long}
          expanded={expanded}
          fadeColor={tokens.card.background}
          touch={props.touch}
          onToggle={() => query ? setSearchFold({ query, closed: expanded }) : setOpen((was) => !was)}
        >
          <HoverPreviewContext.Provider value>
            <MarkdownView text={text} streaming={streaming} renderText={renderText} tokens={prose} variant={preferences.markdownVariant} compact={props.touch === true} size={font} onRevealPath={onRevealPath} />
          </HoverPreviewContext.Provider>
        </FoldedText>
      </View>
      {streaming ? <ReplyLoading tokens={tokens} language={props.language} /> : null}
      {props.waitingAfter ? <ReplyLoading tokens={tokens} language={props.language} waiting id="detail-human-working" /> : null}
    </View>
  );
}

/**
 * Text that folds under a fade after `limit` lines, with the same
 * "Show all · N lines" row under it as every message body. A caller that knows
 * the text's line count passes `long` and `total`; the card's title leaves
 * both out, so the fold measures the laid-out text: a title that fits stays
 * whole, and a narrower sidebar folds sooner.
 */
function FoldedText(props: {
  id: string;
  language: TasksLanguage;
  tokens: TaskTokens;
  /** One line's height, already scaled as the text is. */
  line: number;
  limit: number;
  expanded: boolean;
  /** Whether the text overflows the fold; measured when absent. */
  long?: boolean;
  /** The text's line count; measured when absent. */
  total?: number;
  fadeColor: string;
  touch?: boolean;
  onToggle(): void;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const words = cardStrings(props.language).details;
  const [height, setHeight] = useState<number | null>(null);
  const progress = useRef(new Animated.Value(props.expanded ? 1 : 0)).current;
  const target = useRef(props.expanded);
  const limit = props.limit * props.line;
  // Android's text box keeps a few font-padding pixels past its lines; count
  // whole lines so a title that just fits five stays whole.
  const overflows = height !== null && Math.round(height / props.line) > props.limit;
  // Unmeasured text stays clamped: a long title must not paint open for a frame.
  const long = props.long ?? (height === null || overflows);
  useEffect(() => {
    if (reduced || !long || height === null) {
      target.current = props.expanded;
      progress.setValue(props.expanded ? 1 : 0);
      return;
    }
    if (target.current === props.expanded) return;
    target.current = props.expanded;
    const animation = Animated.timing(progress, { toValue: props.expanded ? 1 : 0, duration: props.expanded ? 180 : 140, easing: MOTION.ease, useNativeDriver: false, isInteraction: false });
    animation.start();
    return () => animation.stop();
  }, [props.expanded, long, reduced, progress, height]);
  const folded = long && !props.expanded;
  const style = !long || (props.expanded && (reduced || height === null)) ? null
    : reduced || height === null ? { maxHeight: limit, overflow: "hidden" as const }
    : { maxHeight: progress.interpolate({ inputRange: [0, 1], outputRange: [Math.min(limit, height), height] }), overflow: "hidden" as const };
  const total = props.total ?? (height === null ? 0 : Math.max(1, Math.round(height / props.line)));
  return (
    <View>
      <Animated.View style={style} testID={`${props.id}-text`}>
        <View testID={`${props.id}-measure`} onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
          {props.children}
        </View>
        {folded ? (
          // A heading or code block cuts the last line anywhere: fade it out.
          <View testID={`${props.id}-fade`} pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: props.line, flexDirection: "column" }}>
            {Array.from({ length: FADE_STEPS }, (_, step) => (
              <View key={step} style={{ flex: 1, backgroundColor: withAlpha(props.fadeColor, (step + 1) / FADE_STEPS) }} />
            ))}
          </View>
        ) : null}
      </Animated.View>
      {long && total > 0 ? (
        <View style={{ minHeight: props.touch ? 36 : 28, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: props.expanded }} {...tipProps(props.expanded ? words.showLess : words.showAll(total))} onPress={props.onToggle} hitSlop={4} testID={`${props.id}-more`} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name={props.expanded ? "ChevronsUp" : "ChevronsDown"} size={14} color={props.tokens.foregroundMuted} />
            <Text style={{ fontSize: F.sm, color: props.tokens.foregroundMuted }}>{props.expanded ? words.showLess : words.showAll(total)}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const REPLY_LOADER_FRAMES = [
  [1, 0, 0.78, 0, 0.56, 0.34], [0.78, 1, 0.56, 0, 0.34, 0],
  [0.56, 0.78, 0.34, 1, 0, 0], [0.34, 0.56, 0, 0.78, 0, 1],
  [0, 0.34, 0, 0.56, 1, 0.78], [0, 0, 1, 0.34, 0.78, 0.56],
] as const;

function ReplyLoading(props: { tokens: TaskTokens; language: TasksLanguage; waiting?: boolean; id?: string }) {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(() => Math.floor((Date.now() % 950) * 6 / 950));
  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => setStep(Math.floor((Date.now() % 950) * 6 / 950)), 950 / 6);
    return () => clearInterval(timer);
  }, [reduced]);
  const label = props.language === "zh" ? (props.waiting ? "等待输出" : "正在回复") : (props.waiting ? "Waiting for reply" : "Replying");
  return (
    <View testID={props.id ?? "detail-message-working"} accessibilityRole="progressbar" accessibilityLabel={label} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: props.waiting ? 6 : 0, paddingTop: 8 }}>
      <View style={{ width: 14, height: 14, alignItems: "center", justifyContent: "center" }}><View testID="detail-message-working-grid" style={{ width: 26 / 3, height: 14, flexDirection: "row", flexWrap: "wrap", columnGap: 2, rowGap: 2 }}>
        {REPLY_LOADER_FRAMES[reduced ? 0 : step]!.map((opacity, index) => <View key={index} style={{ width: 10 / 3, height: 10 / 3, borderRadius: 2, backgroundColor: props.tokens.foreground, opacity }} />)}
      </View></View>
      <Text style={{ fontSize: F.sm, color: props.tokens.foregroundMuted }}>{label}</Text>
    </View>
  );
}

/**
 * A count that moves each time a card's text turns into another: not on its
 * first read, a skeleton or another card, so only a reply that moved under
 * the reader flashes.
 */
function useTextChanges(owner: string, text: string | null): number {
  const seen = useRef({ owner, text });
  const [count, setCount] = useState(0);
  useEffect(() => {
    const was = seen.current;
    const same = was.owner === owner;
    seen.current = { owner, text: text ?? (same ? was.text : null) };
    if (same && was.text !== null && text !== null && text !== was.text) setCount((value) => value + 1);
  }, [owner, text]);
  return count;
}

const SKELETON_WIDTHS = ["94%", "82%", "58%"] as const;

/** A read on its way: the text's sunk box with three breathing lines where the first lines will land. */
function TimelineTextSkeleton(props: { tokens: TaskTokens; id: string; line: number; font: number; touch: boolean; opacity: Animated.Value; label: string }) {
  const colors = detailColors(props.tokens);
  return (
    <View style={{ paddingHorizontal: 6, paddingTop: 2 }} testID={`${props.id}-skeleton`} accessible accessibilityRole="progressbar" accessibilityLabel={props.label}>
      <Animated.View style={{ opacity: props.opacity, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.sunk }}>
        {SKELETON_WIDTHS.map((width) => (
          <View key={width} style={{ height: props.line, justifyContent: "center" }}>
            <View style={{ width, height: Math.round(props.font * 0.7), borderRadius: 3, backgroundColor: colors.track }} />
          </View>
        ))}
      </Animated.View>
      <View style={{ minHeight: props.touch ? 36 : 28 }} />
    </View>
  );
}

function Usage(props: Inner) {
  const { card, m, tokens } = props;
  const words = cardStrings(props.language).details;
  const touch = props.touch === true;
  const font = F.sm;
  const cost = card.usage?.totalCostUsd ?? null;
  const line = (key: string, icon: string, label: string, value: string, strong: boolean) => (
    <View key={key} testID={`detail-usage-${key}`} style={{ height: touch ? 32 : 24, flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Icon name={icon} size={14} color={tokens.foregroundMuted} />
      <Text style={{ fontSize: font, color: tokens.foregroundMuted }}>{label}</Text>
      <View style={{ flex: 1 }} />
      <Text style={{ fontSize: font, fontWeight: strong ? "600" : "400", color: value === "—" ? tokens.foregroundMuted : tokens.foreground, fontFamily: value === "—" ? undefined : MONO }}>{value}</Text>
    </View>
  );
  return (
    <View style={{ paddingHorizontal: 6, paddingTop: 4, paddingBottom: 4, gap: 14 }}>
      {detailHero(card) !== "turn" ? <ContextBar context={contextView(card)} tokens={tokens} theme={props.theme} touch={touch} language={props.language} font={font} /> : null}
      <TokenBar mix={tokenMix(card)} tokens={tokens} theme={props.theme} touch={touch} language={props.language} font={font} />
      <View>
        {line("cost", "Coins", words.totalCost, cost !== null ? `$${cost.toFixed(2)}` : "—", true)}
        {line("turn", "Hourglass", words.lastTurnTime, card.timing.lastTurnMs !== null ? formatDuration(card.timing.lastTurnMs) : "—", false)}
      </View>
    </View>
  );
}

function Activity(props: Inner) {
  const line = timeline(props.card, props.now, props.language);
  if (!line) return null;
  const kind = props.card.stoppedManually ? "stopped" : props.card.status;
  return (
    <TimelineChart
      timeline={line}
      liveColor={statusColor(props.card.status, props.tokens)}
      tokens={props.tokens}
      endMark={<StatusIcon kind={kind} size={14} theme={props.theme} />}
    />
  );
}

// ---- Buttons ---------------------------------------------------------------

function KeyCap(props: { label: string; tokens: TaskTokens }) {
  return (
    <View style={{ height: 16, paddingHorizontal: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: props.tokens.border, borderRadius: 3, justifyContent: "center" }}>
      <Text style={{ fontFamily: MONO, fontSize: F.sm, color: props.tokens.foregroundMuted }}>{props.label}</Text>
    </View>
  );
}

/** A header icon button, matching the toolbar's quiet outline on web. */
export function RoundIcon(props: { icon: string; label: string; size: number; iconSize: number; tokens: TaskTokens; active?: boolean; onPress(): void; testID?: string }) {
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      {...tipProps(props.label)}
      accessibilityState={props.active === undefined ? undefined : { selected: props.active }}
      onPress={props.onPress}
      {...hoverProps}
      testID={props.testID}
      style={({ pressed }) => {
        const lift = surfaceLift(hovered, pressed);
        return {
          width: props.size,
          height: props.size,
          marginVertical: -(props.size - 18) / 2,
          borderRadius: Platform.OS === "web" ? 7 : props.size / 2,
          borderWidth: Platform.OS === "web" ? StyleSheet.hairlineWidth : 0,
          borderColor: hovered ? props.tokens.border : "transparent",
          alignItems: "center" as const,
          justifyContent: "center" as const,
          backgroundColor: props.active ? props.tokens.surface2 : "transparent",
          ...liftStyle(props.tokens, lift, Platform.OS === "web" ? { border: hovered ? props.tokens.border : "transparent" } : {}),
          ...scaleStyle(lift.scale),
        };
      }}
    >
      <Icon name={props.icon} size={props.iconSize} color={props.active ? props.tokens.accent : hovered ? props.tokens.foreground : props.tokens.foregroundMuted} />
    </Pressable>
  );
}

function OpenHint(props: { tokens: TaskTokens; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: props.tokens.success }} />
      <Text style={{ fontSize: F.sm, color: props.tokens.foregroundMuted }}>{props.label}</Text>
    </View>
  );
}

function OutlineButton(props: {
  /** Leads the label; Open tab has none, only its trailing ↗. */
  icon?: string;
  /** A drawn mark in place of `icon`, in the button's colour and the icon's box. */
  glyph?: (color: string, size: number) => React.ReactNode;
  label: string;
  /** The card button's colours (`buttonHue`); plain by default, its icon then muted. */
  look?: CardButtonLook;
  hint?: React.ReactNode;
  trailing?: string;
  height: number;
  font: number;
  tokens: TaskTokens;
  grow?: boolean;
  /** Working: the same label, dimmed, a spinner in place of the icon, and no second press. */
  busy?: boolean;
  disabled?: boolean;
  onPress(): void;
  testID?: string;
}) {
  const { tokens } = props;
  const scale = useTasksFontScale();
  const { hovered: hover, hoverProps } = useHover();
  const disabled = props.busy || props.disabled;
  const hovered = hover && !disabled;
  const look = props.look ?? "plain";
  const hue = buttonHue(tokens, look);
  const iconColor = look === "plain" ? tokens.foregroundMuted : hue.color;
  const [hintWidth, setHintWidth] = useState(0);
  const gap = props.grow ? 8 : 6;
  const leading = !!props.icon || props.glyph !== undefined || props.busy;
  // A trailing icon has a flexible spacer before it; both gaps count even at zero spacer width.
  const pieces = 1 + Number(!!leading) + Number(!!props.hint) + 2 * Number(!!props.trailing);
  const chrome = 2 * (props.grow ? 10 : 12) + (leading ? 15 : 0) + (props.hint ? hintWidth : 0) + (props.trailing ? 14 : 0) + (pieces - 1) * gap + 1;
  const fit = useActionFit(props.label, `${scale}|${props.font}|${useWindowDimensions().fontScale}`, props.height, chrome);
  return (
    <ActionPressable lift={props.grow ? "row" : "control"}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      hitSlop={Platform.OS !== "web" ? 4 : undefined}
      {...tipProps(props.label)}
      accessibilityState={disabled ? { disabled: true, busy: props.busy === true } : undefined}
      disabled={disabled}
      onPress={props.onPress}
      {...hoverProps}
      testID={props.testID}
      style={({ pressed }) => ({
        flexGrow: props.grow ? 1 : 0,
        flexShrink: 1,
        minWidth: 0,
        height: taskControlHeight(props.height, scale),
        paddingHorizontal: props.grow ? 10 : 12,
        borderRadius: 8,
        ...liftedButtonOutline(tokens, hue.border, look === "plain", surfaceLift(hovered, pressed && !disabled, undefined, props.grow ? "row" : "control")),
        backgroundColor: tokens.card.background,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap,
        opacity: disabled ? 0.6 : 1,
        justifyContent: "center" as const,
        ...fit.style,
      })}
    >
      {props.busy ? (
        // The running ring without its dot, in the icon's box so the button keeps its width.
        <SpinnerRing size={15} color={iconColor} testID={props.testID ? `${props.testID}-spinner` : undefined} />
      ) : props.glyph ? (
        props.glyph(iconColor, 15)
      ) : props.icon ? (
        <Icon name={props.icon} size={15} color={iconColor} />
      ) : null}
      {fit.iconOnly ? null : <Text onLayout={fit.labelLayout} numberOfLines={1} style={{ flexShrink: 0, fontSize: props.font, fontWeight: "500", color: hue.color }}>
        {props.label}
      </Text>}
      {!fit.iconOnly && props.hint ? <View onLayout={(event) => setHintWidth(layoutCeil(event.nativeEvent.layout.width))} style={{ flexShrink: 0 }}>{props.hint}</View> : null}
      {props.trailing && !(fit.iconOnly && props.busy) ? (
        <>
          {fit.iconOnly ? null : <View style={{ flex: 1 }} />}
          <Icon name={props.trailing} size={14} color={look === "primary" ? hue.color : tokens.foregroundMuted} />
        </>
      ) : null}
    </ActionPressable>
  );
}

// ---- The phone's action bar ------------------------------------------------

/**
 * Under the phone's sheet: compact actions (36, radius 10).
 * Running: stop, then open the tab at the right. Asking: deny, allow as the
 * main button, and the tab shrunk to a square at the right. Otherwise: open the tab.
 */
export function DetailActionBar(given: {
  card: TaskCard;
  theme: PluginTheme;
  language: TasksLanguage;
  strings: DetailCardsStrings;
  onOpen?(agentId: string): void;
  onClose?(): void;
  stop?: { phase: StopPhase; onPress(): void } | null;
  permissionButtons?: PermissionButton[];
  onPermission?(button: PermissionButton): void;
  unarchive?: { pending(agentId: string): boolean; press(agentId: string): void } | null;
  archive?: { pending(agentId: string): boolean; press(agentId: string): void } | null;
  markRead?: DetailRead | null;
  markUnread?: DetailRead | null;
  sidebar?: boolean;
  smallTablet?: boolean;
  flushBottom?: boolean;
  /** The page still runs under this bar, so it casts the same edge the tabs do. */
  contentUnder?: boolean;
  controlsOnly?: boolean;
}) {
  const props = withoutServerActions(given);
  const { card } = props;
  const onOpen = opensInPaseo(card) ? props.onOpen : undefined;
  // An archived task's main button is Unarchive, in Open tab's place.
  const unarchive = card.archived === "agent" ? props.unarchive ?? null : null;
  const archive = archivable(card) ? props.archive ?? null : null;
  const unread = unreadable(card) ? props.markUnread ?? null : null;
  const tokens = taskTokens(props.theme);
  const stop = stopLabel(props as TaskDetailCardsProps);
  const read = readable(card, stop, props.markRead);
  const buttons = card.lane === "needs_input" && props.onPermission ? (props.permissionButtons ?? []) : [];
  const respond = buttons.filter((button) => button.kind === "respond");
  const answer = buttons.find((button) => button.kind !== "respond");
  const asking = respond.length > 0 || !!answer;
  // The card's buttons, in its words and looks: "Open parent" then "Open tab",
  // a provider subagent's "Open parent" alone (its own tab is the parent's).
  const parentOpens = !!onOpen && parentOpensInPaseo(card);
  const ownOpen = !!onOpen && !card.subagent;
  if (!ownOpen && !parentOpens && !stop && !read && !unread && !asking && !unarchive && !archive && !props.onClose) return null;
  const open = () => onOpen?.(card.id);
  const cardText = cardStrings(props.language);
  const openText = cardText.openTab;
  // Deny first, allow last: the main button sits under the thumb.
  const ordered = [...respond].sort((a, b) => (a.action.behavior === "allow" ? 1 : 0) - (b.action.behavior === "allow" ? 1 : 0));
  const pairedOpen = !!props.onClose && (ownOpen || parentOpens) && !answer;
  if (props.controlsOnly) {
    const showOpen = !buttons.some((button) => button.kind === "open");
    return (
      <ActionRow testID="detail-question-controls" style={{ marginTop: 12, justifyContent: "flex-end" }}>
        {stop && props.stop ? <BarButton tokens={tokens} sidebar={props.sidebar} icon={props.stop.phase === "confirming" ? CONFIRM_STOP_ICON : "Power"} look="danger" label={stop} busy={props.stop.phase === "stopping"} grow={false} onPress={props.stop.onPress} testID="detail-bar-stop" /> : null}
        {showOpen && parentOpens ? <BarButton tokens={tokens} sidebar={props.sidebar} icon="CornerLeftUp" label={cardText.openParent} grow={false} onPress={() => onOpen?.(card.parent!.id)} testID="detail-bar-open-parent" /> : null}
        {showOpen && ownOpen ? <BarButton tokens={tokens} sidebar={props.sidebar} arrow label={openText} grow={false} onPress={open} testID="detail-bar-open" /> : null}
        {props.onClose ? <BarButton tokens={tokens} sidebar={props.sidebar} icon="X" label={props.strings.close} grow={false} onPress={props.onClose} testID="detail-bar-close" /> : null}
      </ActionRow>
    );
  }
  return (
    <ActionRow testID="detail-action-bar" style={{ paddingHorizontal: 12, paddingTop: (props.smallTablet ? 6 : 10) + (Platform.OS === "web" ? 0 : 4), paddingBottom: Platform.OS === "web" || props.flushBottom ? 0 : 4, alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.border, zIndex: props.contentUnder ? 1 : undefined, boxShadow: props.contentUnder ? scrollEdgeShadow(tokens.isDark, "up") : undefined, ...(props.onClose ? { flexWrap: "wrap", justifyContent: "flex-end" } : null) }}>
      {asking ? (
        <>
          {ordered.map((button) => (
            <BarButton smallTablet={props.smallTablet} sidebar={props.sidebar}
              key={button.key}
              tokens={tokens}
              label={button.label}
              icon={button.answers ? undefined : button.action.behavior === "allow" ? "Check" : "X"}
              labelOnly={!!button.answers}
              look={requestLook(button)}
              disabled={!!taskOperationIssue(card, "permission")}
              onPress={() => props.onPermission?.(button)}
            />
          ))}
          {/* "Answer" already opens the tab, so, as on the card, Open tab is the square beside Allow and Deny only. */}
          {answer ? <BarButton smallTablet={props.smallTablet} sidebar={props.sidebar} tokens={tokens} label={answer.label} icon={answer.kind === "question" ? "MessageCircleQuestion" : undefined} arrow={answer.kind === "open"} look={requestLook(answer)} onPress={() => props.onPermission?.(answer)} /> : null}
          {stop && props.stop ? (
            <BarButton smallTablet={props.smallTablet} sidebar={props.sidebar} tokens={tokens} icon={props.stop.phase === "confirming" ? CONFIRM_STOP_ICON : "Power"} look="danger" label={stop} busy={props.stop.phase === "stopping"} grow={false} onPress={props.stop.onPress} testID="detail-bar-stop" />
          ) : null}
          {ownOpen && !answer && !pairedOpen ? <BarButton smallTablet={props.smallTablet} sidebar={props.sidebar} tokens={tokens} look="primary" keepLabel={false} arrow label={openText} square onPress={open} testID="detail-bar-open" /> : null}
          {!ownOpen && parentOpens && !answer && !pairedOpen ? (
            <BarButton smallTablet={props.smallTablet} sidebar={props.sidebar} tokens={tokens} look="primary" keepLabel={false} icon="CornerLeftUp" label={cardText.openParent} square onPress={() => onOpen?.(card.parent!.id)} testID="detail-bar-open-parent" />
          ) : null}
        </>
      ) : (
        <>
          {stop && props.stop ? (
            <BarButton smallTablet={props.smallTablet} sidebar={props.sidebar}
              tokens={tokens}
              icon={props.stop.phase === "confirming" ? CONFIRM_STOP_ICON : "Power"}
              look="danger"
              label={stop}
              busy={props.stop.phase === "stopping"}
              grow={false}
              onPress={props.stop.onPress}
              testID="detail-bar-stop"
            />
          ) : null}
          {read ? (
            <BarButton smallTablet={props.smallTablet} sidebar={props.sidebar}
              tokens={tokens}
              icon="CheckCheck"
              look={card.status === "failed" ? "plain" : "read"}
              label={cardText.markRead}
              busy={read.pending(card.id)}
              grow={!ownOpen && !parentOpens}
              onPress={() => read.press(card)}
              testID="detail-bar-read"
              disabled={!!taskOperationIssue(card, "read")}
            />
          ) : null}
          {unread ? (
            <BarButton smallTablet={props.smallTablet} sidebar={props.sidebar}
              tokens={tokens}
              glyph={(color, size) => <UnreadIcon size={size} color={color} />}
              look="unread"
              label={cardText.markUnread}
              busy={unread.pending(card.id)}
              grow={!ownOpen && !parentOpens}
              onPress={() => unread.press(card)}
              testID="detail-bar-unread"
            />
          ) : null}
          {archive ? (
            <BarButton smallTablet={props.smallTablet} sidebar={props.sidebar}
              tokens={tokens}
              icon="Archive"
              look="archive"
              label={cardText.details.archive}
              busy={archive.pending(card.id)}
              grow={!ownOpen && !parentOpens}
              onPress={() => archive.press(card.id)}
              testID="detail-bar-archive"
              disabled={!!taskOperationIssue(card, "archive")}
            />
          ) : null}
          {parentOpens ? (
            pairedOpen && !ownOpen ? null : <BarButton smallTablet={props.smallTablet} sidebar={props.sidebar} tokens={tokens} look="primary" keepLabel={false} icon="CornerLeftUp" label={cardText.openParent} grow={pairedOpen ? false : undefined} onPress={() => onOpen?.(card.parent!.id)} testID="detail-bar-open-parent" />
          ) : null}
          {ownOpen && !pairedOpen ? <BarButton smallTablet={props.smallTablet} sidebar={props.sidebar} tokens={tokens} look="primary" keepLabel={false} arrow label={openText} onPress={open} testID="detail-bar-open" /> : null}
          {unarchive ? (
            <BarButton smallTablet={props.smallTablet} sidebar={props.sidebar}
              tokens={tokens}
              icon="ArchiveRestore"
              label={cardText.details.unarchive}
              busy={unarchive.pending(card.id)}
              onPress={() => unarchive.press(card.id)}
              testID="detail-bar-unarchive"
              disabled={!!taskOperationIssue(card, "unarchive")}
            />
          ) : null}
        </>
      )}
      {pairedOpen && props.onClose ? <SheetOpenClose tokens={tokens} sidebar={props.sidebar} smallTablet={props.smallTablet} openLabel={ownOpen ? openText : cardText.openParent} parent={!ownOpen} onOpen={ownOpen ? open : () => onOpen?.(card.parent!.id)} closeLabel={props.strings.close} onClose={props.onClose} /> : props.onClose ? <BarButton smallTablet={props.smallTablet} sidebar={props.sidebar} tokens={tokens} icon="X" label={props.strings.close} grow={false} onPress={props.onClose} testID="detail-bar-close" /> : null}
    </ActionRow>
  );
}

/** Share the space left by other actions, while preserving each icon's minimum width. */
function SheetOpenClose(props: { tokens: TaskTokens; sidebar?: boolean; smallTablet?: boolean; openLabel: string; parent: boolean; onOpen(): void; closeLabel: string; onClose(): void }) {
  const scale = useTasksFontScale();
  const minimum = taskControlHeight(Platform.OS === "web" ? 34 : 36, scale);
  const inset = Platform.OS === "web" ? 0 : 4;
  const [width, setWidth] = useState(0);
  const available = Math.max(0, width - 8);
  const closeWidth = width > 0 ? Math.max(minimum, available / 4) : undefined;
  const openWidth = closeWidth === undefined ? undefined : available - closeWidth;
  return (
    <View testID="detail-open-close" onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ flexDirection: "row", flexBasis: 0, flexGrow: 1, flexShrink: 1, minWidth: minimum * 2 + 8, paddingVertical: inset, gap: 8 }}>
      <BarButton tokens={props.tokens} sidebar={props.sidebar} smallTablet={props.smallTablet} look="primary" keepLabel={false} icon={props.parent ? "CornerLeftUp" : undefined} arrow={!props.parent} label={props.openLabel} width={openWidth} onPress={props.onOpen} testID={props.parent ? "detail-bar-open-parent" : "detail-bar-open"} />
      <BarButton tokens={props.tokens} sidebar={props.sidebar} smallTablet={props.smallTablet} icon="X" label={props.closeLabel} width={closeWidth} onPress={props.onClose} testID="detail-bar-close" />
    </View>
  );
}

export type DetailRead = { pending(agentId: string): boolean; press(card: TaskCard): void };

/**
 * Another host's card leaves out what this plugin's server does for its
 * own host's agents: Stop, Mark read and unread, Unarchive and titles.
 */
function withoutServerActions<Props extends { card: TaskCard; stop?: unknown; unarchive?: unknown; markRead?: unknown; markUnread?: unknown; titleUpdates?: unknown }>(props: Props): Props {
  return remoteCard(props.card) ? { ...props, stop: null, unarchive: null, markRead: null, markUnread: null, titleUpdates: undefined } : props;
}

/** Mark read takes Stop's place, as on the card: a card in review is never stoppable. */
function readable(card: TaskCard, stop: string | null, read: DetailRead | null | undefined): DetailRead | null {
  return !stop && card.readable === true ? read ?? null : null;
}

/** A done task, not archived: Archive is offered for it. */
function archivable(card: TaskCard): boolean {
  return card.lane === "done" && !card.archived;
}

/** A done task of our own, not a provider subagent: Mark unread is offered for it. */
function unreadable(card: TaskCard): boolean {
  return card.lane === "done" && !card.archived && !card.subagent;
}

/**
 * The bottom bar's button: the card button's outline (`buttonHue`) at thumb
 * size. The fill stays the card. Desktop hover deepens the shadow. A phone or iPad
 * deepens it while pressed, and grows. A busy one does neither.
 */
/** `arrow` ends the button in a ↗ after its label (Open tab); a square shows only the arrow. */
function BarButton(props: { tokens: TaskTokens; icon?: string; glyph?: (color: string, size: number) => React.ReactNode; look?: CardButtonLook; keepLabel?: boolean; labelOnly?: boolean; label: string; sidebar?: boolean; smallTablet?: boolean; square?: boolean; grow?: boolean; width?: number; busy?: boolean; disabled?: boolean; arrow?: boolean; onPress(): void; testID?: string }) {
  const { tokens } = props;
  const scale = useTasksFontScale();
  const { hovered: hover, hoverProps } = useHover();
  // Desktop and touch layouts keep their own visual heights.
  const compact = (props.sidebar === true && Platform.OS === "web") || (Platform.OS === "ios" && Platform.isPad);
  const font = F.sm;
  const height = taskControlHeight(Platform.OS === "web" ? 34 : 36, scale);
  const squareWidth = height;
  const iconSize = Platform.OS === "web" ? 14 : 16;
  const padding = compact ? 10 : 12;
  const gap = 4;
  const look = props.look ?? "plain";
  const hue = buttonHue(tokens, look);
  const text = hue.color;
  const iconColor = look === "plain" ? tokens.foregroundMuted : text;
  const fit = useActionFit(props.label, `${scale}|${compact}|${font}|${useWindowDimensions().fontScale}`, squareWidth, 2 * padding + ((props.icon || props.glyph !== undefined || props.busy) ? iconSize + gap : 0) + (props.arrow ? iconSize + gap : 0) + 1, props.square, props.keepLabel ?? look === "primary", props.labelOnly);
  const square = fit.iconOnly || (!props.labelOnly && props.width !== undefined && fit.full !== null && props.width < fit.full);
  const disabled = props.busy || props.disabled;
  const hovered = hover && !disabled;
  // A bar button spans its share of the bar, wider than a finger; a square one is covered by it.
  const liftAs = square || props.grow === false ? "control" : "row";
  return (
    <ActionPressable lift={liftAs}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      hitSlop={Platform.OS !== "web" ? 4 : undefined}
      accessibilityState={disabled ? { disabled: true, busy: props.busy === true } : undefined}
      disabled={disabled}
      onPress={props.onPress}
      {...hoverProps}
      testID={props.testID}
      style={({ pressed }) => ({
        // A written option may wrap, so it grows taller rather than wider.
        ...(props.labelOnly ? { minHeight: height, paddingVertical: 4 } : { height }),
        width: square ? squareWidth : undefined,
        flexGrow: square || props.grow === false ? 0 : 1,
        flexShrink: square ? 0 : 1,
        paddingHorizontal: square ? 0 : padding,
        borderRadius: compact ? 8 : 10,
        ...liftedButtonOutline(tokens, hue.border, look === "plain", surfaceLift(hovered, pressed && !disabled, undefined, liftAs)),
        backgroundColor: tokens.card.background,
        opacity: disabled ? 0.6 : 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap,
        ...webTransition,
        ...fit.style,
        ...(props.width === undefined ? null : { width: props.width, minWidth: square ? squareWidth : fit.full ?? squareWidth, flexGrow: 0, flexShrink: 0, ...(square ? { paddingHorizontal: 0 } : null) }),
      })}
    >
      {props.busy ? (
        // The running ring without its dot, in the icon's box so the button keeps its width.
        <SpinnerRing size={iconSize} color={iconColor} testID={props.testID ? `${props.testID}-spinner` : undefined} />
      ) : props.glyph ? (
        props.glyph(iconColor, iconSize)
      ) : props.icon ? (
        <Icon name={props.icon} size={iconSize} color={iconColor} />
      ) : null}
      {square ? null : (
        <Text onLayout={fit.labelLayout} numberOfLines={props.labelOnly ? undefined : 1} style={{ flexShrink: props.labelOnly ? 1 : 0, ...(props.labelOnly ? { textAlign: "center" as const } : null), fontSize: font, fontWeight: "600", color: text }}>
          {props.label}
        </Text>
      )}
      {props.arrow && !(square && props.busy) ? (
        <View style={square ? undefined : { marginLeft: -arrowInset(iconSize), width: iconSize * 18 / 24 }}>
          <Icon name="ArrowUpRight" size={iconSize} color={iconColor} />
        </View>
      ) : null}
    </ActionPressable>
  );
}
