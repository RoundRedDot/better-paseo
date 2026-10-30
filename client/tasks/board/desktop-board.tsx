import React, { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type RefObject } from "react";
import { Animated, PanResponder, Platform, Pressable, ScrollView, View, type GestureResponderEvent, type FlatList as NativeFlatList, type TextInput as NativeTextInput } from "react-native";
import { FlatList, Icon, Modal } from "@getpaseo/plugin/client/react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { TaskText as Text, HOST_FONT as F, HOST_LINE, laneTitle, TasksTypography, TasksTypographyScale, useTasksFontScale, taskControlHeight } from "../typography";
import { StatusIcon, taskTokens, type CardCallbacks } from "../cards";
import { LANE_ORDER, LANE_STATUS, isHistoryLane, type LaneId, type LaneModel, type TaskCard } from "../model";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { useHover } from "../../ui/use-hover";
import { HAIRLINE, MOTION, PANEL_RADIUS, boardPalette } from "./board-style";
import { BoardEmptyState } from "./empty-state";
import { LANE_EMPTY_ICON } from "./strings";
import { LANE_SCROLLBAR_WIDTH, laneScrollProps, useLaneScrollbar } from "./lane-scrollbar";
import { followPointer, resizeHandleProps, resizeIndicatorProps, resizeTrackProps, setResizing, useResizeLine } from "./resize-line";
import { CardCell, HoverPressable, LaneFilterHint, LoadMoreRow, RollingCount, SkeletonCard, VerticalLabel, useBreathing, useFreshIds, useTap } from "./board-parts";
import { useFlash } from "./breathing";
import { DesktopFilterBar, DesktopToolbar, KEY_HINTS_MIN_WIDTH, type EmptyLanes, type FilterMenu } from "./filter-bar";
import { TabletToolbar } from "./tablet-toolbar";
import { buildFilterOptions } from "./filter-options";
import { SWITCH_MS } from "../../ui/switch-track";
import { LANES, boardKeyReducer, clampFocus, boardLaneLayout, type BoardFocus, type LaneShape } from "./navigation";
import { menuChrome } from "./menu-model";
import { DetailsSidebar } from "./details-sidebar";
import { BoardTips } from "../cards/card-hints";
import { LaneMotionLayer, LaneMotionProvider, scrollNode, useLaneCovered, useLaneMotion, useLaneTarget } from "./lane-motion";
import { LaneSwap, useLaneSlide, useLaneWidth } from "./lane-resize";
import {
  NO_SELECTION,
  SIDEBAR,
  TABLET_SIDEBAR,
  tabletSidebarWidth,
  clampWidth,
  escapeStep,
  readSidebarPreference,
  selectionReducer,
  sheetHeight,
  sidebarMode,
  sidebarWidth,
  writeSidebarPreference,
  type SheetDetent,
  type SidebarMode,
  type SidebarPreference,
} from "./sidebar-model";
import { BoardSheet } from "./board-sheet";
import { activeFilterCount, rememberCollapsed, rememberedCollapsed } from "./params";
import { FilterSheetBody } from "./filter-sheet";
import { sortsLoadedOnly } from "./sort";
import { findCard, type BoardController, type BoardLayoutHandlers } from "./use-board";
import { focusedTaskCardId, focusTaskBoard } from "../../web";
import { tasksSettingsOpener } from "./enabled";

const nativeDriver = Platform.OS !== "web";

/** The filter sheet's body inside the host's sheet, as the phone's: the body pads itself and bounds its own scroll. */
const FILTER_SHEET_BODY = { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 16, gap: 0, flex: 1, minHeight: 0 } as const;

const Separator = () => <View style={{ height: 12 }} />;

/**
 * 8 around the cards leaves room for the focus ring inside the list's clip.
 * On web the lane's scrollbar takes its own gutter at the right edge, as
 * Linear's does, so the cards keep only 4 to it.
 */
const LANE_PAD = Platform.OS === "web" ? { paddingLeft: 8, paddingRight: 4 } : { paddingHorizontal: 8 };
const SKELETON_PAD = Platform.OS === "web" ? { paddingLeft: 8, paddingRight: 4 + LANE_SCROLLBAR_WIDTH } : { paddingHorizontal: 8 };

/** True while the keyboard types into a text field. */
function isTyping(active: HTMLElement | null): boolean {
  return !!active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
}

/** The band an overlay scrollbar (macOS's, the board row's thin one) covers at a scroller's edge. */
const OVERLAY_SCROLLBAR = 16;

/**
 * True when a web press lands on the scrollbar of the element it targets, on
 * a side it scrolls: past its client box for a classic scrollbar (the
 * lanes'), within the edge band for an overlay one, which takes no room.
 */
/**
 * On web, a press on the board takes the keyboard for it, as a click in
 * Linear's board does: the host's own buttons (its sidebar switch, its
 * shortcuts) keep focus otherwise, and the board's keys (Esc, J/K) would go
 * nowhere. A press in a text field keeps that field's focus.
 */
function claimKeys(rootRef: RefObject<View | null>, clearFocus: () => void, activeId?: string): object {
  if (Platform.OS !== "web") return {};
  return {
    tabIndex: -1,
    role: "group",
    "aria-activedescendant": activeId,
    // Tab or a pointer can hand focus to a card, a child action or another surface.
    // That DOM focus replaces the board's virtual focus, rather than drawing both.
    onFocus: (event: { target: unknown }) => {
      if (event.target !== rootRef.current) clearFocus();
    },
    onBlur: clearFocus,
    onPointerDown: (event: { target?: unknown }) => {
      if (typeof document === "undefined") return;
      const root = rootRef.current as unknown as HTMLElement | null;
      const target = event.target as HTMLElement | null;
      if (!root || isTyping(target)) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && root.contains(active)) return;
      focusTaskBoard(root);
    },
  };
}

function onScrollbar(target: unknown, pageX: number, pageY: number): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined" || !(target instanceof HTMLElement)) return false;
  const box = target.getBoundingClientRect();
  const x = pageX - window.scrollX - box.left - target.clientLeft;
  const y = pageY - window.scrollY - box.top - target.clientTop;
  const overlayX = target.offsetWidth - target.clientLeft * 2 <= target.clientWidth ? OVERLAY_SCROLLBAR : 0;
  const overlayY = target.offsetHeight - target.clientTop * 2 <= target.clientHeight ? OVERLAY_SCROLLBAR : 0;
  return (
    (target.scrollHeight > target.clientHeight && x >= target.clientWidth - overlayX) ||
    (target.scrollWidth > target.clientWidth && y >= target.clientHeight - overlayY)
  );
}

