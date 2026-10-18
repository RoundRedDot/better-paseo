import React, { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
// A namespace import: the 0.11.2 SDK types do not declare the hook, and a host
// that predates it injects a module object without the key.
import * as PluginReactNative from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { hairline } from "./tokens/platform";
import { DISCLOSURE_HEADER } from "./disclosure-header";

/** The host's `useTimelineStickyHeader` (Paseo H2b, `bc/sticky`). */
export type StickyHeaderHook = (options: {
  headerHeight: number;
  enabled: boolean;
}) => Animated.AnimatedInterpolation<number> | null;

/**
 * The host's sticky header hook, or null on a host that does not provide it
 * (Paseo 0.11.2 and earlier). Feature detection as the SDK documents it:
 * `typeof useTimelineStickyHeader === "function"`.
 */
export function resolveStickyHook(runtime: unknown): StickyHeaderHook | null {
  if (runtime === null || (typeof runtime !== "object" && typeof runtime !== "function")) return null;
  // `in` first: a module namespace that lacks the export may refuse the read.
  if (!("useTimelineStickyHeader" in runtime)) return null;
  const candidate = (runtime as Record<string, unknown>).useTimelineStickyHeader;
  return typeof candidate === "function" ? (candidate as StickyHeaderHook) : null;
}

/** Read once: a host provides the hook for the whole session or not at all. */
const HOST_STICKY_HOOK = resolveStickyHook(PluginReactNative);

/** Whether this host can pin a card header (S6). */
export const STICKY_SUPPORTED = HOST_STICKY_HOOK !== null;

/** A card pins its header only once it is taller than this share of the window (plan §3.5). */
export const STICKY_VIEWPORT_RATIO = 0.6;

/**
 * The enable rule (plan §3.5, S6): an expanded card whose height exceeds 60% of
 * the viewport. A shorter card is read in one glance, and pinning its header
 * would only cover its first lines.
 */
export function shouldStick(
  expanded: boolean,
  cardHeight: number,
  viewportHeight: number,
  ratio = STICKY_VIEWPORT_RATIO,
): boolean {
  return expanded && viewportHeight > 0 && cardHeight > viewportHeight * ratio;
}

interface StickyCardProps {
  tokens: ExtendedThemeTokens;
  /** `layout.compact`: the header row's height. */
  compact: boolean;
  /** The card's header row. */
  header: ReactNode;
  /** The opened body, drawn under the header. */
  children: ReactNode;
}

/**
 * An expanded card on a host with the sticky header API (S6): its header
 * follows the top of the transcript, below the host's pinned prompt, while the
 * card scrolls past, and the card's end pushes it out.
 *
 * Mounted only while the card is expanded, so a collapsed row never calls the
 * hook, measures, or subscribes to the window size. Collapsing unmounts it:
 * the header goes back into the row as a fresh view with no transform, so a
 * card collapsed while pinned leaves no stale offset.
 *
 * Within an expanded card the transform stays bound even while the card is too
 * short to pin (`enabled` false keeps the value at 0): under Fabric a native
 * view whose animated transform is swapped for a static one keeps its last
 * position (H2 finding 4).
 */
export function StickyCard({ tokens, compact, header, children }: StickyCardProps) {
  const useHostStickyHeader = HOST_STICKY_HOOK as StickyHeaderHook;
  const headerHeight = compact ? tokens.typography.block.rowHeight.compact : tokens.typography.block.rowHeight.desktop;
  const { height: viewportHeight } = useWindowDimensions();
  const bodyHeight = useRef(0);
  const [tall, setTall] = useState(false);
  const tallRef = useRef(false);

  // Only the crossing of the threshold re-renders: a body that grows line by
  // line while a command streams lays out on every chunk, and an update that
  // keeps the same value can still cost React one render, so none is queued.
  const settle = useCallback(() => {
    const next = shouldStick(true, headerHeight + bodyHeight.current, viewportHeight);
    if (next === tallRef.current) return;
    tallRef.current = next;
    setTall(next);
  }, [headerHeight, viewportHeight]);
  const onBodyLayout = useCallback(
    (event: LayoutChangeEvent) => {
      bodyHeight.current = event.nativeEvent.layout.height;
      settle();
    },
    [settle],
  );
  useEffect(settle, [settle]);

  const translateY = useHostStickyHeader({ headerHeight, enabled: tall });
  // The rule appears with the offset: 0 at rest, full once the header has
  // moved a point. Opacity runs on the native driver like the transform.
  const ruleOpacity = translateY
    ? translateY.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" })
    : 0;

  return (
    <>
      <Animated.View
        style={[
          styles.header,
          { backgroundColor: tokens.v2.surface0 },
          { transform: translateY ? [{ translateY }] : [] },
        ]}
      >
        {header}
        <Animated.View
          pointerEvents="none"
          style={[styles.rule, hairline(tokens.platform, "bottom"), { backgroundColor: tokens.v2.border, opacity: ruleOpacity }]}
        />
      </Animated.View>
      <View onLayout={onBodyLayout}>{children}</View>
    </>
  );
}

const styles = StyleSheet.create({
  // Above the body that scrolls under it, opaque so the body does not show
  // through, and as wide as the row's outdent.
  header: {
    zIndex: 1,
    marginHorizontal: -DISCLOSURE_HEADER.bleed,
    paddingHorizontal: DISCLOSURE_HEADER.bleed,
  },
  rule: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
});
