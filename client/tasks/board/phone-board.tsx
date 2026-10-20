import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Animated,
  Platform,
  Pressable,
  Text,
  View,
  type FlatList as NativeFlatList,
  type ScrollView as NativeScrollView,
  type LayoutChangeEvent,
} from "react-native";
import { FlatList, Icon, Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { StatusIcon, TaskDetails, taskTokens, type CardCallbacks } from "../cards";
import { LANE_ORDER, LANE_STATUS, type LaneId, type LaneModel, type TaskCard } from "../model";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { holdHostGestures } from "../../ui/hold-host-gestures";
import { HAIRLINE, MOTION, boardPalette } from "./board-style";
import { CardCell, LoadMoreRow, SkeletonCard, WindowSegments, useBreathing, useFreshIds } from "./board-parts";
import { buildFilterOptions, clearedParams } from "./filter-options";
import { FilterSheetBody } from "./filter-sheet";
import { claimsSwipe, defaultLane, laneAfter, swallowsTap, swipeStep, tabUnderline, tabsOverflow, type TabBox } from "./navigation";
import { activeFilterCount, rememberLane, rememberedLane, resolveBoardParams } from "./params";
import { LANE_EMPTY_ICON, sortLabel } from "./strings";
import { sortsLoadedOnly } from "./sort";
import { findCard, type BoardController, type BoardLayoutHandlers } from "./use-board";

const nativeDriver = Platform.OS !== "web";
const Separator = () => <View style={{ height: 12 }} />;
/** The underline is drawn this wide and scaled to its label. */
const UNDERLINE_BASE = 100;

/** A touch (native) or pointer (web) event; both carry page coordinates. */
type PointEvent = { nativeEvent: { pageX: number; pageY: number } };
const point = (event: PointEvent) => ({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY });

// The sheet's safe area is the host's; the bodies pad themselves.
const SHEET_BODY = { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 16, gap: 0 } as const;
// The filters bound their own scroll so their button stays pinned (FilterSheetBody).
const SHEET_FILTER_BODY = { ...SHEET_BODY, flex: 1, minHeight: 0 } as const;

type Sheet = { kind: "filters" } | { kind: "details"; id: string } | null;

/** The phone board (prototype 04): one lane at a time behind a tab bar, swiped or tapped. */
export function PhoneBoard(props: {
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
  const reduced = useReducedMotion();

  const [chosen, setChosen] = useState<LaneId | null>(() => rememberedLane(hostId));
  const lane = defaultLane(lanes.needs_input.cards.length, chosen);
  const laneIndex = LANE_ORDER.indexOf(lane);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const options = useMemo(() => buildFilterOptions(tasks, board.params), [tasks, board.params]);
  const badge = activeFilterCount(board.params, board.defaults);
  const doneWindow = resolveBoardParams(board.params, board.defaults).doneWindow;

  // The tabs: a quarter of the bar each, or as wide as their content when a
  // large system font outgrows a quarter, the bar then scrolling sideways.
  // The underline is one bar sliding under the active tab's label and count,
  // measured; a quarter less 24, centred, until the tab is laid out.
  const [barWidth, setBarWidth] = useState(0);
  const [boxes, setBoxes] = useState<Partial<Record<LaneId, TabBox>>>({});
  const measureTab = useCallback((id: LaneId, part: keyof TabBox, layout: { x: number; width: number }) => {
    setBoxes((current) => {
      const box = current[id] ?? {};
      const was = box[part];
      if (was && was.x === layout.x && was.width === layout.width) return current;
      return { ...current, [id]: { ...box, [part]: { x: layout.x, width: layout.width } } };
    });
  }, []);
  const overflowing = tabsOverflow(boxes, barWidth);
  const span = tabUnderline(boxes[lane], laneIndex, barWidth);
  const underlineX = useRef(new Animated.Value(0)).current;
  const underlineScale = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);
  const tabsRef = useRef<NativeScrollView | null>(null);
  useEffect(() => {
    if (!span) return;
    const x = span.center - UNDERLINE_BASE / 2;
    const scale = span.width / UNDERLINE_BASE;
    // Jump into place until the first measured placement; slide after it.
    if (!placed.current || reduced) {
      placed.current = span.measured;
      underlineX.setValue(x);
      underlineScale.setValue(scale);
      return;
    }
    const timing = (value: Animated.Value, toValue: number) =>
      Animated.timing(value, { toValue, duration: MOTION.laneMs, easing: MOTION.ease, useNativeDriver: nativeDriver });
    const animation = Animated.parallel([timing(underlineX, x), timing(underlineScale, scale)]);
    animation.start();
    return () => animation.stop();
  }, [span?.center, span?.width, span?.measured, reduced, underlineX, underlineScale]);
  const activeTabX = boxes[lane]?.tab?.x;
  useEffect(() => {
    if (overflowing && activeTabX !== undefined) tabsRef.current?.scrollTo?.({ x: Math.max(0, activeTabX - 16), animated: !reduced });
  }, [overflowing, activeTabX, reduced]);

  // The content switch: the old lane fades out moving 24 (120 ms) while the new one comes in from the other side (200 ms).
  const enterOpacity = useRef(new Animated.Value(1)).current;
  const enterX = useRef(new Animated.Value(0)).current;
  const leaveOpacity = useRef(new Animated.Value(0)).current;
  const leaveX = useRef(new Animated.Value(0)).current;
  const [leaving, setLeaving] = useState<{ lane: LaneId; cards: TaskCard[] } | null>(null);
  const select = useCallback(
    (next: LaneId) => {
      const from = defaultLane(board.lanes.needs_input.cards.length, chosen);
      rememberLane(hostId, next);
      setChosen(next);
      if (next === from || reduced) return;
      const direction = LANE_ORDER.indexOf(next) > LANE_ORDER.indexOf(from) ? 1 : -1;
      setLeaving({ lane: from, cards: board.lanes[from].cards.slice(0, 6) });
      leaveOpacity.setValue(1);
      leaveX.setValue(0);
      enterOpacity.setValue(0);
      enterX.setValue(direction * MOTION.laneShift);
      Animated.parallel([
        Animated.timing(leaveOpacity, { toValue: 0, duration: MOTION.laneOutMs, easing: MOTION.ease, useNativeDriver: nativeDriver }),
        Animated.timing(leaveX, { toValue: -direction * MOTION.laneShift, duration: MOTION.laneOutMs, easing: MOTION.ease, useNativeDriver: nativeDriver }),
        Animated.timing(enterOpacity, { toValue: 1, duration: MOTION.laneMs, easing: MOTION.ease, useNativeDriver: nativeDriver }),
        Animated.timing(enterX, { toValue: 0, duration: MOTION.laneMs, easing: MOTION.ease, useNativeDriver: nativeDriver }),
      ]).start(() => setLeaving(null));
    },
    [board.lanes, chosen, hostId, reduced, enterOpacity, enterX, leaveOpacity, leaveX],
  );

  // Swipes: a horizontal travel of 56 that beats 1.5x the vertical; taps right after one are swallowed.
  // On iOS and Android the touch is claimed from the host's pans (the swipe
  // that opens the agent list activates at 15) once it is clearly
  // horizontal, and when a long press opens a card's details: the drag that
  // follows must not open the drawer, nor switch the lane under the sheet.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const swipedAt = useRef<number | null>(null);
  const claimed = useRef<(() => void) | null>(null);
  const heldForDetails = useRef(false);
  const gridRef = useRef<View>(null);
  const latest = useRef({ lane, select });
  latest.current = { lane, select };
  const claim = useCallback(() => {
    if (Platform.OS === "web" || claimed.current) return;
    claimed.current = holdHostGestures(gridRef.current);
  }, []);
  const release = useCallback(() => {
    const letGo = claimed.current;
    claimed.current = null;
    letGo?.();
  }, []);
  useEffect(() => release, [release]);
  const onStart = useCallback((event: PointEvent) => {
    swipeStart.current = point(event);
    heldForDetails.current = false;
  }, []);
  const onMove = useCallback((event: PointEvent) => {
    const start = swipeStart.current;
    if (!start) return;
    const at = point(event);
    if (claimsSwipe(at.x - start.x, at.y - start.y)) claim();
    if (!heldForDetails.current && swipeStep(at.x - start.x, at.y - start.y) !== 0) swipedAt.current = Date.now();
  }, [claim]);
  const onEnd = useCallback((event: PointEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    release();
    if (!start || heldForDetails.current) return;
    const at = point(event);
    const step = swipeStep(at.x - start.x, at.y - start.y);
    if (step === 0) return;
    swipedAt.current = Date.now();
    const next = laneAfter(latest.current.lane, step);
    if (next) latest.current.select(next);
  }, [release]);
  const onCancel = useCallback(() => {
    swipeStart.current = null;
    release();
  }, [release]);
  const gesture =
    Platform.OS === "web"
      ? { onPointerDown: onStart, onPointerMove: onMove, onPointerUp: onEnd, onPointerCancel: onCancel }
      : { onTouchStart: onStart, onTouchMove: onMove, onTouchEnd: onEnd, onTouchCancel: onCancel };

  const callbacks = useMemo<CardCallbacks>(() => {
    const base = board.callbacks;
    const guard =
      <Args extends unknown[]>(run: ((...args: Args) => void) | undefined) =>
      (...args: Args) => {
        if (!swallowsTap(swipedAt.current, Date.now())) run?.(...args);
      };
    return {
      onOpen: base.onOpen ? guard(base.onOpen) : undefined,
      onReveal: guard(base.onReveal),
      onStop: guard(base.onStop),
      onCancelStop: base.onCancelStop,
      onPermission: guard(base.onPermission),
      onDetails: guard((card: TaskCard) => {
        // A long press: the finger is still down.
        if (swipeStart.current) {
          heldForDetails.current = true;
          claim();
        }
        base.onDetails?.(card);
      }),
    };
  }, [board.callbacks, claim]);

  const listRef = useRef<NativeFlatList<TaskCard> | null>(null);
  props.handlers.current = {
    reveal(agentId) {
      const location = findCard(board.lanes, agentId);
      if (!location) {
        if (tasks.byId.has(agentId)) board.toastMessage(strings.hiddenByFilters);
        else tasks.resolveParent(agentId);
        return;
      }
      const switching = location.lane !== lane;
      if (switching) select(location.lane);
      setTimeout(
        () => {
          try {
            listRef.current?.scrollToIndex({ index: location.index, viewPosition: 0, viewOffset: 12, animated: true });
          } catch {
            // Laid out later; the highlight still marks it.
          }
          board.highlight(agentId);
        },
        switching && !reduced ? MOTION.laneMs + 20 : 0,
      );
    },
    details(card) {
      setSheet({ kind: "details", id: card.id });
    },
  };

  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const node = gridRef.current as unknown as HTMLElement | null;
    // Vertical scrolling stays the browser's; horizontal travel is the lane swipe.
    if (node?.style) node.style.touchAction = "pan-y";
  }, []);
  const palette = boardPalette(theme);

  const breathing = useBreathing(!tasks.ready && board.visible);
  const detailsCard = sheet?.kind === "details" ? tasks.byId.get(sheet.id) : undefined;
  const warning = taskTokens(theme).status.warning;

  return (
    <View ref={rootRef} collapsable={false} style={{ flex: 1, backgroundColor: colors.surface0 }}>
      <View style={{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 16, paddingRight: 6 }}>
        <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 17, fontWeight: "600", color: colors.foreground, fontVariant: ["tabular-nums"] }}>
          {strings.total(board.total)}
        </Text>
        {board.params.sort ? (
          // A non-default sort says so, as the desktop sort button's label does; it opens the sheet.
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${strings.sort}: ${sortLabel(board.params.sort, strings)}`}
            onPress={() => setSheet({ kind: "filters" })}
            testID="phone-sort-hint"
            style={{
              flexShrink: 1,
              minHeight: 28,
              marginLeft: 4,
              paddingHorizontal: 10,
              borderRadius: 14,
              borderWidth: HAIRLINE,
              borderColor: colors.border,
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
            }}
          >
            <Icon name="ArrowUpDown" size={13} color={colors.foregroundMuted} />
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, fontWeight: "500", color: colors.foreground }}>
              {sortLabel(board.params.sort, strings)}
            </Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }} />
        <RoundButton
          icon="Search"
          label={strings.searchButton}
          active={searchOpen || board.params.query !== ""}
          theme={theme}
          onPress={() => setSearchOpen((open) => !open)}
        />
        <RoundButton icon="SlidersHorizontal" label={strings.filters} theme={theme} badge={badge} onPress={() => setSheet({ kind: "filters" })} />
      </View>
      {searchOpen || board.params.query ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <View style={{ minHeight: 36, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, borderWidth: HAIRLINE, borderColor: colors.border, borderRadius: 18 }}>
            <Icon name="Search" size={15} color={colors.foregroundMuted} />
            <TextInput
              autoFocus={searchOpen && !board.params.query}
              value={board.params.query}
              onChangeText={(query) => board.setParams((params) => ({ ...params, query }))}
              placeholder={strings.search}
              placeholderTextColor={colors.foregroundMuted}
              accessibilityLabel={strings.search}
              returnKeyType="search"
              style={{ flex: 1, minWidth: 0, padding: 0, fontSize: 15, color: colors.foreground }}
            />
          </View>
        </View>
      ) : null}
      <View
        onLayout={(event: LayoutChangeEvent) => setBarWidth(event.nativeEvent.layout.width)}
        style={{ borderBottomWidth: HAIRLINE, borderBottomColor: colors.border, zIndex: 5, backgroundColor: colors.surface0 }}
      >
        <ScrollView
          ref={tabsRef}
          horizontal
          scrollEnabled={overflowing}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1, minWidth: barWidth }}
        >
          {LANE_ORDER.map((id) => {
            const on = id === lane;
            const count = lanes[id].cards.length;
            const warn = id === "needs_input" && count > 0;
            return (
              <Pressable
                key={id}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${strings.lanes[id]} ${count}`}
                onPress={() => select(id)}
                onLayout={(event: LayoutChangeEvent) => measureTab(id, "tab", event.nativeEvent.layout)}
                style={{
                  flexGrow: 1,
                  minWidth: barWidth / 4,
                  minHeight: 44,
                  paddingHorizontal: overflowing ? 10 : 0,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <View
                  onLayout={(event: LayoutChangeEvent) => measureTab(id, "row", event.nativeEvent.layout)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                >
                  <StatusIcon kind={LANE_STATUS[id]} size={14} theme={theme} animated={board.visible} />
                  <View
                    onLayout={(event: LayoutChangeEvent) => measureTab(id, "label", event.nativeEvent.layout)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                  >
                    <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: on ? "600" : "500", color: on ? colors.foreground : colors.foregroundMuted }}>
                      {strings.tabs[id]}
                    </Text>
                    {tasks.ready ? (
                      <Text
                        style={{
                          fontSize: 13,
                          fontVariant: ["tabular-nums"],
                          fontWeight: warn || on ? "600" : "400",
                          color: warn ? warning : on ? colors.foreground : colors.foregroundMuted,
                        }}
                      >
                        {count}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          })}
          {span ? (
            <Animated.View
              pointerEvents="none"
              testID="lane-underline"
              style={{
                position: "absolute",
                left: 0,
                bottom: 0,
                width: UNDERLINE_BASE,
                height: 2,
                backgroundColor: colors.accent,
                transform: [{ translateX: underlineX }, { scaleX: underlineScale }],
              }}
            />
          ) : null}
        </ScrollView>
      </View>
      {lane === "done" ? (
        <View style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, borderBottomWidth: HAIRLINE, borderBottomColor: colors.border }}>
          <Text style={{ fontSize: 13, color: colors.foregroundMuted }}>{strings.timeRange}</Text>
          <WindowSegments value={doneWindow} onChange={(value) => board.setParams((params) => ({ ...params, doneWindow: value }))} theme={theme} strings={strings} large />
        </View>
      ) : null}
      <View ref={gridRef} style={{ flex: 1, minHeight: 0, overflow: "hidden", backgroundColor: palette.panel }} {...gesture}>
        <Animated.View style={{ flex: 1, opacity: enterOpacity, transform: [{ translateX: enterX }] }}>
          <PhoneLane
            key={lane}
            lane={lanes[lane]}
            board={board}
            theme={theme}
            callbacks={callbacks}
            listRef={listRef}
            breathing={breathing}
          />
        </Animated.View>
        {leaving ? (
          <Animated.View
            pointerEvents="none"
            style={{ position: "absolute", top: 0, left: 0, right: 0, padding: 12, gap: 12, opacity: leaveOpacity, transform: [{ translateX: leaveX }] }}
          >
            {leaving.cards.map((card) => (
              <CardCell
                board={board}
                key={card.id}
                card={card}
                theme={theme}
                compact
                callbacks={callbacks}
                fresh={false}
              />
            ))}
          </Animated.View>
        ) : null}
      </View>
      <Modal title={strings.filters} open={sheet?.kind === "filters"} onOpenChange={(open) => !open && setSheet(null)}>
        <Modal.Content contentContainerStyle={SHEET_FILTER_BODY} scrollable={false}>
          {sheet?.kind === "filters" ? <FilterSheetBody board={board} theme={theme} options={options} onDone={() => setSheet(null)} /> : null}
        </Modal.Content>
      </Modal>
      <Modal title={strings.details} open={detailsCard !== undefined} onOpenChange={(open) => !open && setSheet(null)}>
        <Modal.Content contentContainerStyle={SHEET_BODY}>
          {detailsCard ? (
            <TaskDetails
              card={detailsCard}
              theme={theme}
              clock={board.clock}
              language={board.language}
              compact
              onOpen={
                board.callbacks.onOpen
                  ? (agentId) => {
                      setSheet(null);
                      board.callbacks.onOpen?.(agentId);
                    }
                  : undefined
              }
            />
          ) : null}
        </Modal.Content>
      </Modal>
    </View>
  );
}