/** The desktop board (prototype 01): the bars, then four lanes (five with archived) that scroll sideways when they do not fit, and the details sidebar. */
export function DesktopBoard(props: {
  screen: PluginScreenProps;
  board: BoardController;
  rootRef: RefObject<View | null>;
  handlers: RefObject<BoardLayoutHandlers | null>;
}) {
  const { screen, rootRef } = props;
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The controls (toolbar, filter bar, filter panel) follow the board at once.
  // While the filter panel is open, the lanes, their motion and the sidebar
  // behind it take a change once its switch has slid: a switch that adds or
  // hides cards in every lane (the subtasks switch) held the knob for as long
  // as the new cards took to mount, or stalled it half way.
  const live = props.board;
  // Web: the bars show a switch's new state in the frame it is pressed; the
  // lanes and the sidebar take it in a render React can pause (`DEFER_LANES`).
  const board = useDeferredWithin(useLaggedWhile(live, filtersOpen, FILTER_PANEL_LAG_MS), DEFER_LANES, DEFER_LANES_MAX_MS);
  const scale = useTasksFontScale();
  const theme = screen.theme;
  const colors = theme.colors;
  const hostId = screen.host.id;
  const { lanes, tasks, strings, laneOrder } = board;
  useLaneScrollbar(theme);
  useResizeLine(theme);

  const [collapsedState, setCollapsedState] = useState<LaneId[]>(() => rememberedCollapsed(hostId));
  // A folded archived lane stays remembered while the lane is off, but takes no room.
  const collapsed = useMemo(() => collapsedState.filter((id) => laneOrder.includes(id)), [collapsedState, laneOrder]);
  const setCollapsed = useCallback(
    (update: (lanes: LaneId[]) => LaneId[]) =>
      setCollapsedState((current) => {
        const next = update(current);
        rememberCollapsed(hostId, next);
        return next;
      }),
    [hostId],
  );
  const shapes = useMemo<LaneShape[]>(
    () => laneOrder.map((id) => ({ id, count: lanes[id].cards.length, collapsed: collapsed.includes(id) })),
    [lanes, collapsed, laneOrder],
  );
  const [focusState, setFocus] = useState<BoardFocus | null>(null);
  // Use displayed counts; loading history lanes are not known to be empty yet.
  const emptyLanes = laneOrder.filter((id) => tasks.ready && !lanes[id].loading && lanes[id].cards.length === 0);
  const emptyLanesCollapsed = emptyLanes.length > 0 && emptyLanes.every((id) => collapsed.includes(id));
  const emptyKey = emptyLanes.join();
  const toggleEmptyLanes = useCallback(() => {
    const empty = emptyKey ? (emptyKey.split(",") as LaneId[]) : [];
    if (empty.length === 0) return;
    setCollapsed((current) => empty.every((id) => current.includes(id))
      ? current.filter((id) => !empty.includes(id))
      : [...current, ...empty.filter((id) => !current.includes(id))]);
  }, [emptyKey, setCollapsed]);
  // Stable while nothing in it changes, so the memoized bars skip the board's own renders.
  const emptyLanesSwitch = useMemo<EmptyLanes>(
    () => ({ collapsed: emptyLanesCollapsed, disabled: emptyKey === "", onToggle: toggleEmptyLanes }),
    [emptyLanesCollapsed, emptyKey, toggleEmptyLanes],
  );
  const focus = clampFocus(focusState, shapes);
  const [menu, setMenu] = useState<FilterMenu | null>(null);

  const listRefs = useRef<Partial<Record<LaneId, NativeFlatList<TaskCard> | null>>>({});
  // One stable ref callback per lane, so a lane's list is not re-attached on every render.
  const publishList = useMemo(() => {
    const out = {} as Record<LaneId, (list: NativeFlatList<TaskCard> | null) => void>;
    // forEach, not for-of: Hermes shares one `id` across the closures of a for-of loop, so every lane's list landed under "done".
    LANE_ORDER.forEach((id) => {
      out[id] = (list) => {
        listRefs.current[id] = list;
      };
    });
    return out;
  }, []);
  // One stable fold switch per lane too, so a memoized lane is not drawn again for a new closure.
  const toggleLane = useMemo(() => {
    const out = {} as Record<LaneId, () => void>;
    LANE_ORDER.forEach((id) => {
      out[id] = () => setCollapsed((current) => (current.includes(id) ? current.filter((lane) => lane !== id) : [...current, id]));
    });
    return out;
  }, [setCollapsed]);
  const searchRef = useRef<NativeTextInput>(null);
  const rowRef = useRef<ScrollView | null>(null);

  // The sidebar: open and width as the user left them, inline on a wide
  // board. A narrow board has no room to keep it beside the lanes, so it
  // floats over their right side only on demand: a card clicked or tapped,
  // or the switch. A click or tap outside, Esc or the switch puts it away;
  // the remembered open state stays the wide board's. On a touch screen a
  // tap on a card also shows a closed sidebar for the moment, as a floating
  // panel.
  const touch = Platform.OS !== "web";
  const [preference, setPreferenceState] = useState<SidebarPreference>(readSidebarPreference);
  const setPreference = useCallback((update: (current: SidebarPreference) => SidebarPreference) => {
    setPreferenceState((current) => {
      const next = update(current);
      writeSidebarPreference(next);
      return next;
    });
  }, []);
  // The inline sidebar's width while its edge is dragged; the release keeps it as the preference.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [floatingDragWidth, setFloatingDragWidth] = useState<number | null>(null);
  // Why a floating panel is up for the moment: a card's click or tap (it goes with its card) or the switch.
  const [shown, setShown] = useState<"card" | "switch" | null>(null);
  const [selection, dispatch] = useReducer(selectionReducer, NO_SELECTION);
  const [boardWidth, setBoardWidth] = useState(0);
  const [boardHeight, setBoardHeight] = useState(0);
  const [detent, setDetent] = useState<SheetDetent>("half");
  const modeRef = useRef<SidebarMode | null>(null);
  const mode = boardWidth > 0 ? sidebarMode(boardWidth, modeRef.current) : modeRef.current ?? "inline";
  modeRef.current = boardWidth > 0 ? mode : modeRef.current;
  const narrow = mode !== "inline";
  const open = shown !== null || (!narrow && preference.open);
  const floating = open && (narrow || !preference.open);
  const inline = open && !floating;
  // Too narrow to float beside the lanes: the details rise from the bottom instead, and the lanes make room under them.
  const inSheet = floating && mode === "sheet";
  const ipadFloating = Platform.OS === "ios" && floating && !inSheet;
  useEffect(() => {
    if (!ipadFloating) setFloatingDragWidth(null);
  }, [ipadFloating]);
  const sheetRoom = inSheet ? sheetHeight(boardHeight, detent) : 0;
  const panelWidth = ipadFloating
    ? tabletSidebarWidth(boardWidth, floatingDragWidth ?? preference.floatingWidth)
    : sidebarWidth(boardWidth, dragWidth ?? preference.width, floating ? "floating" : "inline");
  const lanesWidth = Math.max(0, boardWidth - (inline ? panelWidth + SIDEBAR.gap : 0));
  const laneWidth = boardLaneLayout(boardWidth, laneOrder, collapsed, board.laneWidth).laneWidth;
  // What the user sized the lanes with: a change to it eases the lanes to their new widths.
  const sizing = `${collapsedState.filter((id) => id !== "archived").join()}|${board.laneWidth}`;
  const archivedSwitch = useArchivedSwitch(laneOrder, lanes.archived, laneWidth, board.visible);
  // An outgoing lane still occupies its slot until the complete panel has slid out.
  const layout = boardLaneLayout(boardWidth, archivedSwitch.drawn, collapsedState, board.laneWidth, lanesWidth);
  // A floating panel covers the lanes' right side: the row scrolls far enough for the last lane to come out from under it.
  const coverRoom = floating && !inSheet ? panelWidth + (ipadFloating ? 0 : SIDEBAR.gap) : 0;

  const toggleSidebar = useCallback(() => {
    if (shown) setShown(null);
    else if (narrow) setShown("switch");
    else setPreference((current) => ({ ...current, open: !current.open }));
  }, [shown, narrow, setPreference]);
  // A panel shown for the moment does not outlive the width it was shown at.
  useEffect(() => setShown(null), [mode]);
  // A sheet opens at half height again after it closed.
  useEffect(() => {
    if (!inSheet) setDetent("half");
  }, [inSheet]);

  const scrollTo = useCallback((lane: LaneId, index: number, viewPosition = 0.3) => {
    const list = listRefs.current[lane];
    try {
      list?.scrollToIndex({ index, viewPosition, animated: true });
    } catch {
      // Not laid out yet; `onScrollToIndexFailed` retries.
    }
  }, []);
  const focusLane = focus?.lane ?? null;
  const focusIndex = focus?.index ?? -1;
  useEffect(() => {
    if (focusLane) scrollTo(focusLane, focusIndex);
  }, [focusLane, focusIndex, scrollTo]);

  // A panel a card showed goes once its card is closed.
  useEffect(() => {
    if (shown === "card" && selection.id === null) setShown(null);
  }, [shown, selection.id]);
  // A card that left the data (deleted, archived away) leaves the sidebar to the overview.
  const selectedGone = selection.id !== null && tasks.ready && !board.cardById(selection.id);
  useEffect(() => {
    if (selectedGone) dispatch({ type: "clear" });
  }, [selectedGone]);

  const floatWidth = Platform.OS === "ios" ? tabletSidebarWidth(boardWidth, preference.floatingWidth) : sidebarWidth(boardWidth, preference.width, "floating");
  const latest = useRef({ board, live, emptyLanesSwitch, focus, shapes, menu, selection, floating, open, narrow, preferred: preference.open, toggleSidebar, boardWidth, lanesWidth, inSheet, floatWidth, laneWidth: layout.laneWidth, collapsed });
  latest.current = { board, live, emptyLanesSwitch, focus, shapes, menu, selection, floating, open, narrow, preferred: preference.open, toggleSidebar, boardWidth, lanesWidth, inSheet, floatWidth, laneWidth: layout.laneWidth, collapsed };
  const sheetMode = mode === "sheet";
  const sheetModeRef = useRef(sheetMode);
  sheetModeRef.current = sheetMode;
  // Built only where they show: the wide filter bar, or the panel while open.
  const optionsShown = !(touch || sheetMode) || filtersOpen;
  const options = useMemo(() => (optionsShown ? buildFilterOptions(live.tasks, live.params) : null), [optionsShown, live.tasks, live.params]);
  const rowScrollX = useRef(0);
  // The lanes the row shows now: one out of view waits to draw its cards (`DesktopLane`'s `inView`).
  const viewWidth = lanesWidth - coverRoom;
  const lanesInViewRef = useRef({ order: laneOrder, collapsed, laneWidth: layout.laneWidth, viewWidth });
  lanesInViewRef.current = { order: laneOrder, collapsed, laneWidth: layout.laneWidth, viewWidth };
  const [scrolledInView, setInView] = useState("");
  const inView = boardWidth > 0 ? lanesInView(laneOrder, collapsed, layout.laneWidth, rowScrollX.current, viewWidth) : scrolledInView;
  const highlightedLane = board.highlighted ? findCard(lanes, board.highlighted)?.lane ?? null : null;

  // A floating panel lands on the lanes' right side, where the card just
  // clicked may sit: the row scrolls that card's lane out from under it. A
  // sheet covers no lane's side (`cover` 0), but a lane clicked at the
  // board's edge still comes into view whole.
  // `laneWidth` is the lanes' width once a lane about to open has opened. True when the row scrolls.
  const uncover = useCallback((lane: LaneId, cover: number, laneWidth = latest.current.laneWidth) => {
    const now = latest.current;
    const order = now.board.laneOrder;
    const index = order.indexOf(lane);
    const left = LANES.edge + order.slice(0, index).reduce((sum, id) => sum + (now.collapsed.includes(id) ? LANES.collapsed : laneWidth) + LANES.gap, 0);
    const right = left + laneWidth;
    const visible = now.boardWidth - cover;
    const x = rowScrollX.current;
    if (right - x <= visible && left - LANES.edge >= x) return false;
    const target = Math.max(0, Math.min(left - LANES.edge, right - visible));
    // After the render that gives the row its room to scroll under the panel.
    setTimeout(() => rowRef.current?.scrollTo({ x: target, animated: true }), 50);
    return true;
  }, []);

  // A stat in the sidebar: its lane opens if folded, scrolls into view if it
  // is not all in view (beside the inline sidebar, or out from under a
  // floating one), then its background flashes.
  const [flash, setFlash] = useState<LaneFlash | null>(null);
  const showLane = useCallback(
    (lane: LaneId) => {
      const now = latest.current;
      const folded = now.collapsed.includes(lane);
      if (folded) setCollapsed((current) => current.filter((id) => id !== lane));
      const laneWidth = folded ? boardLaneLayout(now.boardWidth, now.board.laneOrder, now.collapsed.filter((id) => id !== lane), now.board.laneWidth).laneWidth : now.laneWidth;
      const cover = now.inSheet ? LANES.edge : now.floating ? now.floatWidth + (Platform.OS === "ios" ? SIDEBAR.gap : 2 * SIDEBAR.gap) : now.boardWidth - now.lanesWidth;
      const scrolled = uncover(lane, cover, laneWidth);
      setFlash((was) => ({ lane, key: (was?.key ?? 0) + 1, delay: scrolled ? LANE_FLASH.afterScrollMs : 0 }));
    },
    [setCollapsed, uncover],
  );

  const reveal = useCallback(
    (agentId: string) => {
      const { board: current } = latest.current;
      const location = findCard(current.lanes, agentId);
      if (!location) {
        if (current.tasks.byId.has(agentId)) current.toastMessage(current.strings.hiddenByFilters);
        else current.tasks.resolveParent(agentId);
        return;
      }
      const wasCollapsed = latest.current.collapsed.includes(location.lane);
      if (wasCollapsed) setCollapsed((lanesNow) => lanesNow.filter((id) => id !== location.lane));
      setTimeout(() => scrollTo(location.lane, location.index), wasCollapsed ? 50 : 0);
      current.highlight(agentId);
    },
    [setCollapsed, scrollTo],
  );

  props.handlers.current = {
    reveal,
    // A long press on a compact or touch card: the same as a click.
    details(card) {
      showCard(card);
    },
  };

  // A click, tap or explicit keyboard preview puts a card in the sidebar.
  // Moving keyboard focus alone does not change the details.
  // An explicit preview brings a put-away sidebar up for the moment. A
  // click or tap does so on touch, or on a narrow board with the preference on.
  const showCard = useCallback(
    (card: TaskCard, preview = false) => {
      if (!preview) setFocus(null);
      dispatch({ type: "click", id: card.id });
      const now = latest.current;
      const show = !now.open && (preview || touch || (now.narrow && now.preferred));
      if (show) setShown("card");
      if (!(now.open || show) || !(now.narrow || !now.preferred)) return;
      if (sheetModeRef.current) {
        // The sheet covers the lanes' lower part: the card's list brings it to the top, above the sheet.
        const location = findCard(now.board.lanes, card.id);
        if (location) setTimeout(() => scrollTo(location.lane, location.index, 0.05), 80);
        uncover(card.lane, LANES.edge);
      } else {
        uncover(card.lane, now.floatWidth + (Platform.OS === "ios" ? SIDEBAR.gap : 2 * SIDEBAR.gap));
      }
    },
    [touch, uncover, scrollTo],
  );
  const callbacks = useMemo<CardCallbacks>(() => ({ ...board.callbacks, onSelect: showCard }), [board.callbacks, showCard]);

  // A click or tap on the lanes that no card, button or list takes: the lanes'
  // gaps, a lane's empty space, its header. It lets go of the selected card
  // and the keyboard's. A drag (a scroll) moves too far to count, and a press
  // on a scrollbar, which Chromium sends to the list as well, does not count.
  //
  // On iOS and Android a responder above the lanes' scroll views held their
  // drags back (a drag from a lane's header did not scroll the row): there
  // each lane's header and the space under its cards take the tap instead,
  // inside the scroll views, as a card does.
  const letGo = useCallback(() => {
    focusTaskBoard(rootRef.current);
    dispatch({ type: "clear" });
    setFocus(null);
    if (latest.current.floating) setShown(null);
  }, [rootRef]);
  const blankDown = useRef<{ x: number; y: number } | null>(null);
  const blankPress = {
    onStartShouldSetResponder: () => true,
    onResponderGrant: (event: { nativeEvent: { pageX: number; pageY: number; target?: unknown } }) => {
      const { pageX, pageY, target } = event.nativeEvent;
      blankDown.current = onScrollbar(target, pageX, pageY) ? null : { x: pageX, y: pageY };
    },
    onResponderRelease: (event: { nativeEvent: { pageX: number; pageY: number } }) => {
      const down = blankDown.current;
      blankDown.current = null;
      if (!down || Math.abs(event.nativeEvent.pageX - down.x) > 6 || Math.abs(event.nativeEvent.pageY - down.y) > 6) return;
      letGo();
    },
    onResponderTerminate: () => {
      blankDown.current = null;
    },
  };

  // Keys on web: navigation, preview, search and the toolbar's switches. Only
  // while the board is on screen and focus is not somewhere else in the app.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined" || !board.visible) return;
    const onKey = (event: KeyboardEvent, ownsActivation = false) => {
      if (event.metaKey || event.ctrlKey || event.altKey || (event.defaultPrevented && !ownsActivation)) return;
      const root = rootRef.current as unknown as HTMLElement | null;
      const active = document.activeElement as HTMLElement | null;
      if (root?.querySelector?.('[data-testid="task-card-menu"]')) return;
      if (active && active !== document.body && root && !root.contains(active)) return;
      if (isTyping(active)) return;
      const now = latest.current;
      const domCardId = focusedTaskCardId(root);
      const keyFocus = domCardId ? findCard(now.board.lanes, domCardId) : now.focus;
      if (!event.isComposing && !now.menu && ((event.key === "." && !event.shiftKey) || (event.key === "F10" && event.shiftKey) || event.key === "ContextMenu")) {
        const card = keyFocus ? now.board.lanes[keyFocus.lane].cards[keyFocus.index] : now.selection.id ? now.board.cardById(now.selection.id) : null;
        if (!card) return;
        const node = document.getElementById(`task-card-${card.id}`);
        if (!node || !root?.contains(node)) return;
        event.preventDefault();
        if (event.repeat) return;
        const rect = node.getBoundingClientRect();
        // Reuse the card's right-click path and its current action availability.
        node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left + 16, clientY: rect.top + 16 }));
        return;
      }
      // Enter and Space on toolbar/sidebar/inner-card controls belong to those controls.
      if ((event.key === "Enter" || event.key === " ") && active && active !== document.body && active !== root && !domCardId) return;
      if (event.key === "Escape" && now.menu) {
        setMenu(null);
        event.preventDefault();
        return;
      }
      if (event.key === "Escape" && now.open) {
        const step = escapeStep(now.selection, now.floating);
        if (step) {
          event.preventDefault();
          if (step === "back") dispatch({ type: "back" });
          else if (step === "clear") dispatch({ type: "clear" });
          else {
            // Esc puts a floating panel or sheet away as a click outside does: the card goes with it.
            now.toggleSidebar();
            dispatch({ type: "clear" });
          }
          return;
        }
      }
      const key = event.key.toLowerCase();
      if (!event.shiftKey && !event.isComposing && !now.menu) {
        const actions: Record<string, (() => void) | null> = {
          "]": now.toggleSidebar,
          ",": tasksSettingsOpener(),
          e: now.emptyLanesSwitch.disabled ? null : now.emptyLanesSwitch.onToggle,
          s: () => now.live.setParams((params) => ({ ...params, hideSubtasks: !(params.hideSubtasks ?? now.live.defaults.hideSubtasks) })),
          a: () => now.live.setShowArchived(!now.live.showArchived),
          g: () => now.live.setShowEmptyGroups(!now.live.showEmptyGroups),
        };
        const action = actions[key];
        if (action) {
          event.preventDefault();
          if (!event.repeat) action();
          return;
        }
      }
      if (event.key === " " && !event.shiftKey && !event.isComposing && !now.menu) {
        const card = keyFocus
          ? now.board.lanes[keyFocus.lane].cards[keyFocus.index]
          : now.selection.id ? now.board.cardById(now.selection.id) : null;
        if (!card) return;
        event.preventDefault();
        if (!event.repeat) {
          if (now.open && now.selection.id === card.id) {
            focusTaskBoard(root);
            setFocus(findCard(now.board.lanes, card.id));
            dispatch({ type: "clear" });
          } else showCard(card, true);
        }
        return;
      }
      const origin = keyFocus ?? (now.selection.id ? findCard(now.board.lanes, now.selection.id) : null);
      const result = boardKeyReducer(origin, event.key, now.shapes);
      if (!result.handled) return;
      event.preventDefault();
      if (result.focus && result.effect !== "search") focusTaskBoard(root);
      setFocus(result.focus);
      if (result.effect === "search") searchRef.current?.focus();
      if (result.effect === "open" && result.focus) {
        const card = now.board.lanes[result.focus.lane].cards[result.focus.index];
        if (card) now.board.callbacks.onOpen?.(card.id);
      }
      if (result.effect === "cancel") {
        for (const id of LANE_ORDER) {
          for (const card of now.board.lanes[id].cards) if (now.board.stop.phase(card.id) === "confirming") now.board.stop.cancel(card.id);
        }
      }
    };
    // The host's global shortcuts run at window capture and may cancel Space
    // before it reaches document. A card or the composite board owns its
    // activation even then; nested controls keep their own key handling.
    const onActivationKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const root = rootRef.current as unknown as HTMLElement | null;
      if (!root || !(focusedTaskCardId(root) || (document.activeElement === root && (latest.current.focus || latest.current.selection.id)))) return;
      onKey(event, true);
      if (event.defaultPrevented) event.stopPropagation();
    };
    // Esc reaches us before TextInput stops it from bubbling.
    const onCaptureKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.metaKey || event.ctrlKey || event.altKey) return;
      const root = rootRef.current as unknown as HTMLElement | null;
      if (root?.querySelector?.('[data-testid="task-card-menu"]')) return;
      const active = document.activeElement as HTMLElement | null;
      const inBoard = !!active && !!root && root.contains(active);
      const disarmed = latest.current.board.stop.cancelAll();
      if (inBoard && isTyping(active)) {
        active!.blur();
        event.preventDefault();
      } else if (disarmed && (inBoard || !active || active === document.body)) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onActivationKey, true);
    document.addEventListener("keydown", onCaptureKey, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onActivationKey, true);
      document.removeEventListener("keydown", onCaptureKey, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [board.visible, rootRef, showCard]);

  const breathing = useBreathing(!tasks.ready && board.visible);
  const reduced = useReducedMotion();
  // Filters, sort and search are the user's: lanes that change with them take their new order at once.
  const motion = useLaneMotion(lanes, { enabled: board.visible && tasks.ready && !reduced, scope: board.scope, flights: true, churnLimit: LANE_CHURN_LIMIT });
  const renderCopy = useCallback(
    (card: TaskCard) => <CardCell board={board} card={card} theme={theme} compact={false} fresh={false} copy callbacks={callbacks} />,
    [board, theme, callbacks],
  );
  const unfilteredEmpty = tasks.ready && LANE_ORDER.every((id) => tasks.lanes[id].cards.length === 0);
  const sidebarToggle = useMemo(() => ({ open, onToggle: toggleSidebar, floating, sheet: mode === "sheet" }), [open, toggleSidebar, floating, mode]);
  const filterCount = sheetMode ? activeFilterCount(live.params, live.defaults) : 0;
  const sheetFilters = useMemo(() => (sheetMode ? { count: filterCount, onPress: () => setFiltersOpen(true) } : undefined), [sheetMode, filterCount]);
  const openFilterPanel = useCallback(() => {
    setMenu(null);
    setFiltersOpen(true);
  }, []);
  const sidebar = (
    <DetailsSidebar
      board={board}
      theme={theme}
      selection={selection}
      dispatch={dispatch}
      onLane={showLane}
      onReveal={reveal}
      touch={touch}
      stats={!(inSheet && selection.id !== null)}
      scrollAll={inSheet}
      tabs={ipadFloating}
    />
  );
  const activeCardId = focus ? `task-card-${lanes[focus.lane].cards[focus.index]!.id}` : undefined;

  return (
    <View ref={rootRef} collapsable={false} style={{ flex: 1, backgroundColor: colors.surface0, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null) }} {...claimKeys(rootRef, () => setFocus(null), activeCardId)}>
      {touch ? <TabletToolbar
        board={live}
        theme={theme}
        width={boardWidth}
        searchRef={searchRef}
        onFilters={() => setFiltersOpen(true)}
        sidebar={sidebarToggle}
        emptyLanes={emptyLanesSwitch}
      /> : <DesktopToolbar
        board={live}
        theme={theme}
        searchRef={searchRef}
        keyHints={boardWidth === 0 || boardWidth >= KEY_HINTS_MIN_WIDTH * Math.max(1, scale)}
        filterOptions={options ?? undefined}
        menu={menu}
        setMenu={setMenu}
        sidebar={sidebarToggle}
        emptyLanes={emptyLanesSwitch}
        filters={sheetFilters}
      />}
      {touch || sheetMode || !options ? null : (
        <DesktopFilterBar
          board={live}
          theme={theme}
          options={options}
          menu={menu}
          setMenu={setMenu}
          emptyLanes={emptyLanesSwitch}
          onMore={openFilterPanel}
        />
      )}
      {/* Narrow boards and tablet toolbars share the host's filter panel. */}
      <Modal title={strings.filters} open={(touch || sheetMode) && filtersOpen} onOpenChange={(open) => !open && setFiltersOpen(false)}>
        <Modal.Content contentContainerStyle={FILTER_SHEET_BODY} scrollable={false}>
          <TasksTypography theme={theme}>
            {(touch || sheetMode) && filtersOpen && options ? (
              <FilterSheetBody
                board={live}
                theme={theme}
                options={options}
                showEmptyGroupsToggle
                showArchivedToggle={touch}
                laneWidth={{ value: live.laneWidth, onChange: live.setLaneWidth }}
                onDone={() => setFiltersOpen(false)}
              />
            ) : null}
          </TasksTypography>
        </Modal.Content>
      </Modal>
      <View
        testID="tasks-board-area"
        style={{ flex: 1, minHeight: 0, flexDirection: "row", overflow: "hidden" }}
        onLayout={(event) => {
          setBoardWidth(Math.floor(event.nativeEvent.layout.width));
          setBoardHeight(Math.floor(event.nativeEvent.layout.height));
        }}
      >
        <View style={{ flex: 1, minWidth: 0, minHeight: 0 }} {...(touch ? null : blankPress)}>
          <LaneMotionProvider value={motion}>
            {boardWidth > 0 ? (
              <ScrollView
                ref={rowRef}
                horizontal
                onScroll={(event) => {
                  rowScrollX.current = event.nativeEvent.contentOffset.x;
                  const now = lanesInViewRef.current;
                  const next = lanesInView(now.order, now.collapsed, now.laneWidth, rowScrollX.current, now.viewWidth);
                  if (next !== inView) setInView(next);
                }}
                scrollEventThrottle={32}
                scrollEnabled={layout.scroll || coverRoom > 0}
                showsHorizontalScrollIndicator={layout.scroll || coverRoom > 0}
                style={{ flex: 1 }}
                contentContainerStyle={{ width: layout.contentWidth + coverRoom, gap: touch ? 0 : LANES.gap, paddingLeft: LANES.edge, paddingRight: LANES.edge + coverRoom, paddingTop: 4, paddingBottom: 12 }}
              >
                {archivedSwitch.drawn.map((id, index) => (
                  <React.Fragment key={id}>
                    {/* On touch the gap between two lanes is a blank to tap too, inside the scroll row. */}
                    {touch && index > 0 ? <LaneGap onPress={letGo} /> : null}
                    <DesktopLane
                      lane={id === "archived" && archivedSwitch.phase === "leave" ? archivedSwitch.last : lanes[id]}
                      width={id === "archived" && archivedSwitch.phase === "leave" ? archivedSwitch.width : layout.laneWidth}
                      collapsed={collapsedState.includes(id)}
                      sizing={`${sizing}|${collapsedState.includes(id)}`}
                      enter={id === "archived" && archivedSwitch.phase === "enter"}
                      leaving={id === "archived" && archivedSwitch.phase === "leave"}
                      onToggle={toggleLane[id]}
                      board={board}
                      callbacks={callbacks}
                      theme={theme}
                      focusIndex={focus?.lane === id ? focus.index : null}
                      currentId={open ? selection.id : null}
                      listRef={publishList[id]}
                      breathing={breathing}
                      bottomRoom={sheetRoom}
                      onBlank={touch ? letGo : undefined}
                      flash={flash?.lane === id ? flash : null}
                      inView={inView.includes(`|${id}|`) || focus?.lane === id || flash?.lane === id || highlightedLane === id}
                      hidden={board.hidden[id]}
                    />
                  </React.Fragment>
                ))}
              </ScrollView>
            ) : null}
            <LaneMotionLayer store={motion} renderCard={renderCopy} />
          </LaneMotionProvider>
          {unfilteredEmpty ? <BoardEmpty board={board} theme={theme} /> : null}
        </View>
        {mode === "inline" && !floating ? (
          <SidebarColumn open={inline} width={panelWidth} theme={theme} onDrag={setDragWidth} onResize={(width) => setPreference((current) => ({ ...current, width }))}>
            {sidebar}
          </SidebarColumn>
        ) : null}
        {inSheet ? (
          <BoardSheet
            area={boardHeight}
            detent={detent}
            onDetent={setDetent}
            onClose={() => {
              dispatch({ type: "clear" });
              setShown(null);
            }}
            theme={theme}
            labels={{ grow: strings.sidebar.sheetGrow, shrink: strings.sidebar.sheetShrink }}
          >
            {sidebar}
          </BoardSheet>
        ) : floating ? (
          <FloatingSidebar
            width={panelWidth}
            theme={theme}
            flushRight={ipadFloating}
            resize={ipadFloating ? {
              label: strings.sidebar.resize,
              max: tabletSidebarWidth(boardWidth, TABLET_SIDEBAR.max),
              onDrag: setFloatingDragWidth,
              onResize: (width) => setPreference((current) => ({ ...current, floatingWidth: width })),
            } : undefined}
          >
            {ipadFloating ? <TasksTypographyScale factor={TABLET_SIDEBAR.fontScale}>{sidebar}</TasksTypographyScale> : sidebar}
          </FloatingSidebar>
        ) : null}
      </View>
      {menu ? (
        <Pressable
          accessibilityLabel={strings.closeMenu}
          onPress={() => setMenu(null)}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 9 }}
        />
      ) : null}
      <BoardTips root={rootRef} theme={theme} color={colors.foreground} />
    </View>
  );
}

