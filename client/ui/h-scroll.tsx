import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
  type ScrollViewProps,
} from "react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { duration, easing, motionDuration } from "./tokens/motion";
import { useReducedMotion } from "./use-reduced-motion";

/** Indicator height and its gap above the content (S7 design spec §3.6, §3.7). */
const TRACK = 2;
const TRACK_GAP = 4;
/** A scroll-only track stays up this long after the last scroll event, then fades over `duration.fast`. */
export const TRACK_HOLD_MS = 1000;

interface HScrollProps {
  tokens: ExtendedThemeTokens;
  children: ReactNode;
  /** The scroller's own style. */
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** The indicator's own style, to move it off the default 4pt under the content. */
  trackStyle?: StyleProp<ViewStyle>;
  /** Use the platform indicator during scrolling instead of the persistent track. */
  indicatorOnScroll?: boolean;
  /**
   * Keep the track up only while the content is scrolled sideways, and fade it
   * out once the reader stops. The preview body asks for it: the track is
   * pinned to the panel's bottom edge there rather than left under the content,
   * so it would otherwise sit over the lines the whole time it is open.
   */
  trackOnScroll?: boolean;
  /** False while a gesture inside holds the content still. */
  scrollEnabled?: boolean;
  onScrollBeginDrag?: ScrollViewProps["onScrollBeginDrag"];
}

/**
 * Content wider than its column — a table, an unwrapped code line — scrolls
 * sideways. The default 2px track stays visible under code lines; tables use
 * the platform indicator, which appears during scrolling, and a preview body
 * asks for the same behaviour from this track (`trackOnScroll`).
 *
 * The thumb is an `Animated.View` translated by the scroll offset through
 * `Animated.event`, on the native driver where there is one, so scrolling
 * never re-renders anything. The two widths it needs arrive from one layout
 * and one content-size callback; the indicator is mounted only while the
 * content overflows, so a fitting code line costs the scroller alone. A
 * scroll-only track fades through its own animated value, so showing and
 * hiding it lays nothing out either.
 */
export function HScroll({ tokens, children, style, contentContainerStyle, trackStyle, indicatorOnScroll = false, trackOnScroll = false, scrollEnabled, onScrollBeginDrag }: HScrollProps) {
  const [{ viewport, content }, setWidths] = useState(NO_WIDTHS);
  const scrollX = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotion();
  // A track asked to show only while scrolling starts out of sight.
  const fade = useRef(new Animated.Value(trackOnScroll ? 0 : 1)).current;
  const linger = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A streamed table or code line widens the content with every chunk. Only
  // a change the indicator shows is committed: while the content fits before
  // and after, nothing drawn depends on the widths, so they are kept here.
  const measured = useRef(NO_WIDTHS);
  const drawn = useRef(NO_WIDTHS);
  drawn.current = { viewport, content };
  const report = useCallback((next: Widths) => {
    measured.current = next;
    const shown = drawn.current;
    if (next.viewport === shown.viewport && next.content === shown.content) return;
    if (!overflows(next) && !overflows(shown)) return;
    setWidths(next);
  }, []);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    report({ ...measured.current, viewport: Math.round(event.nativeEvent.layout.width) });
  }, [report]);
  const onContentSizeChange = useCallback((width: number) => {
    report({ ...measured.current, content: Math.round(width) });
  }, [report]);

  const animate = useCallback((toValue: number) => {
    const ms = motionDuration(duration.fast, reducedMotion);
    if (ms === 0) {
      fade.setValue(toValue);
      return;
    }
    Animated.timing(fade, { toValue, duration: ms, easing: easing.out, useNativeDriver: Platform.OS !== "web" }).start();
  }, [fade, reducedMotion]);
  // The reader is moving the content: keep the track up, and start hiding it
  // again a moment after the last event.
  const reveal = useCallback(() => {
    animate(1);
    if (linger.current !== null) clearTimeout(linger.current);
    linger.current = setTimeout(() => {
      linger.current = null;
      animate(0);
    }, TRACK_HOLD_MS);
  }, [animate]);
  useEffect(() => () => {
    if (linger.current !== null) clearTimeout(linger.current);
  }, []);

  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: Platform.OS !== "web",
        listener: trackOnScroll ? reveal : undefined,
      }),
    [scrollX, trackOnScroll, reveal],
  );

  const overflow = !indicatorOnScroll && overflows({ viewport, content });
  const thumb = overflow ? Math.max(24, Math.round((viewport * viewport) / content)) : 0;
  // Offset 0..(content - viewport) maps to thumb 0..(viewport - thumb).
  const ratio = overflow ? (viewport - thumb) / (content - viewport) : 0;
  const translateX = useMemo(
    () =>
      ratio > 0
        ? scrollX.interpolate({
            inputRange: [0, content - viewport],
            outputRange: [0, ratio * (content - viewport)],
            extrapolate: "clamp",
          })
        : 0,
    [scrollX, ratio, content, viewport],
  );
  const visibility = useMemo(() => ({ opacity: fade }), [fade]);

  // One wrapper, always present: inside a `gap` column the indicator stays
  // 4pt under its content, and the scroller never remounts when it appears.
  return (
    <View>
      <Animated.ScrollView
        horizontal
        showsHorizontalScrollIndicator={indicatorOnScroll}
        onLayout={indicatorOnScroll ? undefined : onLayout}
        onContentSizeChange={indicatorOnScroll ? undefined : onContentSizeChange}
        onScroll={indicatorOnScroll ? undefined : onScroll}
        onScrollBeginDrag={onScrollBeginDrag}
        scrollEventThrottle={16}
        scrollEnabled={scrollEnabled}
        style={style}
        contentContainerStyle={contentContainerStyle}
      >
        {children}
      </Animated.ScrollView>
      {overflow ? (
        <Animated.View
          style={[styles.track, { backgroundColor: tokens.v2.surface2 }, trackOnScroll ? visibility : null, trackStyle]}
          pointerEvents="none"
        >
          <Animated.View
            style={[
              styles.thumb,
              { width: thumb, backgroundColor: tokens.foregroundSubtle, transform: [{ translateX }] },
            ]}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

interface Widths {
  viewport: number;
  content: number;
}

const NO_WIDTHS: Widths = { viewport: 0, content: 0 };

function overflows({ viewport, content }: Widths): boolean {
  return viewport > 0 && content > viewport + 1;
}

const styles = StyleSheet.create({
  track: {
    height: TRACK,
    marginTop: TRACK_GAP,
    borderRadius: TRACK / 2,
    overflow: "hidden",
  },
  thumb: {
    height: TRACK,
    borderRadius: TRACK / 2,
  },
});
