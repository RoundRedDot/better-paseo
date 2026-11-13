import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { tipProps } from "../cards/card-hints";
import { TaskText as Text, HOST_FONT as F, HOST_LINE, useTasksFontScale, taskControlHeight } from "../typography";
import { useHover } from "../../ui/use-hover";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { liftStyle, scaleStyle, surfaceLift } from "../cards/surface-lift";
import { usePressCue } from "../cards/action-pressable";
import { BrandMark, DETAIL_CARD, DetailActionBar, DetailCard, detailGutter, detailScrollProps, outsideIndicator, ProjectIcon, requestInSection, StatusIcon, TagMark, TaskDetailCards, taskTokens, tildePath, type DetailNotice, type TaskTokens } from "../cards";
import { LANE_STATUS, turnRunning, type LaneId, type TaskCard } from "../model";
import { activeStopChildren } from "../actions/stop-targets";
import { SheetFoot, SheetScrollRoom } from "../sheet-motion";
import { useFirstPrompt } from "../data/first-prompt";
import { lastHumanMessageVersion, useLastHumanMessage } from "../data/last-human-message";
import { lastMessageVersion, useLastMessage } from "../data/last-message";
import { detailsShowNote, useQuestionContext } from "../data/question-context";
import { useSessionTokens } from "../data/session-tokens";
import { useSubagentTimeline } from "../data/subagent-timeline";
import { FILTER_GROUP_ORDER, FILTER_ICONS, buildFilterOptions, clearedParams, filterSummary, shownFilterOptions, toggleProject, type FilterOption, type ShownFilterOptions } from "./filter-options";
import { RollingCount, RollingTotal } from "./board-parts";
import { useRequestProjectIcons } from "./project-icons";
import { toggleItem } from "./params";
import { matchesSearch, searchWords } from "./search";
import type { SelectionAction, SidebarSelection } from "./sidebar-model";
import { findCard, type BoardController } from "./use-board";
import { CardContextMenu } from "../cards/card-menu";
import { cardStrings } from "../cards/strings";
import { parentOpensInPaseo } from "../model";
import { useTitleUpdateState } from "../actions/title-update";

type GroupKind = (typeof FILTER_GROUP_ORDER)[number];
const GROUP_KINDS: readonly GroupKind[] = FILTER_GROUP_ORDER;

export interface DetailsSidebarProps {
  board: BoardController;
  theme: PluginTheme;
  selection: SidebarSelection;
  dispatch(action: SelectionAction): void;
  /** A stat was pressed: show that lane. */
  onLane(lane: LaneId): void;
  /** A parent or subtask in the details: scroll the board to it. */
  onReveal(agentId: string): void;
  /** Touch sizes (a tablet). */
  touch: boolean;
  /** False leaves out the status counts (a bottom sheet showing a card, where room is short). Default true. */
  stats?: boolean;
  /** Scroll the whole column as one whatever its height (a bottom sheet: its handle, not the header, is what stays). */
  scrollAll?: boolean;
  tabs?: boolean;
  sheetToggle?: { full: boolean; label: string; onPress(): void };
  onSheetClose?(): void;
  testID?: string;
}

/**
 * The sidebar's column (`docs/prototypes/task-details-sidebar.md`): the
 * status counts always on top; under them the board's groups while no card
 * is chosen, or the chosen card's details as one card, its header pinned and
 * the sections under it scrolling.
 */
export const DetailsSidebar = memo(DetailsSidebarView);

/**
 * The board fields a card's details draw nothing from: the lanes, beyond
 * whether the card is in them, the counts and the store's snapshot. Every
 * running agent's update changes them, and drew the open card again each
 * time, 25-60 ms on an Android foldable. Any other field is compared, so one
 * added later draws the details again rather than leaving them stale.
 */
const DETAILS_BLIND: ReadonlySet<string> = new Set(["lanes", "hidden", "hiddenSubtasks", "total", "tasks", "searchStatus"]);

/** The board as a card's details read it: equal but for `DETAILS_BLIND` (the caller compares the card itself). */
export function sameDetailsBoard(last: BoardController, next: BoardController): boolean {
  if (last === next) return true;
  if (last.tasks.ready !== next.tasks.ready) return false;
  const fields = Object.keys(next) as (keyof BoardController)[];
  return fields.length === Object.keys(last).length && fields.every((key) => DETAILS_BLIND.has(key) || last[key] === next[key]);
}

/** The action bar's part of a card's details: what it can do now. */
function detailActions(board: BoardController, card: TaskCard) {
  const stopAvailable = !!board.callbacks.onStop && (card.stoppable || activeStopChildren(card).length > 0);
  return {
    card,
    language: board.language,
    strings: board.strings.sidebar,
    onOpen: board.callbacks.onOpen,
    stop: stopAvailable ? { phase: board.stop.phase(card.id), onPress: () => board.callbacks.onStop?.(card, { withChildren: !card.stoppable }) } : null,
    permissionButtons: board.buttonsFor(card),
    submitQuestions: board.submitQuestions,
    questionDialog: board.questionDialog,
    onPermission: (button: Parameters<NonNullable<typeof board.callbacks.onPermission>>[1]) => board.callbacks.onPermission?.(card, button),
    unarchive: board.unarchive.available ? board.unarchive : null,
    archive: board.archive,
    markRead: board.read.available ? board.read : null,
    markUnread: board.unread ?? null,
  };
}

