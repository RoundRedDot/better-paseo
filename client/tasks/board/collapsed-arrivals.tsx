import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Animated, Platform, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { TaskText as Text, HOST_FONT as F } from "../typography";
import { LANE_ORDER, type LaneId, type LaneModel } from "../model";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { mix } from "../../components/theme-tokens";
import { MOTION, PANEL_RADIUS } from "./board-style";
import { NEW_WINDOW_MS } from "./new-cards";

const EMPTY: readonly string[] = [];
const nativeDriver = Platform.OS !== "web";

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

/** Static marker remains until the lane is opened; each arrival gives one brief pulse. */
export function CollapsedArrivalMarker(props: { ids: readonly string[]; hue: string; theme: PluginTheme; lane: LaneId }) {
  const reduced = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(0));
  const key = props.ids.join("\u0000");
  const previous = useRef<readonly string[]>([]);
  useEffect(() => {
    const added = props.ids.some((id) => !previous.current.includes(id));
    previous.current = props.ids;
    if (!added || reduced) return;
    pulse.setValue(0);
    const animation = Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 180, easing: MOTION.ease, useNativeDriver: nativeDriver }),
      Animated.timing(pulse, { toValue: 0, duration: 700, easing: MOTION.ease, useNativeDriver: nativeDriver }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [key, reduced, pulse]);
  if (!props.ids.length) return null;
  return (
    <View pointerEvents="none" testID={`lane-new-marker-${props.lane}`} style={{ alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ position: "absolute", width: 30, height: 24, borderRadius: 12, borderWidth: 2, borderColor: props.hue, opacity: pulse, transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1.6, 1] }) }] }} />
      <Animated.View style={{ transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }], minWidth: 26, maxWidth: 38, height: 22, paddingHorizontal: 4, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: mix(props.theme.colors.surface0, props.hue, 0.18), borderWidth: 1, borderColor: props.hue }}>
        <Text testID={`lane-new-count-${props.lane}`} numberOfLines={1} style={{ color: props.theme.colors.foreground, fontSize: F.sm, fontWeight: "700", fontVariant: ["tabular-nums"] }}>+{props.ids.length > 99 ? "99+" : props.ids.length}</Text>
      </Animated.View>
    </View>
  );
}

export function CollapsedArrivalHighlight(props: { ids: readonly string[]; hue: string }) {
  const reduced = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(0));
  const key = props.ids.join("\u0000");
  const previous = useRef<readonly string[]>([]);
  useEffect(() => {
    const added = props.ids.some((id) => !previous.current.includes(id));
    previous.current = props.ids;
    if (!added || reduced) return;
    pulse.setValue(1);
    const animation = Animated.timing(pulse, { toValue: 0, duration: 880, easing: MOTION.ease, useNativeDriver: nativeDriver });
    animation.start();
    return () => animation.stop();
  }, [key, reduced, pulse]);
  if (!props.ids.length) return null;
  return <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, borderRadius: PANEL_RADIUS, overflow: "hidden" }}>
    <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: props.hue, opacity: 0.08 }} />
    <Animated.View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, borderWidth: 2, borderRadius: PANEL_RADIUS, borderColor: props.hue, opacity: pulse }} />
  </View>;
}
