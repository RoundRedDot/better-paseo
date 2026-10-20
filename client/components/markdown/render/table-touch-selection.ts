import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { findNodeHandle, Platform, TurboModuleRegistry, type GestureResponderEvent, type View, type ViewProps } from "react-native";
import { useListScrollLock, useScrollDismiss } from "../../../ui/scroll-anchor";
import { cellRange, indexAt, sameCell, type CellPos, type CellRange } from "./table-range";
import { HOLD_MS, MOVE_SLOP } from "./table-selection";

const DOUBLE_TAP_MS = 300;
const TAP_MS = 250;

interface Tap { cell: CellPos; time: number; x: number; y: number }

interface Press extends Tap {
  timer: ReturnType<typeof setTimeout> | null;
  /** The hold went through: the finger now draws the range. */
  active: boolean;
  /** The frame's place on the page and its rows' and columns' starts inside it, measured once the hold goes through. */
  origin?: { x: number; y: number };
  rows?: number[];
  columns?: readonly number[];
}

/** Where a native finger is: the table's frame, its rows, and its column starts. */
export interface TableGeometry {
  frame: RefObject<View | null>;
  /** Row views, the header first. */
  rows: RefObject<(View | null)[]>;
  /** Each column's start inside the frame. */
  columns: readonly number[];
}

interface GestureHandlerModule {
  handleSetJSResponder?(tag: number, blockNativeResponder: boolean): void;
  flushOperations?(): void;
}

/**
 * Fails the host's native pans for the held touch: the swipe that opens the
 * agent list, on iOS. Gesture Handler stops them when a JS responder blocks
 * native ones, but the new architecture's responder no longer passes through
 * its hook, so the hold tells the module itself, and flushes the call, which
 * the new architecture otherwise queues until Gesture Handler's next batch.
 * Its root recogniser then begins and prevents every other recogniser for
 * this touch, the scrollers' pans included. Without the module nothing changes.
 */
function holdHostGestures(node: View | null): void {
  try {
    const gestures = TurboModuleRegistry.get<GestureHandlerModule & import("react-native").TurboModule>("RNGestureHandlerModule");
    gestures?.handleSetJSResponder?.(findNodeHandle(node) ?? -1, true);
    gestures?.flushOperations?.();
  } catch {
    // A host without Gesture Handler has no such pans.
  }
}

type CellTouchProps = Pick<ViewProps, "onTouchStart" | "onTouchMove" | "onTouchEnd" | "onTouchCancel"
  | "onMoveShouldSetResponder" | "onResponderGrant" | "onResponderTerminationRequest">;

/**
 * A table's cell selection: a rectangle from the cell it began on to the one
 * it reached. A double tap (a double click on web) selects one cell. Holding
 * a cell starts a range that follows the finger across rows and columns; the
 * copy menu waits for the release. Native gestures are recognised here, web
 * pointers in `bindTableCellSelection`.
 */