function DetailsSidebarView(props: DetailsSidebarProps) {
  const { board, theme, selection, dispatch } = props;
  const tokens = taskTokens(theme);
  // Pixel-by-pixel resizes only change the browser's layout, not this subtree.
  const [layout, setLayout] = useState({ short: false, wide: false });
  const [menu, setMenu] = useState<{ id: string; point: { x: number; y: number } } | null>(null);
  const openMenu = useCallback((id: string, point: { x: number; y: number }) => setMenu({ id, point }), []);
  const card = selection.id ? board.cardById(selection.id) : undefined;
  useParentTitle(board, card);
  const shown = card && selection.id ? findCard(board.lanes, selection.id) !== null : false;
  const backId = selection.back[selection.back.length - 1]?.id;
  const backCard = backId ? board.cardById(backId) : undefined;

  const showStats = props.stats !== false;
  // The counts' summary and the groups read the same options: built once here, and only while one of them is shown.
  const optionsShown = showStats || card === undefined;
  const showEmpty = board.showEmptyGroups;
  const options = useMemo(() => (optionsShown ? shownFilterOptions(buildFilterOptions(board.tasks, board.params), showEmpty) : null), [optionsShown, board.tasks, board.params, showEmpty]);

  // A short column (an iPad in landscape, a low window) has no room to hold
  // the header still: the fixed part left the sections a strip of 80. There
  // the whole column scrolls as one.
  // A wide sheet lays a card out in two columns that scroll on their own, so the header stays in view.
  const tabs = props.tabs === true && card !== undefined;
  const columns = !tabs && props.scrollAll === true && card !== undefined && layout.wide;
  const short = !tabs && !columns && (props.scrollAll === true || layout.short);
  const content = (
    <>
      {menu && board.cardById(menu.id) ? <SidebarCardMenu board={board} card={board.cardById(menu.id)!} theme={theme} point={menu.point} onClose={() => setMenu(null)} /> : null}
      {showStats ? <StatsCard board={board} options={options!} theme={theme} tokens={tokens} onLane={props.onLane} touch={props.touch} /> : null}
      {card ? (
        <SidebarDetails
          board={board}
          card={card}
          shown={shown}
          backId={backId}
          backCard={backCard}
          theme={theme}
          dispatch={dispatch}
          onReveal={props.onReveal}
          onMenu={openMenu}
          touch={props.touch}
          sheetToggle={props.sheetToggle}
          onSheetClose={props.onSheetClose}
          questionActionsInHeader={!tabs && !!props.onSheetClose}
          actions={!tabs && props.onSheetClose ? false : undefined}
          scrollBody={!short && !columns && !tabs}
          columns={columns}
          tabs={tabs}
          tab={selection.tab}
          scrollHeader={tabs && (props.touch || layout.short || props.scrollAll === true)}
        />
      ) : (
        <GroupCard board={board} options={options!} theme={theme} tokens={tokens} touch={props.touch} />
      )}
    </>
  );
  const sheetActions = !tabs && card && props.onSheetClose && !requestInSection(card, board.buttonsFor(card)) ? <SheetFoot><DetailActionBar {...detailActions(board, card)} theme={theme} sidebar onClose={props.onSheetClose} /></SheetFoot> : null;
  // Whether the column's size can change what it draws. A touch card in tabs
  // (the tablet's sheet and floating panel) ignores it: there the layout that
  // follows a card's first frame only drew the whole card again, the same,
  // for 70 ms on an Android foldable, and the sheet waited for it to slide in.
  const layoutUsed = card ? (tabs ? !(props.touch || props.scrollAll === true) : true) : props.scrollAll !== true;
  const usedNow = useRef(layoutUsed);
  usedNow.current = layoutUsed;
  // The last size measured while it was not used; taken once it is.
  const measured = useRef(layout);
  useLayoutEffect(() => {
    if (!layoutUsed) return;
    const next = measured.current;
    setLayout((was) => was.short === next.short && was.wide === next.wide ? was : next);
  }, [layoutUsed]);
  const onLayout = (event: { nativeEvent: { layout: { width: number; height: number } } }) => {
    const height = Math.round(event.nativeEvent.layout.height);
    const short = height > 0 && height < SHORT_COLUMN;
    const wide = Math.round(event.nativeEvent.layout.width) >= SHEET_COLUMNS;
    measured.current = { short, wide };
    if (usedNow.current) setLayout((was) => was.short === short && was.wide === wide ? was : { short, wide });
  };
  if (short) {
    const parked = outsideIndicator(props.scrollAll === true && props.touch === true);
    return (
      <View style={{ flex: 1, minHeight: 0 }} onLayout={onLayout} testID={props.testID ?? "details-sidebar"}>
        {/* Keyed by the card: a jump to the parent or back starts at the top. */}
        <SheetScrollRoom>
          <ScrollView key={selection.id ?? ""} style={{ flex: 1, marginRight: parked?.marginRight ?? 0 }} contentContainerStyle={{ gap: DETAIL_CARD.gap, paddingRight: parked?.paddingRight ?? 0 }} {...detailScrollProps("column")} testID="details-sidebar-scroll">
            {content}
          </ScrollView>
        </SheetScrollRoom>
        {sheetActions}
      </View>
    );
  }
  return (
    <View style={{ flex: 1, minHeight: 0, gap: DETAIL_CARD.gap }} onLayout={onLayout} testID={props.testID ?? "details-sidebar"}>
      {/* A tabbed card gives up the room inside, above its own foot. */}
      {columns ? <SheetScrollRoom>{content}</SheetScrollRoom> : content}
      {sheetActions}
    </View>
  );
}

