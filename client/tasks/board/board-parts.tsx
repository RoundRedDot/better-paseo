import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Animated, Platform, Pressable, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { TaskText as Text, HOST_FONT as F, HOST_LINE, useTasksFontScale, taskControlHeight } from "../typography";
import type { DoneWindow } from "../../../shared/tasks-settings";
import { DONE_WINDOWS } from "../../../shared/tasks-settings";
import { useHover } from "../../ui/use-hover";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { liftStyle, scaleStyle, surfaceLift, type LiftSize } from "../cards/surface-lift";
import { usePressCue } from "../cards/action-pressable";
import { TaskCardView, taskTokens, type CardCallbacks } from "../cards";
import { useTodoSummary } from "../data/todo-summary";
import { SpinnerRing } from "../cards/status-icon";
import { tipProps } from "../cards/card-hints";
import type { LaneId, TaskCard } from "../model";
import { GLYPH_LINE, HAIRLINE, MOTION } from "./board-style";
import { filterSummary, readFilterOptions } from "./filter-options";
import type { BoardStrings } from "./strings";
import type { BoardController } from "./use-board";
import { useCardMotion } from "./lane-motion";
import { useFlash } from "./breathing";
import { useNewCardOutline } from "./new-cards";
import { withAlpha } from "../../components/theme-tokens";

const nativeDriver = Platform.OS !== "web";

/** A lane name read top to bottom: Chinese stacks its characters upright, Latin text turns 90°. */
export function VerticalLabel({ text, color, language }: { text: string; color: string; language: "en" | "zh" }) {
  const scale = useTasksFontScale();
  const [length, setLength] = useState(0);
  const style = { fontSize: F.base, fontWeight: "500" as const, color, lineHeight: HOST_LINE.base };
  if (language === "zh") {
    return (
      <View style={{ alignItems: "center" }}>
        {Array.from(text).map((char, index) => (
          <Text key={index} style={style}>
            {char}
          </Text>
        ))}
      </View>
    );
  }
  return (
    <View style={{ width: Math.round(18 * scale), height: Math.max(length, 1), alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 400, alignItems: "center", transform: [{ rotate: "90deg" }] }}>
        <Text numberOfLines={1} onLayout={(event) => setLength(Math.ceil(event.nativeEvent.layout.width))} style={[style, { letterSpacing: 1 }]}>
          {text}
        </Text>
      </View>
    </View>
  );
}

/** Each done window's mark in the desktop filter bar: its count and a smaller unit, infinity for all. */
export const WINDOW_MARKS: Readonly<Record<DoneWindow, { value: string; unit?: string }>> = {
  "24h": { value: "24", unit: "h" },
  "7d": { value: "7", unit: "d" },
  all: { value: "\u221e" },
};

/** Smaller digits and units match infinity's optical height while retaining the control's target size. */
export function WindowMark(props: { window: DoneWindow; color: string; unitColor: string }) {
  const mark = WINDOW_MARKS[props.window];
  if (!mark.unit) {
    // A glyph sized to sit as tall as the digits beside it, not a step of the text ramp.
    return <Text testID="window-mark" style={{ fontSize: F.base + 3, lineHeight: HOST_LINE.base, fontWeight: "500", color: props.color }}>{mark.value}</Text>;
  }
  return (
    <Text testID="window-mark" style={{ fontSize: F.sm - 1, lineHeight: HOST_LINE.base, fontWeight: "500", letterSpacing: -0.3, color: props.color, fontVariant: ["tabular-nums"] }}>
      {mark.value}
      <Text style={{ fontSize: F.sm - 3, fontWeight: "500", letterSpacing: 0, color: props.unitColor }}>{mark.unit}</Text>
    </Text>
  );
}

/** The done window as a segmented control (24 h / 7 d / all); `marks` draws `WINDOW_MARKS`, else their names. */
export function WindowSegments(props: {
  value: DoneWindow;
  onChange(value: DoneWindow): void;
  theme: PluginTheme;
  strings: BoardStrings;
  /** Phone: 32 high, items 26; desktop: 26 high, items 20. */
  large?: boolean;
  stretch?: boolean;
  /** The desktop bar's hover tip for the whole control. */
  tip?: string;
  marks?: boolean;
}) {
  const { marks, ...rest } = props;
  return (
    <Segments
      items={DONE_WINDOWS}
      label={(window) => props.strings.windows[window]}
      mark={marks ? (window, on) => <WindowMark window={window} color={on ? props.theme.colors.foreground : props.theme.colors.foregroundMuted} unitColor={props.theme.colors.foregroundMuted} /> : undefined}
      testID="done-window"
      {...rest}
    />
  );
}