/**
 * Web: a board switch (subtasks, archived, empty lanes) redraws every lane
 * and the sidebar, mounting cards by the dozen, in one 50-80 ms frame. Behind
 * `useDeferredValue` the bars still answer in the frame of the press, and the
 * lanes render in slices between frames; only the commit is one piece. Native
 * keeps its own timing (`useLaggedWhile` above, the lane motion's cover).
 */
const DEFER_LANES = Platform.OS === "web";

/**
 * A deferred render starts over whenever the board changes again, and the
 * daemon can send a change every few milliseconds (git status across many
 * workspaces, streaming agents): after this long the lanes take the board at
 * once, as they would without `DEFER_LANES`.
 */
const DEFER_LANES_MAX_MS = 120;

/**
 * `useDeferredValue(value)` while `on`, but never more than `maxMs` behind:
 * a value still not shown after that renders at once. `value` itself when off.
 */
export function useDeferredWithin<T>(value: T, on: boolean, maxMs: number): T {
  const deferred = useDeferredValue(on ? value : null);
  const [, wake] = useReducer((count: number) => count + 1, 0);
  const behind = on && deferred !== value;
  // When the shown board first fell behind, as committed: a render React drops leaves it alone.
  const since = useRef<number | null>(null);
  const late = behind && since.current !== null && Date.now() - since.current >= maxMs;
  useLayoutEffect(() => {
    if (!behind) since.current = null;
    else if (since.current === null) since.current = Date.now();
  });
  useEffect(() => {
    if (!behind || late || since.current === null) return;
    const timer = setTimeout(wake, Math.max(0, maxMs - (Date.now() - since.current)));
    return () => clearTimeout(timer);
  });
  return on && !late ? (deferred as T) : value;
}