interface SidebarDetailsProps {
  board: BoardController;
  card: TaskCard;
  /** In the lanes the filters leave; a hidden card says so. */
  shown: boolean;
  backId: string | undefined;
  backCard: TaskCard | undefined;
  theme: PluginTheme;
  dispatch(action: SelectionAction): void;
  onReveal(agentId: string): void;
  onMenu(id: string, point: { x: number; y: number }): void;
  touch: boolean;
  sheetToggle?: { full: boolean; label: string; onPress(): void };
  onSheetClose?(): void;
  questionActionsInHeader?: boolean;
  actions: false | undefined;
  scrollBody: boolean;
  columns: boolean;
  tabs: boolean;
  tab: SidebarSelection["tab"];
  scrollHeader: boolean;
}

/**
 * The chosen card's details. The column around them draws again for every
 * board change (its counts follow the lanes); the details only for their own
 * card or what they read of the board (`sameDetailsBoard`), in the sheet and
 * the side panels alike.
 */
const SidebarDetails = memo(SidebarDetailsView, (last: SidebarDetailsProps, next: SidebarDetailsProps) => {
  const keys = Object.keys(next) as (keyof SidebarDetailsProps)[];
  return keys.length === Object.keys(last).length && keys.every((key) => (key === "board" ? sameDetailsBoard(last.board, next.board) : last[key] === next[key]));
});

function SidebarDetailsView(props: SidebarDetailsProps) {
  const { board, card, dispatch } = props;
  const strings = board.strings.sidebar;
  const notice: DetailNotice | null = props.shown
    ? null
    : { icon: "EyeOff", text: strings.hidden, action: { label: board.strings.clearFilters, onPress: () => board.setParams((params) => ({ ...clearedParams(params), hideSubtasks: false })) } };
  const { firstPrompt, humanMessage, lastMessage, sessionTokens, questionContext } = useDetailReads(board, card);
  return (
    <TaskDetailCards
      key={props.tabs ? card.id : undefined}
      {...detailActions(board, card)}
      searchQuery={board.params.query}
      theme={props.theme}
      touch={props.touch}
      clock={board.clock}
      onClose={() => dispatch({ type: "clear" })}
      onMenu={(point) => props.onMenu(card.id, point)}
      sheetToggle={props.sheetToggle}
      onSheetClose={props.onSheetClose}
      questionActionsInHeader={props.questionActionsInHeader}
      back={props.backId ? { title: props.backCard?.title ?? cardStrings(board.language).parentUnknown, onPress: () => dispatch({ type: "back" }) } : null}
      notice={notice}
      onJump={(agentId) => {
        dispatch({ type: "jump", id: agentId });
        props.onReveal(agentId);
      }}
      onSubtaskMenu={props.onMenu}
      titleUpdates={board.callbacks.titleUpdates}
      firstPrompt={firstPrompt}
      sessionTokens={sessionTokens}
      humanMessage={humanMessage}
      lastMessage={lastMessage}
      questionContext={questionContext}
      actions={props.actions}
      scrollBody={props.scrollBody}
      columns={props.columns}
      tabs={props.tabs}
      initialTab={props.tab}
      onTabChange={(tab) => dispatch({ type: "tab", tab })}
      scrollHeader={props.scrollHeader}
    />
  );
}

