import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { tipProps } from "../cards/card-hints";
import { TaskText as Text, HOST_FONT as F, HOST_LINE, useTasksFontScale, taskControlHeight } from "../typography";
import { useHover } from "../../ui/use-hover";
import { BrandMark, DETAIL_CARD, DetailCard, detailGutter, detailScrollProps, ProjectIcon, StatusIcon, TagMark, TaskDetailCards, taskTokens, tildePath, type DetailNotice, type TaskTokens } from "../cards";
import { LANE_STATUS, turnRunning, type LaneId, type TaskCard } from "../model";
import { activeStopChildren } from "../actions/stop-targets";
import { useFirstPrompt } from "../data/first-prompt";
import { lastHumanMessageVersion, useLastHumanMessage } from "../data/last-human-message";
import { lastMessageVersion, useLastMessage, useLiveReplyCount } from "../data/last-message";
import { useSessionTokens } from "../data/session-tokens";
import { useSubagentTimeline } from "../data/subagent-timeline";
import { FILTER_ICONS, buildFilterOptions, clearedParams, filterSummary, shownFilterOptions, toggleProject, type FilterOption } from "./filter-options";
import { RollingCount, RollingTotal } from "./board-parts";
import { useRequestProjectIcons } from "./project-icons";
import { toggleItem } from "./params";
import { matchesSearch, searchWords } from "./search";
import type { SelectionAction, SidebarSelection } from "./sidebar-model";
import { findCard, type BoardController } from "./use-board";

type GroupKind = "agent" | "project" | "workspace" | "label";
const GROUP_KINDS: readonly GroupKind[] = ["agent", "project", "workspace", "label"];

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
  testID?: string;
}

/**
 * The sidebar's column (`docs/prototypes/task-details-sidebar.md`): the
 * status counts always on top; under them the board's groups while no card
 * is chosen, or the chosen card's details as one card, its header pinned and
 * the sections under it scrolling.
 */
export const DetailsSidebar = memo(DetailsSidebarView);