function RoundButton(props: { icon: string; label: string; theme: PluginTheme; onPress(): void; active?: boolean; badge?: number }) {
  const colors = props.theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          borderWidth: HAIRLINE,
          borderColor: props.active ? colors.accent : colors.border,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={props.icon} size={18} color={colors.foreground} />
      </View>
      {props.badge ? (
        <View
          style={{
            // 16 by 16 inside a 2 px ring of the surface.
            position: "absolute",
            top: 0,
            right: 0,
            minWidth: 20,
            height: 20,
            paddingHorizontal: 2,
            borderRadius: 10,
            backgroundColor: colors.accent,
            borderWidth: 2,
            borderColor: colors.surface0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 11, lineHeight: 12, fontWeight: "600", color: colors.accentForeground, fontVariant: ["tabular-nums"] }}>{props.badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function PhoneLane(props: {
  lane: LaneModel;
  board: BoardController;
  theme: PluginTheme;
  callbacks: CardCallbacks;
  listRef: RefObject<NativeFlatList<TaskCard> | null>;
  breathing: Animated.Value;
}) {
  const { lane, board, theme } = props;
  const colors = theme.colors;
  const strings = board.strings;
  const ready = board.tasks.ready;
  const count = lane.cards.length;
  const fresh = useFreshIds(
    lane.cards.map((card) => card.id),
    ready,
  );
  // No clock in here: a tick reaches the timer texts, not the list and its rows.
  const { callbacks } = props;
  const { highlighted, stop, fields } = board;
  const extraData = useMemo(() => ({ highlighted, stop, fields, fresh, callbacks }), [highlighted, stop, fields, fresh, callbacks]);
  const renderItem = useCallback(
    ({ item }: { item: TaskCard }) => <CardCell board={board} card={item} theme={theme} compact callbacks={callbacks} fresh={fresh.has(item.id)} />,
    [board, theme, callbacks, fresh],
  );
  if (!ready || (lane.id === "done" && lane.loading && count === 0)) {
    return (
      <View style={{ padding: 12, gap: 12 }}>
        {[0, 1, 2].map((index) => (
          <SkeletonCard key={index} index={index} theme={theme} opacity={props.breathing} />
        ))}
      </View>
    );
  }
  const filtered = activeFilterCount(board.params, board.defaults) > 0;
  return (
    <FlatList<TaskCard>
      ref={props.listRef}
      data={lane.cards}
      keyExtractor={(card) => card.id}
      extraData={extraData}
      renderItem={renderItem}
      ItemSeparatorComponent={Separator}
      contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 12, paddingBottom: 46 }}
      initialNumToRender={6}
      maxToRenderPerBatch={6}
      windowSize={7}
      onScrollToIndexFailed={({ index, averageItemLength }) => {
        props.listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
      }}
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (lane.id === "done" && lane.hasMore && !lane.loading) board.tasks.loadMoreDone();
      }}
      ListEmptyComponent={
        <View
          style={{
            marginTop: 36,
            alignItems: "center",
            gap: 8,
            paddingVertical: 28,
            paddingHorizontal: 20,
            borderWidth: HAIRLINE,
            borderStyle: "dashed",
            borderColor: colors.border,
            borderRadius: 8,
          }}
        >
          <Icon name={LANE_EMPTY_ICON[lane.id]} size={20} color={colors.foregroundMuted} />
          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground, textAlign: "center" }}>{strings.laneEmpty[lane.id]}</Text>
          <Text style={{ fontSize: 13, lineHeight: 19, color: colors.foregroundMuted, textAlign: "center" }}>{strings.laneEmptyHint[lane.id]}</Text>
          {filtered ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => board.setParams(clearedParams)}
              style={{ marginTop: 6, height: 36, paddingHorizontal: 16, borderRadius: 18, borderWidth: HAIRLINE, borderColor: colors.border, justifyContent: "center" }}
            >
              <Text style={{ fontSize: 14, fontWeight: "500", color: colors.foreground }}>{strings.clearFilters}</Text>
            </Pressable>
          ) : null}
        </View>
      }
      ListFooterComponent={
        lane.id === "done" && count > 0 && (lane.hasMore || lane.loading) ? (
          <LoadMoreRow shown={count} sortedLoadedOnly={sortsLoadedOnly(board.params.sort)} loading={lane.loading} onPress={board.tasks.loadMoreDone} theme={theme} strings={strings} large />
        ) : null
      }
    />
  );
}