/** A row of choices, one picked: the done window's segments, and the lane width's in the filter sheet. */
export function Segments<T extends string>(props: {
  items: readonly T[];
  label(item: T): string;
  value: T;
  onChange(value: T): void;
  theme: PluginTheme;
  large?: boolean;
  stretch?: boolean;
  testID?: string;
  tip?: string;
  /** Draws each choice as this mark alone, picked or not; its label is read out, and is its hover tip on the web. */
  mark?(item: T, on: boolean): ReactNode;
}) {
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  // Desktop: a Linear-style 28 pill with square-ish corners; phone: the prototype's round segments.
  const mark = props.mark;
  const outer = taskControlHeight(props.large ? 32 : 28, scale);
  const round = (height: number) => (props.large ? height / 2 : height === outer ? 6 : 4);
  return (
    <View
      accessibilityRole="radiogroup"
      testID={props.testID}
      {...tipProps(props.tip)}
      style={{
        height: props.stretch ? taskControlHeight(36, scale) : outer,
        flexDirection: "row",
        padding: 2,
        borderWidth: HAIRLINE,
        borderColor: colors.border,
        borderRadius: round(props.stretch ? taskControlHeight(36, scale) : outer),
        alignSelf: props.stretch ? "stretch" : "auto",
      }}
    >
      {props.items.map((window) => {
        const on = window === props.value;
        const inner = (props.stretch ? taskControlHeight(36, scale) : outer) - 6;
        return (
          <HoverPressable
            key={window}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={mark ? props.label(window) : undefined}
            {...tipProps(mark ? props.label(window) : undefined)}
            onPress={() => props.onChange(window)}
            style={(hovered, pressed) => ({
              height: inner,
              flex: props.stretch ? 1 : undefined,
              minWidth: mark ? inner + 8 : undefined,
              paddingHorizontal: mark ? 6 : props.large ? 12 : 9,
              borderRadius: round(inner),
              backgroundColor: on ? colors.surface2 : "transparent",
              ...liftStyle(() => taskTokens(props.theme), surfaceLift(hovered, pressed)),
              alignItems: "center",
              justifyContent: "center",
            })}
          >
            {mark ? (
              mark(window, on)
            ) : (
              <Text style={{ fontSize: F.base, fontWeight: "500", color: on ? colors.foreground : colors.foregroundMuted }}>
                {props.label(window)}
              </Text>
            )}
          </HoverPressable>
        );
      })}
    </View>
  );
}

export { useBreathing } from "./breathing";

const SKELETON_WIDTHS = ["78%", "62%", "70%"] as const;

/** A first-load placeholder card (prototype 05 D). */
export function SkeletonCard({ theme, opacity, index }: { theme: PluginTheme; opacity: Animated.Value; index: number }) {
  const colors = theme.colors;
  const bar = { borderRadius: 2, backgroundColor: colors.surface2 };
  return (
    <Animated.View
      style={{ opacity, padding: 10, gap: 9, borderWidth: HAIRLINE, borderColor: colors.border, borderRadius: 6, backgroundColor: colors.surface0 }}
    >
      <View style={[bar, { height: 10, width: SKELETON_WIDTHS[index % SKELETON_WIDTHS.length] }]} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={[bar, { width: 16, height: 16, borderRadius: 4 }]} />
        <View style={[bar, { height: 8, width: "45%" }]} />
      </View>
      <View style={[bar, { height: 8, width: "30%" }]} />
    </Animated.View>
  );
}

/** "Showing 50 · Load more", or "Loading" while the next page is on its way. */
/**
 * Under a lane's cards, in its own blank space: how many of the lane's cards
 * the filters leave out, and which filters are on. The sidebar's counts and
 * the lane header's count then differ for a reason the lane names.
 */
