import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState, type RefObject } from "react";
import { Animated, Platform, Pressable, ScrollView, View, type FlatList as NativeFlatList, type TextInput as NativeTextInput } from "react-native";
import { FlatList, Icon, Modal } from "@getpaseo/plugin/client/react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { TaskText as Text, HOST_FONT as F, HOST_LINE, TasksTypography, useTasksFontScale, taskControlHeight } from "../typography";
import { StatusIcon, type CardCallbacks } from "../cards";
import { LANE_ORDER, LANE_STATUS, type LaneId, type LaneModel, type TaskCard } from "../model";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { HAIRLINE, MOTION, PANEL_RADIUS, boardPalette } from "./board-style";
import { LANE_SCROLLBAR_WIDTH, laneScrollProps, useLaneScrollbar } from "./lane-scrollbar";
import { followPointer, resizeHandleProps, resizeIndicatorProps, resizeTrackProps, setResizing, useResizeLine } from "./resize-line";
import { CardCell, HoverPressable, LoadMoreRow, SkeletonCard, VerticalLabel, useBreathing, useFreshIds } from "./board-parts";
import { DesktopFilterBar, DesktopToolbar, KEY_HINTS_MIN_WIDTH, type FilterMenu } from "./filter-bar";
import { buildFilterOptions } from "./filter-options";
import { LANES, boardKeyReducer, clampFocus, laneLayout, type BoardFocus, type LaneShape } from "./navigation";
import { menuChrome } from "./menu-model";
import { DetailsSidebar } from "./details-sidebar";
import { LaneMotionLayer, LaneMotionProvider, useLaneCovered, useLaneMotion, useLaneTarget } from "./lane-motion";
import {
  NO_SELECTION,
  SIDEBAR,
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

const nativeDriver = Platform.OS !== "web";

/** The filter sheet's body inside the host's sheet, as the phone's: the body pads itself and bounds its own scroll. */
const FILTER_SHEET_BODY = { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 16, gap: 0, flex: 1, minHeight: 0 } as const;

const Separator = () => <View style={{ height: 12 }} />;

/**
 * 8 around the cards leaves room for the 3 px focus ring inside the list's clip.
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
function claimKeys(rootRef: RefObject<View | null>): object {
  if (Platform.OS !== "web") return {};
  return {
    tabIndex: -1,
    onPointerDown: (event: { target?: unknown }) => {
      if (typeof document === "undefined") return;
      const root = rootRef.current as unknown as HTMLElement | null;
      const target = event.target as HTMLElement | null;
      if (!root || isTyping(target)) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && root.contains(active)) return;
      root.focus({ preventScroll: true });
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

/** The desktop board (prototype 01): the bars, then four lanes that scroll sideways when they do not fit, and the details sidebar. */
export function DesktopBoard(props: {
  screen: PluginScreenProps;
  board: BoardController;
  rootRef: RefObject<View | null>;
  handlers: RefObject<BoardLayoutHandlers | null>;
}) {
  const { screen, board, rootRef } = props;
  const scale = useTasksFontScale();
  const theme = screen.theme;
  const colors = theme.colors;
  const hostId = screen.host.id;
  const { lanes, tasks, strings } = board;
  useLaneScrollbar(theme);
  useResizeLine(theme);

  const [collapsed, setCollapsedState] = useState<LaneId[]>(() => rememberedCollapsed(hostId));
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
    () => LANE_ORDER.map((id) => ({ id, count: lanes[id].cards.length, collapsed: collapsed.includes(id) })),
    [lanes, collapsed],
  );
  const [focusState, setFocus] = useState<BoardFocus | null>(null);
  const focus = clampFocus(focusState, shapes);
  const [menu, setMenu] = useState<FilterMenu | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const options = useMemo(() => buildFilterOptions(tasks, board.params), [tasks, board.params]);

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
  const sheetRoom = inSheet ? sheetHeight(boardHeight, detent) : 0;
  const panelWidth = sidebarWidth(boardWidth, dragWidth ?? preference.width, floating ? "floating" : "inline");
  const lanesWidth = Math.max(0, boardWidth - (inline ? panelWidth + SIDEBAR.gap : 0));
  const layout = laneLayout(lanesWidth, LANE_ORDER.length - collapsed.length, collapsed.length, board.laneWidth);
  // A floating panel covers the lanes' right side: the row scrolls far enough for the last lane to come out from under it.
  const coverRoom = floating && !inSheet ? panelWidth + SIDEBAR.gap : 0;

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
  const selectedGone = selection.id !== null && tasks.ready && !tasks.byId.has(selection.id);
  useEffect(() => {
    if (selectedGone) dispatch({ type: "clear" });
  }, [selectedGone]);

  const showLane = useCallback(
    (lane: LaneId) => {
      if (collapsed.includes(lane)) setCollapsed((current) => current.filter((id) => id !== lane));
      const index = LANE_ORDER.indexOf(lane);
      const before = LANE_ORDER.slice(0, index).reduce((sum, id) => sum + (collapsed.includes(id) && id !== lane ? LANES.collapsed : layout.laneWidth) + LANES.gap, 0);
      rowRef.current?.scrollTo({ x: Math.max(0, before - LANES.edge), animated: true });
      if (lanes[lane].cards.length > 0) setFocus({ lane, index: 0 });
    },
    [collapsed, setCollapsed, layout.laneWidth, lanes],
  );

  const floatWidth = sidebarWidth(boardWidth, preference.width, "floating");
  const latest = useRef({ board, focus, shapes, menu, selection, floating, open, narrow, preferred: preference.open, toggleSidebar, boardWidth, floatWidth, laneWidth: layout.laneWidth, collapsed });
  latest.current = { board, focus, shapes, menu, selection, floating, open, narrow, preferred: preference.open, toggleSidebar, boardWidth, floatWidth, laneWidth: layout.laneWidth, collapsed };
  const sheetMode = mode === "sheet";
  const sheetModeRef = useRef(sheetMode);
  sheetModeRef.current = sheetMode;
  const rowScrollX = useRef(0);

  // A floating panel lands on the lanes' right side, where the card just
  // clicked may sit: the row scrolls that card's lane out from under it. A
  // sheet covers no lane's side (`cover` 0), but a lane clicked at the
  // board's edge still comes into view whole.
  const uncover = useCallback((lane: LaneId, cover: number) => {
    const now = latest.current;
    const index = LANE_ORDER.indexOf(lane);
    const left = LANES.edge + LANE_ORDER.slice(0, index).reduce((sum, id) => sum + (now.collapsed.includes(id) ? LANES.collapsed : now.laneWidth) + LANES.gap, 0);
    const right = left + now.laneWidth;
    const visible = now.boardWidth - cover;
    const x = rowScrollX.current;
    if (right - x <= visible && left - LANES.edge >= x) return;
    const target = Math.max(0, Math.min(left - LANES.edge, right - visible));
    // After the render that gives the row its room to scroll under the panel.
    setTimeout(() => rowRef.current?.scrollTo({ x: target, animated: true }), 50);
  }, []);

  const reveal = useCallback(
    (agentId: string) => {
      const { board: current } = latest.current;
      const location = findCard(current.lanes, agentId);
      if (!location) {
        if (current.tasks.byId.has(agentId)) current.toastMessage(current.strings.hiddenByFilters);
        else current.tasks.resolveParent(agentId);
        return;
      }
      const wasCollapsed = collapsed.includes(location.lane);
      if (wasCollapsed) setCollapsed((lanesNow) => lanesNow.filter((id) => id !== location.lane));
      setTimeout(() => scrollTo(location.lane, location.index), wasCollapsed ? 50 : 0);
      current.highlight(agentId);
    },
    [collapsed, setCollapsed, scrollTo],
  );

  props.handlers.current = {
    reveal,
    // A long press on a compact or touch card: the same as a click.
    details(card) {
      showCard(card);
    },
  };

  // Only a click or tap puts a card in the sidebar: no hover, no keyboard focus.
  // A put-away sidebar comes up for it on a touch screen, and on a narrow
  // board unless the user switched the sidebar off.
  const showCard = useCallback(
    (card: TaskCard) => {
      dispatch({ type: "click", id: card.id });
      const now = latest.current;
      const show = !now.open && (touch || (now.narrow && now.preferred));
      if (show) setShown("card");
      if (!(now.open || show) || !(now.narrow || !now.preferred)) return;
      if (sheetModeRef.current) {
        // The sheet covers the lanes' lower part: the card's list brings it to the top, above the sheet.
        const location = findCard(now.board.lanes, card.id);
        if (location) setTimeout(() => scrollTo(location.lane, location.index, 0.05), 80);
        uncover(card.lane, LANES.edge);
      } else {
        uncover(card.lane, now.floatWidth + 2 * SIDEBAR.gap);
      }
    },
    [touch, uncover, scrollTo],
  );
  const callbacks = useMemo<CardCallbacks>(() => ({ ...board.callbacks, onSelect: showCard }), [board.callbacks, showCard]);

  // A click or tap on the lanes that no card, button or list takes: the lanes'
  // gaps, a lane's empty space, its header. It lets go of the selected card
  // and the keyboard's. A drag (a scroll) moves too far to count, and a press
  // on a scrollbar, which Chromium sends to the list as well, does not count.
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
      dispatch({ type: "clear" });
      setFocus(null);
      if (latest.current.floating) setShown(null);
    },
    onResponderTerminate: () => {
      blankDown.current = null;
    },
  };

  // Keys on web: J/K, H/L, arrows, Enter, Esc, "/", I (sidebar). Only
  // while the board is on screen and focus is not somewhere else in the app.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined" || !board.visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const root = rootRef.current as unknown as HTMLElement | null;
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && root && !root.contains(active)) return;
      if (isTyping(active)) return;
      const now = latest.current;
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
      if (key === "i" && !event.shiftKey) {
        event.preventDefault();
        now.toggleSidebar();
        return;
      }
      const result = boardKeyReducer(now.focus, event.key, now.shapes);
      if (!result.handled) return;
      event.preventDefault();
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
    // Esc, in the capture phase: React Native Web's TextInput stops it before
    // it bubbles to the document. It disarms an armed stop wherever the
    // keyboard focus is (the board, its search box, the sidebar), and takes
    // the focus out of the board's search box.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.metaKey || event.ctrlKey || event.altKey) return;
      const root = rootRef.current as unknown as HTMLElement | null;
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
    document.addEventListener("keydown", onEscape, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onEscape, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [board.visible, rootRef]);

  const breathing = useBreathing(!tasks.ready && board.visible);
  const reduced = useReducedMotion();
  // Filters, sort and search are the user's: lanes that change with them take their new order at once.
  const motion = useLaneMotion(lanes, { enabled: board.visible && tasks.ready && !reduced, scope: board.params, flights: true });
  const renderCopy = useCallback(
    (card: TaskCard) => <CardCell board={board} card={card} theme={theme} compact={false} fresh={false} copy callbacks={callbacks} />,
    [board, theme, callbacks],
  );
  const unfilteredEmpty = tasks.ready && LANE_ORDER.every((id) => tasks.lanes[id].cards.length === 0);
  const sidebarToggle = { open, onToggle: toggleSidebar, floating };
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
    />
  );

  return (
    <View ref={rootRef} collapsable={false} style={{ flex: 1, backgroundColor: colors.surface0, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null) }} {...claimKeys(rootRef)}>
      <DesktopToolbar
        board={board}
        theme={theme}
        searchRef={searchRef}
        keyHints={boardWidth === 0 || boardWidth >= KEY_HINTS_MIN_WIDTH * Math.max(1, scale)}
        sidebar={sidebarToggle}
        filters={sheetMode ? { count: activeFilterCount(board.params, board.defaults), onPress: () => setFiltersOpen(true) } : undefined}
      />
      {sheetMode ? null : <DesktopFilterBar board={board} theme={theme} options={options} menu={menu} setMenu={setMenu} />}
      {/* A narrow board's filters, sort and lane width, behind the header's one button; the host draws the sheet in its own portal. */}
      <Modal title={strings.filters} open={sheetMode && filtersOpen} onOpenChange={(open) => !open && setFiltersOpen(false)}>
        <Modal.Content contentContainerStyle={FILTER_SHEET_BODY} scrollable={false}>
          <TasksTypography theme={theme}>
            {sheetMode && filtersOpen ? (
              <FilterSheetBody
                board={board}
                theme={theme}
                options={options}
                laneWidth={{ value: board.laneWidth, onChange: board.setLaneWidth }}
                onDone={() => setFiltersOpen(false)}
              />
            ) : null}
          </TasksTypography>
        </Modal.Content>
      </Modal>
      <View
        style={{ flex: 1, minHeight: 0, flexDirection: "row" }}
        onLayout={(event) => {
          setBoardWidth(Math.floor(event.nativeEvent.layout.width));
          setBoardHeight(Math.floor(event.nativeEvent.layout.height));
        }}
      >
        <View style={{ flex: 1, minWidth: 0, minHeight: 0 }} {...blankPress}>
          <LaneMotionProvider value={motion}>
            {boardWidth > 0 ? (
              <ScrollView
                ref={rowRef}
                horizontal
                onScroll={(event) => {
                  rowScrollX.current = event.nativeEvent.contentOffset.x;
                }}
                scrollEventThrottle={32}
                scrollEnabled={layout.scroll || coverRoom > 0}
                showsHorizontalScrollIndicator={layout.scroll || coverRoom > 0}
                style={{ flex: 1 }}
                contentContainerStyle={{ width: layout.contentWidth + coverRoom, gap: LANES.gap, paddingLeft: LANES.edge, paddingRight: LANES.edge + coverRoom, paddingTop: 4, paddingBottom: 12 }}
              >
                {LANE_ORDER.map((id) => (
                  <DesktopLane
                    key={id}
                    lane={lanes[id]}
                    width={layout.laneWidth}
                    collapsed={collapsed.includes(id)}
                    onToggle={() => setCollapsed((current) => (current.includes(id) ? current.filter((lane) => lane !== id) : [...current, id]))}
                    board={board}
                    callbacks={callbacks}
                    theme={theme}
                    focusIndex={focus?.lane === id ? focus.index : null}
                    currentId={open ? selection.id : null}
                    listRef={publishList[id]}
                    breathing={breathing}
                    bottomRoom={sheetRoom}
                  />
                ))}
              </ScrollView>
            ) : null}
            <LaneMotionLayer store={motion} renderCard={renderCopy} />
          </LaneMotionProvider>
          {unfilteredEmpty ? <BoardEmpty board={board} theme={theme} /> : null}
        </View>
        {inline ? (
          <SidebarColumn width={panelWidth} theme={theme} onDrag={setDragWidth} onResize={(width) => setPreference((current) => ({ ...current, width }))}>
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
          <FloatingSidebar width={panelWidth} theme={theme}>
            {sidebar}
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
    </View>
  );
}

