import React, { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";

/** Indicator height and its gap above the content (S7 design spec §3.6, §3.7). */
const TRACK = 2;
const TRACK_GAP = 4;

interface HScrollProps {
  tokens: ExtendedThemeTokens;
  children: ReactNode;
  /** The scroller's own style. */
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** The indicator's own style, to move it off the default 4pt under the content. */
  trackStyle?: StyleProp<ViewStyle>;
}

/**
 * Content wider than its column — a table, an unwrapped code line — scrolls
 * sideways, and a 2px indicator under it says so. React Native draws its own
 * indicator only while a scroll is in progress, so at rest a wide table looked
 * clipped (S7 iOS screenshots: "What i…").
 *
 * The thumb is an `Animated.View` translated by the scroll offset through
 * `Animated.event`, on the native driver where there is one, so scrolling
 * never re-renders anything. The two widths it needs arrive from one layout
 * and one content-size callback; the indicator is mounted only while the
 * content overflows, so a table that fits costs the scroller alone.
 */
export function HScroll({ tokens, children, style, contentContainerStyle, trackStyle }: HScrollProps) {
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    setViewport((previous) => (previous === width ? previous : width));
  }, []);
  const onContentSizeChange = useCallback((width: number) => {
    const rounded = Math.round(width);
    setContent((previous) => (previous === rounded ? previous : rounded));
  }, []);
  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: Platform.OS !== "web",
      }),
    [scrollX],
  );

  const overflow = viewport > 0 && content > viewport + 1;
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

  // One wrapper, always present: inside a `gap` column the indicator stays
  // 4pt under its content, and the scroller never remounts when it appears.
  return (
    <View>
      <Animated.ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        onLayout={onLayout}
        onContentSizeChange={onContentSizeChange}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={style}
        contentContainerStyle={contentContainerStyle}
      >
        {children}
      </Animated.ScrollView>
      {overflow ? (
        <View style={[styles.track, { backgroundColor: tokens.v2.surface2 }, trackStyle]} pointerEvents="none">
          <Animated.View
            style={[
              styles.thumb,
              { width: thumb, backgroundColor: tokens.foregroundSubtle, transform: [{ translateX }] },
            ]}
          />
        </View>
      ) : null}
    </View>
  );
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