/** The filter panel's switches slide for `SWITCH_MS`; the lanes behind wait a frame past that. */
const FILTER_PANEL_LAG_MS = SWITCH_MS + 40;

/**
 * `value` as it was up to `ms` ago while `lag` holds, the latest one as soon
 * as it does not. Changes that come in while one waits go out with it.
 */
export function useLaggedWhile<T>(value: T, lag: boolean, ms: number): T {
  const [, wake] = useReducer((count: number) => count + 1, 0);
  const shown = useRef(value);
  const latest = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  latest.current = value;
  if (!lag) shown.current = value;
  useEffect(() => {
    if (!lag && timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!lag || timer.current || shown.current === value) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      shown.current = latest.current;
      wake();
    }, ms);
  });
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return shown.current;
}

/** The gap between two lanes on touch: a blank to tap, as the lanes' headers and empty space are. */
function LaneGap(props: { onPress(): void }) {
  const { pressIn, tap } = useTap();
  return <Pressable accessible={false} {...pressIn} onPress={tap(props.onPress)} testID="lane-gap" style={{ width: LANES.gap, alignSelf: "stretch" }} />;
}

/**
 * The inline sidebar: a column at the board's right, 12 from its edge, its
 * left inset holding the drag handle on web. A drag
 * resizes the column and the lanes' viewport, at most once a frame; the
 * release keeps the width. A double click puts 380 back.
 */
