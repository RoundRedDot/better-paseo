/**
 * What the bottom drawer and the floating bottom panel share (design 4c):
 * two detents, a handle, the drag and the open and close motion.
 *
 * At fit the panel is as tall as its content up to a cap (0.58 of the
 * available height for the drawer, 0.5 for the floating panel), and lays
 * itself out: a `maxHeight` of that cap, so a running block that grows grows
 * the panel up to it. The full detent (available - 8, or - 24 floating) is
 * always offered: three long unwrapped lines want the room as much as a long
 * output does. At full, and while a finger or a settle moves it, the height
 * is set. The panel opens off-screen, so its first layout (the measure) is
 * never seen; then it slides up. A switch to another block at fit holds the old
 * height, measures the new content in it, and moves there over 240 ms.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Animated, Platform, Pressable, StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import type { ExtendedThemeTokens } from "../../components/theme-tokens";
import type { Detent } from "../contracts";
import { detentHeights, releaseDetent, settleMs } from "../detent-model";
import { toolbarLabel } from "../../i18n/toolbar-strings";
import { useEnhancerPreferences } from "../../preferences";
import { DETAILS_MOTION, animate, animateLayout, panelShadow } from "./motion";
import { OVERDRAG, panelResponder, type DragTarget } from "./gestures";
import { detailsPalette } from "./scrim";
import type { Insets } from "./safe-area";
import type { BodyWatch } from "./body-handover";
import { keepOffWindowDrag } from "./web-layer";

/** The handle's strip: a 36 × 5 grabber 8 below the panel's top, in a row a finger can take. */
export const HANDLE = 28;
export const CORNER = 16;
/** The floating panel's gap above the bottom safe area. */
export const FLOATING_GAP = 12;
/** The floating panel's fit cap and full gap (design table 5.2); the drawer's come from the detent model. */
const FLOATING = { fit: 0.5, fullGap: 24 } as const;

export type BottomForm = "drawer" | "floating";

/**
 * The fit and full heights in whole points: the drawer's from the detent
 * model (0.58, available - 8), the floating panel's 0.5 and available - 24.
 */
export function panelHeights(form: BottomForm, content: number, available: number): { fit: number; full: number } {
  if (form === "drawer") {
    const { fit, full } = detentHeights(content, available);
    return { fit: Math.round(fit), full: Math.max(0, Math.round(full)) };
  }
  const cap = Math.round(available * FLOATING.fit);
  return {
    fit: Math.round(Math.min(content, cap)),
    full: Math.max(0, Math.round(available - FLOATING.fullGap)),
  };
}

export type Entrance = "slide" | "fade" | "none";

/** A drag up from the body's top that leaves faster than this (px/ms) glides on for about this long's worth of its speed. */
const GLIDE = { speed: 0.3, ms: 300 } as const;

/** How long a block switch waits for the new content's height before letting the panel lay itself out. */
const STEP_MEASURE_MS = 400;

export interface BottomPanelProps {
  form: BottomForm;
  /** The open block: a switch at fit animates the height to the new content. */
  blockId: string;
  /** The body's reports (native), for the new content's height. */
  body: BodyWatch;
  tokens: ExtendedThemeTokens;
  stage: { width: number; height: number };
  insets: Insets;
  detent: Detent;
  reduced: boolean;
  /** How the panel arrives: slid up (opened), faded in (a form change), or already there (a lease handover). */
  entrance: Entrance;
  /** The panel closed: play the exit, then call `onExited`. */
  leaving: boolean;
  onExited(): void;
  onDetent(detent: Detent): void;
  /** A drag down closed it. */
  onClose(): void;
  /** The panel's resting top in the stage, for the timeline sync. */
  onTop(top: number): void;
  /** Filled with the vertical drag, for the header's handlers. */
  dragRef: MutableRefObject<DragTarget | null>;
  /** Holds the host's pans while a finger drags; returns the release. */
  hold(): () => void;
  /** The body's pull-down hand-over: true at its top, null when unknown. */
  bodyAtTop(): boolean | null;
  /** What sits behind the panel: the drawer's scrim, the floating panel's outside catcher. */
  behind?(opacity: Animated.Value): ReactNode;
  testID: string;
  /** The panel's box in the stage. */
  frame: { left: number; width: number; bottom: number };
  /** Corners and the bottom pad: the drawer's top corners and safe-area pad, the floating panel's all four. */
  corners: "top" | "all";
  bottomPad: number;
  /** Height the detents divide. */
  available: number;
  children: ReactNode;
}

/** The height the detents divide: under the top safe area, and for the floating panel above its bottom gap. */
export function availableHeight(form: BottomForm, stageHeight: number, insets: Insets): number {
  if (form === "drawer") return Math.max(0, stageHeight - insets.top);
  return Math.max(0, stageHeight - insets.top - FLOATING_GAP - insets.bottom);
}

