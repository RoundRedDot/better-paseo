import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Platform, Pressable, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { TaskText as Text, HOST_FONT as F, HOST_LINE, useTasksFontScale, taskControlHeight } from "../typography";
import type { DoneWindow } from "../../../shared/tasks-settings";
import { DONE_WINDOWS } from "../../../shared/tasks-settings";
import { useHover } from "../../ui/use-hover";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { TaskCardView, taskTokens, type CardCallbacks } from "../cards";
import { tipProps } from "../cards/card-hints";
import type { LaneId, TaskCard } from "../model";
import { GLYPH_LINE, HAIRLINE, MOTION } from "./board-style";
import { buildFilterOptions, filterSummary } from "./filter-options";
import type { BoardStrings } from "./strings";
import type { BoardController } from "./use-board";
import { useCardMotion } from "./lane-motion";

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

/** A done window's mark: "24" with a small "h" after it on its baseline; all of them a larger infinity. */
export function WindowMark(props: { window: DoneWindow; color: string; unitColor: string }) {
  const mark = WINDOW_MARKS[props.window];
  if (!mark.unit) {
    // A glyph sized to sit as tall as the digits beside it, not a step of the text ramp.
    return <Text testID="window-mark" style={{ fontSize: F.base + 3, lineHeight: HOST_LINE.base, fontWeight: "500", color: props.color }}>{mark.value}</Text>;
  }
  return (
    <Text testID="window-mark" style={{ fontSize: F.base, lineHeight: HOST_LINE.base, fontWeight: "600", letterSpacing: -0.3, color: props.color, fontVariant: ["tabular-nums"] }}>
      {mark.value}
      <Text style={{ fontSize: F.sm - 1, fontWeight: "600", letterSpacing: 0, color: props.unitColor }}>{mark.unit}</Text>
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
          <Pressable
            key={window}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={mark ? props.label(window) : undefined}
            {...tipProps(mark ? props.label(window) : undefined)}
            onPress={() => props.onChange(window)}
            style={{
              height: inner,
              flex: props.stretch ? 1 : undefined,
              minWidth: mark ? inner + 8 : undefined,
              paddingHorizontal: mark ? 6 : props.large ? 12 : 9,
              borderRadius: round(inner),
              backgroundColor: on ? colors.surface2 : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {mark ? (
              mark(window, on)
            ) : (
              <Text style={{ fontSize: F.base, fontWeight: "500", color: on ? colors.foreground : colors.foregroundMuted }}>
                {props.label(window)}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/** The skeletons' shared breathing, 1 → 0.5 → 1 over 1200 ms; still under reduced motion or while hidden. */
export function useBreathing(active: boolean): Animated.Value {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    value.setValue(1);
    if (!active || reduced) return;
    const half = MOTION.skeletonMs / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 0.5, duration: half, useNativeDriver: nativeDriver }),
        Animated.timing(value, { toValue: 1, duration: half, useNativeDriver: nativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduced, value]);
  return value;
}

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
  const summary = useMemo(() => (count > 0 ? filterSummary(params, defaults, buildFilterOptions(tasks, params), strings) : ""), [count, tasks, params, defaults, strings]);
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
        style={(hovered) => ({
          height,
          paddingHorizontal: props.large ? 16 : 12,
          borderRadius: height / 2,
          borderWidth: HAIRLINE,
          borderColor: colors.border,
          backgroundColor: hovered ? colors.surface1 : colors.surface0,
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
function FadeOnMount({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  // Decided at mount: switching the wrapper later would remount the card.
  const play = useRef(enabled && !reduced).current;
  const opacity = useRef(new Animated.Value(play ? 0 : 1)).current;
  useEffect(() => {
    if (!play) return;
    const animation = Animated.timing(opacity, { toValue: 1, duration: MOTION.fadeMs, delay: MOTION.fadeDelayMs, useNativeDriver: nativeDriver });
    animation.start();
    return () => animation.stop();
  }, [play, opacity]);
  return play ? <Animated.View style={{ opacity }}>{children}</Animated.View> : <>{children}</>;
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
  props: Omit<React.ComponentProps<typeof Pressable>, "style"> & { style(hovered: boolean): StyleProp<ViewStyle> },
) {
  const { style, ...rest } = props;
  const { hovered, hoverProps } = useHover();
  return <Pressable {...rest} {...hoverProps} style={style(hovered)} />;
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
  const nodeRef = useRef<View>(null);
  const motion = useCardMotion(card.id, nodeRef, props.copy ?? false);
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
        <FadeOnMount enabled={props.fresh}>
          <TaskCardView
            card={card}
            fields={board.fields}
            theme={props.theme}
            compact={props.compact}
            subtasksExpanded={board.expandedSubtasks.has(card.id)}
            onSubtasksExpandedChange={board.setSubtasksExpanded}
            permissionButtons={board.buttonsFor(card)}
            stopPhase={board.stop.phase(card.id)}
            readPending={board.read.pending(card.id)}
            unarchivePending={board.unarchive.pending(card.id)}
            archivePending={board.archive.pending(card.id)}
            focused={props.focused ?? false}
            current={props.current}
            highlighted={board.highlighted === card.id}
            clock={board.clock}
            language={board.language}
            animated={board.visible}
            hostId={board.hostId}
            {...(props.callbacks ?? board.callbacks)}
          />
        </FadeOnMount>
      </Animated.View>
    </View>
  );
}

/**
 * The ids a lane has not shown before, so only a card that arrives (a status
 * change, a new agent) fades in; scrolling a virtualised list back to a card
 * does not. The first ready render seeds the set without fading anything.
 * A card that leaves the lane is forgotten, so it fades in again when it comes
 * back, unless the user's own `scope` (search, sort) took it away and brought
 * it back.
 */
export function useFreshIds(ids: readonly string[], ready: boolean, scope?: unknown): ReadonlySet<string> {
  const seen = useRef<Set<string> | null>(null);
  const seenScope = useRef<unknown>(scope);
  const last = useRef<ReadonlySet<string>>(NO_IDS);
  const fresh = new Set<string>();
  if (ready && seen.current) for (const id of ids) if (!seen.current.has(id)) fresh.add(id);
  useEffect(() => {
    if (!ready) return;
    if (!seen.current || seenScope.current === scope) seen.current = new Set();
    seenScope.current = scope;
    for (const id of ids) seen.current.add(id);
  });
  // The same set while its ids hold, so a list's `extraData` does not change for nothing.
  if (!sameIds(last.current, fresh)) last.current = fresh.size === 0 ? NO_IDS : fresh;
  return last.current;
}

const NO_IDS: ReadonlySet<string> = new Set();

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const id of right) if (!left.has(id)) return false;
  return true;
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
export function RollingCount(props: { value: number; scope?: unknown; align?: "left" | "center"; style: StyleProp<TextStyle> }) {
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
  if (!t) return <Text style={props.style}>{value}</Text>;
  const shift = roll.to > roll.from ? MOTION.countShift : -MOTION.countShift;
  const center = props.align === "center";
  return (
    <View>
      <Animated.View style={{ opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [shift, 0] }) }] }}>
        <Text style={props.style}>{roll.to}</Text>
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
  if (Platform.OS !== "web") return <Text numberOfLines={1} style={props.style}>{board.strings.total(board.total)}</Text>;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <RollingCount value={board.total} scope={board.tasks.ready ? board.scope : null} style={props.style} />
      <Text numberOfLines={1} style={props.style}>
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
  testID?: string;
  /** A toggle's state, read out as selected. */
  selected?: boolean;
  disabled?: boolean;
  /** Struck through, as Lucide's "-off" icons: a toggle that is off. */
  slashed?: boolean;
  /** The circle's size, with no target padding around it. */
  size?: number;
  /** Its hover tip, where a pointer can rest on it (a narrow tablet board on the web). */
  tip?: string;
}) {
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  const size = props.size ?? 36;
  const pad = props.size === undefined ? 4 : 0;
  const icon = Math.round(size / 2);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={props.selected === undefined ? undefined : { selected: props.selected, ...(props.disabled ? { disabled: true } : {}) }}
      disabled={props.disabled}
      {...tipProps(props.tip)}
      onPress={props.onPress}
      hitSlop={pad || Platform.OS === "web" ? 0 : 4}
      testID={props.testID}
      style={{ width: size + 2 * pad, height: size + 2 * pad, alignItems: "center", justifyContent: "center", opacity: props.disabled ? 0.4 : 1 }}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: HAIRLINE,
          borderColor: props.active ? colors.accent : colors.border,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={props.icon} size={icon} color={colors.foreground} />
        {props.slashed ? <SlashMark size={icon} color={colors.foreground} gap={colors.surface0} /> : null}
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