export function useTableCellSelection(source: string, geometry: TableGeometry) {
  const [selection, setSelection] = useState<{ anchor: CellPos; focus: CellPos } | null>(null);
  const [dragging, setDragging] = useState(false);
  const lockList = useListScrollLock();
  const press = useRef<Press | null>(null);
  const previous = useRef<Tap | null>(null);
  const locked = useRef(false);
  const latest = useRef(geometry);
  latest.current = geometry;

  const dismiss = useCallback(() => { setSelection(null); setDragging(false); }, []);
  const select = useCallback((cell: CellPos) => { setSelection({ anchor: cell, focus: cell }); setDragging(false); }, []);
  const begin = useCallback((cell: CellPos) => { setSelection({ anchor: cell, focus: cell }); setDragging(true); }, []);
  const extend = useCallback((cell: CellPos) => {
    setSelection((current) => current && !sameCell(current.focus, cell) ? { ...current, focus: cell } : current);
  }, []);
  const end = useCallback(() => setDragging(false), []);
  useScrollDismiss(selection !== null, dismiss);

  const unlock = () => {
    if (!locked.current) return;
    locked.current = false;
    lockList(false);
  };
  const cancel = () => {
    const current = press.current;
    press.current = null;
    if (current?.timer) clearTimeout(current.timer);
    unlock();
    return current;
  };
  useEffect(() => { cancel(); previous.current = null; dismiss(); }, [source]);
  useEffect(() => () => { cancel(); }, []);

  const point = (cell: CellPos, event: GestureResponderEvent): Tap => ({
    cell, time: event.nativeEvent.timestamp,
    x: event.nativeEvent.pageX, y: event.nativeEvent.pageY,
  });
  const near = (a: Tap, b: Tap) => Math.hypot(a.x - b.x, a.y - b.y) <= MOVE_SLOP;
  // Rows and columns are measured once the hold goes through, while the
  // finger is still; the table and the timeline are held still from then on.
  const measure = (current: Press) => {
    const { frame, rows, columns } = latest.current;
    const node = frame.current;
    if (!node) return;
    current.columns = columns;
    node.measure((_x, _y, _width, _height, pageX, pageY) => { current.origin = { x: pageX, y: pageY }; });
    const tops: number[] = [];
    current.rows = tops;
    rows.current?.forEach((row, index) => {
      row?.measureLayout(node, (_left, top) => { tops[index] = top; });
    });
  };
  const activate = (current: Press) => {
    current.timer = null;
    if (press.current !== current) return;
    current.active = true;
    previous.current = null;
    locked.current = true;
    lockList(true);
    holdHostGestures(latest.current.frame.current);
    measure(current);
    begin(current.cell);
  };
  const locate = (current: Press, x: number, y: number): CellPos | null => {
    const { origin, rows, columns } = current;
    if (!origin || !rows?.length || !columns?.length) return null;
    return { row: indexAt(rows, y - origin.y), column: indexAt(columns, x - origin.x) };
  };

  const cellProps = (cell: CellPos): CellTouchProps => Platform.OS === "web" ? {} : {
    onTouchStart: (event) => {
      dismiss();
      cancel();
      if (event.nativeEvent.touches.length !== 1) {
        previous.current = null;
        return;
      }
      const current: Press = { ...point(cell, event), timer: null, active: false };
      current.timer = setTimeout(() => activate(current), HOLD_MS);
      press.current = current;
    },
    onTouchMove: (event) => {
      const current = press.current;
      if (!current) return;
      const at = point(cell, event);
      if (!current.active) {
        // Moving before the hold is a scroll.
        if (!near(current, at)) {
          cancel();
          previous.current = null;
        }
        return;
      }
      const target = locate(current, at.x, at.y);
      if (target) extend(target);
    },
    onTouchCancel: () => {
      if (cancel()?.active) end();
      previous.current = null;
    },
    onTouchEnd: (event) => {
      const start = cancel();
      if (!start) return;
      if (start.active) {
        end();
        return;
      }
      const release = point(cell, event);
      if (!sameCell(start.cell, cell) || release.time - start.time > TAP_MS || !near(start, release)) {
        previous.current = null;
        return;
      }
      const last = previous.current;
      if (last && sameCell(last.cell, cell) && release.time - last.time <= DOUBLE_TAP_MS && near(last, release)) {
        previous.current = null;
        select(cell);
      } else previous.current = release;
    },
    // Once the hold goes through, the cell takes the gesture and keeps it,
    // and blocks the native scrollers above it (Android).
    onMoveShouldSetResponder: () => press.current?.active === true,
    onResponderGrant: (() => true) as ViewProps["onResponderGrant"],
    onResponderTerminationRequest: () => press.current?.active !== true,
  };

  const range: CellRange | null = selection ? cellRange(selection.anchor, selection.focus) : null;
  return { range, dragging, cellProps, dismiss, select, begin, extend, end };
}