export function LaneFilterHint({ board, lane, count, theme }: { board: BoardController; lane: LaneId; count: number; theme: PluginTheme }) {
  const { tasks, params, defaults, strings } = board;
  const summary = useMemo(() => (count > 0 ? filterSummary(params, defaults, readFilterOptions(tasks, params), strings) : ""), [count, tasks, params, defaults, strings]);
  if (count === 0) return null;
  const muted = theme.colors.foregroundMuted;
  return (
    <View testID={`lane-filter-hint-${lane}`} style={{ alignItems: "center", gap: 2, paddingTop: 12, paddingHorizontal: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Icon name="ListFilter" size={12} color={muted} />
        <Text style={{ fontSize: F.sm, color: muted, fontVariant: ["tabular-nums"] }}>{strings.laneHidden(count)}</Text>
      </View>
      {summary ? <Text style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: muted, opacity: 0.8, textAlign: "center" }}>{summary}</Text> : null}
    </View>
  );
}

export function LoadMoreRow(props: {
  shown: number;
  /** The sort reaches only the loaded pages: say so instead of the plain count. */
  sortedLoadedOnly?: boolean;
  loading: boolean;
  onPress(): void;
  theme: PluginTheme;
  strings: BoardStrings;
  large?: boolean;
}) {
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  const height = taskControlHeight(props.large ? 36 : 26, scale);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: props.large ? 4 : 6 }}>
      <Text style={{ flex: 1, fontSize: F.sm, color: colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>
        {props.sortedLoadedOnly ? props.strings.sortedAmong(props.shown) : props.strings.shown(props.shown)}
      </Text>
      <HoverPressable
        accessibilityRole="button"
        disabled={props.loading}
        onPress={props.onPress}
        style={(hovered, pressed) => ({
          height,
          paddingHorizontal: props.large ? 16 : 12,
          borderRadius: height / 2,
          borderWidth: HAIRLINE,
          backgroundColor: colors.surface0,
          ...liftStyle(() => taskTokens(props.theme), surfaceLift(hovered, pressed), { border: colors.border }),
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
        })}
      >
        {props.loading ? <Icon name="LoaderCircle" size={12} color={colors.foregroundMuted} /> : null}
        <Text style={{ fontSize: props.large ? F.base : F.sm, fontWeight: "500", color: props.loading ? colors.foregroundMuted : colors.foreground }}>
          {props.loading ? props.strings.loading : props.strings.loadMore}
        </Text>
      </HoverPressable>
    </View>
  );
}

/**
 * Opacity 0 -> 1 once on mount: a card that came into the lane without a
 * flight. It waits while the cards below slide out of its way. No motion when reduced.
 */
/**
 * A card that came into its lane enters: it rises into its place and grows a
 * little as it fades in (`MOTION.enter*`). Decided at mount, so the first frame
 * that draws the card already has it at the start of its entrance.
 */
function EnterOnMount({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  // Decided at mount: switching the wrapper later would remount the card.
  const play = useRef(enabled && !reduced).current;
  const [t] = useState(() => new Animated.Value(play ? 0 : 1));
  const style = useMemo(
    () =>
      play
        ? {
            opacity: t,
            transform: [
              { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [MOTION.enterShift, 0] }) },
              { scale: t.interpolate({ inputRange: [0, 1], outputRange: [MOTION.enterScale, 1] }) },
            ],
          }
        : null,
    [play, t],
  );
  useEffect(() => {
    if (!play) return;
    const animation = Animated.timing(t, { toValue: 1, duration: MOTION.enterMs, delay: MOTION.enterDelayMs, easing: MOTION.ease, useNativeDriver: nativeDriver });
    animation.start();
    return () => animation.stop();
  }, [play, t]);
  return style ? <Animated.View style={style}>{children}</Animated.View> : <>{children}</>;
}

/** A `Pressable` whose style follows the pointer on web and on native pointers. */
/**
 * A press that is a tap, not the start of a scroll: on iOS a quick swipe that
 * starts on a button can end as that button's press before the scroll view
 * takes the touch (a fast drag from a lane's collapse button folded the
 * lane). Spread `pressIn` on the Pressable and wrap its handler in `tap`; a
 * release more than 10 from where the finger went down does nothing.
 */
export function useTap(): {
  pressIn: { onPressIn(event: { nativeEvent: { pageX: number; pageY: number } }): void };
  tap(handler?: () => void): ((event?: { nativeEvent?: { pageX: number; pageY: number } }) => void) | undefined;
} {
  const down = useRef<{ x: number; y: number } | null>(null);
  return {
    pressIn: {
      onPressIn(event) {
        down.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
      },
    },
    tap(handler) {
      if (!handler) return undefined;
      return (event) => {
        const start = down.current;
        const end = event?.nativeEvent;
        down.current = null;
        // A release without coordinates (a keyboard or an accessibility action) is a tap.
        if (start && end && Math.hypot(end.pageX - start.x, end.pageY - start.y) > TAP_SLOP) return;
        handler();
      };
    },
  };
}