function SidebarColumn(props: { open: boolean; width: number; theme: PluginTheme; onDrag(width: number | null): void; onResize(width: number): void; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const { hovered, hoverProps } = useHover();
  const [dragging, setDragging] = useState(false);
  const [mounted, setMounted] = useState(props.open);
  const progress = useRef(new Animated.Value(reduced && props.open ? 1 : 0)).current;
  if (props.open && !mounted) setMounted(true);
  useEffect(() => {
    if (reduced) {
      progress.setValue(props.open ? 1 : 0);
      if (!props.open) setMounted(false);
      return;
    }
    // Reuse the current progress when reversed; never reset a half-open panel.
    const animation = Animated.timing(progress, { toValue: props.open ? 1 : 0, duration: props.open ? 240 : 180, easing: MOTION.ease, useNativeDriver: false });
    animation.start(({ finished }) => {
      if (finished && !props.open) setMounted(false);
    });
    return () => animation.stop();
  }, [progress, props.open, reduced]);
  const lastDown = useRef(0);
  const handleRef = useRef<View>(null);
  const indicatorRef = useRef<View>(null);
  const dom = () => [handleRef.current, indicatorRef.current] as unknown as [HTMLElement | null, HTMLElement | null];
  const follow = (clientY: number) => followPointer(...dom(), clientY);
  const start = (event: { nativeEvent: { pageX: number; clientY: number } }) => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const at = Date.now();
    if (at - lastDown.current < 350) {
      lastDown.current = 0;
      props.onResize(SIDEBAR.width);
      return;
    }
    lastDown.current = at;
    const x0 = event.nativeEvent.pageX;
    const width0 = props.width;
    let width = width0;
    const [handle] = dom();
    const body = document.body.style;
    const restore = { cursor: body.cursor, userSelect: body.userSelect };
    body.cursor = "col-resize";
    body.userSelect = "none";
    setResizing(handle, true);
    setDragging(true);
    let frame = 0;
    let pointerY = event.nativeEvent.clientY;
    const move = (moved: PointerEvent) => {
      width = clampWidth(width0 + (x0 - moved.pageX));
      pointerY = moved.clientY;
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          follow(pointerY);
          props.onDrag(width);
        });
      }
    };
    const up = () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      Object.assign(body, restore);
      setResizing(handle, false);
      setDragging(false);
      props.onDrag(null);
      if (width !== width0) props.onResize(width);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };
  const handle = Platform.OS === "web" ? (
    <View
      ref={handleRef}
      {...resizeHandleProps}
      {...({ onPointerDown: start, onPointerMove: (event: { nativeEvent: { clientY: number } }) => { if (!dragging) follow(event.nativeEvent.clientY); } } as object)}
      style={{ position: "absolute", left: 0, top: 4, bottom: 12, width: 8, zIndex: 5, ...({ cursor: "col-resize", touchAction: "none" } as object) }}
      testID="sidebar-resize"
    >
      <View pointerEvents="none" style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <View testID="sidebar-resize-grabber" style={{
          width: 3,
          height: 40,
          borderRadius: 2,
          backgroundColor: props.theme.colors.foregroundMuted,
          opacity: hovered || dragging ? 0.5 : 0,
          ...({ transitionProperty: "opacity", transitionDuration: reduced ? "0ms" : "150ms", transitionTimingFunction: "ease-out" } as object),
        }} />
      </View>
      <View {...resizeTrackProps} pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, left: 3.5, width: 1, overflow: "hidden" }}>
        <View ref={indicatorRef} {...resizeIndicatorProps} style={{ position: "absolute", top: "-50%", height: "200%", left: 0, right: 0 }} />
      </View>
    </View>
  ) : null;
  if (!props.open && (!mounted || reduced)) return null;
  return (
    // Animate only the slot and surface: fixed-width cards do not reflow on every frame.
    <Animated.View
      testID="sidebar-slot"
      pointerEvents={props.open ? "auto" : "none"}
      aria-hidden={!props.open}
      accessibilityElementsHidden={!props.open}
      importantForAccessibility={props.open ? "auto" : "no-hide-descendants"}
      style={{ width: reduced ? props.width + SIDEBAR.gap : progress.interpolate({ inputRange: [0, 1], outputRange: [0, props.width + SIDEBAR.gap] }), flexShrink: 0, minHeight: 0 }}
    >
      <Animated.View
        testID="sidebar-inline"
        {...(Platform.OS === "web" ? { onPointerEnter: hoverProps.onHoverIn, onPointerLeave: hoverProps.onHoverOut } : {})}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: SIDEBAR.gap,
          width: props.width,
          // Include the outer margin in the right inset to match the toolbar's 16 pt.
          ...(Platform.OS === "web" ? { paddingLeft: 10, paddingRight: 16 - SIDEBAR.gap } : { paddingHorizontal: 10 }),
          paddingTop: 4,
          paddingBottom: 12,
          minHeight: 0,
          backgroundColor: props.theme.colors.surface0,
          boxShadow: `-8px 0px 16px -8px rgba(0, 0, 0, ${taskTokens(props.theme).isDark ? 0.5 : 0.2})`,
          zIndex: 1,
          opacity: reduced ? 1 : progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.9, 1] }),
          transform: [{ translateX: reduced ? 0 : progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        }}
      >
        {handle}
        {props.children}
      </Animated.View>
    </Animated.View>
  );
}

