import { createContext, useCallback, useContext, useEffect, useRef } from "react";

/**
 * Whether the board's bottom sheet is changing height (a switch or a drag).
 * Its height is JS-driven, so every frame of it lays the details out again;
 * a size the details keep in state (their scroller's viewport) re-rendered
 * every card section on each of those frames and left an Android tablet 3-5
 * frames of a 240 ms switch. Such sizes wait for the sheet to stand still.
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