export function BottomPanel(props: BottomPanelProps) {
  const { tokens, detent, reduced, available } = props;
  const language = useEnhancerPreferences().language;
  const latest = useRef(props);
  latest.current = props;
  const cap = panelHeights(props.form, Number.POSITIVE_INFINITY, available).fit;
  const capRef = useRef(cap);
  capRef.current = cap;
  // The panel's own height at fit, as last laid out; null before the first layout.
  const [measured, setMeasured] = useState<number | null>(null);
  // Set height (full, a drag, a settle) rather than the content's, up to the cap.
  const [fixed, setFixed] = useState(false);
  // A height within a point of the cap is the cap: the content passes it.
  const capped = measured !== null && measured >= cap - 1;
  const heights = useMemo(
    () => panelHeights(props.form, capped ? Number.POSITIVE_INFINITY : measured ?? 0, available),
    [props.form, capped, measured, available],
  );
  const heightsRef = useRef(heights);
  heightsRef.current = heights;
  const height = useRef(new Animated.Value(0)).current;
  // The first layout (the measure) happens in place and unseen, as the press
  // preview's does: never translated off the screen, where native text and
  // images laid out there stayed blank until a later layout.
  const translate = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(props.entrance === "none" ? 1 : 0)).current;
  const backdrop = useRef(new Animated.Value(props.entrance === "none" ? 1 : 0)).current;
  // What the values hold; Animated values are not read back while they move.
  const now = useRef({ height: 0, translate: 0 });
  const entered = useRef(false);
  const dragging = useRef(false);
  // A drag ends with a press on the handle it moved with: that press must not switch the detent back.
  const dragged = useRef(false);
  // A release is settling the panel at this detent: the detent change it reports must not start a second settle.
  const settling = useRef<Detent | null>(null);
  const fixedRef = useRef(fixed);
  fixedRef.current = fixed;

  const setHeight = useCallback((value: number) => {
    height.setValue(value);
    now.current.height = value;
  }, [height]);
  const setTranslate = useCallback((value: number) => {
    translate.setValue(value);
    now.current.translate = value;
  }, [translate]);
  const moveHeight = useCallback((to: number, ms: number, done?: () => void) => {
    now.current.height = to;
    if (ms <= 0) {
      height.setValue(to);
      done?.();
      return;
    }
    animateLayout(height, to, ms, done);
  }, [height]);
  const fix = useCallback(() => {
    if (fixedRef.current) return;
    setHeight(now.current.height);
    fixedRef.current = true;
    setFixed(true);
  }, [setHeight]);
  const free = useCallback(() => {
    fixedRef.current = false;
    setFixed(false);
  }, []);

  const restHeight = (d: Detent) => (d === "full" ? heightsRef.current.full : heightsRef.current.fit);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const laid = Math.round(event.nativeEvent.layout.height);
    if (fixedRef.current || laid <= 0) return;
    now.current.height = laid;
    setMeasured(laid);
  }, []);

  // The first layout measured the content: open at the asked detent, from where the entrance says.
  useEffect(() => {
    if (measured === null || entered.current) return;
    entered.current = true;
    const now0 = latest.current;
    if (now0.detent === "full") {
      fixedRef.current = true;
      setFixed(true);
      setHeight(heightsRef.current.full);
    }
    const panel = now.current.height;
    if (now0.entrance === "slide" && !now0.reduced) {
      // Laid out where it rests; now below the edge, shown, and up.
      setTranslate(panel);
      opacity.setValue(1);
      now.current.translate = 0;
      // iOS draws a selectable text's string when it is next displayed; one
      // that changed while the panel was below the screen (highlighting that
      // landed late) stayed blank until a relayout. At rest, the body draws
      // its content again.
      animate(translate, 0, DETAILS_MOTION.openMs, Platform.OS === "ios" ? () => latest.current.body.redraw() : undefined);
      animate(backdrop, 1, DETAILS_MOTION.scrimMs, undefined, "linear");
    } else if (now0.entrance !== "none") {
      const ms = now0.reduced ? DETAILS_MOTION.reducedMs : DETAILS_MOTION.formInMs;
      animate(opacity, 1, ms);
      animate(backdrop, 1, ms, undefined, "linear");
    }
  }, [measured, opacity, backdrop, translate, setHeight, setTranslate]);

  // The resting top, for the timeline sync: the stage's height less the panel's resting box.
  const restingTop = measured === null ? null
    : props.stage.height - props.frame.bottom - restHeight(detent);
  useEffect(() => {
    if (restingTop !== null) latest.current.onTop(restingTop);
  }, [restingTop]);

  // A detent asked for from outside the drag: the handle's tap, the full-screen button, an open at full.
  useEffect(() => {
    if (!entered.current || dragging.current) return;
    if (settling.current === detent) return;
    const ms = latest.current.reduced ? 0 : DETAILS_MOTION.detentMs;
    if (detent === "full") {
      fix();
      moveHeight(heights.full, ms);
    } else if (fixedRef.current) {
      moveHeight(heights.fit, ms, free);
    }
  }, [detent, heights.full, heights.fit, fix, free, moveHeight]);

  // Another block at fit: hold the height it had, measure the new content inside it, and move there.
  const panelRef = useRef<View>(null);
  // Grown full, it reaches the host's title bar drag (`keepOffWindowDrag`).
  useLayoutEffect(() => keepOffWindowDrag(panelRef.current), []);
  const shownBlock = useRef(props.blockId);
  useLayoutEffect(() => {
    if (props.blockId === shownBlock.current) return;
    shownBlock.current = props.blockId;
    if (!entered.current || fixedRef.current || dragging.current || latest.current.reduced) return;
    const from = now.current.height;
    if (from <= 0) return;
    fix();
    settling.current = "fit";
    let done = false;
    let stopWatch = () => {};
    const finish = (size: { content: number; viewport: number } | null) => {
      if (done) return;
      done = true;
      stopWatch();
      clearTimeout(timer);
      if (!size) {
        settling.current = null;
        free();
        return;
      }
      const natural = Math.round(from - size.viewport + size.content);
      const target = Math.min(natural, capRef.current);
      setMeasured(target);
      moveHeight(target, DETAILS_MOTION.detentMs, () => {
        settling.current = null;
        if (latest.current.detent === "fit") free();
      });
    };
    // Nothing measured in time: let the panel lay itself out again.
    const timer = setTimeout(() => finish(null), STEP_MEASURE_MS);
    if (Platform.OS === "web") {
      const read = () => {
        const body = (panelRef.current as unknown as HTMLElement | null)
          ?.querySelector?.<HTMLElement>('[data-testid="hover-preview-body"]');
        finish(body && body.clientHeight > 0 ? { content: body.scrollHeight, viewport: body.clientHeight } : null);
      };
      const frame = (globalThis as { requestAnimationFrame?: (callback: () => void) => number }).requestAnimationFrame;
      if (typeof frame === "function") frame(read);
      else read();
    } else {
      stopWatch = latest.current.body.onNextSize(finish);
    }
    return () => {
      if (done) return;
      done = true;
      stopWatch();
      clearTimeout(timer);
      settling.current = null;
      free();
    };
  }, [props.blockId, fix, free, moveHeight]);

  // Closed: down off the screen (or a fade), then gone.
  useEffect(() => {
    if (!props.leaving) {
      // Opened again while leaving: back up.
      if (entered.current && now.current.translate !== 0) {
        now.current.translate = 0;
        animate(translate, 0, latest.current.reduced ? 0 : DETAILS_MOTION.detentMs);
        animate(opacity, 1, 0);
        animate(backdrop, 1, 0);
      }
      return;
    }
    const done = () => latest.current.onExited();
    if (!entered.current) {
      done();
      return;
    }
    if (latest.current.reduced) {
      animate(opacity, 0, DETAILS_MOTION.reducedMs, done);
      animate(backdrop, 0, DETAILS_MOTION.reducedMs, undefined, "linear");
      return;
    }
    now.current.translate = now.current.height;
    animate(translate, now.current.height, DETAILS_MOTION.closeMs, done);
    animate(backdrop, 0, DETAILS_MOTION.closeMs, undefined, "linear");
  }, [props.leaving, translate, opacity, backdrop]);

  // The vertical drag: the height between fit and full, a slide down below fit, resistance past the last detent.
  const drag = useMemo<DragTarget>(() => {
    let visible = 0;
    const settle = (next: Detent, velocity: number) => {
      const target = restHeight(next);
      const shown = now.current.height - now.current.translate;
      const ms = latest.current.reduced ? 0 : settleMs(Math.abs(shown - target), velocity);
      settling.current = next;
      now.current.translate = 0;
      if (ms > 0) animate(translate, 0, ms);
      else translate.setValue(0);
      moveHeight(target, ms, () => {
        settling.current = null;
        if (next === "fit") free();
      });
      if (next !== latest.current.detent) latest.current.onDetent(next);
    };
    return {
      begin() {
        dragging.current = true;
        dragged.current = true;
        fix();
        visible = now.current.height - now.current.translate;
      },
      move(travel) {
        const { fit, full } = heightsRef.current;
        const want = visible - travel;
        if (want > full) {
          setHeight(full + (want - full) * OVERDRAG);
          setTranslate(0);
        } else if (want >= fit) {
          setHeight(want);
          setTranslate(0);
        } else {
          setHeight(fit);
          setTranslate(Math.max(0, fit - want));
        }
      },
      end(travel, velocity) {
        dragging.current = false;
        setTimeout(() => { dragged.current = false; }, 300);
        const next = releaseDetent(latest.current.detent, travel, velocity);
        if (next === "closed") {
          latest.current.onClose();
          return;
        }
        settle(next, velocity);
      },
      cancel() {
        dragging.current = false;
        dragged.current = false;
        settle(latest.current.detent, 0);
      },
    };
  }, [fix, free, moveHeight, setHeight, setTranslate, translate]);
  props.dragRef.current = drag;

  const handlePan = useMemo(() => panelResponder({
    vertical: () => drag,
    hold: () => latest.current.hold(),
  }), [drag]);
  // A drag up from a phone body at its top, which does not scroll itself
  // there: the body follows the finger, and a fling glides on.
  const lift = useMemo<DragTarget>(() => {
    let scrolled = 0;
    const scroller = () => latest.current.body.scroller();
    return {
      begin() {
        scrolled = 0;
      },
      move(travel) {
        const body = scroller();
        if (body) scrolled += body.scrollBy(-travel - scrolled);
      },
      end(_travel, velocity) {
        if (velocity < -GLIDE.speed) scroller()?.scrollBy(-velocity * GLIDE.ms, true);
      },
      cancel() {},
    };
  }, []);
  // On the body itself, not the panel: the header, the toolbar and the
  // handle above it drag the drawer their own way. On iOS and Android a body
  // at its top takes the touch as it starts (see `claimAtStart`).
  const bodyPan = useMemo(() => panelResponder({
    vertical: () => drag,
    hold: () => latest.current.hold(),
    pullDown: () => latest.current.bodyAtTop() === true,
    ...(Platform.OS === "web" ? {} : {
      pullUp: () => lift,
      claimAtStart: () => latest.current.bodyAtTop() === true,
    }),
  }), [drag, lift]);
  props.body.setPanHandlers(bodyPan.panHandlers as unknown as Record<string, unknown>);

  const toggle = useCallback(() => {
    if (dragged.current) return;
    latest.current.onDetent(latest.current.detent === "full" ? "fit" : "full");
  }, []);

  const palette = detailsPalette(tokens);
  const full = detent === "full";
  const cornerStyle: ViewStyle = props.corners === "top"
    ? { borderTopLeftRadius: CORNER, borderTopRightRadius: CORNER }
    : { borderRadius: CORNER };
  return (
    <>
      {props.behind?.(backdrop)}
      {/* The frame moves and fades (native driver); the box inside it takes the height (layout). */}
      <Animated.View
        testID={`${props.testID}-frame`}
        style={[
          styles.frame,
          cornerStyle,
          {
            left: props.frame.left,
            width: props.frame.width,
            bottom: props.frame.bottom,
            boxShadow: panelShadow(tokens.isDark, props.corners === "top"),
            opacity,
            transform: [{ translateY: translate }],
          },
        ] as never}
      >
        <Animated.View
          ref={panelRef}
          testID={props.testID}
          accessibilityViewIsModal={Platform.OS !== "web"}
          onLayout={onLayout}
          style={[
            styles.panel,
            cornerStyle,
            props.corners === "top" && styles.openBottom,
            { backgroundColor: tokens.surface0, borderColor: palette.border },
            fixed ? { height } : { maxHeight: cap },
          ] as never}
        >
          <View testID="details-handle-zone" {...handlePan.panHandlers} style={[styles.handle, Platform.OS === "web" && styles.grab]}>
            <Pressable
              testID="details-handle"
              accessibilityRole="button"
              accessibilityLabel={toolbarLabel(full ? "Shrink details" : "Expand details", language)}
              onPress={toggle}
              style={styles.handlePress}
            >
              <View style={[styles.grabber, { backgroundColor: palette.grabber }]} />
            </Pressable>
          </View>
          <View style={[styles.content, fixed && styles.contentFill]}>{props.children}</View>
          {props.bottomPad > 0 ? <View style={{ height: props.bottomPad }} /> : null}
        </Animated.View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  frame: { position: "absolute" },
  panel: { overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  // The drawer meets the screen's bottom edge.
  openBottom: { borderBottomWidth: 0, borderLeftWidth: 0, borderRightWidth: 0 },
  handle: { height: HANDLE, flexShrink: 0, alignItems: "stretch" },
  handlePress: { flex: 1, alignItems: "center", paddingTop: 8 },
  grabber: { width: 36, height: 5, borderRadius: 3 },
  grab: { cursor: "grab", touchAction: "none" } as unknown as ViewStyle,
  content: { flexShrink: 1, minHeight: 0 },
  contentFill: { flexGrow: 1 },
});
