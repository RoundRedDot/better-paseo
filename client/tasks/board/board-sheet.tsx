import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Platform, Pressable, View, type GestureResponderEvent } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { HAIRLINE, MOTION, boardPalette } from "./board-style";
import { menuChrome } from "./menu-model";
import { sheetHeight, sheetRelease, type SheetDetent } from "./sidebar-model";
import { createSheetMotion, SheetFrameContext, SheetMotionContext, type SheetFrame } from "../sheet-motion";
import { androidContentBottomPad } from "../../details/shell/safe-area";

/** The strip the sheet is dragged by: its whole width, with the grabber in the middle. */
const HANDLE = 16;

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
 *
 * A switch or a drag does not change the sheet's height either: it is laid
 * out at its full height and moves up and down (`shift`) on the native
 * driver, its foot moving the other way (`SheetFrame` in `sheet-motion.ts`).
 */
export interface BoardSheetHandle {
  /** Switch the two heights, from the one a switch already moving is heading to. */
  toggle(): void;
}

const native = () => Platform.OS !== "web";

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
  // The height the sheet is laid out at, and how much of it a detent leaves below the board.
  const full = sheetHeight(props.area, "full");
  const below = (detent: SheetDetent) => Math.max(0, full - sheetHeight(props.area, detent));
  const target = below(props.detent);
  // How far down the sheet stands from its full height: a switch or a drag moves only this, on the native driver.
  const shift = useRef(new Animated.Value(target)).current;
  const foot = useRef(Animated.multiply(shift, -1)).current;
  // How far below its place the sheet sits: opening and closing move only this, on the native driver.
  const slide = useRef(new Animated.Value(props.open && !reduced ? full - target : 0)).current;
  // What a scroller gives up below the board (`SheetFrame.hidden`).
  const [hidden, setHiddenState] = useState(target);
  const hiddenNow = useRef(target);
  const setHidden = useRef((next: number) => {
    hiddenNow.current = next;
    setHiddenState(next);
  }).current;
  const latest = useRef(props);
  latest.current = props;
  // Where the sheet is: sliding in or resting ("in"), sliding out ("leaving"), or slid out and waiting to go ("out").
  const phase = useRef<"entering" | "in" | "leaving" | "out">(props.open ? "entering" : "out");
  const slideRun = useRef<Animated.CompositeAnimation | null>(null);
  // A first slide in waits for the frames that mount the details (`slideTo`'s callers).
  const slideWait = useRef<(() => void) | null>(null);
  // A drag ends with a click on the handle it moved with: that click must not switch the height back.
  const dragged = useRef(false);
  // The shift the value rests at or is moving to; during a drag, where the finger put it.
  const aimed = useRef(target);
  // The area and detent the sheet was last laid out for: a board that catches up with a switch already there moves nothing.
  const laid = useRef({ area: props.area, target });
  // Whether the sheet is moving: the details hold their measured sizes until it stands still (`sheet-motion.ts`).
  const moving = useRef(createSheetMotion()).current;
  // A switch on its way, before the board hears of it: waiting for the frames after a grown scroller, then running.
  const heading = useRef<{ detent: SheetDetent; run: Animated.CompositeAnimation | null; wait: (() => void) | null } | null>(null);

  // The grabber shows a finger on the strip, from the touch down through a drag (0 resting, 1 held).
  const grip = useRef(new Animated.Value(0)).current;
  const grabber = useRef({
    opacity: grip.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
    transform: [{ scaleX: grip.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }) }],
  }).current;
  const hold = useRef((on: boolean) => {
    Animated.timing(grip, { toValue: on ? 1 : 0, duration: on ? 90 : 160, easing: MOTION.ease, useNativeDriver: native() }).start();
  }).current;

  const motionNow: {
    slideTo(to: number, duration: number, done: () => void): void;
    slideInAfterMount(done: () => void): void;
    unwait(): void;
    shown(done: (height: number) => void): void;
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
      const run = Animated.timing(slide, { toValue: to, duration, easing: MOTION.ease, useNativeDriver: native() });
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
      slideWait.current = afterFrames(() => {
        slideWait.current = null;
        motionNow.slideTo(0, 280, done);
      });
    },
    unwait() {
      slideWait.current?.();
      slideWait.current = null;
    },
    /** The height the sheet shows now, a switch on its way stopped where it is (a native value reports it a frame later). */
    shown(done: (height: number) => void) {
      const layout = sheetHeight(latest.current.area, "full");
      shift.stopAnimation((value) => done(Math.max(0, layout - value)));
    },
  }).current;

  if (props.open && !present) {
    // Opening: the details mount in the same commit as the board's change
    // for the card, not in a render of their own after it (between the two,
    // a busy JS thread ran other work for up to 50 ms on an Android foldable).
    // Mounted below its place at the height it opens to: the first frame
    // shows nothing, the slide everything. The values are set before the
    // sheet's views exist, so no frame shows it in place.
    shift.setValue(target);
    aimed.current = target;
    laid.current = { area: props.area, target };
    setHidden(target);
    slide.setValue(reduced ? 0 : full - target);
    phase.current = "entering";
    setPresent(true);
  }
  useEffect(() => {
    const { slideTo, shown } = motionNow;
    if (!props.open) {
      if (!present || phase.current === "leaving") return;
      if (phase.current === "out") {
        setPresent(false);
        return;
      }
      phase.current = "leaving";
      shown((height) => {
        if (phase.current !== "leaving") return;
        slideTo(height, reduced ? 0 : 200, () => {
          phase.current = "out";
          setPresent(false);
        });
      });
      return;
    }
    // Opening from nothing is handled in the render above, in the board's own commit.
    if (!present) return;
    // Opened again on its way out (or after a drag closed it): it comes back from where it is, at its height.
    const back = phase.current === "leaving" || phase.current === "out";
    if (back || (phase.current === "entering" && !slideRun.current && slideWait.current === null)) {
      phase.current = "entering";
      if (aimed.current !== target || laid.current.area !== props.area) {
        shift.stopAnimation();
        shift.setValue(target);
        aimed.current = target;
        laid.current = { area: props.area, target };
        setHidden(target);
      }
      const done = () => {
        phase.current = "in";
        latest.current.onShown?.(true);
      };
      // Coming back, the details are mounted already.
      if (back || reduced) slideTo(0, reduced ? 0 : 240, done);
      else motionNow.slideInAfterMount(done);
      return;
    }
    if (laid.current.area === props.area && laid.current.target === target) return;
    laid.current = { area: props.area, target };
    if (heading.current || dragged.current || aimed.current === target) return;
    // The area changed while the sheet was up (a rotation): it stands at its new height at once.
    shift.setValue(target);
    aimed.current = target;
    setHidden(target);
  }, [shift, slide, motionNow, setHidden, target, full, reduced, props.open, props.area, present]);
  // The board hears the sheet went once it is gone, whether it slid out or the board stopped drawing it.
  const wasPresent = useRef(present);
  useEffect(() => {
    if (wasPresent.current && !present) latest.current.onShown?.(false);
    wasPresent.current = present;
  }, [present]);
  useEffect(() => () => {
    motionNow.unwait();
    slideRun.current?.stop();
    if (phase.current !== "out") latest.current.onShown?.(false);
  }, [motionNow]);

  const motion = useMemo(() => {
    const drop = () => {
      const last = heading.current;
      heading.current = null;
      last?.wait?.();
      last?.run?.stop();
    };
    // A switch that stops without another motion taking over (closing, unmounting): the held sizes follow.
    const stop = () => {
      drop();
      moving.set(false);
    };
    const settle = (next: SheetDetent, duration: number) => {
      drop();
      const now = latest.current;
      const to = Math.max(0, sheetHeight(now.area, "full") - sheetHeight(now.area, next));
      aimed.current = to;
      const tell = () => {
        if (latest.current.detent !== next) latest.current.onDetent(next);
      };
      if (reducedNow.current) {
        shift.setValue(to);
        setHidden(to);
        moving.set(false);
        tell();
        return;
      }
      moving.set(true);
      const entry: NonNullable<typeof heading.current> = { detent: next, run: null, wait: null };
      heading.current = entry;
      const run = () => {
        entry.wait = null;
        const animation = Animated.timing(shift, { toValue: to, duration, easing: MOTION.ease, useNativeDriver: native() });
        entry.run = animation;
        animation.start(({ finished }) => {
          // Stopped by another switch, a drag or the sheet closing: that one decides.
          if (heading.current !== entry) return;
          heading.current = null;
          if (finished) setHidden(to);
          moving.set(false);
          if (finished) tell();
        });
      };
      // Growing, the scrollers take the room first, and the run starts once that layout is on screen.
      if (to < hiddenNow.current) {
        setHidden(to);
        entry.wait = afterFrames(run);
      } else {
        run();
      }
    };
    return {
      drop,
      stop,
      settle,
      toggle: () => settle((heading.current?.detent ?? latest.current.detent) === "full" ? "half" : "full", 240),
    };
  }, [shift, moving, setHidden]);
  useImperativeHandle(ref, () => ({ toggle: motion.toggle }), [motion]);
  useEffect(() => { if (!props.open) motion.stop(); }, [motion, props.open]);
  // A switch still moving when the sheet closes does not reach the board.
  useEffect(() => motion.stop, [motion]);

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
        start = aimed.current;
        shift.stopAnimation((value) => {
          start = value;
        });
        dragged.current = true;
        hold(true);
        moving.set(true);
        // The whole height may come into view.
        setHidden(0);
      },
      onPanResponderMove: (event) => {
        const area = latest.current.area;
        const most = Math.max(0, sheetHeight(area, "full") - HANDLE);
        aimed.current = Math.max(0, Math.min(most, start + travel(event)));
        shift.setValue(aimed.current);
      },
      onPanResponderRelease: (event, gesture) => {
        hold(false);
        setTimeout(() => {
          dragged.current = false;
        }, 300);
        const now = latest.current;
        const next = sheetRelease(now.detent, travel(event), gesture.vy);
        if (next === "closed") {
          moving.set(false);
          // Slides out from where the finger left it; the board closes it once it is out.
          phase.current = "leaving";
          motionNow.slideTo(Math.max(0, sheetHeight(now.area, "full") - aimed.current), 200, () => {
            phase.current = "out";
            latest.current.onClose();
          });
          return;
        }
        motion.settle(next, next === now.detent ? 200 : 240);
      },
      onPanResponderTerminate: () => {
        hold(false);
        dragged.current = false;
        motion.settle(latest.current.detent, 200);
      },
    });
  }, [shift, motion, motionNow, moving, setHidden, hold]);

  const palette = boardPalette(props.theme);
  const chrome = menuChrome(props.theme);
  // Android draws under the navigation bar. The pad is that bar, measured from the system; iOS keeps the sheet's own 4.
  const pad = Platform.OS === "android" ? androidContentBottomPad() : 4;
  const frame = useMemo<SheetFrame>(() => ({ hidden, foot, panel: palette.panel, pad }), [hidden, foot, palette.panel, pad]);
  const isFull = props.detent === "full";
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
          height: full,
          transform: [{ translateY: shift }],
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
            accessibilityLabel={isFull ? props.labels.shrink : props.labels.grow}
            onPress={() => {
              if (dragged.current) return;
              motion.toggle();
            }}
            onPressIn={() => hold(true)}
            // A drag taking the touch over keeps the grabber held until it lets go.
            onPressOut={() => {
              if (!dragged.current) hold(false);
            }}
            testID="board-sheet-handle"
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            <Animated.View
              testID="board-sheet-grabber"
              style={{
                width: 32,
                height: 3,
                borderRadius: 1.5,
                backgroundColor: props.theme.colors.foregroundMuted,
                ...grabber,
              }}
            />
          </Pressable>
        </View>
        <View testID="board-sheet-content" style={{ flex: 1, minHeight: 0, paddingHorizontal: 12, paddingBottom: pad }}>
          <SheetMotionContext.Provider value={moving}>
            <SheetFrameContext.Provider value={frame}>{content.current}</SheetFrameContext.Provider>
          </SheetMotionContext.Provider>
        </View>
      </Animated.View>
    </Animated.View>
  );
});

/** Run `callback` two frames on, after the commit made now is on screen. Returns its cancel. */
function afterFrames(callback: () => void): () => void {
  let handle = requestAnimationFrame(() => {
    handle = requestAnimationFrame(callback);
  });
  return () => cancelAnimationFrame(handle);
}