const TAP_SLOP = 10;

export function HoverPressable(
  props: Omit<React.ComponentProps<typeof Pressable>, "style"> & {
    /** What the lift treats it as (`LiftSize`); false keeps its size on every press. */
    lift?: boolean | LiftSize;
    /** `pressed` is the press cue: at once for a pointer, after a still 100 ms for a finger (`usePressCue`). */
    style(hovered: boolean, pressed: boolean): StyleProp<ViewStyle>;
  },
) {
  const { style, onPress, onLongPress, onPressIn, onPressOut, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, lift: liftAs = true, ...rest } = props;
  const { hovered, hoverProps } = useHover();
  const reduced = useReducedMotion();
  const press = usePressCue(hovered, !rest.disabled);
  const visual = style(hovered, press.pressed);
  const lift = scaleStyle(liftAs === false ? 1 : surfaceLift(hovered, press.pressed, reduced, liftAs === true ? "control" : liftAs, press.input).scale);
  const flat = visual && typeof visual === "object" && !Array.isArray(visual) ? { ...visual, ...lift } : [visual, lift];
  return (
    <Pressable
      {...rest}
      {...hoverProps}
      onPress={press.guard(onPress)}
      onLongPress={press.guard(onLongPress)}
      onPressIn={(event) => { press.onPressIn(event); onPressIn?.(event); }}
      onPressOut={(event) => { press.onPressOut(event); onPressOut?.(event); }}
      onTouchStart={(event) => { press.onTouchStart(event); onTouchStart?.(event); }}
      onTouchMove={(event) => { press.onTouchMove(event); onTouchMove?.(event); }}
      onTouchEnd={(event) => { press.onTouchEnd(event); onTouchEnd?.(event); }}
      onTouchCancel={(event) => { press.onTouchCancel(event); onTouchCancel?.(event); }}
      style={flat}
    />
  );
}

/** A lane's colour: the hue of its status icon. */
export function laneHue(theme: PluginTheme, lane: LaneId): string {
  const status = taskTokens(theme).status;
  return lane === "needs_input" ? status.warning : lane === "running" ? status.running : theme.colors.accent;
}

/** A new card's outline at full strength: its opacity breathes it in and out. */
function newOutline(theme: PluginTheme, lane: LaneId): ViewStyle {
  const hue = laneHue(theme, lane);
  return {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: withAlpha(hue, 0.55),
    backgroundColor: withAlpha(hue, taskTokens(theme).isDark ? 0.1 : 0.07),
  };
}

export interface CardCellProps {
  card: TaskCard;
  board: BoardController;
  theme: PluginTheme;
  compact: boolean;
  focused?: boolean;
  /** The card the details sidebar shows. */
  current?: boolean;
  fresh: boolean;
  /** The cell's node by card id. */
  register?(agentId: string, node: unknown): void;
  /** Overrides the board's callbacks (the phone swallows taps after a swipe). */
  callbacks?: CardCallbacks;
  /** A copy of a card (one in the air, the phone's outgoing lane): it takes no part in the lane motion. */
  copy?: boolean;
}

/**
 * One card in a lane: the card, its fade-in, its lane motion, and its project icon request.
 * It re-renders with the board, not with the clock; `TaskCardView`'s own
 * memo skips the cards a board update does not change.
 */