function DetailsSidebarView(props: DetailsSidebarProps) {
  const { board, theme, selection, dispatch } = props;
  const tokens = taskTokens(theme);
  // Pixel-by-pixel resizes only change the browser's layout, not this subtree.
  const [layout, setLayout] = useState({ short: false, wide: false });
  const card = selection.id ? board.cardById(selection.id) : undefined;
  useParentTitle(board, card);
  const shown = card && selection.id ? findCard(board.lanes, selection.id) !== null : false;
  const strings = board.strings.sidebar;

  let notice: DetailNotice | null = null;
  if (card && !shown) {
    notice = { icon: "EyeOff", text: strings.hidden, action: { label: board.strings.clearFilters, onPress: () => board.setParams(clearedParams) } };
  }
  const backId = selection.back[selection.back.length - 1];
  const backCard = backId ? board.cardById(backId) : undefined;

  const jump = (agentId: string) => {
    dispatch({ type: "jump", id: agentId });
    props.onReveal(agentId);
  };
  const { firstPrompt, humanMessage, lastMessage, sessionTokens } = useDetailReads(board, card);
  const stopAvailable = !!board.callbacks.onStop && !!card && (card.stoppable || activeStopChildren(card).length > 0);
  const detailProps = card
    ? {
        card,
        theme,
        language: board.language,
        strings,
        touch: props.touch,
        clock: board.clock,
        onClose: () => dispatch({ type: "clear" }),
        back: backId ? { title: backCard?.title ?? board.strings.back, onPress: () => dispatch({ type: "back" }) } : null,
        notice,
        onOpen: board.callbacks.onOpen,
        stop: stopAvailable ? { phase: board.stop.phase(card.id), onPress: () => board.callbacks.onStop?.(card, { withChildren: !card.stoppable }) } : null,
        permissionButtons: board.buttonsFor(card),
        onPermission: (button: Parameters<NonNullable<typeof board.callbacks.onPermission>>[1]) => board.callbacks.onPermission?.(card, button),
        onJump: jump,
        firstPrompt,
        sessionTokens,
        humanMessage,
        lastMessage,
        unarchive: board.unarchive.available ? board.unarchive : null,
        archive: board.archive,
        markRead: board.read.available ? board.read : null,
      }
    : null;

  // A short column (an iPad in landscape, a low window) has no room to hold
  // the header still: the fixed part left the sections a strip of 80. There
  // the whole column scrolls as one.
  // A wide sheet lays a card out in two columns that scroll on their own, so the header stays in view.
  const columns = props.scrollAll === true && detailProps !== null && layout.wide;
  const short = !columns && (props.scrollAll === true || layout.short);
  const content = (
    <>
      {props.stats === false ? null : <StatsCard board={board} theme={theme} tokens={tokens} onLane={props.onLane} touch={props.touch} />}
      {detailProps ? (
        <TaskDetailCards {...detailProps} scrollBody={!short && !columns} columns={columns} />
      ) : (
        <GroupCard board={board} theme={theme} tokens={tokens} touch={props.touch} />
      )}
    </>
  );
  const onLayout = (event: { nativeEvent: { layout: { width: number; height: number } } }) => {
    const height = Math.round(event.nativeEvent.layout.height);
    const short = height > 0 && height < SHORT_COLUMN;
    const wide = Math.round(event.nativeEvent.layout.width) >= SHEET_COLUMNS;
    setLayout((was) => was.short === short && was.wide === wide ? was : { short, wide });
  };
  if (short) {
    return (
      <View style={{ flex: 1, minHeight: 0 }} onLayout={onLayout} testID={props.testID ?? "details-sidebar"}>
        {/* Keyed by the card: a jump to the parent or back starts at the top. */}
        <ScrollView key={selection.id ?? ""} style={{ flex: 1 }} contentContainerStyle={{ gap: DETAIL_CARD.gap }} {...detailScrollProps("column")} testID="details-sidebar-scroll">
          {content}
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, minHeight: 0, gap: DETAIL_CARD.gap }} onLayout={onLayout} testID={props.testID ?? "details-sidebar"}>
      {content}
    </View>
  );
}

/**
 * What the details read from a task's timeline: its first prompt, the last
 * message a person sent, its latest reply and running session's tokens. A
 * provider subagent's come from the plugin server, which reads its timeline
 * off the daemon; it has no session of its own to count, and no person
 * writes to it (its prompts are the parent's).
 */
