import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Platform, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { TaskText as Text, HOST_FONT as F, HOST_LINE, useTasksFontScale, taskControlHeight } from "../typography";
import type { DoneWindow } from "../../../shared/tasks-settings";
import { DONE_WINDOWS } from "../../../shared/tasks-settings";
import { useHover } from "../../ui/use-hover";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { TaskCardView, taskTokens, type CardCallbacks } from "../cards";
import type { TaskCard } from "../model";
import { GLYPH_LINE, HAIRLINE, MOTION } from "./board-style";
import type { BoardStrings } from "./strings";
import type { BoardController } from "./use-board";

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

export function Checkbox({ on, theme, size = 14 }: { on: boolean; theme: PluginTheme; size?: number }) {
  const colors = theme.colors;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size > 16 ? 4 : 3,
        borderWidth: GLYPH_LINE,
        borderColor: on ? colors.accent : taskTokens(theme).borderStrong,
        backgroundColor: on ? colors.accent : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {on ? <Icon name="Check" size={size - 4} color={colors.accentForeground} /> : null}
    </View>
  );
}

/** The done window as a segmented control (24 h / 7 d / all). */
export function WindowSegments(props: {
  value: DoneWindow;
  onChange(value: DoneWindow): void;
  theme: PluginTheme;
  strings: BoardStrings;
  /** Phone: 32 high, items 26; desktop: 26 high, items 20. */
  large?: boolean;
  stretch?: boolean;
}) {
  return <Segments items={DONE_WINDOWS} label={(window) => props.strings.windows[window]} {...props} />;
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
}) {
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  // Desktop: a Linear-style 28 pill with square-ish corners; phone: the prototype's round segments.
  const outer = taskControlHeight(props.large ? 32 : 28, scale);
  const round = (height: number) => (props.large ? height / 2 : height === outer ? 6 : 4);
  return (
    <View
      accessibilityRole="radiogroup"
      testID={props.testID}
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
            onPress={() => props.onChange(window)}
            style={{
              height: inner,
              flex: props.stretch ? 1 : undefined,
              paddingHorizontal: props.large ? 12 : 9,
              borderRadius: round(inner),
              backgroundColor: on ? colors.surface2 : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontSize: F.base, fontWeight: "500", color: on ? colors.foreground : colors.foregroundMuted }}>
              {props.label(window)}
            </Text>
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

/** Opacity 0 → 1 once on mount; a card that just changed lanes. No motion when reduced. */
function FadeOnMount({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  // Decided at mount: switching the wrapper later would remount the card.
  const play = useRef(enabled && !reduced).current;
  const opacity = useRef(new Animated.Value(play ? 0 : 1)).current;
  useEffect(() => {
    if (!play) return;
    const animation = Animated.timing(opacity, { toValue: 1, duration: MOTION.fadeMs, useNativeDriver: nativeDriver });
    animation.start();
    return () => animation.stop();
  }, [play, opacity]);
  return play ? <Animated.View style={{ opacity }}>{children}</Animated.View> : <>{children}</>;
}

/** A `Pressable` whose style follows the pointer on web and on native pointers. */
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
}

/**
 * One card in a lane: the card, its fade-in, and its project icon request.
 * It re-renders with the board, not with the clock; `TaskCardView`'s own
 * memo skips the cards a board update does not change.
 */
export function CardCell(props: CardCellProps) {
  const { card, board, register } = props;
  const nodeRef = useRef<View>(null);
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
  return (
    <View ref={nodeRef} collapsable={false}>
      <FadeOnMount enabled={props.fresh}>
        <TaskCardView
          card={card}
          fields={board.fields}
          theme={props.theme}
          compact={props.compact}
          permissionButtons={board.buttonsFor(card)}
          stopPhase={board.stop.phase(card.id)}
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
    </View>
  );
}

/**
 * The ids a lane has not shown before, so only a card that arrives (a status
 * change, a new agent) fades in; scrolling a virtualised list back to a card
 * does not. The first ready render seeds the set without fading anything.
 */
export function useFreshIds(ids: readonly string[], ready: boolean): ReadonlySet<string> {
  const seen = useRef<Set<string> | null>(null);
  const last = useRef<ReadonlySet<string>>(NO_IDS);
  const fresh = new Set<string>();
  if (ready && seen.current) for (const id of ids) if (!seen.current.has(id)) fresh.add(id);
  useEffect(() => {
    if (!ready) return;
    if (!seen.current) seen.current = new Set();
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


export function LetterAvatar({ name, theme, size = 14 }: { name: string; theme: PluginTheme; size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: 3, borderWidth: GLYPH_LINE, borderColor: theme.colors.foregroundMuted, alignItems: "center", justifyContent: "center" }}
    >
      <Text style={{ fontSize: size - 6, fontWeight: "600", color: theme.colors.foregroundMuted }}>{(name.trim()[0] ?? "?").toUpperCase()}</Text>
    </View>
  );
}

/** A 36 round icon button in a 44 target, with a count badge: the phone's search and filters, a narrow tablet board's filters. */
export function RoundButton(props: { icon: string; label: string; theme: PluginTheme; onPress(): void; active?: boolean; badge?: number; testID?: string }) {
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      testID={props.testID}
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