export function CardCell(props: CardCellProps) {
  const { card, board, register } = props;
  const todo = useTodoSummary(board.paseo, card.id, board.visible && !card.subagent && !card.closed && board.fields.plan, !props.copy);
  const searchPrompt = useSyncExternalStore(
    board.params.query.trim() ? board.searchStatus.subscribe : () => () => {},
    () => board.params.query.trim() ? board.searchStatus.prompt(card) : undefined,
    () => undefined,
  );
  const nodeRef = useRef<View>(null);
  const [arrival, setArrival] = useState(0);
  const onArrive = useCallback(() => setArrival((key) => key + 1), []);
  const flashOpacity = useFlash(board.visible ? arrival : 0);
  // A new task, once seen: its outline breathes in its lane's colour.
  const outline = useNewCardOutline(board.hostId, card, props.copy ?? false);
  const motion = useCardMotion(card.id, nodeRef, props.copy ?? false, onArrive);
  useEffect(() => {
    if (!register) return;
    register(card.id, nodeRef.current);
    return () => register(card.id, null);
  }, [register, card.id]);
  // Rendered cards only, once per project while the icon is missing; the data layer dedupes the fetch.
  const { requestIcon } = board;
  const projectId = card.location.projectIcon === null ? card.location.projectId : null;
  useEffect(() => {
    if (requestIcon && projectId) requestIcon(projectId);
  }, [requestIcon, projectId]);
  // The slot is what the lane motion measures; the card inside it is what moves.
  return (
    <View ref={nodeRef} collapsable={false}>
      <Animated.View style={motion ? { opacity: motion.opacity, transform: [{ translateX: motion.x }, { translateY: motion.y }] } : undefined}>
        <EnterOnMount enabled={props.fresh}>
          <TaskCardView
            card={card}
            todo={todo}
            searchQuery={board.params.query.trim().toLowerCase()}
            searchPrompt={searchPrompt}
            searchPromptUnavailable={Boolean(card.closed || card.subagent && (!card.parent || !board.cardById(card.parent.id) || board.cardById(card.parent.id)!.closed))}
            fields={board.fields}
            titleLines={board.titleLines === "all" ? null : Number(board.titleLines)}
            theme={props.theme}
            compact={props.compact}
            todoExpanded={board.expandedTodo.has(card.id)}
            onTodoExpandedChange={board.setTodoExpanded}
            subtasksExpanded={board.expandedSubtasks.has(card.id)}
            onSubtasksExpandedChange={board.setSubtasksExpanded}
            permissionButtons={board.buttonsFor(card)}
            stopPhase={board.stop.phase(card.id)}
            readPending={board.read.pending(card.id)}
            unarchivePending={board.unarchive.pending(card.id)}
            archivePending={board.archive.pending(card.id)}
            focused={props.focused ?? false}
            focusId={props.copy ? undefined : `task-card-${card.id}`}
            current={props.current}
            highlighted={board.highlighted === card.id}
            clock={board.clock}
            language={board.language}
            animated={board.visible}
            hostId={board.hostId}
            {...(props.callbacks ?? board.callbacks)}
          />
        </EnterOnMount>
        <Animated.View
          pointerEvents="none"
          testID={`card-flash-${card.id}`}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 8, backgroundColor: taskTokens(props.theme).isDark ? "#ffffff" : "#000000", opacity: flashOpacity }}
        />
        {outline ? (
          <Animated.View
            pointerEvents="none"
            testID={`card-new-${card.id}`}
            style={{ ...newOutline(props.theme, card.lane), opacity: outline }}
          />
        ) : null}
      </Animated.View>
    </View>
  );
}

/**
 * The ids a lane has not shown before, so only a card that arrives (a status
 * change, a new agent) enters; scrolling a virtualised list back to a card
 * does not. The first ready render seeds the set without any entering.
 * A card that leaves the lane is forgotten, so it enters again when it comes
 * back, unless the user's own `scope` (search, sort) took it away and brought
 * it back.
 *
 * Read by a row as it mounts, which is the only time it matters (the entrance
 * is decided at mount): one reader for the lane's life, so a card that comes
 * in, and the render after it that no longer counts it, do not change the
 * list's `renderItem` and redraw every row. A card counts as arriving for
 * `FRESH_MS` after its lane first had it: a list past its first rows mounts
 * a new one in a later batch, after the render that brought it.
 */
export function useFreshIds(ids: readonly string[], ready: boolean, scope?: unknown, now: () => number = Date.now): (id: string) => boolean {
  const seen = useRef<Set<string> | null>(null);
  const seenScope = useRef<unknown>(scope);
  const arrived = useRef(new Map<string, number>());
  const clock = useRef(now);
  clock.current = now;
  if (ready && seen.current) {
    const at = now();
    for (const id of ids) if (!seen.current.has(id) && !arrived.current.has(id)) arrived.current.set(id, at);
  }
  useEffect(() => {
    if (!ready) return;
    if (!seen.current || seenScope.current === scope) seen.current = new Set();
    seenScope.current = scope;
    for (const id of ids) seen.current.add(id);
    const at = clock.current();
    for (const [id, since] of arrived.current) if (at - since >= FRESH_MS || !seen.current.has(id)) arrived.current.delete(id);
  });
  return useCallback((id: string) => {
    const since = arrived.current.get(id);
    return since !== undefined && clock.current() - since < FRESH_MS;
  }, []);
}

