import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Animated, Platform, Pressable, ScrollView, Text, View, type FlatList as NativeFlatList, type TextInput as NativeTextInput } from "react-native";
import { FlatList, Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { StatusIcon, TaskDetails } from "../cards";
import { LANE_ORDER, LANE_STATUS, type LaneId, type LaneModel, type TaskCard } from "../model";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { boardColors, MOTION } from "./board-style";
import { CardCell, DashedRule, LoadMoreRow, SkeletonCard, VerticalLabel, useBreathing, useFreshIds } from "./board-parts";
import { DesktopFilterBar, DesktopToolbar, type FilterMenu } from "./filter-bar";
import { buildFilterOptions } from "./filter-options";
import { POPOVER_MAX_HEIGHT, POPOVER_WIDTH, boardKeyReducer, clampFocus, popoverPlacement, type BoardFocus, type Box, type LaneShape } from "./navigation";
import { rememberCollapsed, rememberedCollapsed } from "./params";
import { findCard, type BoardController, type BoardLayoutHandlers } from "./use-board";

const nativeDriver = Platform.OS !== "web";

function measure(node: unknown): Promise<Box | null> {
  const target = node as { measureInWindow?(callback: (x: number, y: number, width: number, height: number) => void): void } | null;
  return new Promise((resolve) => {
    if (!target?.measureInWindow) return resolve(null);
    target.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
  });
}

const Separator = () => <View style={{ height: 8 }} />;

/** The desktop board (prototype 01): the bars, then four lanes that scroll sideways when they do not fit. */
export function DesktopBoard(props: {
  screen: PluginScreenProps;
  board: BoardController;
  rootRef: RefObject<View | null>;
  handlers: RefObject<BoardLayoutHandlers | null>;
}) {
  const { screen, board, rootRef } = props;
  const theme = screen.theme;
  const colors = theme.colors;
  const hostId = screen.host.id;
  const { lanes, tasks, strings } = board;

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
  const cells = useRef(new Map<string, unknown>());
  const register = useCallback((agentId: string, node: unknown) => {
    if (node) cells.current.set(agentId, node);
    else cells.current.delete(agentId);
  }, []);
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
  const gridRef = useRef<View>(null);

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

  // The details popover: the card asks after its hover delay, and says when the pointer left.
  const [popover, setPopover] = useState<{ id: string; x: number; y: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  useEffect(() => clearClose, []);
  const openDetails = useCallback(
    (card: TaskCard) => {
      clearClose();
      void Promise.all([measure(cells.current.get(card.id)), measure(rootRef.current)]).then(([cell, root]) => {
        if (!cell || !root) return;
        setPopover({ id: card.id, ...popoverPlacement(cell, root) });
      });
    },
    [rootRef],
  );
  const closeDetailsSoon = useCallback(() => {
    clearClose();
    closeTimer.current = setTimeout(() => setPopover(null), MOTION.popoverCloseMs);
  }, []);

  const latest = useRef({ board, focus, shapes, menu, popover });
  latest.current = { board, focus, shapes, menu, popover };

  props.handlers.current = {
    reveal(agentId) {
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
    details: openDetails,
    detailsEnd: closeDetailsSoon,
  };

  // Keys on web: J/K, H/L, arrows, Enter, Esc, "/". Only while the board is
  // on screen and focus is not somewhere else in the app.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined" || !board.visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const root = rootRef.current as unknown as HTMLElement | null;
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && root && !root.contains(active)) return;
      const typing = !!active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
      if (typing) {
        if (event.key === "Escape") active.blur();
        return;
      }
      const now = latest.current;
      if (event.key === "Escape" && (now.menu || now.popover)) {
        setMenu(null);
        setPopover(null);
        event.preventDefault();
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
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [board.visible, rootRef]);

  // The dot grid is a CSS background on web; native skips it (one View per dot is too many).
  const dotGrid = boardColors(theme).dotGrid;
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const node = gridRef.current as unknown as HTMLElement | null;
    if (!node?.style) return;
    node.style.backgroundImage = `radial-gradient(${dotGrid} 1px, transparent 1.3px)`;
    node.style.backgroundSize = "16px 16px";
    node.style.backgroundPosition = "8px 8px";
  }, [dotGrid]);

  const breathing = useBreathing(!tasks.ready && board.visible);
  const unfilteredEmpty = tasks.ready && LANE_ORDER.every((id) => tasks.lanes[id].cards.length === 0);
  const popoverCard = popover ? tasks.byId.get(popover.id) : undefined;

  return (
    <View ref={rootRef} collapsable={false} style={{ flex: 1, backgroundColor: colors.surface0 }}>
      <DesktopToolbar board={board} theme={theme} searchRef={searchRef} />
      <DesktopFilterBar board={board} theme={theme} options={options} menu={menu} setMenu={setMenu} />
      <View ref={gridRef} style={{ flex: 1, minHeight: 0 }}>
        <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} showsHorizontalScrollIndicator>
          {LANE_ORDER.map((id, index) => (
            <DesktopLane
              key={id}
              lane={lanes[id]}
              index={index}
              collapsed={collapsed.includes(id)}
              onToggle={() => setCollapsed((current) => (current.includes(id) ? current.filter((lane) => lane !== id) : [...current, id]))}
              board={board}
              theme={theme}
              focusIndex={focus?.lane === id ? focus.index : null}
              listRef={publishList[id]}
              register={register}
              breathing={breathing}
            />
          ))}
        </ScrollView>
        {unfilteredEmpty ? <BoardEmpty board={board} theme={theme} /> : null}
      </View>
      {menu ? (
        <Pressable
          accessibilityLabel="close menu"
          onPress={() => setMenu(null)}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 9 }}
        />
      ) : null}
      {popover && popoverCard ? (
        <Popover
          key={popover.id}
          x={popover.x}
          y={popover.y}
          onEnter={clearClose}
          onLeave={() => setPopover(null)}
        >
          <TaskDetails
            card={popoverCard}
            theme={theme}
            now={board.now}
            onOpen={
              board.callbacks.onOpen
                ? (agentId) => {
                    setPopover(null);
                    board.callbacks.onOpen?.(agentId);
                  }
                : undefined
            }
          />
        </Popover>
      ) : null}
    </View>
  );
}

