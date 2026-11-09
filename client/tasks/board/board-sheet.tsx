import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Platform, Pressable, View, type GestureResponderEvent } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
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
 *
 * A switch moves the sheet first and tells the board (`onDetent`) once it is
 * there: the board's render that follows a new height (every lane's bottom
 * room, the details) held the JS thread for 200-360 ms on an Android tablet,
 * and a JS-driven height cannot move before that render is done.
 */
export interface BoardSheetHandle {
  /** Switch the two heights, from the one a switch already moving is heading to. */
  toggle(): void;
}

export const BoardSheet = forwardRef<BoardSheetHandle, {
  /** The lanes' area the sheet rises in. */
  area: number;
  open: boolean;
  detent: SheetDetent;
  onDetent(detent: SheetDetent): void;
  onClose(): void;
  theme: PluginTheme;
  labels: { grow: string; shrink: string };
  children: React.ReactNode;
}>(function BoardSheet(props, ref) {
  const reduced = useReducedMotion();
  const [present, setPresent] = useState(props.open);
  const content = useRef(props.children);
  if (props.open) content.current = props.children;
  const reducedNow = useRef(reduced);
  reducedNow.current = reduced;
  const target = sheetHeight(props.area, props.detent);
  const height = useRef(new Animated.Value(0)).current;
  const latest = useRef(props);
  latest.current = props;
  const opened = useRef(false);
  const closedByDrag = useRef(false);
  // A drag ends with a click on the handle it moved with: that click must not switch the height back.
  const dragged = useRef(false);
  // The height the value rests at or is moving to: a board that catches up with a switch already there moves nothing.
  const aimed = useRef<number | null>(null);
  // A switch on its way, before the board hears of it.
  const heading = useRef<{ detent: SheetDetent; run: Animated.CompositeAnimation } | null>(null);

  useEffect(() => {
    if (!props.open) {
      if (!present) return;
      if (closedByDrag.current || reduced) {
        height.setValue(0);
        aimed.current = 0;
        setPresent(false);
        return;
      }
      aimed.current = 0;
      const animation = Animated.timing(height, { toValue: 0, duration: 200, easing: MOTION.ease, useNativeDriver: false });
      animation.start(({ finished }) => { if (finished) setPresent(false); });
      return () => animation.stop();
    }
    closedByDrag.current = false;
    if (!present) {
      setPresent(true);
      return;
    }
    if (aimed.current === target) return;
    aimed.current = target;
    const animation = Animated.timing(height, {
      toValue: target,
      duration: reduced ? 0 : opened.current ? 240 : 280,
      easing: MOTION.ease,
      useNativeDriver: false,
    });
    opened.current = true;
    animation.start();
    return () => animation.stop();
  }, [height, target, reduced, props.open, present]);

  const motion = useMemo(() => {
    const drop = () => {
      const last = heading.current;
      heading.current = null;
      last?.run.stop();
    };
    const settle = (next: SheetDetent, duration: number) => {
      drop();
      const to = sheetHeight(latest.current.area, next);
      aimed.current = to;
      const tell = () => {
        if (latest.current.detent !== next) latest.current.onDetent(next);
      };
      if (reducedNow.current) {
        height.setValue(to);
        tell();
        return;
      }
      const run = Animated.timing(height, { toValue: to, duration, easing: MOTION.ease, useNativeDriver: false });
      heading.current = { detent: next, run };
      run.start(({ finished }) => {
        // Stopped by another switch, a drag or the sheet closing: that one decides.
        if (heading.current?.run !== run) return;
        heading.current = null;
        if (finished) tell();
      });
    };
    return {
      drop,
      settle,
      toggle: () => settle((heading.current?.detent ?? latest.current.detent) === "full" ? "half" : "full", 240),
    };
  }, [height]);
  useImperativeHandle(ref, () => ({ toggle: motion.toggle }), [motion]);
  useEffect(() => { if (!props.open) motion.drop(); }, [motion, props.open]);
  // A switch still moving when the sheet closes does not reach the board.
  useEffect(() => motion.drop, [motion]);

  const pan = useMemo(() => {
    let start = 0;
    // PanResponder counts dy from the grant, a later move (much later when the JS thread is busy):
    // measure the drag from where the finger went down.
    let touchY = 0;
    const travel = (event: GestureResponderEvent) => event.nativeEvent.pageY - touchY;
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: (event) => {
        touchY = event.nativeEvent.pageY;
        return false;
      },
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        // A drag catches the sheet where it is, a switch still moving included.
        motion.drop();
        start = sheetHeight(latest.current.area, latest.current.detent);
        height.stopAnimation((value) => {
          start = value;
        });
        aimed.current = null;
        dragged.current = true;
      },
      onPanResponderMove: (event) => {
        const full = sheetHeight(latest.current.area, "full");
        height.setValue(Math.max(HANDLE, Math.min(full, start - travel(event))));
      },
      onPanResponderRelease: (event, gesture) => {
        setTimeout(() => {
          dragged.current = false;
        }, 300);
        const now = latest.current;
        const next = sheetRelease(now.detent, travel(event), gesture.vy);
        if (next === "closed") {
          aimed.current = 0;
          if (reducedNow.current) {
            height.setValue(0);
            closedByDrag.current = true;
            latest.current.onClose();
            return;
          }
          Animated.timing(height, { toValue: 0, duration: 200, easing: MOTION.ease, useNativeDriver: false }).start(({ finished }) => {
            if (!finished) return;
            closedByDrag.current = true;
            latest.current.onClose();
          });
          return;
        }
        motion.settle(next, next === now.detent ? 200 : 240);
      },
      onPanResponderTerminate: () => {
        dragged.current = false;
        motion.settle(latest.current.detent, 200);
      },
    });
  }, [height, motion]);

  const palette = boardPalette(props.theme);
  const chrome = menuChrome(props.theme);
  const full = props.detent === "full";
  if (!present) return null;
  return (
    <Animated.View
      testID="board-sheet"
      pointerEvents={props.open ? "auto" : "none"}
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
            motion.toggle();
          }}
          testID="board-sheet-handle"
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <View style={{ width: 32, height: 3, borderRadius: 1.5, backgroundColor: props.theme.colors.foregroundMuted, opacity: 0.5 }} />
        </Pressable>
      </View>
      <View testID="board-sheet-content" style={{ flex: 1, minHeight: 0, paddingHorizontal: 12, paddingBottom: Platform.OS === "android" ? 20 : 4 }}>{content.current}</View>
    </Animated.View>
  );
});