function SidebarCardMenu(props: { board: BoardController; card: TaskCard; theme: PluginTheme; point: { x: number; y: number }; onClose(): void }) {
  const { board, card } = props;
  const callbacks = board.callbacks;
  const title = useTitleUpdateState(callbacks.titleUpdates, card.id);
  const children = activeStopChildren(card).length;
  const canStop = (card.stoppable || children > 0) && !!callbacks.onStop;
  return <CardContextMenu point={props.point} card={card} theme={props.theme} strings={cardStrings(board.language)} onClose={props.onClose} actions={{
    autoTitle: callbacks.titleUpdates ? () => callbacks.titleUpdates?.start(card.id) : undefined,
    autoTitlePending: title.state === "running" || board.callbacks.titleUpdates?.revealing().has(card.id),
    open: callbacks.onOpen && !card.subagent ? () => callbacks.onOpen?.(card.id) : undefined,
    openParent: callbacks.onOpen && parentOpensInPaseo(card) ? () => callbacks.onOpen?.(card.parent!.id) : undefined,
    revealParent: card.parent ? () => callbacks.onReveal(card.parent!.id) : undefined,
    stop: canStop && board.stop.phase(card.id) !== "stopping" ? (withChildren) => callbacks.onStop?.(card, { withChildren, dialog: true }) : undefined,
    children: canStop && card.stoppable ? children : 0,
    childrenOnly: !card.stoppable,
    read: !canStop && card.readable && callbacks.onRead && !board.read.pending(card.id) ? () => callbacks.onRead?.(card) : undefined,
    unread: card.lane === "done" && !card.archived && !card.subagent && callbacks.onUnread && !board.unread?.pending(card.id) ? () => callbacks.onUnread?.(card) : undefined,
    unarchive: card.archived === "agent" && callbacks.onUnarchive ? () => callbacks.onUnarchive?.(card.id) : undefined,
    archive: card.lane === "done" && !card.archived && callbacks.onArchive && !board.archive.pending(card.id) ? () => callbacks.onArchive?.(card.id) : undefined,
    filters: callbacks.onFilter && callbacks.filterState ? { state: callbacks.filterState(card), select: (by) => callbacks.onFilter?.(card, by) } : undefined,
  }} />;
}

/**
 * What the details read from a task's timeline: its first prompt, the last
 * message a person sent, its latest reply and running session's tokens. A
 * provider subagent's come from the plugin server, which reads its timeline
 * off the daemon; it has no session of its own to count, and no person
 * writes to it (its prompts are the parent's).
 *
 * The three messages start loading as soon as the card is shown, including
 * a closed agent. Reading its timeline resumes it; opening the card is that
 * request, so the reader does not also press Load.
 */
export function useDetailReads(board: BoardController, card: TaskCard | undefined) {
  const subagent = card?.subagent ? card : undefined;
  const agent = card && !card.subagent ? card : undefined;
  const shown = agent !== undefined;
  const firstPrompt = useFirstPrompt(board.paseo, agent?.id ?? "", shown);
  const live = board.visible && agent !== undefined && turnRunning(agent) && agent.closed !== true;
  const lastMessage = useLastMessage(board.paseo, agent?.id ?? "", agent ? lastMessageVersion(agent) : "", shown, live);
  const replyEpoch = lastMessage.prompt.state === "ready" ? lastMessage.prompt.position?.epoch : undefined;
  const humanMessage = useLastHumanMessage(board.paseo, agent?.id ?? "", agent ? `${lastHumanMessageVersion(agent)}|${replyEpoch ?? ""}` : "", shown);
  const sessionTokens = useSessionTokens(agent?.id ?? "", agent !== undefined && turnRunning(agent) && agent.closed !== true);
  const subagentReads = useSubagentTimeline(
    {
      id: subagent?.id ?? "",
      parentId: subagent?.parent?.id ?? "",
      running: subagent?.status === "running",
      version: subagent ? `${subagent.status}|${subagent.timing.updatedAt}` : "",
    },
    subagent !== undefined,
  );
  const asking = agent?.lane === "needs_input" && agent.permission?.kind === "question" ? agent.permission : null;
  const questionRead = useQuestionContext(board.paseo, agent?.id ?? "", asking);
  const questionContext = asking && detailsShowNote(questionRead.context, lastMessage.prompt) ? questionRead : null;
  return subagent ? { ...subagentReads, humanMessage: null, sessionTokens: null, questionContext: null } : { firstPrompt, humanMessage, lastMessage, sessionTokens, questionContext };
}

/**
 * A parent that left the loaded set (archived, or an old done task) has no
 * title, and no word on whether it is archived, until it is read once: the
 * details ask for it, as the card's "show parent" link does.
 */
export function useParentTitle(board: BoardController, card: TaskCard | undefined): void {
  const parent = card?.parent;
  const parentId = parent && (parent.title === null || (parent.missing && parent.archived === null)) ? parent.id : null;
  useEffect(() => {
    if (parentId) board.tasks.resolveParent(parentId);
  }, [board.tasks, parentId]);
}

/** A bottom sheet this wide (a tablet's, not a phone's or a foldable's) lays the details out in two columns of about 340 and 300. */
const SHEET_COLUMNS = 640;

/** Under this height the sidebar scrolls as one instead of holding the details' header still. */
const SHORT_COLUMN = 640;