function Popover(props: { x: number; y: number; onEnter(): void; onLeave(): void; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return;
    const animation = Animated.timing(opacity, { toValue: 1, duration: MOTION.popoverInMs, easing: MOTION.ease, useNativeDriver: nativeDriver });
    animation.start();
    return () => animation.stop();
  }, [opacity, reduced]);
  return (
    <Animated.View
      onPointerEnter={props.onEnter}
      onPointerLeave={props.onLeave}
      style={{ position: "absolute", left: props.x, top: props.y, width: POPOVER_WIDTH, maxHeight: POPOVER_MAX_HEIGHT, zIndex: 60, opacity }}
    >
      {props.children}
    </Animated.View>
  );
}

function BoardEmpty({ board, theme }: { board: BoardController; theme: PluginTheme }) {
  const colors = theme.colors;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: 40, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" }}>
      <View style={{ alignItems: "center", gap: 8, paddingVertical: 20, paddingHorizontal: 28, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface0 }}>
        <Icon name="SquareKanban" size={20} color={colors.foregroundMuted} />
        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{board.strings.boardEmpty}</Text>
        <Text style={{ fontSize: 12, color: colors.foregroundMuted }}>{board.strings.boardEmptyHint}</Text>
      </View>
    </View>
  );
}

function DesktopLane(props: {
  lane: LaneModel;
  index: number;
  collapsed: boolean;
  onToggle(): void;
  board: BoardController;
  theme: PluginTheme;
  focusIndex: number | null;
  listRef(list: NativeFlatList<TaskCard> | null): void;
  register(agentId: string, node: unknown): void;
  breathing: Animated.Value;
}) {
  const { lane, board, theme } = props;
  const colors = theme.colors;
  const strings = board.strings;
  const ready = board.tasks.ready;
  const name = strings.lanes[lane.id];
  const count = lane.cards.length;
  const rule = props.index > 0 ? { borderLeftWidth: 1, borderLeftColor: colors.border } : null;
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

  if (props.collapsed) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${strings.expand}: ${name}`}
        onPress={props.onToggle}
        style={({ pressed }) => [
          rule,
          { width: 40, alignItems: "center", gap: 10, paddingVertical: 12, backgroundColor: pressed ? colors.surface1 : colors.surface0 },
        ]}
      >
        <StatusIcon kind={LANE_STATUS[lane.id]} size={16} theme={theme} />
        <VerticalLabel text={name} color={colors.foreground} language={board.language} />
        <Text style={{ fontSize: 12, color: colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{ready ? count : ""}</Text>
      </Pressable>
    );
  }

  const loadingFirst = !ready || (lane.id === "done" && lane.loading && count === 0);
  return (
    <View style={[rule, { flexGrow: 1, flexShrink: 0, flexBasis: 320, minHeight: 0 }]}>
      <View style={{ height: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 12, paddingRight: 8, backgroundColor: colors.surface0, zIndex: 1 }}>
        <StatusIcon kind={LANE_STATUS[lane.id]} size={16} theme={theme} />
        <Text style={{ fontSize: 13, fontWeight: "500", color: colors.foreground }}>{name}</Text>
        {ready ? (
          <Text style={{ fontSize: 12, color: colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{count}</Text>
        ) : (
          <View style={{ width: 14, height: 10, borderRadius: 2, backgroundColor: colors.surface2 }} />
        )}
        <View style={{ flex: 1 }} />
        {lane.id === "done" ? (
          <Text style={{ marginRight: 4, fontSize: 11, color: colors.foregroundMuted }}>
            {strings.windows[board.params.doneWindow ?? board.defaults.doneWindow]}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.collapse}
          onPress={props.onToggle}
          style={({ pressed }) => ({
            width: 24,
            height: 24,
            borderRadius: 4,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? colors.surface2 : "transparent",
          })}
        >
          <Icon name="FoldHorizontal" size={14} color={colors.foregroundMuted} />
        </Pressable>
        <DashedRule color={colors.border} style={{ position: "absolute", left: 0, right: 0, bottom: 0 }} />
        {props.index > 0 ? (
          <View
            style={{
              position: "absolute",
              left: -4,
              bottom: -3,
              width: 6,
              height: 6,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 1,
              backgroundColor: colors.surface0,
            }}
          />
        ) : null}
      </View>
      {loadingFirst ? (
        <View style={{ padding: 10, gap: 8 }}>
          {[0, 1, 2].map((index) => (
            <SkeletonCard key={index} index={index} theme={theme} opacity={props.breathing} />
          ))}
        </View>
      ) : (
        <FlatList<TaskCard>
          ref={setList}
          data={lane.cards}
          keyExtractor={(card) => card.id}
          extraData={{ now: board.now, focus: props.focusIndex, highlighted: board.highlighted, stop: board.stop, fields: board.fields, fresh }}
          renderItem={({ item, index }) => (
            <CardCell
              card={item}
              fields={board.fields}
              theme={theme}
              compact={false}
              buttons={board.buttonsFor(item)}
              stopPhase={board.stop.phase(item.id)}
              focused={props.focusIndex === index}
              highlighted={board.highlighted === item.id}
              now={board.now}
              callbacks={board.callbacks}
              fresh={fresh.has(item.id)}
              register={props.register}
            />
          )}
          ItemSeparatorComponent={Separator}
          contentContainerStyle={{ padding: 10 }}
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
            <View style={{ height: 64, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: 6, backgroundColor: colors.surface0, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 12, color: colors.foregroundMuted }}>{strings.laneEmpty[lane.id]}</Text>
            </View>
          }
          ListFooterComponent={
            lane.id === "done" && count > 0 && (lane.hasMore || lane.loading) ? (
              <LoadMoreRow shown={count} loading={lane.loading} onPress={board.tasks.loadMoreDone} theme={theme} strings={strings} />
            ) : null
          }
        />
      )}
    </View>
  );
}
