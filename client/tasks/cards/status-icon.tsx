import React, { memo, useCallback, useLayoutEffect, useRef } from "react";
import { Animated, Platform, View, type ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { probeAnimationLoop } from "../../debug/perf";
import { steppedEasing } from "../../ui/tokens/motion";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import type { StatusKind } from "../model";
import { taskTokens } from "./tokens";

/**
 * Paseo's sidebar workspace indicator (`components/status-ring/`,
 * `sidebar-workspace-row-content.tsx`), drawn from Views: no SVG on native.
 *
 * At the default 16 px box the mark is the host's exactly: a 6 px centre dot,
 * a 12 px ring of 1.5 px stroke (1.5 gap) whose track sits at 30% and whose
 * 90° quarter at 90%, one turn per 900 ms. The quarter is a fully rounded box
 * with only its top border coloured, which is a 90° arc. Smaller boxes scale
 * the mark by 3/4; larger ones grow it by half the extra (20 → 14, as the
 * prototype's phone tab).
 *
 * One deliberate deviation, at the user's request: needs-input is a hollow
 * amber ring (the running track, whole and opaque), not the host's filled
 * CircleAlert.
 */

export const STATUS_RING_PERIOD_MS = 900;
/** Native turns in steps, like the host's ring and a platform activity indicator. */
export const STATUS_RING_STEPS = 12;
const TRACK_OPACITY = 0.3;
const HEAD_OPACITY = 0.9;

/** The mark's diameter for a box: 12 at 16, 9 at 12, 14 at 20. */
export function statusMarkSize(box: number): number {
  return box < 16 ? box * 0.75 : 12 + (box - 16) / 2;
}

export interface StatusIconProps {
  /** A status, or "stopped" for a card stopped from the board: a solid square. */
  kind: StatusKind | "stopped";
  /** Box width; the ring and dots scale from Paseo's sidebar geometry. Default 16. */
  size?: number;
  /** Box height, the line it centres on (the card's title line is 20). Default `size`. */
  height?: number;
  theme: PluginTheme;
  /**
   * The surface under the icon. Kept for callers; the hollow needs-input ring
   * no longer knocks anything out of a fill. Default `surface0`.
   */
  backdrop?: string;
  /** False stops the ring (a hidden pane, a static preview). Default true. */
  animated?: boolean;
  accessibilityLabel?: string;
}

const WEB = Platform.OS === "web";

// --- One clock for every ring ------------------------------------------------
//
// Native: one Animated.Value on the native driver, started when the first ring
// mounts and stopped when the last one leaves, so every ring is in phase and a
// board without running cards runs nothing. Its easing holds each of 12 steps
// (`steppedEasing`): a smooth turn changed the arc on every vsync, and many
// Android devices redraw the whole window for that. Web: each ring runs a Web Animation
// pinned to the document timeline's origin (`startTime = 0`), the host's own
// approach in `clock.web.ts`, so rings mounted at different times still agree.

let spin: Animated.Value | null = null;
let rotation: Animated.AnimatedInterpolation<string> | null = null;
let loop: Animated.CompositeAnimation | null = null;
let holders = 0;
let releaseProbe: (() => void) | null = null;

function sharedRotation(): Animated.AnimatedInterpolation<string> {
  if (!spin || !rotation) {
    spin = new Animated.Value(0);
    rotation = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  }
  return rotation;
}

/** Keeps the shared loop running while held; the returned function lets go once. */
export function holdStatusRing(): () => void {
  sharedRotation();
  holders += 1;
  if (holders === 1 && spin) {
    spin.setValue(0);
    loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: STATUS_RING_PERIOD_MS,
        easing: steppedEasing(STATUS_RING_STEPS),
        useNativeDriver: true,
        isInteraction: false,
      }),
    );
    loop.start();
    releaseProbe = probeAnimationLoop("StatusRing");
  }
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holders -= 1;
    if (holders === 0) {
      loop?.stop();
      loop = null;
      releaseProbe?.();
      releaseProbe = null;
    }
  };
}

/** Rings holding the shared clock right now; for tests. */
export function statusRingHolders(): number {
  return holders;
}

const WEB_KEYFRAMES = [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }];

function useWebSpin(active: boolean) {
  const node = useRef<HTMLElement | null>(null);
  const setNode = useCallback((instance: unknown) => {
    node.current = typeof HTMLElement !== "undefined" && instance instanceof HTMLElement ? instance : null;
  }, []);
  useLayoutEffect(() => {
    const element = node.current;
    if (!active || !element || typeof element.animate !== "function") return;
    const animation = element.animate(WEB_KEYFRAMES, {
      duration: STATUS_RING_PERIOD_MS,
      easing: "linear",
      iterations: Number.POSITIVE_INFINITY,
    });
    animation.startTime = 0;
    const release = probeAnimationLoop("StatusRing");
    return () => {
      animation.cancel();
      release();
    };
  }, [active]);
  return setNode;
}