/**
 * The inline sidebar: a column at the board's right, 12 from its edge, its
 * left gap a drag handle on web drawn as Linear's split line. A drag
 * resizes the column and the lanes as it goes, at most once a frame; the
 * release keeps the width. A double click puts 380 back.
 */
function SidebarColumn(props: { width: number; theme: PluginTheme; onDrag(width: number | null): void; onResize(width: number): void; children: React.ReactNode }) {
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
    let frame = 0;
    const move = (moved: PointerEvent) => {
      width = clampWidth(width0 + (x0 - moved.pageX));
      follow(moved.clientY);
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
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
      {...({ onPointerDown: start, onPointerMove: (event: { nativeEvent: { clientY: number } }) => follow(event.nativeEvent.clientY) } as object)}
      style={{ position: "absolute", left: -SIDEBAR.gap, top: 4, bottom: 12, width: SIDEBAR.gap, zIndex: 5, ...({ cursor: "col-resize", touchAction: "none" } as object) }}
      testID="sidebar-resize"
    >
      <View {...resizeTrackProps} pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, left: SIDEBAR.gap / 2 - 0.5, width: 1, overflow: "hidden" }}>
        <View ref={indicatorRef} {...resizeIndicatorProps} style={{ position: "absolute", top: "-50%", height: "200%", left: 0, right: 0 }} />
      </View>
    </View>
  ) : null;
  return (
    <View style={{ width: props.width, marginRight: SIDEBAR.gap, paddingTop: 4, paddingBottom: 12, minHeight: 0 }} testID="sidebar-inline">
      {handle}
      <FadeIn>{props.children}</FadeIn>
    </View>
  );
}