/** How long a card that came into a lane still enters when its row mounts. */
export const FRESH_MS = 1000;




/**
 * New tasks a lane holds out of view: a pill floating over the list, at the
 * edge they are past. It rises in as the first comes and sinks away once the
 * last is seen; pressing it scrolls to the first.
 */
export function NewCardsPill(props: {
  count: number;
  direction: "up" | "down";
  /** From the list's edge it floats at. */
  inset: number;
  hue: string;
  theme: PluginTheme;
  strings: BoardStrings;
  onPress(): void;
  testID?: string;
}) {
  const { count, direction, theme } = props;
  const reduced = useReducedMotion();
  const on = count > 0;
  const [mounted, setMounted] = useState(on);
  const [label, setLabel] = useState(count);
  // The number it last showed stays while it sinks away.
  if (on && label !== count) setLabel(count);
  if (on && !mounted) setMounted(true);
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!mounted) return;
    const animation = Animated.timing(t, { toValue: on ? 1 : 0, duration: reduced ? 0 : on ? 220 : 160, easing: MOTION.ease, useNativeDriver: nativeDriver });
    animation.start(({ finished }) => {
      if (finished && !on) setMounted(false);
    });
    return () => animation.stop();
  }, [on, mounted, reduced, t]);
  if (!mounted) return null;
  const colors = theme.colors;
  const up = direction === "up";
  const shift = up ? -10 : 10;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, alignItems: "center", ...(up ? { top: props.inset } : { bottom: props.inset }) }}>
      <Animated.View style={{ opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [shift, 0] }) }] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.strings.newTasks(label)}
          disabled={!on}
          onPress={props.onPress}
          testID={props.testID}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            minHeight: 30,
            paddingLeft: 10,
            paddingRight: 12,
            borderRadius: 15,
            borderWidth: HAIRLINE,
            borderColor: colors.border,
            backgroundColor: taskTokens(theme).card.background,
            ...(Platform.OS === "web"
              ? { boxShadow: "0px 8px 24px -6px rgba(0, 0, 0, 0.16), 0px 2px 6px -2px rgba(0, 0, 0, 0.08)" }
              : { elevation: 6, shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }),
          } as ViewStyle}
        >
          <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: props.hue }} />
          <Text style={{ fontSize: F.sm, fontWeight: "600", color: colors.foreground, fontVariant: ["tabular-nums"] }}>{props.strings.newTasks(label)}</Text>
          <Icon name={up ? "ArrowUp" : "ArrowDown"} size={13} color={props.hue} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** A lane with new tasks not seen yet, where its cards are not shown: the phone's other tabs, a collapsed lane. */
export function NewCardsDot(props: { on: boolean; hue: string; testID?: string }) {
  const reduced = useReducedMotion();
  const [t] = useState(() => new Animated.Value(props.on ? 1 : 0));
  useEffect(() => {
    const animation = Animated.timing(t, { toValue: props.on ? 1 : 0, duration: reduced ? 0 : props.on ? 240 : 160, easing: MOTION.ease, useNativeDriver: nativeDriver });
    animation.start();
    return () => animation.stop();
  }, [props.on, reduced, t]);
  return (
    <Animated.View
      pointerEvents="none"
      testID={props.on ? props.testID : undefined}
      style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: props.hue, opacity: t, transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }}
    />
  );
}

/** A count on its way from `from` to `to`; `t` runs 0 → 1, null once it has arrived. */
interface Roll {
  from: number;
  to: number;
  scope: unknown;
  t: Animated.Value | null;
}

/**
 * A lane's count that rolls to its new value: the new number comes in from
 * below as the old one leaves upward when the count grows, the other way when
 * it shrinks. Only a change within the same `scope` rolls; a new search or a
 * new sort shows the new count at once, as its cards do, while a filter rolls
 * it. No motion when reduced.
 *
 * The roll is decided in render, so the frame that shows the new lanes starts
 * it from its first value (on iOS a layout effect lands a frame late). The new
 * number keeps the slot's width; the old one draws over it, out of the flow.
 */
