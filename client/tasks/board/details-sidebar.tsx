import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { TaskText as Text, HOST_FONT as F, HOST_LINE, useTasksFontScale, taskControlHeight } from "../typography";
import { useHover } from "../../ui/use-hover";
import { BrandMark, DETAIL_CARD, DetailCard, detailScrollProps, ProjectIcon, StatusIcon, TaskDetailCards, taskTokens, type DetailNotice, type TaskTokens } from "../cards";
import { LANE_STATUS, turnRunning, type LaneId, type TaskCard } from "../model";
import { useFirstPrompt } from "../data/first-prompt";
import { lastMessageVersion, useLastMessage } from "../data/last-message";
import { useSessionTokens } from "../data/session-tokens";
import { FILTER_ICONS, activeChips, buildFilterOptions, clearedParams, shownFilterOptions, toggleProject, type FilterOption } from "./filter-options";
import { RollingCount, RollingTotal } from "./board-parts";
import { toggleItem } from "./params";
import type { SelectionAction, SidebarSelection } from "./sidebar-model";
import { findCard, type BoardController } from "./use-board";

type GroupKind = "agent" | "project" | "workspace" | "label";

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
export function DetailsSidebar(props: DetailsSidebarProps) {
  const { board, theme, selection, dispatch } = props;
  const tokens = taskTokens(theme);
  const [height, setHeight] = useState(0);
  const [width, setWidth] = useState(0);
  const card = selection.id ? board.tasks.byId.get(selection.id) : undefined;
  useParentTitle(board, card);
  const shown = card && selection.id ? findCard(board.lanes, selection.id) !== null : false;
  const strings = board.strings.sidebar;

  let notice: DetailNotice | null = null;
  if (card && !shown) {
    notice = { icon: "EyeOff", text: strings.hidden, action: { label: board.strings.clearFilters, onPress: () => board.setParams(clearedParams) } };
  }
  const backId = selection.back[selection.back.length - 1];
  const backCard = backId ? board.tasks.byId.get(backId) : undefined;

  const jump = (agentId: string) => {
    dispatch({ type: "jump", id: agentId });
    props.onReveal(agentId);
  };
  const firstPrompt = useFirstPrompt(board.paseo, card?.id ?? "", card !== undefined && card.closed !== true);
  const lastMessage = useLastMessage(board.paseo, card?.id ?? "", card ? lastMessageVersion(card) : "", card !== undefined && card.closed !== true);
  const sessionTokens = useSessionTokens(card?.id ?? "", card !== undefined && turnRunning(card) && card.closed !== true);
  const stopAvailable = !!board.callbacks.onStop && card?.stoppable === true;
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
        stop: stopAvailable ? { phase: board.stop.phase(card.id), onPress: () => board.callbacks.onStop?.(card) } : null,
        permissionButtons: board.buttonsFor(card),
        onPermission: (button: Parameters<NonNullable<typeof board.callbacks.onPermission>>[1]) => board.callbacks.onPermission?.(card, button),
        onJump: jump,
        firstPrompt,
        sessionTokens,
        lastMessage,
        unarchive: board.unarchive.available ? board.unarchive : null,
      }
    : null;

  // A short column (an iPad in landscape, a low window) has no room to hold
  // the header still: the fixed part left the sections a strip of 80. There
  // the whole column scrolls as one.
  // A wide sheet lays a card out in two columns that scroll on their own, so the header stays in view.
  const columns = props.scrollAll === true && detailProps !== null && width >= SHEET_COLUMNS;
  const short = !columns && (props.scrollAll === true || (height > 0 && height < SHORT_COLUMN));
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
    const next = Math.round(event.nativeEvent.layout.height);
    const across = Math.round(event.nativeEvent.layout.width);
    setHeight((was) => (was === next ? was : next));
    setWidth((was) => (was === across ? was : across));
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
  const chips = activeChips(board.params, board.defaults, options, board.strings).filter((chip) => chip.key !== "win");
  const summary = chips.map((chip) => (chip.kind ? `${chip.kind}: ${chip.value}` : chip.value)).join(" · ");
  return (
    <DetailCard tokens={tokens} style={{ paddingHorizontal: 8, paddingTop: 8, paddingBottom: 8, gap: 6 }} testID="sidebar-stats">
      <View style={{ paddingHorizontal: 4, gap: 2 }}>
        <RollingTotal board={board} style={{ fontSize: F.base, fontWeight: "600", color: tokens.foreground, fontVariant: ["tabular-nums"] }} />
        {summary ? (
          <Text numberOfLines={1} style={{ fontSize: F.sm, color: tokens.foregroundMuted }}>
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
            scope={board.countScope}
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
  const { hovered, hoverProps } = useHover();
  const alert = props.lane === "needs_input" && (props.count ?? 0) > 0;
  const countStyle = { fontSize: F.xl, lineHeight: HOST_LINE.xl, fontWeight: "600" as const, color: alert ? tokens.warning : tokens.foreground, fontVariant: ["tabular-nums" as const] };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label} ${props.count ?? ""}`}
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
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <StatusIcon kind={LANE_STATUS[props.lane]} size={13} theme={props.theme} animated={props.animated} />
        <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: F.sm, color: tokens.foregroundMuted }}>
          {props.label}
        </Text>
      </View>
      {props.count === null ? (
        <Text style={countStyle}>–</Text>
      ) : (
        <RollingCount value={props.count} scope={props.scope} style={countStyle} />
      )}
    </Pressable>
  );
}

interface GroupRow {
  id: string;
  label: string;
  count: number;
  on: boolean;
  lead: React.ReactNode;
  /** Muted after the label: a workspace's project. */
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
  const [kind, setKind] = useState<GroupKind>("agent");
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
          lead: <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: option.color ?? tokens.foregroundMuted }} />,
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
            detail: group.projectId && group.projectName !== item.label ? group.projectName : undefined,
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
        toggle: () => board.setParams((params) => toggleProject(params, project)),
      }))
      .sort(byCount);
  }, [kind, options, board, tokens]);
  // The rows' projects may have no card on screen to fetch their icon; the data layer dedupes the fetch.
  const iconsFor = [...new Set(rows.flatMap((row) => (row.iconFor ? [row.iconFor] : [])))].join("\n");
  const { requestProjectIcon } = board.tasks;
  useEffect(() => {
    if (iconsFor) for (const projectId of iconsFor.split("\n")) requestProjectIcon(projectId);
  }, [iconsFor, requestProjectIcon]);

  return (
    <DetailCard tokens={tokens} style={{ flexShrink: 1, minHeight: 0, paddingTop: 10, paddingBottom: 6 }} testID="sidebar-groups">
      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 10, paddingBottom: 6 }}>
        {(["agent", "project", "workspace", "label"] as const).map((id) => (
          <Segment key={id} icon={FILTER_ICONS[id]} label={strings.groups[id]} on={kind === id} tokens={tokens} touch={props.touch} onPress={() => setKind(id)} />
        ))}
      </View>
      <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
        {rows.length === 0 ? (
          <Text style={{ paddingHorizontal: DETAIL_CARD.padH, paddingVertical: 12, fontSize: F.sm, color: tokens.foregroundMuted }}>{strings.noGroups}</Text>
        ) : (
          rows.map((row) => <GroupRowView key={row.id} row={row} tokens={tokens} touch={props.touch} />)
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
function Segment(props: { icon: string; label: string; on: boolean; tokens: TaskTokens; touch: boolean; onPress(): void }) {
  const { tokens } = props;
  const scale = useTasksFontScale();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: props.on }}
      accessibilityLabel={props.label}
      onPress={props.onPress}
      {...hoverProps}
      style={{
        // Grown from each label's width, not split evenly: "Workspace" needs more room than "Agent" beside its icon.
        flexGrow: 1,
        flexShrink: 1,
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
      <Icon name={props.icon} size={14} color={props.on ? tokens.foreground : tokens.foregroundMuted} />
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: F.base, fontWeight: props.on ? "600" : "400", color: props.on ? tokens.foreground : tokens.foregroundMuted }}>
        {props.label}
      </Text>
    </Pressable>
  );
}

function GroupRowView(props: { row: GroupRow; tokens: TaskTokens; touch: boolean }) {
  const { row, tokens } = props;
  const scale = useTasksFontScale();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: row.on }}
      accessibilityLabel={`${row.label}${row.detail ? ` ${row.detail}` : ""} ${row.count}`}
      onPress={row.toggle}
      {...hoverProps}
      style={({ pressed }) => ({
        height: taskControlHeight(props.touch ? 44 : 36, scale),
        marginHorizontal: 6,
        paddingHorizontal: 8,
        borderRadius: 6,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: row.on ? tokens.surface2 : hovered || pressed ? tokens.card.controlHover : "transparent",
      })}
    >
      <View style={{ width: 20, alignItems: "center" }}>{row.lead}</View>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: F.base, color: tokens.foreground }}>
        {row.label}
        {row.detail ? <Text style={{ fontSize: 12, color: tokens.foregroundMuted }}>{`  ${row.detail}`}</Text> : null}
      </Text>
      {row.on ? <Icon name="Check" size={14} color={tokens.foreground} /> : null}
      <Text style={{ fontSize: F.sm, color: tokens.foregroundMuted, fontVariant: ["tabular-nums"] }}>{row.count}</Text>
    </Pressable>
  );
}

/** Whether a card is still somewhere the sidebar can show it. */
export function sidebarCard(board: BoardController, id: string | null): TaskCard | undefined {
  return id ? board.tasks.byId.get(id) : undefined;
}
