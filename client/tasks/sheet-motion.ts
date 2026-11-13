import React, { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

/**
 * Whether the board's bottom sheet is changing height (a switch or a drag).
 * A size the details keep in state (their scroller's viewport) re-renders
 * every card section when it changes: it waits for the sheet to stand still,
 * so one switch costs one such render, not one per frame.
 */
export interface SheetMotion {
  moving(): boolean;
  /** Called once the sheet stands still again; returns a remover. */
  onSettle(listener: () => void): () => void;
}

export interface SheetMotionSource extends SheetMotion {
  set(moving: boolean): void;
}

export function createSheetMotion(): SheetMotionSource {
  let moving = false;
  const listeners = new Set<() => void>();
  return {
    moving: () => moving,
    onSettle(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      if (next === moving) return;
      moving = next;
      if (moving) return;
      const waiting = [...listeners];
      listeners.clear();
      for (const listener of waiting) listener();
    },
  };
}

export const SheetMotionContext = createContext<SheetMotion | null>(null);

/**
 * Runs `apply` now, or once the sheet stops moving with the last value it was
 * given meanwhile. Outside a sheet it always runs now.
 */
export function useAfterSheetMotion<T>(apply: (value: T) => void): (value: T) => void {
  const motion = useContext(SheetMotionContext);
  const latest = useRef(apply);
  latest.current = apply;
  const held = useRef<{ value: T; remove: () => void } | null>(null);
  useEffect(() => () => held.current?.remove(), []);
  return useCallback((value: T) => {
    if (!motion?.moving()) {
      held.current?.remove();
      held.current = null;
      latest.current(value);
      return;
    }
    if (held.current) {
      held.current.value = value;
      return;
    }
    const entry = {
      value,
      remove: motion.onSettle(() => {
        held.current = null;
        latest.current(entry.value);
      }),
    };
    held.current = entry;
  }, [motion]);
}

/**
 * How the board's bottom sheet stands (`board/board-sheet.tsx`). It is laid
 * out at its full height whatever height it shows, and a switch moves it up
 * or down on the native driver: a JS-driven height laid the details out on
 * every frame and showed 3-8 frames of a 240 ms switch on an Android tablet,
 * up to 180 ms apart. What lies below the shown part is off the board.
 *
 * - `hidden`: how much of the sheet is below the board at rest. A scroller
 *   gives it up (`SheetScrollRoom`), so its content scrolls into view. It
 *   changes once per switch: before a sheet grows, after it shrinks.
 * - `foot`: moves the sheet's foot (its action bar) up by the part below the
 *   board, every frame, so it stays at the bottom of what shows (`SheetFoot`).
 */
export interface SheetFrame {
  hidden: number;
  foot: Animated.AnimatedInterpolation<number> | Animated.Value | Animated.AnimatedMultiplication<number>;
  /** The sheet's colour, painted under a foot over what continues below it. */
  panel: string;
  /** The sheet's margin under its content. */
  pad: number;
}

export const SheetFrameContext = createContext<SheetFrame | null>(null);

/** A scroller in the sheet: it ends where the shown part does. */
export function SheetScrollRoom(props: { children: React.ReactNode }) {
  const frame = useContext(SheetFrameContext);
  if (!frame) return React.createElement(React.Fragment, null, props.children);
  return React.createElement(View, { testID: "sheet-scroll-room", style: { flex: 1, minHeight: 0, marginBottom: frame.hidden } }, props.children);
}

/**
 * The sheet's foot, kept at the bottom of the shown part. Below the board's
 * edge the details go on (the sheet keeps its full height), so the foot paints
 * what should end there: the sheet's margin and, for a foot inside a card, the
 * card's bottom edge.
 */
export function SheetFoot(props: { card?: { background: string; border: string; radius: number }; children: React.ReactNode }) {
  const frame = useContext(SheetFrameContext);
  if (!frame) return React.createElement(React.Fragment, null, props.children);
  const edge = props.card ? StyleSheet.hairlineWidth : 0;
  return React.createElement(
    Animated.View,
    { testID: "sheet-foot", style: { transform: [{ translateY: frame.foot }] } },
    React.createElement(View, { pointerEvents: "none", style: { position: "absolute", left: -edge, right: -edge, top: 0, bottom: -(edge + frame.pad), backgroundColor: frame.panel } }),
    props.card
      ? React.createElement(View, {
          pointerEvents: "none",
          style: {
            position: "absolute",
            left: -edge,
            right: -edge,
            top: 0,
            bottom: -edge,
            backgroundColor: props.card.background,
            borderColor: props.card.border,
            borderLeftWidth: edge,
            borderRightWidth: edge,
            borderBottomWidth: edge,
            borderBottomLeftRadius: props.card.radius,
            borderBottomRightRadius: props.card.radius,
          },
        })
      : null,
    props.children,
  );
}