export function RollingCount(props: { value: number; scope?: unknown; align?: "left" | "center"; style: StyleProp<TextStyle>; singleLine?: boolean }) {
  const { value, scope } = props;
  const reduced = useReducedMotion();
  const [roll, setRoll] = useState<Roll>(() => ({ from: value, to: value, scope, t: null }));
  if (roll.to !== value || roll.scope !== scope) {
    const play = roll.to !== value && roll.scope === scope && !reduced;
    setRoll({ from: roll.to, to: value, scope, t: play ? new Animated.Value(0) : null });
  }
  const t = roll.t;
  useEffect(() => {
    if (!t) return;
    const animation = Animated.timing(t, { toValue: 1, duration: MOTION.countMs, easing: MOTION.ease, useNativeDriver: nativeDriver });
    animation.start(({ finished }) => {
      if (finished) setRoll((current) => (current.t === t ? { ...current, t: null } : current));
    });
    return () => animation.stop();
  }, [t]);
  if (!t) return <Text numberOfLines={props.singleLine ? 1 : undefined} style={props.style}>{value}</Text>;
  const shift = roll.to > roll.from ? MOTION.countShift : -MOTION.countShift;
  const center = props.align === "center";
  return (
    <View>
      <Animated.View style={{ opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [shift, 0] }) }] }}>
        <Text numberOfLines={props.singleLine ? 1 : undefined} style={props.style}>{roll.to}</Text>
      </Animated.View>
      {/* Wider than the slot, so a longer old number is not cut or wrapped. */}
      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: center ? -COUNT_SPILL : 0,
          right: -COUNT_SPILL,
          alignItems: center ? "center" : "flex-start",
          opacity: t.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -shift] }) }],
        }}
      >
        <Text numberOfLines={1} style={props.style}>
          {roll.from}
        </Text>
      </Animated.View>
    </View>
  );
}

/** How far past the slot an old, longer count may draw. */
const COUNT_SPILL = 40;

/**
 * The board's "N tasks": on web and the desktop app its number rolls as the
 * lanes' counts do (see `scope`); a phone or tablet shows it at once.
 * The first count after loading shows at once too.
 */
export function RollingTotal(props: { board: BoardController; style: StyleProp<TextStyle> }) {
  const { board } = props;
  const scale = useTasksFontScale();
  if (Platform.OS !== "web") return <Text numberOfLines={1} style={props.style}>{board.strings.total(board.total)}</Text>;
  return (
    <View accessible accessibilityLabel={board.strings.total(board.total)} style={{ flexDirection: "row", alignItems: "center" }}>
      <RollingCount value={board.total} scope={board.tasks.ready ? board.scope : null} style={props.style} />
      <Text numberOfLines={1} style={[props.style, { marginLeft: Math.round(4 * scale) }]}>
        {" " + board.strings.totalUnit(board.total)}
      </Text>
    </View>
  );
}

/**
 * A 36 round icon button in a 44 target, with a count badge: the phone's
 * search and filters. Given a `size`, the circle is the button, its target
 * reaching 4 past it off the web: a narrow board's header, beside the
 * sidebar switch of that size.
 */
