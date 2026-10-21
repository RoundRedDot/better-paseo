import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Platform, type GestureResponderEvent, type View, type ViewProps } from "react-native";
import { holdHostGestures } from "../../../ui/hold-host-gestures";
import { useListScrollLock, useScrollDismiss } from "../../../ui/scroll-anchor";
import { cellRange, indexAt, sameCell, type CellPos, type CellRange } from "./table-range";
import { HOLD_MS, MOVE_SLOP } from "./table-selection";

const DOUBLE_TAP_MS = 300;
const TAP_MS = 250;

interface Tap { time: number; x: number; y: number }

interface Press extends Tap {
  timer: ReturnType<typeof setTimeout> | null;
  /** The hold went through: the finger now draws the range. */
  active: boolean;
  /** Where the cells are, measured once the hold goes through. */
  cells?: CellGrid;
}

/** The frame's place on the page and its rows' and columns' starts inside it. */
interface CellGrid {
  origin: { x: number; y: number };
  rows: number[];
  columns: readonly number[];
}

/** Where a native finger is: the table's frame, its rows, and its column starts. */
export interface TableGeometry {
  frame: RefObject<View | null>;
  /** Row views, the header first. */
  rows: RefObject<(View | null)[]>;
  /** Each column's start inside the frame. */
  columns: readonly number[];
}

type FrameTouchProps = Pick<ViewProps, "onTouchStart" | "onTouchMove" | "onTouchEnd" | "onTouchCancel"
  | "onMoveShouldSetResponder" | "onResponderGrant" | "onResponderTerminationRequest">;

/**
 * A table's cell selection: a rectangle from the cell it began on to the one
 * it reached. A double tap (a double click on web) selects one cell. Holding
 * a cell starts a range that follows the finger across rows and columns; the
 * copy menu waits for the release. Native gestures are recognised here, on
 * the table's frame, which finds the cell under the finger from its rows and
 * column starts, so a cell needs no view of its own; web pointers are
 * recognised in `bindTableCellSelection`.
 */
export function useTableCellSelection(source: string, geometry: TableGeometry) {
  const [selection, setSelection] = useState<{ anchor: CellPos; focus: CellPos } | null>(null);
  const [dragging, setDragging] = useState(false);
  const lockList = useListScrollLock();
  const press = useRef<Press | null>(null);
  const previous = useRef<Tap | null>(null);
  const locked = useRef<(() => void) | null>(null);
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
    const release = locked.current;
    if (!release) return;
    locked.current = null;
    lockList(false);
    release();
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

  const point = (event: GestureResponderEvent): Tap => ({
    time: event.nativeEvent.timestamp,
    x: event.nativeEvent.pageX, y: event.nativeEvent.pageY,
  });
  const near = (a: Tap, b: Tap) => Math.hypot(a.x - b.x, a.y - b.y) <= MOVE_SLOP;
  // The rows and columns are measured only when a cell is needed: once a
  // hold goes through, while the finger is still, and on a double tap. The
  // grid arrives once the frame and every row have answered.
  const measure = (done: (cells: CellGrid) => void) => {
    const { frame, rows, columns } = latest.current;
    const node = frame.current;
    if (!node) return;
    const views = rows.current ?? [];
    const tops: number[] = [];
    let origin: CellGrid["origin"] | undefined;
    let waiting = 1 + views.filter(Boolean).length;
    const answered = () => {
      waiting -= 1;
      if (waiting === 0 && origin) done({ origin, rows: tops, columns });
    };
    node.measure((_x, _y, _width, _height, pageX, pageY) => { origin = { x: pageX, y: pageY }; answered(); });
    views.forEach((row, index) => {
      row?.measureLayout(node, (_left, top) => { tops[index] = top; answered(); }, answered);
    });
  };
  const locate = (cells: CellGrid, at: Tap): CellPos => ({
    row: indexAt(cells.rows, at.y - cells.origin.y),
    column: indexAt(cells.columns, at.x - cells.origin.x),
  });
  const activate = (current: Press) => {
    current.timer = null;
    if (press.current !== current) return;
    current.active = true;
    previous.current = null;
    lockList(true);
    locked.current = holdHostGestures(latest.current.frame.current);
    measure((cells) => {
      if (press.current !== current) return;
      current.cells = cells;
      begin(locate(cells, current));
    });
  };

  const frameProps: FrameTouchProps = Platform.OS === "web" ? {} : {
    onTouchStart: (event) => {
      dismiss();
      cancel();
      if (event.nativeEvent.touches.length !== 1) {
        previous.current = null;
        return;
      }
      const current: Press = { ...point(event), timer: null, active: false };
      current.timer = setTimeout(() => activate(current), HOLD_MS);
      press.current = current;
    },
    onTouchMove: (event) => {
      const current = press.current;
      if (!current) return;
      const at = point(event);
      if (!current.active) {
        // Moving before the hold is a scroll.
        if (!near(current, at)) {
          cancel();
          previous.current = null;
        }
        return;
      }
      if (current.cells) extend(locate(current.cells, at));
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
      const release = point(event);
      if (release.time - start.time > TAP_MS || !near(start, release)) {
        previous.current = null;
        return;
      }
      const last = previous.current;
      if (last && release.time - last.time <= DOUBLE_TAP_MS && near(last, release)) {
        previous.current = null;
        // Two taps a few points apart can still straddle a cell's edge.
        measure((cells) => {
          const cell = locate(cells, release);
          if (sameCell(locate(cells, last), cell)) select(cell);
        });
      } else previous.current = release;
    },
    // Once the hold goes through, the frame takes the gesture and keeps it,
    // and blocks the native scrollers above it (Android).
    onMoveShouldSetResponder: () => press.current?.active === true,
    onResponderGrant: (() => true) as ViewProps["onResponderGrant"],
    onResponderTerminationRequest: () => press.current?.active !== true,
  };

  const range: CellRange | null = selection ? cellRange(selection.anchor, selection.focus) : null;
  return { range, dragging, frameProps, dismiss, select, begin, extend, end };
}
