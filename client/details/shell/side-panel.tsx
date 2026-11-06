/**
 * The right-hand details panel (design boards 2c and 3, table 5.2):
 * clamp(0.36W, 420, 640) wide (400 in a phone's landscape), full height
 * under the status bar, a 1px left border, no handle and no dim. Its full
 * screen is a wider panel. On desktop web an 8 wide zone on its left edge
 * drags its width between 360 and 0.6W, kept for the session. A drag frame
 * writes the width to the page, at most once a frame; the panel renders
 * once, on release, so the details do not draw again on every move.
 */
import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Platform, StyleSheet, View, type ViewStyle } from "react-native";
import type { ExtendedThemeTokens } from "../../components/theme-tokens";
import { sidePanelWidth } from "../layout-model";
import { toolbarLabel } from "../../i18n/toolbar-strings";
import { useEnhancerPreferences } from "../../preferences";
import { DETAILS_MOTION, animate } from "./motion";
import { OutsideCatcher, detailsPalette } from "./scrim";
import type { Entrance } from "./bottom-panel";
import type { Insets } from "./safe-area";
import { keepOffWindowDrag } from "./web-layer";
import { DESKTOP_OVERLAY } from "../../ui/tokens/motion";

export const SIDE = {
  /** A phone in landscape (height under 500). */
  phone: 400,
  min: 360,
  max: 0.6,
  edge: 8,
} as const;

// The width the reader dragged the panel to, for the rest of the session.
let sessionWidth: number | null = null;

/** The saved or design width, wider at full screen; desktop web stays inside the empty gutter. */
export function sideWidth(stage: { width: number; height: number; sideSpace?: number }, wide: boolean): number {
  if (stage.height < 500 && stage.sideSpace === undefined) return Math.min(SIDE.phone, stage.width);
  const base = sessionWidth === null
    ? Math.round(sidePanelWidth(stage.width))
    : Math.round(Math.max(SIDE.min, Math.min(stage.width * SIDE.max, sessionWidth)));
  return Math.min(stage.sideSpace ?? stage.width, wide ? Math.max(base, Math.round(stage.width * SIDE.max)) : base);
}

/** Tests only. */
export function resetSideWidth(): void {
  sessionWidth = null;
}