function useNativeSpin(active: boolean): void {
  useLayoutEffect(() => (active ? holdStatusRing() : undefined), [active]);
}

const RunningRing = memo(function RunningRing(props: {
  box: ViewStyle;
  mark: number;
  color: string;
  animated: boolean;
  accessibilityLabel?: string;
}) {
  const { box, mark, color } = props;
  const reduced = useReducedMotion();
  const active = props.animated && !reduced;
  const setWebNode = useWebSpin(WEB && active);
  useNativeSpin(!WEB && active);
  const scale = mark / 12;
  const stroke = 1.5 * scale;
  const dot = 6 * scale;
  const width = box.width as number;
  const height = box.height as number;
  const circle: ViewStyle = {
    position: "absolute",
    left: (width - mark) / 2,
    top: (height - mark) / 2,
    width: mark,
    height: mark,
    borderRadius: mark / 2,
    borderWidth: stroke,
  };
  const arc: ViewStyle = { ...circle, borderColor: "transparent", borderTopColor: color, opacity: HEAD_OPACITY };
  return (
    <View style={box} testID="status-running" accessibilityLabel={props.accessibilityLabel}>
      <View style={[circle, { borderColor: color, opacity: TRACK_OPACITY }]} />
      {WEB ? (
        <View ref={setWebNode as never} style={arc} />
      ) : (
        <Animated.View style={[arc, active ? { transform: [{ rotate: sharedRotation() }] } : null]} />
      )}
      <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color }} />
    </View>
  );
});

/** Paseo's sidebar status indicator. All running rings turn in phase (900 ms per turn, in 12 steps on native). */
export const StatusIcon = memo(function StatusIcon(props: StatusIconProps) {
  const size = props.size ?? 16;
  const height = props.height ?? size;
  const tokens = taskTokens(props.theme);
  const mark = statusMarkSize(size);
  const scale = mark / 12;
  const box: ViewStyle = { width: size, height, flexShrink: 0, alignItems: "center", justifyContent: "center" };
  const a11y = props.accessibilityLabel ? { accessibilityLabel: props.accessibilityLabel } : null;

  if (props.kind === "running") {
    return (
      <RunningRing
        box={box}
        mark={mark}
        color={tokens.status.running}
        animated={props.animated !== false}
        accessibilityLabel={props.accessibilityLabel}
      />
    );
  }

  if (props.kind === "needs_input") {
    // A deliberate deviation from the host (the user's call): not the filled
    // CircleAlert but a hollow amber ring, empty in the middle, no "!". It is
    // the running ring's track (same diameter and stroke) drawn whole and
    // fully opaque, with no centre dot and no turning arc, so the two never
    // read alike.
    const stroke = 1.5 * scale;
    return (
      <View style={box} testID="status-needs_input" {...a11y}>
        <View
          testID="status-needs_input-ring"
          style={{
            width: mark,
            height: mark,
            borderRadius: mark / 2,
            borderWidth: stroke,
            borderColor: tokens.status.warning,
          }}
        />
      </View>
    );
  }

  if (props.kind === "stopped") {
    // Stopped is the stop pill's solid square (an approved deviation from
    // the prototype), muted: a stop is not a failure.
    const side = mark * 0.75;
    return (
      <View style={box} testID="status-stopped" {...a11y}>
        <View style={{ width: side, height: side, borderRadius: 2 * scale, backgroundColor: tokens.foregroundMuted }} />
      </View>
    );
  }

  if (props.kind === "done") {
    // Done is a green circled check (the user's call), not the prototype's
    // grey dot: a finished run reads as a success at a glance.
    return (
      <View style={box} testID="status-done" {...a11y}>
        <Icon name="CircleCheck" size={size} color={tokens.status.success} />
      </View>
    );
  }

  if (props.kind === "archived") {
    // The archived lane's own mark: Lucide's box, muted.
    return (
      <View style={box} testID="status-archived" {...a11y}>
        <Icon name="Archive" size={size} color={tokens.foregroundMuted} />
      </View>
    );
  }

  // The prototype's dots: unread 6, failed 8.
  const dot = (props.kind === "failed" ? 8 : 6) * scale;
  const color = props.kind === "unread" ? tokens.status.success : tokens.status.danger;
  return (
    <View style={box} testID={`status-${props.kind}`} {...a11y}>
      <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color }} />
    </View>
  );
});
