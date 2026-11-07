import React, { useEffect, useMemo, useRef } from "react";
import { Animated, PanResponder, Platform, Pressable, View, type GestureResponderEvent } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { perfStart, probeDragEnd, probeDragMove, probeDragStart, type DragTrack } from "../../debug/perf";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { HAIRLINE, MOTION, boardPalette } from "./board-style";
import { menuChrome } from "./menu-model";
import { sheetHeight, sheetRelease, type SheetDetent } from "./sidebar-model";

/** Match the side panel's 12 px resize strip with a compact horizontal grabber. */
const HANDLE = 12;

/**
 * The details of a board too narrow to float them beside its lanes
 * (`docs/prototypes/task-board-pad.md`): a sheet over the lanes' lower part,
 * not modal and without a scrim, so the lanes above it still scroll and take
 * a click. Half height leaves the lanes' top in view; full leaves a strip.
 * Only the handle drags it (the content scrolls); a tap on the handle
 * switches the two heights, a drag down from half closes it.
 */
export function BoardSheet(props: {
  /** The lanes' area the sheet rises in. */
  area: number;
  detent: SheetDetent;
  onDetent(detent: SheetDetent): void;
  onClose(): void;
  theme: PluginTheme;
  labels: { grow: string; shrink: string };
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const target = sheetHeight(props.area, props.detent);
  const height = useRef(new Animated.Value(0)).current;
  const latest = useRef(props);
  latest.current = props;
  const opened = useRef(false);
  // A drag ends with a click on the handle it moved with: that click must not switch the height back.
  const dragged = useRef(false);

  useEffect(() => {
    const animation = Animated.timing(height, {
      toValue: target,
      duration: reduced ? 0 : opened.current ? 240 : 280,
      easing: MOTION.ease,
      useNativeDriver: false,
    });
    opened.current = true;
    animation.start();
    return () => animation.stop();
  }, [height, target, reduced]);

  const pan = useMemo(() => {
    let start = 0;
    // PanResponder counts dy from the grant, a later move (much later when the JS thread is busy):
    // measure the drag from where the finger went down.
    let touchY = 0;
    const travel = (event: GestureResponderEvent) => event.nativeEvent.pageY - touchY;
    // The perf probes' record of this drag (`/bc-perf`); null while they are off.
    let probe: DragTrack | null = null;
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: (event) => {
        touchY = event.nativeEvent.pageY;
        return false;
      },
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        start = sheetHeight(latest.current.area, latest.current.detent);
        dragged.current = true;
        probe = probeDragStart("sheet", event.nativeEvent.timestamp);
      },
      onPanResponderMove: (event) => {
        const startedAt = probe === null ? 0 : perfStart();
        const full = sheetHeight(latest.current.area, "full");
        height.setValue(Math.max(HANDLE, Math.min(full, start - travel(event))));
        if (probe !== null) probeDragMove(probe, event.nativeEvent.timestamp, startedAt);
      },
      onPanResponderRelease: (event, gesture) => {
        probeDragEnd(probe, "release", event.nativeEvent.timestamp);
        probe = null;
        setTimeout(() => {
          dragged.current = false;
        }, 300);
        const now = latest.current;
        const next = sheetRelease(now.detent, travel(event), gesture.vy);
        if (next === "closed") {
          Animated.timing(height, { toValue: 0, duration: 200, easing: MOTION.ease, useNativeDriver: false }).start(() => latest.current.onClose());
          return;
        }
        if (next === now.detent) {
          Animated.timing(height, { toValue: sheetHeight(now.area, next), duration: 200, easing: MOTION.ease, useNativeDriver: false }).start();
        } else {
          now.onDetent(next);
        }
      },
      onPanResponderTerminate: (event) => {
        probeDragEnd(probe, "terminate", event.nativeEvent.timestamp);
        probe = null;
        dragged.current = false;
        const now = latest.current;
        Animated.timing(height, { toValue: sheetHeight(now.area, now.detent), duration: 200, easing: MOTION.ease, useNativeDriver: false }).start();
      },
    });
  }, [height]);

  const palette = boardPalette(props.theme);
  const chrome = menuChrome(props.theme);
  const full = props.detent === "full";
  return (
    <Animated.View
      testID="board-sheet"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height,
        zIndex: 20,
        borderRadius: 0,
        borderTopWidth: HAIRLINE,
        borderColor: chrome.border,
        backgroundColor: palette.panel,
        ...(Platform.OS === "web" ? ({ boxShadow: "0 -8px 28px rgba(0, 0, 0, 0.14)" } as object) : { elevation: 12, shadowColor: "#000", shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: -6 } }),
      }}
    >
      <View {...pan.panHandlers} style={{ height: HANDLE, ...(Platform.OS === "web" ? ({ cursor: "grab", touchAction: "none" } as object) : null) }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={full ? props.labels.shrink : props.labels.grow}
          onPress={() => {
            if (dragged.current) return;
            props.onDetent(full ? "half" : "full");
          }}
          testID="board-sheet-handle"
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <View style={{ width: 32, height: 3, borderRadius: 1.5, backgroundColor: props.theme.colors.foregroundMuted, opacity: 0.5 }} />
        </Pressable>
      </View>
      <View style={{ flex: 1, minHeight: 0, paddingHorizontal: 4, paddingBottom: 4 }}>{props.children}</View>
    </Animated.View>
  );
}