export function SidePanel(props: {
  tokens: ExtendedThemeTokens;
  stage: { width: number; height: number; sideSpace?: number };
  insets: Insets;
  reduced: boolean;
  entrance: Entrance;
  leaving: boolean;
  onExited(): void;
  /** The full-screen toggle: a wider panel. */
  wide: boolean;
  /** Desktop web: the left edge drags the width. */
  resizable: boolean;
  onOutside(): void;
  children: ReactNode;
}) {
  const { tokens, reduced } = props;
  const language = useEnhancerPreferences().language;
  const latest = useRef(props);
  latest.current = props;
  const [, setDragged] = useState(0);
  const width = sideWidth(props.stage, props.wide);
  const moves = props.entrance === "slide" && !reduced;
  const shift = useRef(new Animated.Value(moves ? Platform.OS === "web" ? DESKTOP_OVERLAY.shift : DETAILS_MOTION.sideShift : 0)).current;
  const opacity = useRef(new Animated.Value(props.entrance === "none" || Platform.OS === "web" && reduced ? 1 : Platform.OS === "web" && moves ? DESKTOP_OVERLAY.opacity : 0)).current;
  const entered = useRef(false);
  const wasLeaving = useRef(false);

  useEffect(() => {
    if (entered.current) return;
    entered.current = true;
    const now = latest.current;
    if (now.entrance === "none" || Platform.OS === "web" && now.reduced) return;
    if (now.entrance === "slide" && !now.reduced) {
      const ms = Platform.OS === "web" ? DESKTOP_OVERLAY.ms : DETAILS_MOTION.sideOpenMs;
      const ease = Platform.OS === "web" ? "overlay" : "ease";
      animate(shift, 0, ms, undefined, ease);
      animate(opacity, 1, ms, undefined, ease);
      return;
    }
    animate(opacity, 1, now.reduced ? DETAILS_MOTION.reducedMs : DETAILS_MOTION.formInMs);
  }, [shift, opacity]);

  useEffect(() => {
    const restoring = wasLeaving.current;
    wasLeaving.current = props.leaving;
    if (!props.leaving) {
      if (entered.current && (Platform.OS !== "web" || restoring)) {
        animate(shift, 0, 0);
        animate(opacity, 1, 0);
      }
      return;
    }
    const done = () => latest.current.onExited();
    if (Platform.OS === "web") {
      done();
      return;
    }
    if (latest.current.reduced) {
      animate(opacity, 0, DETAILS_MOTION.reducedMs, done);
      return;
    }
    animate(shift, DETAILS_MOTION.sideShift, DETAILS_MOTION.sideCloseMs);
    animate(opacity, 0, DETAILS_MOTION.sideCloseMs, done);
  }, [props.leaving, shift, opacity]);

  // Full height: its top lies over the host's title bar drag (`keepOffWindowDrag`).
  const panel = useRef<View>(null);
  useLayoutEffect(() => keepOffWindowDrag(panel.current), []);

  const edge = useRef<View>(null);
  useLayoutEffect(() => {
    if (!props.resizable || Platform.OS !== "web") return;
    const node = panel.current as unknown as HTMLElement | null;
    const rerender = () => setDragged((count) => count + 1);
    return bindEdgeDrag(edge.current, () => sideWidth(latest.current.stage, false), (next) => {
      sessionWidth = Math.round(Math.max(SIDE.min, Math.min(latest.current.stage.width * SIDE.max, next)));
      if (node?.style) node.style.width = `${sideWidth(latest.current.stage, latest.current.wide)}px`;
      else rerender();
    }, rerender);
  }, [props.resizable]);

  const palette = detailsPalette(tokens);
  return (
    <>
      {Platform.OS === "web" ? null : <OutsideCatcher onPress={props.onOutside} />}
      <Animated.View
        ref={panel}
        testID="details-side"
        accessibilityViewIsModal={Platform.OS !== "web"}
        style={[
          styles.panel,
          {
            top: props.insets.top,
            width,
            backgroundColor: tokens.surface0,
            borderLeftColor: palette.border,
            opacity,
            transform: [{ translateX: shift }],
          },
        ] as never}
      >
        <View style={styles.content}>{props.children}</View>
        {props.resizable && Platform.OS === "web" ? (
          <View
            ref={edge}
            testID="details-side-edge"
            accessibilityRole="adjustable"
            accessibilityLabel={toolbarLabel("Resize details panel", language)}
            style={[styles.edge, styles.edgeCursor]}
          />
        ) : null}
      </Animated.View>
    </>
  );
}

/**
 * Drags the panel's left edge: the width grows as the pointer moves left,
 * written at most once a frame (`write`); `release` follows the last one.
 * Web only.
 */
function bindEdgeDrag(node: unknown, read: () => number, write: (width: number) => void, release: () => void): () => void {
  const element = node as HTMLElement | null;
  if (!element || typeof element.addEventListener !== "function") return () => {};
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  let start: { x: number; width: number } | null = null;
  let pending: number | null = null;
  let frame = 0;
  const flush = () => {
    frame = 0;
    if (pending === null) return;
    const width = pending;
    pending = null;
    write(width);
  };
  const move = (event: PointerEvent) => {
    if (!start) return;
    event.preventDefault();
    pending = start.width + (start.x - event.clientX);
    if (!view?.requestAnimationFrame) flush();
    else if (!frame) frame = view.requestAnimationFrame(flush);
  };
  const end = () => {
    if (!start) return;
    start = null;
    if (frame) view?.cancelAnimationFrame(frame);
    flush();
    release();
    doc.removeEventListener("pointermove", move);
    doc.removeEventListener("pointerup", end);
    doc.removeEventListener("pointercancel", end);
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    start = { x: event.clientX, width: read() };
    doc.addEventListener("pointermove", move);
    doc.addEventListener("pointerup", end);
    doc.addEventListener("pointercancel", end);
  };
  element.addEventListener("pointerdown", down);
  return () => {
    if (frame) view?.cancelAnimationFrame(frame);
    frame = 0;
    pending = null;
    start = null;
    doc.removeEventListener("pointermove", move);
    doc.removeEventListener("pointerup", end);
    doc.removeEventListener("pointercancel", end);
    element.removeEventListener("pointerdown", down);
  };
}

const styles = StyleSheet.create({
  panel: { position: "absolute", right: 0, bottom: 0, borderLeftWidth: 1, overflow: "hidden" },
  content: { flex: 1, minHeight: 0 },
  edge: { position: "absolute", left: 0, top: 0, bottom: 0, width: SIDE.edge },
  edgeCursor: { cursor: "col-resize", touchAction: "none" } as unknown as ViewStyle,
});