/** A narrow board's sidebar: over the lanes' right side, on the board's surface with the menus' shadow. */
function FloatingSidebar(props: {
  width: number;
  theme: PluginTheme;
  flushRight?: boolean;
  resize?: { label: string; max: number; onDrag(width: number | null): void; onResize(width: number): void };
  children: React.ReactNode;
}) {
  const chrome = menuChrome(props.theme);
  const reduced = useReducedMotion();
  const x = useRef(new Animated.Value(reduced ? 0 : 24)).current;
  const opacity = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const latest = useRef(props);
  latest.current = props;
  const [dragging, setDragging] = useState(false);
  const pan = useMemo(() => {
    let touchX = 0;
    let startWidth = 0;
    const widthAt = (event: GestureResponderEvent) => {
      const max = latest.current.resize?.max ?? TABLET_SIDEBAR.max;
      return Math.round(Math.max(TABLET_SIDEBAR.min, Math.min(max, startWidth + touchX - event.nativeEvent.pageX)));
    };
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: (event) => {
        touchX = event.nativeEvent.pageX;
        return false;
      },
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, gesture) => !!latest.current.resize && Math.abs(gesture.dx) > 4 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        startWidth = latest.current.width;
        setDragging(true);
      },
      onPanResponderMove: (event) => latest.current.resize?.onDrag(widthAt(event)),
      onPanResponderRelease: (event) => {
        const resize = latest.current.resize;
        resize?.onResize(widthAt(event));
        resize?.onDrag(null);
        setDragging(false);
      },
      onPanResponderTerminate: () => {
        latest.current.resize?.onDrag(null);
        setDragging(false);
      },
    });
  }, []);
  useEffect(() => {
    if (reduced) return;
    const animation = Animated.parallel([
      Animated.timing(x, { toValue: 0, duration: 220, easing: MOTION.ease, useNativeDriver: nativeDriver }),
      Animated.timing(opacity, { toValue: 1, duration: 220, easing: MOTION.ease, useNativeDriver: nativeDriver }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [x, opacity, reduced]);
  return (
    <Animated.View
      testID="sidebar-floating"
      style={{
        position: "absolute",
        top: 4,
        right: props.flushRight ? 0 : SIDEBAR.gap,
        bottom: 12,
        width: props.width,
        padding: 8,
        paddingLeft: props.resize ? 12 : 8,
        borderRadius: 16,
        ...(props.flushRight ? { borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRightWidth: 0 } : null),
        borderWidth: HAIRLINE,
        borderColor: chrome.border,
        backgroundColor: boardPalette(props.theme).panel,
        boxShadow: `-8px 0px 16px -8px rgba(0, 0, 0, ${taskTokens(props.theme).isDark ? 0.5 : 0.2})`,
        zIndex: 20,
        opacity,
        transform: [{ translateX: x }],
      } as object}
    >
      {props.resize ? (
        <View
          {...pan.panHandlers}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={props.resize.label}
          accessibilityValue={{ min: TABLET_SIDEBAR.min, max: props.resize.max, now: props.width }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) => {
            const action = event.nativeEvent.actionName;
            if (action !== "increment" && action !== "decrement") return;
            const width = props.width + (action === "increment" ? 20 : -20);
            props.resize?.onResize(Math.max(TABLET_SIDEBAR.min, Math.min(props.resize.max, width)));
          }}
          testID="floating-sidebar-resize"
          style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 12, alignItems: "center", justifyContent: "center", zIndex: 5 }}
        >
          <View pointerEvents="none" testID="floating-sidebar-grabber" style={{ width: 4, height: 40, borderRadius: 2, backgroundColor: dragging ? props.theme.colors.accent : props.theme.colors.foregroundMuted, opacity: dragging ? 1 : 0.5 }} />
        </View>
      ) : null}
      {props.children}
    </Animated.View>
  );
}

