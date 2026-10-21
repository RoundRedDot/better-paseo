import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState, type RefObject } from "react";
import { Animated, Platform, Pressable, ScrollView, View, type FlatList as NativeFlatList, type TextInput as NativeTextInput } from "react-native";
import { FlatList, Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { TaskText as Text, useTasksFontScale, taskControlHeight } from "../typography";
import { StatusIcon, type CardCallbacks } from "../cards";
import { LANE_ORDER, LANE_STATUS, type LaneId, type LaneModel, type TaskCard } from "../model";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { HAIRLINE, MOTION, PANEL_RADIUS, boardPalette } from "./board-style";
import { LANE_SCROLLBAR_WIDTH, laneScrollProps, useLaneScrollbar } from "./lane-scrollbar";
import { CardCell, HoverPressable, LoadMoreRow, SkeletonCard, VerticalLabel, useBreathing, useFreshIds } from "./board-parts";
import { DesktopFilterBar, DesktopToolbar, KEY_HINTS_MIN_WIDTH, type FilterMenu } from "./filter-bar";
import { buildFilterOptions } from "./filter-options";
import { LANES, boardKeyReducer, clampFocus, laneLayout, type BoardFocus, type LaneShape } from "./navigation";
import { menuChrome } from "./menu-model";
import { DetailsSidebar } from "./details-sidebar";
import {
  NO_SELECTION,
  SIDEBAR,
  clampWidth,
  escapeStep,
  readSidebarPreference,
  selectionReducer,
  sidebarMode,
  sidebarWidth,
  writeSidebarPreference,
  type SidebarMode,
  type SidebarPreference,
} from "./sidebar-model";
import { rememberCollapsed, rememberedCollapsed } from "./params";
import { sortsLoadedOnly } from "./sort";
import { findCard, type BoardController, type BoardLayoutHandlers } from "./use-board";

const nativeDriver = Platform.OS !== "web";

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
  const options = useMemo(() => buildFilterOptions(tasks, board.params), [tasks, board.params]);

  const listRefs = useRef<Partial<Record<LaneId, NativeFlatList<TaskCard> | null>>>({});
  // One stable ref callback per lane, so a lane's list is not re-attached on every render.
  const publishList = useMemo(() => {
    const out = {} as Record<LaneId, (list: NativeFlatList<TaskCard> | null) => void>;
    for (const id of LANE_ORDER) {
      out[id] = (list) => {
        listRefs.current[id] = list;
      };
    }
    return out;
  }, []);
  const searchRef = useRef<NativeTextInput>(null);
  const rowRef = useRef<ScrollView | null>(null);

  // The sidebar: open and width as the user left them; inline on a wide
  // board, floating over its right side on a narrow one. On a touch screen a
  // tap on a card shows a closed sidebar for the moment, as a floating panel.
  const touch = Platform.OS !== "web";
  const [preference, setPreferenceState] = useState<SidebarPreference>(readSidebarPreference);
  const setPreference = useCallback((update: (current: SidebarPreference) => SidebarPreference) => {
    setPreferenceState((current) => {
      const next = update(current);
      writeSidebarPreference(next);
      return next;
    });
  }, []);
  const [shownForTap, setShownForTap] = useState(false);
  const [selection, dispatch] = useReducer(selectionReducer, NO_SELECTION);
  const [boardWidth, setBoardWidth] = useState(0);
  const modeRef = useRef<SidebarMode | null>(null);
  const mode = boardWidth > 0 ? sidebarMode(boardWidth, modeRef.current) : modeRef.current ?? "inline";
  modeRef.current = boardWidth > 0 ? mode : modeRef.current;
  const open = preference.open || shownForTap;
  const floating = open && (mode === "floating" || (!preference.open && shownForTap));
  const inline = open && !floating;
  const panelWidth = sidebarWidth(boardWidth, preference.width, floating ? "floating" : "inline");
  const lanesWidth = Math.max(0, boardWidth - (inline ? panelWidth + SIDEBAR.gap : 0));
  const layout = laneLayout(lanesWidth, LANE_ORDER.length - collapsed.length, collapsed.length);
  // A floating panel covers the lanes' right side: the row scrolls far enough for the last lane to come out from under it.
  const coverRoom = floating ? panelWidth + SIDEBAR.gap : 0;

  const toggleSidebar = useCallback(() => {
    if (shownForTap) {
      setShownForTap(false);
      return;
    }
    setPreference((current) => ({ ...current, open: !current.open }));
  }, [shownForTap, setPreference]);

  const scrollTo = useCallback((lane: LaneId, index: number) => {
    const list = listRefs.current[lane];
    try {
      list?.scrollToIndex({ index, viewPosition: 0.3, animated: true });
    } catch {
      // Not laid out yet; `onScrollToIndexFailed` retries.
    }
  }, []);
  const focusLane = focus?.lane ?? null;
  const focusIndex = focus?.index ?? -1;
  useEffect(() => {
    if (focusLane) scrollTo(focusLane, focusIndex);
  }, [focusLane, focusIndex, scrollTo]);

  // The keyboard's card is the sidebar's while nothing is pinned.
  const focusedId = focusLane ? lanes[focusLane].cards[focusIndex]?.id ?? null : null;
  useEffect(() => {
    if (focusedId && open) dispatch({ type: "focus", id: focusedId });
  }, [focusedId, open]);
  // A panel a tap showed goes once its card is closed.
  useEffect(() => {
    if (shownForTap && selection.id === null) setShownForTap(false);
  }, [shownForTap, selection.id]);
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

  const latest = useRef({ board, focus, shapes, menu, selection, floating, open, focusedId, toggleSidebar });
  latest.current = { board, focus, shapes, menu, selection, floating, open, focusedId, toggleSidebar };

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
    // A hover of 150 ms: the inline sidebar follows it; a floating one changes only on a click or a key.
    details(card) {
      const now = latest.current;
      if (now.open && !now.floating) dispatch({ type: "hover", id: card.id });
    },
  };

  const callbacks = useMemo<CardCallbacks>(
    () => ({
      ...board.callbacks,
      onSelect: (card) => {
        dispatch({ type: "click", id: card.id });
        if (touch && !latest.current.open) setShownForTap(true);
      },
    }),
    [board.callbacks, touch],
  );

  // Keys on web: J/K, H/L, arrows, Enter, Esc, "/", I (sidebar), P (pin). Only
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
          else if (step === "unpin") dispatch({ type: "unpin" });
          else now.toggleSidebar();
          return;
        }
      }
      const key = event.key.toLowerCase();
      if (key === "i" && !event.shiftKey) {
        event.preventDefault();
        now.toggleSidebar();
        return;
      }
      if (key === "p" && !event.shiftKey) {
        event.preventDefault();
        dispatch({ type: "togglePin", id: now.selection.pinned ? now.selection.id : now.focusedId ?? now.selection.id });
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
    />
  );

  return (
    <View ref={rootRef} collapsable={false} style={{ flex: 1, backgroundColor: colors.surface0 }}>
      <DesktopToolbar
        board={board}
        theme={theme}
        searchRef={searchRef}
        keyHints={boardWidth === 0 || boardWidth >= KEY_HINTS_MIN_WIDTH * Math.max(1, scale)}
        sidebar={sidebarToggle}
      />
      <DesktopFilterBar board={board} theme={theme} options={options} menu={menu} setMenu={setMenu} />
      <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }} onLayout={(event) => setBoardWidth(Math.floor(event.nativeEvent.layout.width))}>
        <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          {boardWidth > 0 ? (
            <ScrollView
              ref={rowRef}
              horizontal
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
                  pinned={selection.pinned}
                  listRef={publishList[id]}
                  breathing={breathing}
                />
              ))}
            </ScrollView>
          ) : null}
          {unfilteredEmpty ? <BoardEmpty board={board} theme={theme} /> : null}
        </View>
        {inline ? (
          <SidebarColumn width={panelWidth} theme={theme} onResize={(width) => setPreference((current) => ({ ...current, width }))}>
            {sidebar}
          </SidebarColumn>
        ) : null}
        {floating ? (
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
 * left gap a drag handle on web. A drag moves a preview line only; the lanes
 * take the new width once, on release. A double click puts 380 back.
 */
function SidebarColumn(props: { width: number; theme: PluginTheme; onResize(width: number): void; children: React.ReactNode }) {
  const colors = props.theme.colors;
  const [drag, setDrag] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const lastDown = useRef(0);
  const start = (event: { nativeEvent: { pageX: number } }) => {
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
    setDrag(width0);
    const move = (moved: PointerEvent) => {
      width = clampWidth(width0 + (x0 - moved.pageX));
      setDrag(width);
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      setDrag(null);
      if (width !== width0) props.onResize(width);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };
  const handle = Platform.OS === "web" ? (
    <View
      // A 12 wide strip in the gap before the sidebar.
      {...({ onPointerDown: start, onPointerEnter: () => setHovered(true), onPointerLeave: () => setHovered(false) } as object)}
      style={{ position: "absolute", left: -SIDEBAR.gap, top: 4, bottom: 12, width: SIDEBAR.gap, alignItems: "center", ...({ cursor: "col-resize" } as object) }}
      testID="sidebar-resize"
    >
      <View style={{ width: 2, height: "100%", borderRadius: 1, backgroundColor: drag !== null ? colors.accent : hovered ? colors.border : "transparent" }} />
    </View>
  ) : null;
  return (
    <View style={{ width: props.width, marginRight: SIDEBAR.gap, paddingTop: 4, paddingBottom: 12, minHeight: 0 }} testID="sidebar-inline">
      {handle}
      {drag !== null && drag !== props.width ? (
        <View pointerEvents="none" style={{ position: "absolute", left: props.width - drag - SIDEBAR.gap / 2 - 1, top: 4, bottom: 12, width: 2, borderRadius: 1, backgroundColor: colors.accent, zIndex: 5 }} />
      ) : null}
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
        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{board.strings.boardEmpty}</Text>
        <Text style={{ fontSize: 12, color: colors.foregroundMuted }}>{board.strings.boardEmptyHint}</Text>
      </View>
    </View>
  );
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
  /** The card the sidebar shows, and whether it is pinned. */
  currentId: string | null;
  pinned: boolean;
  listRef(list: NativeFlatList<TaskCard> | null): void;
  breathing: Animated.Value;
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
  );
  const listRef = useRef<NativeFlatList<TaskCard> | null>(null);
  const { listRef: publish } = props;
  const setList = useCallback(
    (list: NativeFlatList<TaskCard> | null) => {
      listRef.current = list;
      publish(list);
    },
    [publish],
  );
  // No clock in here: a tick reaches the timer texts, not the list and its rows.
  const { focusIndex, currentId, pinned, callbacks } = props;
  const { highlighted, stop, fields } = board;
  const extraData = useMemo(() => ({ focusIndex, highlighted, stop, fields, fresh, currentId, pinned }), [focusIndex, highlighted, stop, fields, fresh, currentId, pinned]);
  const renderItem = useCallback(
    ({ item, index }: { item: TaskCard; index: number }) => (
      <CardCell
        board={board}
        card={item}
        theme={theme}
        compact={false}
        focused={focusIndex === index}
        current={currentId === item.id}
        pinned={pinned && currentId === item.id}
        fresh={fresh.has(item.id)}
        callbacks={callbacks}
      />
    ),
    [board, theme, focusIndex, currentId, pinned, fresh, callbacks],
  );

  if (props.collapsed) {
    return (
      <HoverPressable
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
        <Text style={{ fontSize: 13, color: colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{ready ? count : ""}</Text>
      </HoverPressable>
    );
  }

  const loadingFirst = !ready || (lane.id === "done" && lane.loading && count === 0);
  return (
    <View style={{ width: props.width, minHeight: 0, borderRadius: PANEL_RADIUS, backgroundColor: palette.panel, overflow: "hidden" }}>
      <View style={{ height: taskControlHeight(40, scale), flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 14, paddingRight: 8 }}>
        <StatusIcon kind={LANE_STATUS[lane.id]} size={14} theme={theme} animated={board.visible} />
        <Text style={{ fontSize: 14, fontWeight: "500", color: colors.foreground }}>{name}</Text>
        {ready ? (
          <Text style={{ fontSize: 14, color: colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{count}</Text>
        ) : (
          <View style={{ width: 14, height: 10, borderRadius: 2, backgroundColor: colors.surface2 }} />
        )}
        <View style={{ flex: 1 }} />
        {lane.id === "done" ? (
          <Text style={{ fontSize: 12, color: colors.foregroundMuted }}>{strings.windows[board.params.doneWindow ?? board.defaults.doneWindow]}</Text>
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
          data={lane.cards}
          keyExtractor={(card) => card.id}
          extraData={extraData}
          renderItem={renderItem}
          ItemSeparatorComponent={Separator}
          contentContainerStyle={{ ...LANE_PAD, paddingTop: 2, paddingBottom: 8 }}
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
              <Text style={{ fontSize: 13, color: colors.foregroundMuted }}>{strings.laneEmpty[lane.id]}</Text>
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