/** The board's lanes' counts after the filters, each with its lane's mark; a press shows the lane. */
function StatsCard(props: { board: BoardController; options: ShownFilterOptions; theme: PluginTheme; tokens: TaskTokens; onLane(lane: LaneId): void; touch: boolean }) {
  const { board, options, tokens } = props;
  const scale = useTasksFontScale();
  const [rowWidth, setRowWidth] = useState(0);
  const [measured, setMeasured] = useState<{ value: number; scale: number; width: number } | null>(null);
  const largestCount = Math.max(0, ...board.laneOrder.map((id) => board.lanes[id].cards.length));
  const available = (rowWidth - 4 * (board.laneOrder.length - 1)) / board.laneOrder.length - 16;
  // Each cell's heading spans the cell inside its padding and border. Taken
  // from the row's one layout: a resize then measures one node, not one per lane.
  const headingWidth = rowWidth > 0 ? available - 2 * StyleSheet.hairlineWidth : null;
  const countSize = measured?.value === largestCount && measured.scale === scale && measured.width > 0 && available > 0
    ? Math.min(F.base, Math.floor(F.base * available / measured.width * scale) / scale)
    : F.base;
  const summary = filterSummary(board.params, board.defaults, options, board.strings);
  return (
    <DetailCard tokens={tokens} style={{ paddingHorizontal: 8, paddingTop: 8, paddingBottom: props.touch ? 4 : 8, gap: 6 }} testID="sidebar-stats">
      <View style={{ paddingHorizontal: 4, flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <View style={{ flexShrink: 0 }}>
          <RollingTotal board={board} style={{ fontSize: F.base, fontWeight: "600", color: tokens.foreground, fontVariant: ["tabular-nums"] }} />
        </View>
        {summary ? (
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: F.sm, color: tokens.foregroundMuted }}>
            {summary}
          </Text>
        ) : null}
      </View>
      <View testID="sidebar-stats-row" onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)} style={{ flexDirection: "row", gap: 4 }}>
        {board.laneOrder.map((id) => (
          <StatCell
            key={id}
            lane={id}
            label={board.strings.lanes[id]}
            count={board.tasks.ready ? board.lanes[id].cards.length : null}
            scope={board.scope}
            theme={props.theme}
            tokens={tokens}
            animated={board.visible}
            touch={props.touch}
            countSize={countSize}
            headingWidth={headingWidth}
            onPress={() => props.onLane(id)}
          />
        ))}
        <View pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: "absolute", opacity: 0, flexDirection: "row" }}>
          <Text key={`${largestCount}|${scale}`} testID="sidebar-stat-count-measure" onLayout={(event) => setMeasured({ value: largestCount, scale, width: event.nativeEvent.layout.width })} style={{ fontSize: F.base, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{largestCount}</Text>
        </View>
      </View>
    </DetailCard>
  );
}