function BoardEmpty({ board, theme }: { board: BoardController; theme: PluginTheme }) {
  const colors = theme.colors;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: 40, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", padding: 16 }}>
      <BoardEmptyState
        theme={theme}
        icon="SquareKanban"
        title={board.strings.boardEmpty}
        hint={board.strings.boardEmptyHint}
        style={{ width: "100%", maxWidth: 480, backgroundColor: colors.surface0 }}
      />
    </View>
  );
}

/**
 * The archived lane as it is switched on and off: the complete panel slides
 * in and out, keeping its slot and the other lanes' widths until it leaves.
 * `drawn` is the lanes to render: the
 * board's, and the archived lane while it leaves, drawn as it last showed
 * (`last`, at `width`). At once when the board is hidden or motion is reduced.
 */
function useArchivedSwitch(
  laneOrder: readonly LaneId[],
  archived: LaneModel,
  laneWidth: number,
  visible: boolean,
): { drawn: readonly LaneId[]; phase: "enter" | "leave" | null; last: LaneModel; width: number } {
  const reduced = useReducedMotion();
  const on = laneOrder.includes("archived");
  const [seen, setSeen] = useState(on);
  const [phase, setPhase] = useState<"enter" | "leave" | null>(null);
  if (seen !== on) {
    setSeen(on);
    setPhase(visible && !reduced ? (on ? "enter" : "leave") : null);
  }
  if (phase && (!visible || reduced)) setPhase(null);
  const last = useRef({ lane: archived, width: laneWidth });
  if (on) last.current = { lane: archived, width: laneWidth };
  useEffect(() => {
    if (!phase) return;
    const timer = setTimeout(() => setPhase(null), MOTION.resizeMs);
    return () => clearTimeout(timer);
  }, [phase]);
  const drawn = useMemo<readonly LaneId[]>(() => (phase === "leave" && !on ? [...laneOrder, "archived"] : laneOrder), [phase, on, laneOrder]);
  return { drawn, phase, last: last.current.lane, width: last.current.width };
}

/**
 * The lanes the row shows between `scrollX` and `scrollX + viewWidth`, as
 * `|id|id|`: a string, so the board renders again only when the set changes.
 * The row's edge padding does not count: a lane added after the last, with the
 * row scrolled to its end, starts inside it and is not in view.
 */
function lanesInView(order: readonly LaneId[], collapsed: readonly LaneId[], laneWidth: number, scrollX: number, viewWidth: number): string {
  let left = LANES.edge;
  let out = "|";
  for (const id of order) {
    const width = collapsed.includes(id) ? LANES.collapsed : laneWidth;
    if (left < scrollX + viewWidth - LANES.edge && left + width > scrollX + LANES.edge) out += `${id}|`;
    left += width + LANES.gap;
  }
  return out;
}

/** An out-of-view lane draws its cards this long after it appeared, when the switch or the board's opening has settled. */
const OFFSCREEN_DRAW_MS = 800;

/**
 * Whether a lane draws its cards: at once in view; out of view (a tablet's
 * row, the archived lane switched on past its edge) once it scrolls in or
 * `OFFSCREEN_DRAW_MS` later, so its cards do not mount in the same frames as
 * the switch. Once drawn it stays drawn.
 */
function useDrawnOnce(inView: boolean): boolean {
  const [drawn, setDrawn] = useState(inView);
  if (inView && !drawn) setDrawn(true);
  useEffect(() => {
    if (drawn) return;
    const timer = setTimeout(() => setDrawn(true), OFFSCREEN_DRAW_MS);
    return () => clearTimeout(timer);
  }, [drawn]);
  return drawn || inView;
}

/** A list under copies of its cards while they move (native lane motion). */
const HIDDEN = { opacity: 0 };
/**
 * Native: more cards than this coming into the lanes or leaving them show at
 * once, without lane motion (`useLaneMotion`). A card that changes lanes
 * counts twice, so up to three cards still travel. The web moves the cards
 * themselves and copies none, so every change there keeps its motion.
 */
const LANE_CHURN_LIMIT = Platform.OS === "web" ? undefined : 6;
/**
 * Native: how long a lane waits before it renders more of its cards out of
 * view. A filter that adds cards (the subtasks switch) grows every list at
 * once, and their next batches of cards no one could see yet landed while the
 * new cards faded in and the counts rolled. A list short of cards on screen
 * still fills at once (`VirtualizedList`'s high-priority update).
 */
const LANE_FILL_MS = Platform.OS === "web" ? undefined : MOTION.slideMs + MOTION.fadeDelayMs;

/**
 * Web: how many cards a lane adds to its list at a time, out of view. The
 * lanes fill together, in one render: after the subtasks switch showed
 * their cards, eight a lane mounted some twenty cards no one could see yet
 * in a single frame, just as the cards' slides ended.
 */
const LANE_BATCH = Platform.OS === "web" ? 4 : 8;

interface LaneFlash {
  lane: LaneId;
  /** A new key flashes again. */
  key: number;
  /** Wait for the row's scroll before flashing. */
  delay: number;
}

const LANE_FLASH = {
  /** The row's animated scroll comes first. */
  afterScrollMs: 300,
} as const;

interface DesktopLaneProps {
  lane: LaneModel;
  width: number;
  collapsed: boolean;
  /** Changes when the user collapses, expands or resizes lanes: the lane eases to its new width. */
  sizing: string;
  /** The archived lane just switched on: its complete panel slides in. */
  enter?: boolean;
  /** The archived lane just switched off: it slides out, its content as it was, and takes no touch. */
  leaving?: boolean;
  onToggle(): void;
  board: BoardController;
  callbacks: CardCallbacks;
  theme: PluginTheme;
  focusIndex: number | null;
  /** The card the sidebar shows. */
  currentId: string | null;
  listRef(list: NativeFlatList<TaskCard> | null): void;
  breathing: Animated.Value;
  /** The bottom sheet's height over the lanes: the list scrolls its last card above it. */
  bottomRoom: number;
  /** Touch only: a tap on the header or under the cards lets go of the selection (see `letGo`). */
  onBlank?(): void;
  /** A stat pressed for this lane: its background flashes. */
  flash: LaneFlash | null;
  /** In the row's view, or wanted there (focused, flashed, a card revealed): its cards draw now, not later. */
  inView: boolean;
  /** Its cards the filters leave out (`board.hidden`), passed alone so another lane's count does not draw this one again. */
  hidden: number;
}

/**
 * The board fields a lane draws nothing from, and that change on every data
 * update: the other lanes, the counts above them (a lane's own hidden count
 * comes as its `hidden` prop), and the store's snapshot,
 * of which a lane reads only `ready` and `loadMoreDone`. Any other field is
 * compared, so one added later makes the lane draw again rather than go stale.
 */
const LANE_BLIND: ReadonlySet<string> = new Set(["lanes", "hidden", "total", "tasks", "searchStatus"]);

function sameLaneBoard(last: BoardController, next: BoardController): boolean {
  if (last === next) return true;
  if (last.tasks.ready !== next.tasks.ready || last.tasks.loadMoreDone !== next.tasks.loadMoreDone) return false;
  const keys = Object.keys(next) as (keyof BoardController)[];
  return keys.length === Object.keys(last).length && keys.every((key) => LANE_BLIND.has(key) || last[key] === next[key]);
}

function sameLaneProps(last: DesktopLaneProps, next: DesktopLaneProps): boolean {
  const keys = Object.keys(next) as (keyof DesktopLaneProps)[];
  return keys.length === Object.keys(last).length && keys.every((key) => (key === "board" ? sameLaneBoard(last.board, next.board) : last[key] === next[key]));
}

/** A lane draws again only when its own cards, its size or what its cards show changed, not when another lane did. */
const DesktopLane = memo(DesktopLaneView, sameLaneProps);