export function RoundButton(props: {
  icon: string;
  label: string;
  theme: PluginTheme;
  onPress(): void;
  active?: boolean;
  badge?: number;
  /** A grey count at the circle's bottom right (`CornerBadge`). */
  cornerBadge?: number;
  testID?: string;
  /** A toggle's state, read out as selected. */
  selected?: boolean;
  toggle?: boolean;
  disabled?: boolean;
  /** Struck through, as Lucide's "-off" icons: a toggle that is off. */
  slashed?: boolean;
  /** The circle's size, with no target padding around it. */
  size?: number;
  iconSize?: number;
  /** Its hover tip, where a pointer can rest on it (a narrow tablet board on the web). */
  tip?: string;
  /** A loading ring replaces the icon while true, read out as busy. */
  busy?: boolean;
  quietOutline?: boolean;
  borderless?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  const size = props.size ?? 36;
  const pad = props.size === undefined ? 4 : 0;
  const icon = props.iconSize ?? Math.round(size / 2);
  const toggleColor = props.selected ? colors.foreground : colors.foregroundMuted;
  const { hovered, hoverProps } = useHover();
  const press = usePressCue(hovered, !props.disabled);
  const lift = surfaceLift(hovered, press.pressed, undefined, "control", press.input);
  const line = props.quietOutline && Platform.OS === "web" && !hovered ? "transparent" : props.active ? colors.accent : colors.border;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={props.busy !== undefined ? { busy: props.busy } : props.selected === undefined ? undefined : { selected: props.selected, ...(props.disabled ? { disabled: true } : {}) }}
      disabled={props.disabled}
      {...tipProps(props.tip)}
      onPress={press.guard(props.onPress)}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onTouchStart={press.onTouchStart}
      onTouchMove={press.onTouchMove}
      onTouchEnd={press.onTouchEnd}
      onTouchCancel={press.onTouchCancel}
      {...hoverProps}
      hitSlop={pad || Platform.OS === "web" ? 0 : 4}
      testID={props.testID}
      style={[{ width: size + 2 * pad, height: size + 2 * pad, alignItems: "center", justifyContent: "center", opacity: props.disabled ? 0.4 : 1 }, scaleStyle(lift.scale), props.style]}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: props.quietOutline && Platform.OS === "web" ? 7 : size / 2,
          borderWidth: props.borderless ? 0 : HAIRLINE,
          borderColor: line,
          ...(props.toggle ? { backgroundColor: "transparent" } : null),
          ...(props.disabled ? { boxShadow: undefined } : liftStyle(() => taskTokens(props.theme), lift, props.borderless ? {} : { border: line, hued: !!props.active })),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {props.busy ? <SpinnerRing size={icon} color={colors.foreground} testID={props.testID ? `${props.testID}-spinner` : undefined} /> : <Icon name={props.icon} size={icon} color={props.toggle ? toggleColor : props.borderless && props.active ? colors.accent : colors.foreground} />}
        {props.slashed ? <SlashMark size={icon} color={props.toggle ? toggleColor : colors.foreground} gap={colors.surface0} /> : null}
        <CornerBadge count={props.cornerBadge ?? 0} theme={props.theme} style={{ bottom: 0, right: 0 }} testID={props.testID ? `${props.testID}-count` : undefined} />
      </View>
      {props.badge ? (
        <View
          style={{
            // 16 by 16 inside a 2 px ring of the surface.
            position: "absolute",
            top: pad - 4,
            right: pad - 4,
            minWidth: taskControlHeight(20, scale),
            height: taskControlHeight(20, scale),
            paddingHorizontal: 2,
            borderRadius: 10,
            backgroundColor: colors.accent,
            borderWidth: 2,
            borderColor: colors.surface0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: F.sm, lineHeight: 14, fontWeight: "600", color: colors.accentForeground, fontVariant: ["tabular-nums"] }}>{props.badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * A small grey count at an icon's bottom right: the tablet toolbar's
 * filter count, and the cards a switch leaves off the board. Placed by
 * its parent (`style`), in a 1 px ring of the surface. Nothing at zero.
 */
export function CornerBadge(props: { count: number; theme: PluginTheme; ringColor?: string; style: { top?: number; right?: number; bottom?: number; left?: number }; testID?: string }) {
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  if (props.count <= 0) return null;
  const size = taskControlHeight(12, scale);
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", ...props.style, minWidth: size, height: size, paddingHorizontal: 2, borderRadius: size / 2, backgroundColor: colors.foregroundMuted, borderWidth: 1, borderColor: props.ringColor ?? colors.surface0, alignItems: "center", justifyContent: "center" }}
    >
      <Text testID={props.testID} style={{ fontSize: 8, lineHeight: 10, includeFontPadding: false, fontWeight: "600", fontVariant: ["tabular-nums"], color: colors.surface0 }}>
        {props.count > 99 ? "99+" : props.count}
      </Text>
    </View>
  );
}

/**
 * Lucide's "-off" slash over an icon of `size`: corner to corner of its
 * 20-unit drawing at the host's 1.5 stroke, cut out of the icon by a ring
 * of the surface. Drawn with views, as the sandbox has no SVG.
 */
export function SlashMark(props: { size: number; color: string; gap: string }) {
  const unit = props.size / 24;
  const length = 20 * Math.SQRT2 * unit;
  const stroke = 1.5 * unit;
  const line = (width: number, color: string) => (
    <View
      style={{
        position: "absolute",
        width: length + 2 * width,
        height: stroke + 2 * width,
        borderRadius: stroke / 2 + width,
        backgroundColor: color,
        transform: [{ rotate: "45deg" }],
      }}
    />
  );
  return (
    <View testID="slash-mark" pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" }}>
      {line(stroke, props.gap)}
      {line(0, props.color)}
    </View>
  );
}

