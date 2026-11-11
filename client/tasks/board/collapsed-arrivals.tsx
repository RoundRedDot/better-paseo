import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Animated, Platform, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { TaskText as Text, HOST_FONT as F, useTasksFontScale } from "../typography";
import { LANE_ORDER, type LaneId, type LaneModel } from "../model";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { mix } from "../../components/theme-tokens";
import { cubicBezier } from "./board-style";
import { NEW_WINDOW_MS } from "./new-cards";

const EMPTY: readonly string[] = [];
const nativeDriver = Platform.OS !== "web";
const markerEase = cubicBezier(0.2, 0.7, 0.2, 1);

type Lanes = Record<LaneId, LaneModel>;

/** Cards entering a folded lane since it was last opened, scoped to this board. */
export function createCollapsedArrivals() {
  let previous: Map<string, LaneId> | null = null;
  let lastScope: unknown;
  let arrivals: Partial<Record<LaneId, readonly string[]>> = {};
  const listeners = new Set<() => void>();
  return {
    track(lanes: Lanes, collapsed: readonly LaneId[], scope: unknown, ready: boolean, now = Date.now()) {
      if (!ready) return;
      const next = new Map<string, LaneId>();
      for (const lane of LANE_ORDER) for (const card of lanes[lane].cards) next.set(card.id, lane);
      const reset = previous === null || lastScope !== scope;
      let changed = false;
      const updated: Partial<Record<LaneId, readonly string[]>> = {};
      for (const lane of LANE_ORDER) {
        const before = arrivals[lane] ?? EMPTY;
        const ids = new Set(reset || !collapsed.includes(lane) ? EMPTY : before.filter((id) => next.get(id) === lane));
        if (!reset && collapsed.includes(lane)) {
          for (const card of lanes[lane].cards) {
            const was = previous!.get(card.id);
            const created = Date.parse(card.timing.createdAt);
            if ((was !== undefined && was !== lane) || (was === undefined && !card.subagent && Number.isFinite(created) && now - created <= NEW_WINDOW_MS)) ids.add(card.id);
          }
        }
        const result = [...ids];
        const same = before.length === result.length && before.every((id, index) => id === result[index]);
        if (!same) changed = true;
        if (result.length) updated[lane] = same ? before : result;
      }
      previous = next;
      lastScope = scope;
      arrivals = updated;
      if (changed) listeners.forEach((listener) => listener());
    },
    get: (lane: LaneId) => arrivals[lane] ?? EMPTY,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export type CollapsedArrivals = ReturnType<typeof createCollapsedArrivals>;

export function useCollapsedArrivals(store: CollapsedArrivals, lane: LaneId): readonly string[] {
  const read = () => store.get(lane);
  return useSyncExternalStore(store.subscribe, read, read);
}

/** The marker fades and grows into view, then remains until the lane is opened. */
export function CollapsedArrivalMarker(props: { ids: readonly string[]; hue: string; theme: PluginTheme; lane: LaneId }) {
  const reduced = useReducedMotion();
  const fontScale = useTasksFontScale();
  const [scale] = useState(() => new Animated.Value(1));
  const key = props.ids.join("\u0000");
  const previous = useRef<readonly string[]>([]);
  useEffect(() => {
    const appearing = previous.current.length === 0 && props.ids.length > 0;
    previous.current = props.ids;
    if (reduced || !appearing) { scale.setValue(1); return; }
    scale.setValue(0);
    const animation = Animated.timing(scale, { toValue: 1, duration: 300, easing: markerEase, useNativeDriver: nativeDriver });
    animation.start();
    return () => animation.stop();
  }, [key, reduced, scale]);
  if (!props.ids.length) return null;
  const diameter = Math.round((props.ids.length > 99 ? 30 : props.ids.length > 9 ? 24 : 18) * Math.max(1, fontScale));
  return (
    <View pointerEvents="none" testID={`lane-new-marker-${props.lane}`} style={{ alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ opacity: scale, transform: [{ scale: scale.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) }], width: diameter, height: diameter, borderRadius: diameter / 2, alignItems: "center", justifyContent: "center", backgroundColor: mix(props.theme.colors.surface0, props.hue, 0.18) }}>
        <Text testID={`lane-new-count-${props.lane}`} numberOfLines={1} style={{ color: props.theme.colors.foreground, fontSize: F.sm - 2, fontVariant: ["tabular-nums"] }}>+{props.ids.length > 99 ? "99+" : props.ids.length}</Text>
      </Animated.View>
    </View>
  );
}
