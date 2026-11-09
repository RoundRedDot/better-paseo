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
 *
 * Opening and closing slide the sheet at its resting height on the native
 * driver instead of growing it from 0: a JS-driven height laid the details
 * out again on every frame while the board re-rendered for the selection, and
 * a small Android tablet showed a few frames of it. The board hears that the
 * sheet is in (`onShown`) once it has slid in, and that it is gone once it
 * has slid out, so the lanes' bottom room changes while nothing moves.
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
  /** The sheet has slid in (true) or out (false). */
  onShown?(shown: boolean): void;
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
  const height = useRef(new Animated.Value(props.open ? target : 0)).current;
  // How far below its place the sheet sits: opening and closing move only this, on the native driver.
  const slide = useRef(new Animated.Value(props.open && !reduced ? target : 0)).current;
  const latest = useRef(props);
  latest.current = props;
  // Where the sheet is: sliding in or resting ("in"), sliding out ("leaving"), or slid out and waiting to go ("out").
  const phase = useRef<"entering" | "in" | "leaving" | "out">(props.open ? "entering" : "out");
  const slideRun = useRef<Animated.CompositeAnimation | null>(null);
  // A first slide in waits for the frames that mount the details (`slideTo`'s callers).
  const slideWait = useRef<number | null>(null);
  const heightRun = useRef<Animated.CompositeAnimation | null>(null);
  // A drag ends with a click on the handle it moved with: that click must not switch the height back.
  const dragged = useRef(false);
  // The height the value rests at or is moving to: a board that catches up with a switch already there moves nothing.
  const aimed = useRef<number | null>(props.open ? target : null);
  // A switch on its way, before the board hears of it.
  const heading = useRef<{ detent: SheetDetent; run: Animated.CompositeAnimation } | null>(null);

  const motionNow: {
    slideTo(to: number, duration: number, done: () => void): void;
    slideInAfterMount(done: () => void): void;
    unwait(): void;
    heightNow(): number;
  } = useRef({
    /** Slide to `to` below the sheet's place, then `done`; a later slide stops this one. */
    slideTo(to: number, duration: number, done: () => void) {
      motionNow.unwait();
      slideRun.current?.stop();
      if (reducedNow.current || duration === 0) {
        slideRun.current = null;
        slide.setValue(to);
        done();
        return;
      }
      const run = Animated.timing(slide, { toValue: to, duration, easing: MOTION.ease, useNativeDriver: Platform.OS !== "web" });
      slideRun.current = run;
      run.start(({ finished }) => {
        if (slideRun.current !== run) return;
        slideRun.current = null;
        if (finished) done();
      });
    },
    /**
     * Slide in once the details are on screen. A native run's clock starts
     * when it is started: started next to the commit that mounts the details,
     * it spent its first ~95 ms behind that mount on an Android tablet and
     * showed up three quarters of the way in. The second frame comes after
     * the mount.
     */
    slideInAfterMount(done: () => void) {
      motionNow.unwait();
      slideWait.current = requestAnimationFrame(() => {
        slideWait.current = requestAnimationFrame(() => {
          slideWait.current = null;
          motionNow.slideTo(0, 280, done);
        });
      });
    },
    unwait() {
      if (slideWait.current !== null) cancelAnimationFrame(slideWait.current);
      slideWait.current = null;
    },
    /** The height the sheet stands at now, a run on its way stopped where it is. */
    heightNow() {
      heightRun.current?.stop();
      heightRun.current = null;
      let now = aimed.current ?? 0;
      height.stopAnimation((value) => {
        now = value;
      });
      return now;
    },
  }).current;

  useEffect(() => {
    const { slideTo, heightNow } = motionNow;
    if (!props.open) {
      if (!present || phase.current === "leaving") return;
      if (phase.current === "out") {
        setPresent(false);
        return;
      }
      phase.current = "leaving";
      slideTo(heightNow(), reduced ? 0 : 200, () => {
        phase.current = "out";
        setPresent(false);
      });
      return;
    }
    if (!present) {
      // Mounted below its place at the height it opens to: the first frame shows nothing, the slide everything.
      heightRun.current?.stop();
      heightRun.current = null;
      height.setValue(target);
      aimed.current = target;
      slide.setValue(reduced ? 0 : target);
      phase.current = "entering";
      setPresent(true);
      return;
    }
    // Opened again on its way out (or after a drag closed it): it comes back from where it is, at its height.
    const back = phase.current === "leaving" || phase.current === "out";
    if (back || (phase.current === "entering" && !slideRun.current && slideWait.current === null)) {
      phase.current = "entering";
      if (aimed.current !== target) {
        heightNow();
        height.setValue(target);
        aimed.current = target;
      }
      const shown = () => {
        phase.current = "in";
        latest.current.onShown?.(true);
      };
      // Coming back, the details are mounted already.
      if (back || reduced) slideTo(0, reduced ? 0 : 240, shown);
      else motionNow.slideInAfterMount(shown);
      return;
    }
    if (aimed.current === target) return;
    // The area changed while the sheet was up: the height follows it.
    aimed.current = target;
    heightRun.current?.stop();
    const run = Animated.timing(height, { toValue: target, duration: reduced ? 0 : 240, easing: MOTION.ease, useNativeDriver: false });
    heightRun.current = run;
    run.start(() => {
      if (heightRun.current === run) heightRun.current = null;
    });
  }, [height, slide, motionNow, target, reduced, props.open, present]);
  // The board hears the sheet went once it is gone, whether it slid out or the board stopped drawing it.
  const wasPresent = useRef(present);
  useEffect(() => {
    if (wasPresent.current && !present) latest.current.onShown?.(false);
    wasPresent.current = present;
  }, [present]);
  useEffect(() => () => {
    motionNow.unwait();
    slideRun.current?.stop();
    heightRun.current?.stop();
    if (phase.current !== "out") latest.current.onShown?.(false);
  }, [motionNow]);

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
          // Slides out from where the finger left it; the board closes it once it is out.
          phase.current = "leaving";
          motionNow.slideTo(motionNow.heightNow(), 200, () => {
            phase.current = "out";
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
  }, [height, motion, motionNow]);

  const palette = boardPalette(props.theme);
  const chrome = menuChrome(props.theme);
  const full = props.detent === "full";
  if (!present) return null;
  return (
    <Animated.View
      testID="board-sheet"
      pointerEvents={props.open ? "auto" : "none"}
      style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 20, transform: [{ translateY: slide }] }}
    >
      <Animated.View
        testID="board-sheet-body"
        style={{
          height,
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
    </Animated.View>
  );
});