export function useDetailReads(board: BoardController, card: TaskCard | undefined) {
  const subagent = card?.subagent ? card : undefined;
  const agent = card && !card.subagent ? card : undefined;
  const firstPrompt = useFirstPrompt(board.paseo, agent?.id ?? "", agent !== undefined && agent.closed !== true);
  const humanMessage = useLastHumanMessage(board.paseo, agent?.id ?? "", agent ? lastHumanMessageVersion(agent) : "", agent !== undefined && agent.closed !== true);
  // While the board shows a running turn, its reply chunks read the latest reply again.
  const live = useLiveReplyCount(board.paseo, agent?.id ?? "", board.visible && agent !== undefined && turnRunning(agent) && agent.closed !== true);
  const lastMessage = useLastMessage(board.paseo, agent?.id ?? "", agent ? `${lastMessageVersion(agent)}|${live}` : "", agent !== undefined && agent.closed !== true);
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
  return subagent ? { ...subagentReads, humanMessage: null, sessionTokens: null } : { firstPrompt, humanMessage, lastMessage, sessionTokens };
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
function StatsCard(props: { board: BoardController; theme: PluginTheme; tokens: TaskTokens; onLane(lane: LaneId): void; touch: boolean }) {
  const { board, tokens } = props;
  const showEmpty = board.showEmptyGroups;
  const options = useMemo(() => shownFilterOptions(buildFilterOptions(board.tasks, board.params), showEmpty), [board.tasks, board.params, showEmpty]);
  const summary = filterSummary(board.params, board.defaults, options, board.strings);
  return (
    <DetailCard tokens={tokens} style={{ paddingHorizontal: 8, paddingTop: 8, paddingBottom: 8, gap: 6 }} testID="sidebar-stats">
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
      <View style={{ flexDirection: "row", gap: 4 }}>
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
            onPress={() => props.onLane(id)}
          />
        ))}
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
  onPress(): void;
}) {
  const { tokens } = props;
  const scale = useTasksFontScale();
  const [headingWidth, setHeadingWidth] = useState<number | null>(null);
  const [labelSize, setLabelSize] = useState<{ key: string; width: number } | null>(null);
  const labelKey = `${props.label}|${scale}`;
  const hideLabel = headingWidth !== null && labelSize?.key === labelKey && labelSize.width + 13 + 5 > headingWidth + 0.5;
  const { hovered, hoverProps } = useHover();
  const alert = props.lane === "needs_input" && (props.count ?? 0) > 0;
  const countStyle = { fontSize: F.xl, lineHeight: HOST_LINE.xl, fontWeight: "600" as const, color: alert ? tokens.warning : tokens.foreground, fontVariant: ["tabular-nums" as const] };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label} ${props.count ?? ""}`}
      {...tipProps(props.label)}
      onPress={props.onPress}
      {...hoverProps}
      testID={`sidebar-stat-${props.lane}`}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        minHeight: taskControlHeight(props.touch ? 64 : 56, scale),
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: alert ? tokens.warning : "transparent",
        backgroundColor: hovered || pressed ? tokens.card.controlHover : "transparent",
        gap: 2,
      })}
    >
      <View
        testID={`sidebar-stat-heading-${props.lane}`}
        onLayout={(event) => setHeadingWidth(event.nativeEvent.layout.width)}
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
        <RollingCount value={props.count} scope={props.scope} style={countStyle} />
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
 * With no card chosen: Agent, Project, Workspace and Label counts (active
 * cards), a row a filter; those at 0 too while `board.showEmptyGroups` is on.
 */
function GroupCard(props: { board: BoardController; theme: PluginTheme; tokens: TaskTokens; touch: boolean }) {
  const { board, tokens } = props;
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
  const showEmpty = board.showEmptyGroups;
  const options = useMemo(() => shownFilterOptions(buildFilterOptions(board.tasks, board.params), showEmpty), [board.tasks, board.params, showEmpty]);
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
      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 10, paddingBottom: 10 }}>
        {GROUP_KINDS.map((id) => (
          <Segment key={id} id={id} icon={FILTER_ICONS[id]} label={strings.groups[id]} showLabel={showLabels} onFit={reportFit} on={kind === id} tokens={tokens} touch={props.touch} onPress={() => setKind(id)} />
        ))}
      </View>
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

/** Linear's segmented pills: outlined, grey when chosen. */
function Segment(props: { id: GroupKind; icon: string; label: string; showLabel: boolean; onFit(id: GroupKind, key: string, fits: boolean): void; on: boolean; tokens: TaskTokens; touch: boolean; onPress(): void }) {
  const { tokens } = props;
  const scale = useTasksFontScale();
  const [width, setWidth] = useState<number | null>(null);
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
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{
        // Share the row equally, regardless of label length or selection.
        flexBasis: 0,
        flexGrow: 1,
        flexShrink: 1,
        minWidth: iconWidth,
        height: taskControlHeight(props.touch ? 36 : 28, scale),
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: props.on ? tokens.surface2 : tokens.card.pillBorder,
        backgroundColor: props.on ? tokens.surface2 : hovered ? tokens.card.controlHover : "transparent",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        paddingHorizontal: 6,
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
  // The rows sit on the group card; a row's own fill shows when it is on or hovered.
  const fill = row.on ? tokens.surface2 : hovered ? tokens.card.controlHover : tokens.card.background;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: row.on }}
      accessibilityLabel={`${row.label}${row.detail ? ` ${row.detail}` : ""} ${row.count}`}
      {...tipProps(`${row.label}${row.detail ? ` · ${row.detail}` : ""}`)}
      onPress={row.toggle}
      {...hoverProps}
      style={({ pressed }) => ({
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
      })}
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