function DesktopLaneView(props: DesktopLaneProps) {
  const { lane, board, theme } = props;
  const scale = useTasksFontScale();
  const colors = theme.colors;
  const flashOpacity = useFlash(props.flash?.key ?? 0, props.flash?.delay ?? 0);
  const palette = boardPalette(theme);
  const strings = board.strings;
  const ready = board.tasks.ready;
  const name = strings.lanes[lane.id];
  const count = lane.cards.length;
  const titleSize = laneTitle().size;
  const countStyle = { fontSize: titleSize, color: colors.foregroundMuted, fontVariant: ["tabular-nums" as const] };
  const fresh = useFreshIds(
    lane.cards.map((card) => card.id),
    ready,
    board.scope,
  );
  const listRef = useRef<NativeFlatList<TaskCard> | null>(null);
  const pillRef = useRef<View | null>(null);
  // Cards that change lanes fly to the list, or to the pill of a collapsed lane.
  useLaneTarget(
    lane.id,
    () => (props.collapsed ? pillRef.current : scrollNode(listRef.current)),
    (offset) => listRef.current?.scrollToOffset({ offset, animated: false }),
  );
  const covered = useLaneCovered(lane.id);
  const { listRef: publish } = props;
  const setList = useCallback(
    (list: NativeFlatList<TaskCard> | null) => {
      listRef.current = list;
      publish(list);
    },
    [publish],
  );
  // No clock in here: a tick reaches the timer texts, not the list and its rows.
  const { focusIndex, currentId, callbacks } = props;
  const { highlighted, stop, read, fields } = board;
  const extraData = useMemo(() => ({ focusIndex, highlighted, stop, read, fields, fresh, currentId }), [focusIndex, highlighted, stop, read, fields, fresh, currentId]);
  const renderItem = useCallback(
    ({ item, index }: { item: TaskCard; index: number }) => (
      <CardCell
        board={board}
        card={item}
        theme={theme}
        compact={false}
        focused={focusIndex === index}
        current={currentId === item.id}
        fresh={fresh.has(item.id)}
        callbacks={callbacks}
      />
    ),
    [board, theme, focusIndex, currentId, fresh, callbacks],
  );

  // Taps that a quick swipe starting on them must not fire (see `useTap`).
  const headerTap = useTap();
  const collapseTap = useTap();
  const blankTap = useTap();
  const drawn = useDrawnOnce(props.inView);
  const shown = props.collapsed ? LANES.collapsed : props.width;
  const resized = useLaneWidth(shown, props.sizing);
  const slide = useLaneSlide(props.enter ? "enter" : props.leaving ? "leave" : null, shown + LANES.gap);
  // The lane's clip eases to its width; the strip or list inside it has its own at once.
  const clip = (content: React.ReactNode) => (
    <Animated.View
      testID={`lane-${lane.id}`}
      pointerEvents={props.leaving ? "none" : "auto"}
      aria-hidden={props.leaving}
      accessibilityElementsHidden={props.leaving}
      importantForAccessibility={props.leaving ? "no-hide-descendants" : "auto"}
      style={{ width: resized.width, flexShrink: 0, minHeight: 0, borderRadius: PANEL_RADIUS, overflow: "hidden" }}
    >
      <Animated.View testID={`lane-surface-${lane.id}`} style={{ width: shown, flex: 1, minHeight: 0, borderRadius: PANEL_RADIUS, backgroundColor: palette.panel, overflow: "hidden", transform: [{ translateX: slide }] }}>
        <LaneSwap key={props.collapsed ? "strip" : "list"} fade={resized.moving} width={shown}>
          {content}
        </LaneSwap>
      </Animated.View>
    </Animated.View>
  );

  if (props.collapsed) {
    return clip(
      <HoverPressable
        ref={pillRef}
        accessibilityRole="button"
        accessibilityLabel={`${strings.expand}: ${name}`}
        {...collapseTap.pressIn}
        onPress={collapseTap.tap(props.onToggle)}
        style={(hovered) => ({
          width: LANES.collapsed,
          alignItems: "center",
          gap: 10,
          paddingVertical: 11,
          borderRadius: PANEL_RADIUS,
          backgroundColor: hovered ? palette.panelHover : palette.panel,
        })}
      >
        <StatusIcon kind={LANE_STATUS[lane.id]} size={14} theme={theme} animated={board.visible} />
        <VerticalLabel text={name} color={colors.foreground} language={board.language} />
        {ready ? <RollingCount value={count} scope={board.scope} align="center" style={countStyle} /> : <Text style={countStyle}>{""}</Text>}
      </HoverPressable>,
    );
  }

  const loadingFirst = !ready || !drawn || (lane.initialLoading && count === 0);
  return clip(
    <View style={{ width: props.width, minHeight: 0, borderRadius: PANEL_RADIUS, backgroundColor: palette.panel, overflow: "hidden" }}>
      {/* Under the header and the cards: only the lane's own fill flashes. */}
      <Animated.View pointerEvents="none" testID={`lane-flash-${lane.id}`} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.accent, opacity: flashOpacity }} />
      <Pressable
        accessible={false}
        disabled={!props.onBlank}
        {...headerTap.pressIn}
        onPress={headerTap.tap(props.onBlank)}
        testID={`lane-header-${lane.id}`}
        style={{ height: taskControlHeight(40, scale), flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 14, paddingRight: 8 }}
      >
        <StatusIcon kind={LANE_STATUS[lane.id]} size={14} theme={theme} animated={board.visible} />
        <Text style={{ fontSize: titleSize, fontWeight: "500", color: colors.foreground }}>{name}</Text>
        {ready ? (
          <RollingCount value={count} scope={board.scope} style={countStyle} />
        ) : (
          <View style={{ width: 14, height: 10, borderRadius: 2, backgroundColor: colors.surface2 }} />
        )}
        <View style={{ flex: 1 }} />
        {isHistoryLane(lane.id) ? (
          <Text style={{ fontSize: F.sm, color: colors.foregroundMuted }}>{strings.windows[board.params.doneWindow ?? board.defaults.doneWindow]}</Text>
        ) : null}
        <HoverPressable
          accessibilityRole="button"
          accessibilityLabel={strings.collapse}
          {...collapseTap.pressIn}
          onPress={collapseTap.tap(props.onToggle)}
          style={(hovered) => ({
            width: 24,
            height: 24,
            borderRadius: 6,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: hovered ? palette.panelHover : "transparent",
          })}
        >
          <Icon name="FoldHorizontal" size={14} color={colors.foregroundMuted} />
        </HoverPressable>
      </Pressable>
      {loadingFirst ? (
        <View style={{ ...SKELETON_PAD, paddingBottom: 8, gap: 12 }}>
          {[0, 1, 2].map((index) => (
            <SkeletonCard key={index} index={index} theme={theme} opacity={props.breathing} />
          ))}
        </View>
      ) : (
        <FlatList<TaskCard>
          {...laneScrollProps}
          ref={setList}
          style={covered ? HIDDEN : undefined}
          data={lane.cards}
          keyExtractor={(card) => card.id}
          extraData={extraData}
          renderItem={renderItem}
          ItemSeparatorComponent={Separator}
          contentContainerStyle={{ ...LANE_PAD, paddingTop: Platform.OS === "web" ? 4 : 2, paddingBottom: 8 + props.bottomRoom, ...(props.onBlank ? { flexGrow: 1 } : null) }}
          initialNumToRender={8}
          maxToRenderPerBatch={LANE_BATCH}
          windowSize={7}
          updateCellsBatchingPeriod={LANE_FILL_MS}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            // Variable heights: jump near it, then try again once laid out.
            listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
            setTimeout(() => {
              try {
                listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: true });
              } catch {
                // Give up quietly: the card is still highlighted.
              }
            }, 50);
          }}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (isHistoryLane(lane.id) && lane.hasMore && !lane.loading) board.tasks.loadMoreDone();
          }}
          ListEmptyComponent={
            <BoardEmptyState
              theme={theme}
              icon={LANE_EMPTY_ICON[lane.id]}
              title={strings.laneEmpty[lane.id]}
              hint={strings.laneEmptyHint[lane.id]}
              narrow
              style={{ marginTop: 36 }}
            />
          }
          ListFooterComponentStyle={props.onBlank ? { flexGrow: 1 } : undefined}
          ListFooterComponent={
            <>
              {/* Both history lanes can have no visible matches while later pages still have some. */}
              {isHistoryLane(lane.id) && (lane.hasMore || lane.loading) ? (
                <LoadMoreRow shown={count} sortedLoadedOnly={sortsLoadedOnly(board.params.sort)} loading={lane.loading} onPress={board.tasks.loadMoreDone} theme={theme} strings={strings} />
              ) : null}
              <LaneFilterHint board={board} lane={lane.id} count={props.hidden} theme={theme} />
              {props.onBlank ? <Pressable accessible={false} {...blankTap.pressIn} onPress={blankTap.tap(props.onBlank)} testID={`lane-blank-${lane.id}`} style={{ flexGrow: 1, minHeight: 48 }} /> : null}
            </>
          }
        />
      )}
    </View>,
  );
}