/** A narrow board's sidebar: over the lanes' right side, on the board's surface with the menus' shadow. */
function FloatingSidebar(props: { width: number; theme: PluginTheme; children: React.ReactNode }) {
  const chrome = menuChrome(props.theme);
  const reduced = useReducedMotion();
  const x = useRef(new Animated.Value(reduced ? 0 : 24)).current;
  const opacity = useRef(new Animated.Value(reduced ? 1 : 0)).current;
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
        right: SIDEBAR.gap,
        bottom: 12,
        width: props.width,
        padding: 8,
        borderRadius: 16,
        borderWidth: HAIRLINE,
        borderColor: chrome.border,
        backgroundColor: boardPalette(props.theme).panel,
        boxShadow: chrome.shadow,
        zIndex: 20,
        opacity,
        transform: [{ translateX: x }],
      } as object}
    >
      {props.children}
    </Animated.View>
  );
}

/** The inline sidebar comes in over 180 ms, 12 from the right; the lanes take their width at once. */
function FadeIn(props: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const x = useRef(new Animated.Value(reduced ? 0 : 12)).current;
  const opacity = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return;
    const animation = Animated.parallel([
      Animated.timing(x, { toValue: 0, duration: 180, easing: MOTION.ease, useNativeDriver: nativeDriver }),
      Animated.timing(opacity, { toValue: 1, duration: 180, easing: MOTION.ease, useNativeDriver: nativeDriver }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [x, opacity, reduced]);
  return <Animated.View style={{ flex: 1, minHeight: 0, opacity, transform: [{ translateX: x }] }}>{props.children}</Animated.View>;
}

function BoardEmpty({ board, theme }: { board: BoardController; theme: PluginTheme }) {
  const colors = theme.colors;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: 40, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" }}>
      <View style={{ alignItems: "center", gap: 8, paddingVertical: 20, paddingHorizontal: 28, borderWidth: HAIRLINE, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface0 }}>
        <Icon name="SquareKanban" size={20} color={colors.foregroundMuted} />
        <Text style={{ fontSize: F.base, fontWeight: "600", color: colors.foreground }}>{board.strings.boardEmpty}</Text>
        <Text style={{ fontSize: F.sm, color: colors.foregroundMuted }}>{board.strings.boardEmptyHint}</Text>
      </View>
    </View>
  );
}

/** A list under copies of its cards while they move (native lane motion). */
const HIDDEN = { opacity: 0 };

/** A list's scrolling node: the element on the web, the native scroll view's instance elsewhere. */
function scrollNode(list: NativeFlatList<TaskCard> | null): unknown {
  const scroller = list as unknown as { getScrollableNode?(): unknown; getNativeScrollRef?(): unknown } | null;
  return Platform.OS === "web" ? scroller?.getScrollableNode?.() : scroller?.getNativeScrollRef?.();
}

function DesktopLane(props: {
  lane: LaneModel;
  width: number;
  collapsed: boolean;
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
}) {
  const { lane, board, theme } = props;
  const scale = useTasksFontScale();
  const colors = theme.colors;
  const palette = boardPalette(theme);
  const strings = board.strings;
  const ready = board.tasks.ready;
  const name = strings.lanes[lane.id];
  const count = lane.cards.length;
  const fresh = useFreshIds(
    lane.cards.map((card) => card.id),
    ready,
    board.params,
  );
  const listRef = useRef<NativeFlatList<TaskCard> | null>(null);
  const pillRef = useRef<View | null>(null);
  // Cards that change lanes fly to the list, or to the pill of a collapsed lane.
  useLaneTarget(lane.id, () => (props.collapsed ? pillRef.current : scrollNode(listRef.current)));
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
  const { highlighted, stop, fields } = board;
  const extraData = useMemo(() => ({ focusIndex, highlighted, stop, fields, fresh, currentId }), [focusIndex, highlighted, stop, fields, fresh, currentId]);
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

  if (props.collapsed) {
    return (
      <HoverPressable
        ref={pillRef}
        accessibilityRole="button"
        accessibilityLabel={`${strings.expand}: ${name}`}
        onPress={props.onToggle}
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
        <Text style={{ fontSize: F.sm, color: colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{ready ? count : ""}</Text>
      </HoverPressable>
    );
  }

  const loadingFirst = !ready || (lane.id === "done" && lane.loading && count === 0);
  return (
    <View style={{ width: props.width, minHeight: 0, borderRadius: PANEL_RADIUS, backgroundColor: palette.panel, overflow: "hidden" }}>
      <View style={{ height: taskControlHeight(40, scale), flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 14, paddingRight: 8 }}>
        <StatusIcon kind={LANE_STATUS[lane.id]} size={14} theme={theme} animated={board.visible} />
        <Text style={{ fontSize: F.sm, fontWeight: "500", color: colors.foreground }}>{name}</Text>
        {ready ? (
          <Text style={{ fontSize: F.sm, color: colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{count}</Text>
        ) : (
          <View style={{ width: 14, height: 10, borderRadius: 2, backgroundColor: colors.surface2 }} />
        )}
        <View style={{ flex: 1 }} />
        {lane.id === "done" ? (
          <Text style={{ fontSize: F.sm, color: colors.foregroundMuted }}>{strings.windows[board.params.doneWindow ?? board.defaults.doneWindow]}</Text>
        ) : null}
        <HoverPressable
          accessibilityRole="button"
          accessibilityLabel={strings.collapse}
          onPress={props.onToggle}
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
      </View>
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
          contentContainerStyle={{ ...LANE_PAD, paddingTop: 2, paddingBottom: 8 + props.bottomRoom }}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
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
            if (lane.id === "done" && lane.hasMore && !lane.loading) board.tasks.loadMoreDone();
          }}
          ListEmptyComponent={
            <View style={{ height: 64, borderWidth: HAIRLINE, borderStyle: "dashed", borderColor: colors.border, borderRadius: PANEL_RADIUS, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: F.sm, color: colors.foregroundMuted }}>{strings.laneEmpty[lane.id]}</Text>
            </View>
          }
          ListFooterComponent={
            lane.id === "done" && count > 0 && (lane.hasMore || lane.loading) ? (
              <LoadMoreRow shown={count} sortedLoadedOnly={sortsLoadedOnly(board.params.sort)} loading={lane.loading} onPress={board.tasks.loadMoreDone} theme={theme} strings={strings} />
            ) : null
          }
        />
      )}
    </View>
  );
}