function StatCell(props: {
  lane: LaneId;
  label: string;
  count: number | null;
  /** The board's params: a count rolls to its new value only while they hold. */
  scope: unknown;
  theme: PluginTheme;
  tokens: TaskTokens;
  animated: boolean;
  touch: boolean;
  countSize: number;
  /** The width the mark and label share, from the stats row's layout; null until it is laid out. */
  headingWidth: number | null;
  onPress(): void;
}) {
  const { tokens, headingWidth } = props;
  const scale = useTasksFontScale();
  const [labelSize, setLabelSize] = useState<{ key: string; width: number } | null>(null);
  const labelKey = `${props.label}|${scale}`;
  const hideLabel = headingWidth !== null && labelSize?.key === labelKey && labelSize.width + 13 + 5 > headingWidth + 0.5;
  const { hovered, hoverProps } = useHover();
  const reduced = useReducedMotion();
  const press = usePressCue(hovered);
  const lift = surfaceLift(hovered, press.pressed, reduced, "capsule", press.input);
  const alert = props.lane === "needs_input" && (props.count ?? 0) > 0;
  const countStyle = { fontSize: props.countSize, lineHeight: HOST_LINE.base, fontWeight: "600" as const, color: alert ? tokens.warning : tokens.foreground, fontVariant: ["tabular-nums" as const] };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label} ${props.count ?? ""}`}
      {...tipProps(props.label)}
      onPress={press.guard(props.onPress)}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onTouchStart={press.onTouchStart}
      onTouchMove={press.onTouchMove}
      onTouchEnd={press.onTouchEnd}
      onTouchCancel={press.onTouchCancel}
      {...hoverProps}
      testID={`sidebar-stat-${props.lane}`}
      style={() => {
        return {
          flex: 1,
          minWidth: 0,
          minHeight: taskControlHeight(props.touch ? 48 : 56, scale),
          paddingHorizontal: 8,
          paddingTop: 6,
          paddingBottom: props.touch ? 2 : 6,
          borderRadius: 8,
          borderWidth: StyleSheet.hairlineWidth,
          backgroundColor: "transparent",
          // Transparent at rest; the needs-input alert's warning line keeps its hue.
          ...liftStyle(tokens, lift, { border: alert ? tokens.warning : "transparent", hued: alert }),
          ...scaleStyle(lift.scale),
          gap: 2,
        };
      }}
    >
      <View
        testID={`sidebar-stat-heading-${props.lane}`}
        style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
      >
        <StatusIcon kind={LANE_STATUS[props.lane]} size={13} theme={props.theme} animated={props.animated} />
        {hideLabel ? null : (
          <Text testID={`sidebar-stat-label-${props.lane}`} numberOfLines={1} style={{ flexShrink: 1, fontSize: F.sm, color: tokens.foregroundMuted }}>
            {props.label}
          </Text>
        )}
      </View>
      {props.count === null ? (
        <Text style={countStyle}>–</Text>
      ) : (
        <RollingCount value={props.count} scope={props.scope} style={countStyle} singleLine />
      )}
      {/* Keep the intrinsic label measurable while it is hidden, so resizing restores it. */}
      <View
        pointerEvents="none"
        aria-hidden
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ position: "absolute", left: 0, top: 0, opacity: 0, flexDirection: "row" }}
      >
        <Text
          key={labelKey}
          testID={`sidebar-stat-measure-${props.lane}`}
          numberOfLines={1}
          onLayout={(event) => {
            const width = event.nativeEvent.layout.width;
            setLabelSize((previous) => previous?.key === labelKey && previous.width === width ? previous : { key: labelKey, width });
          }}
          style={{ flexShrink: 0, fontSize: F.sm, color: tokens.foregroundMuted }}
        >
          {props.label}
        </Text>
      </View>
    </Pressable>
  );
}

interface GroupRow {
  id: string;
  label: string;
  count: number;
  on: boolean;
  /** Before the label; a label's tag is handed the row's fill for its hole. */
  lead: React.ReactNode | ((fill: string) => React.ReactNode);
  /** Muted second line: a project's path or a workspace's project. */
  detail?: string;
  /** A project row whose uploaded icon is not loaded yet. */
  iconFor?: string;
  toggle(): void;
}

/**
 * With no card chosen: Agent, Label, Project and Workspace counts (every
 * loaded card, including done and archived), a row a filter; those at 0 too
 * while `board.showEmptyGroups` is on.
 */
function GroupCard(props: { board: BoardController; options: ShownFilterOptions; theme: PluginTheme; tokens: TaskTokens; touch: boolean }) {
  const { board, options, tokens } = props;
  const strings = board.strings.sidebar;
  const scale = useTasksFontScale();
  const [labelFits, setLabelFits] = useState<Partial<Record<GroupKind, { key: string; fits: boolean }>>>({});
  const reportFit = useCallback((id: GroupKind, key: string, fits: boolean) => {
    setLabelFits((previous) => previous[id]?.key === key && previous[id]?.fits === fits ? previous : { ...previous, [id]: { key, fits } });
  }, []);
  // All four labels appear together, only after every current measurement fits.
  const showLabels = GROUP_KINDS.every((id) => labelFits[id]?.key === `${strings.groups[id]}|${scale}` && labelFits[id]?.fits);
  const [kind, setKind] = useState<GroupKind>("agent");
  const [queries, setQueries] = useState<Record<GroupKind, string>>({ agent: "", project: "", workspace: "", label: "" });
  const [searchFocused, setSearchFocused] = useState(false);
  const query = queries[kind];
  const rows = useMemo<GroupRow[]>(() => {
    const byCount = (a: { count: number }, b: { count: number }) => b.count - a.count;
    if (kind === "agent") {
      return [...options.agents]
        .sort(byCount)
        .map((option) => ({
          ...pick(option),
          lead: <BrandMark provider={option.id} size={16} tokens={tokens} />,
          toggle: () => board.setParams((params) => ({ ...params, providers: toggleItem(params.providers, option.id) })),
        }));
    }
    if (kind === "label") {
      return [...options.labels]
        .sort(byCount)
        .map((option) => ({
          ...pick(option),
          lead: (fill: string) => <TagMark size={16} color={option.color ?? tokens.foregroundMuted} hole={fill} />,
          toggle: () => board.setParams((params) => ({ ...params, labels: toggleItem(params.labels, option.id) })),
        }));
    }
    if (kind === "workspace") {
      return options.workspaceGroups
        .flatMap((group) =>
          group.items.map((item) => ({
            ...pick(item),
            lead: group.projectId ? <ProjectIcon location={group} size={16} hostId={board.hostId} /> : <Initial name={item.label} tokens={tokens} />,
            iconFor: group.projectId && group.projectIcon === null ? group.projectId : undefined,
            detail: group.projectId ? group.projectName : undefined,
            toggle: () => board.setParams((params) => ({ ...params, workspaceIds: toggleItem(params.workspaceIds, item.id) })),
          })),
        )
        .sort(byCount);
    }
    return options.projects
      .map((project) => ({
        ...pick(project),
        lead: <ProjectIcon location={project.group} size={16} hostId={board.hostId} />,
        iconFor: project.group.projectIcon === null ? project.id : undefined,
        detail: project.group.projectPath ? tildePath(project.group.projectPath) : undefined,
        toggle: () => board.setParams((params) => toggleProject(params, project)),
      }))
      .sort(byCount);
  }, [kind, options, board, tokens]);
  const words = searchWords(query);
  const visibleRows = rows.filter((row) => matchesSearch([row.label, row.detail], words));
  useRequestProjectIcons([...new Set(rows.flatMap((row) => (row.iconFor ? [row.iconFor] : [])))], board.tasks.requestProjectIcon);

  return (
    <DetailCard tokens={tokens} style={{ flexShrink: 1, minHeight: 0, paddingTop: 12, paddingBottom: 8 }} testID="sidebar-groups">
      <SegmentRow labels={strings.groups} kind={kind} onKind={setKind} showLabels={showLabels} onFit={reportFit} tokens={tokens} touch={props.touch} />
      <View style={{ paddingHorizontal: 10, paddingBottom: 8 }}>
        <View testID="sidebar-groups-search" style={{ height: taskControlHeight(props.touch ? 36 : 28, scale), flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: searchFocused ? props.theme.colors.foregroundMuted : props.theme.colors.border }}>
          <Icon name="Search" size={13} color={tokens.foregroundMuted} />
          <TextInput
            testID="sidebar-groups-search-input"
            value={query}
            onChangeText={(value) => setQueries((previous) => ({ ...previous, [kind]: value }))}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder={board.strings.menuSearch.placeholder}
            placeholderTextColor={tokens.foregroundMuted}
            accessibilityLabel={`${board.strings.searchButton} ${strings.groups[kind]}`}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            style={{ flex: 1, minWidth: 0, padding: 0, fontSize: Math.round(F.base * scale), color: tokens.foreground, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null) }}
          />
          {query ? (
            <Pressable testID="sidebar-groups-search-clear" accessibilityRole="button" accessibilityLabel={board.strings.menuSearch.clear} {...tipProps(board.strings.menuSearch.clear)} hitSlop={6} style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }} onPress={() => setQueries((previous) => ({ ...previous, [kind]: "" }))}>
              <Icon name="X" size={13} color={tokens.foregroundMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" {...detailScrollProps("inset")} testID="sidebar-groups-scroll">
        {visibleRows.length === 0 ? (
          <Text style={{ paddingHorizontal: DETAIL_CARD.padH, paddingVertical: 12, fontSize: F.sm, color: tokens.foregroundMuted }}>{words.length ? board.strings.menuSearch.empty : strings.noGroups}</Text>
        ) : (
          visibleRows.map((row) => <GroupRowView key={row.id} row={row} tokens={tokens} touch={props.touch} />)
        )}
      </ScrollView>
    </DetailCard>
  );
}

function pick(option: FilterOption): Pick<GroupRow, "id" | "label" | "count" | "on"> {
  return { id: option.id, label: option.label, count: option.count, on: option.on };
}

function Initial(props: { name: string; tokens: TaskTokens }) {
  return (
    <View style={{ width: 16, height: 16, borderRadius: 4, alignItems: "center", justifyContent: "center", backgroundColor: props.tokens.surface2 }}>
      {/* A glyph sized to its 16 badge, as an icon is, not a step of the text ramp. */}
      <Text style={{ fontSize: 10, fontWeight: "600", color: props.tokens.foregroundMuted }}>{[...props.name][0]?.toUpperCase() ?? "?"}</Text>
    </View>
  );
}

const SEGMENT_GAP = 6;
const SEGMENT_ROW_PAD = 10;

/**
 * The group tabs' row. It alone is measured: the four tabs share it equally
 * (`flexBasis` 0), so a resize lays out one node instead of four, and only
 * this row and its tabs draw again, not the group list under it.
 */
function SegmentRow(props: {
  labels: Record<GroupKind, string>;
  kind: GroupKind;
  onKind(kind: GroupKind): void;
  showLabels: boolean;
  onFit(id: GroupKind, key: string, fits: boolean): void;
  tokens: TaskTokens;
  touch: boolean;
}) {
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const width = rowWidth === null ? null : (rowWidth - 2 * SEGMENT_ROW_PAD - SEGMENT_GAP * (GROUP_KINDS.length - 1)) / GROUP_KINDS.length;
  return (
    <View
      testID="sidebar-group-tabs"
      onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
      style={{ flexDirection: "row", gap: SEGMENT_GAP, paddingHorizontal: SEGMENT_ROW_PAD, paddingBottom: 10 }}
    >
      {GROUP_KINDS.map((id) => (
        <Segment key={id} id={id} icon={FILTER_ICONS[id]} label={props.labels[id]} width={width} showLabel={props.showLabels} onFit={props.onFit} on={props.kind === id} tokens={props.tokens} touch={props.touch} onPress={() => props.onKind(id)} />
      ))}
    </View>
  );
}

/** Linear's segmented pills: outlined, grey when chosen. */
function Segment(props: {
  id: GroupKind;
  icon: string;
  label: string;
  /** Its share of the row (`SegmentRow`); null until the row is laid out. */
  width: number | null;
  showLabel: boolean;
  onFit(id: GroupKind, key: string, fits: boolean): void;
  on: boolean;
  tokens: TaskTokens;
  touch: boolean;
  onPress(): void;
}) {
  const { tokens, width } = props;
  const scale = useTasksFontScale();
  const [labelSize, setLabelSize] = useState<{ key: string; width: number } | null>(null);
  const labelKey = `${props.label}|${scale}`;
  const labelWidth = labelSize?.key === labelKey ? labelSize.width : null;
  const iconWidth = 14 + 12 + 2 * StyleSheet.hairlineWidth;
  const fullWidth = labelWidth === null ? null : labelWidth + iconWidth + 4;
  const { id, onFit } = props;
  useEffect(() => {
    if (width !== null && fullWidth !== null) onFit(id, labelKey, fullWidth <= width + 0.5);
  }, [id, onFit, labelKey, width, fullWidth]);
  const labelStyle = { fontSize: F.base, fontWeight: "500" as const, color: props.on ? tokens.foreground : tokens.foregroundMuted };
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: props.on }}
      accessibilityLabel={props.label}
      {...tipProps(props.label)}
      onPress={props.onPress}
      {...hoverProps}
      testID={`sidebar-group-tab-${props.icon}`}
      style={({ pressed }) => {
        return {
          // Share the row equally, regardless of label length or selection.
          flexBasis: 0,
          flexGrow: 1,
          flexShrink: 1,
          minWidth: iconWidth,
          height: taskControlHeight(props.touch ? 36 : 28, scale),
          borderRadius: 999,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: props.on ? tokens.surface2 : tokens.card.pillBorder,
          backgroundColor: props.on ? tokens.surface2 : hovered || pressed ? tokens.card.controlHover : "transparent",
          flexDirection: "row" as const,
          alignItems: "center" as const,
          justifyContent: "center" as const,
          gap: 4,
          paddingHorizontal: 6,
        };
      }}
    >
      <Icon name={props.icon} size={props.showLabel ? 14 : 18} color={props.on ? tokens.foreground : tokens.foregroundMuted} />
      {props.showLabel ? <Text testID="sidebar-group-tab-label" numberOfLines={1} style={[labelStyle, { flexShrink: 0 }]}>
        {props.label}
      </Text> : null}
      <View
        pointerEvents="none"
        aria-hidden
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ position: "absolute", left: 0, top: 0, opacity: 0, flexDirection: "row" }}
      >
        <Text
          key={labelKey}
          testID="sidebar-group-tab-measure"
          style={[labelStyle, { flexShrink: 0 }]}
          onLayout={(event) => {
            const measured = Math.ceil(event.nativeEvent.layout.width);
            setLabelSize((previous) => previous?.key === labelKey && previous.width === measured ? previous : { key: labelKey, width: measured });
          }}
        >{props.label}</Text>
      </View>
    </Pressable>
  );
}

function GroupRowView(props: { row: GroupRow; tokens: TaskTokens; touch: boolean }) {
  const { row, tokens } = props;
  const scale = useTasksFontScale();
  const { hovered, hoverProps } = useHover();
  // The tag hole follows the row background on hover.
  const fill = row.on ? tokens.surface2 : hovered ? tokens.card.controlHover : tokens.card.background;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: row.on }}
      accessibilityLabel={`${row.label}${row.detail ? ` ${row.detail}` : ""} ${row.count}`}
      {...tipProps(`${row.label}${row.detail ? ` · ${row.detail}` : ""}`)}
      onPress={row.toggle}
      {...hoverProps}
      style={({ pressed }) => {
        return {
          height: taskControlHeight(row.detail ? (props.touch ? 56 : 48) : (props.touch ? 44 : 36), scale),
          marginVertical: 2,
          // The scrollbar's gutter takes the right margin (`detail-scrollbar.ts`); off web the gutter is 0 and the margin stays 6.
          marginLeft: 6,
          marginRight: 6 - detailGutter("inset"),
          paddingHorizontal: 8,
          borderRadius: 6,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          backgroundColor: row.on ? tokens.surface2 : hovered || pressed ? tokens.card.controlHover : "transparent",
        };
      }}
    >
      <View style={{ width: 20, alignItems: "center" }}>{typeof row.lead === "function" ? row.lead(fill) : row.lead}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: F.base, lineHeight: HOST_LINE.base, color: tokens.foreground }}>{row.label}</Text>
        {row.detail ? <Text numberOfLines={1} style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: tokens.foregroundMuted }}>{row.detail}</Text> : null}
      </View>
      {row.on ? <Icon name="Check" size={14} color={tokens.foreground} /> : null}
      <Text style={{ fontSize: F.sm, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{row.count}</Text>
    </Pressable>
  );
}

/** Whether a card is still somewhere the sidebar can show it. */
export function sidebarCard(board: BoardController, id: string | null): TaskCard | undefined {
  return id ? board.cardById(id) : undefined;
}
