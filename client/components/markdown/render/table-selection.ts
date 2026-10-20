import { Platform } from "react-native";
import { suppressTouchCallout } from "../../../web";
import { sameCell, type CellPos } from "./table-range";

export const TABLE_CELL_TEST_ID = "markdown-table-cell";

/** How long a press rests on a cell before it starts a range, and how far it may drift first. */
export const HOLD_MS = 350;
export const MOVE_SLOP = 8;

export interface CellSelectionHandlers {
  /** One cell, as a double click picks it. */
  select(cell: CellPos): void;
  /** A held press starts a range on its cell... */
  begin(cell: CellPos): void;
  /** ...that follows the pointer... */
  extend(cell: CellPos): void;
  /** ...until it lets go. */
  end(): void;
}

interface Press {
  pointer: number;
  cell: CellPos;
  x: number;
  y: number;
  touch: boolean;
  active: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const CELL = `[data-testid="${TABLE_CELL_TEST_ID}"]`;

/**
 * Web cell selection, drawn by the same state and menu as on native. A double
 * click picks one cell. A press that rests on a cell, or a mouse drag that
 * crosses into another cell, starts a range that follows the pointer until it
 * lets go; a drag inside one cell stays the browser's text selection. A touch
 * has to rest first, and moving before that is a scroll.
 */
export function bindTableCellSelection(node: unknown, handlers: CellSelectionHandlers): () => void {
  if (Platform.OS !== "web") return () => {};
  const frame = node as HTMLElement | null;
  if (!frame) return () => {};
  const doc = frame.ownerDocument;
  const clearSelection = () => doc.defaultView?.getSelection()?.removeAllRanges();
  const position = (cell: Element): CellPos | null => {
    const row = Number(cell.getAttribute("data-table-cell-row"));
    const column = Number(cell.getAttribute("data-table-cell-column"));
    return cell.getAttribute("data-table-cell-row") !== null && Number.isInteger(row) && Number.isInteger(column)
      ? { row, column } : null;
  };
  const cellOf = (target: EventTarget | null): Element | null => {
    const cell = (target as Element | null)?.closest?.(CELL) ?? null;
    return cell && frame.contains(cell) ? cell : null;
  };
  // The cell under the pointer; past the table's edge, the nearest one in.
  const cellAt = (x: number, y: number): CellPos | null => {
    const rect = frame.getBoundingClientRect();
    const hit = doc.elementFromPoint(
      Math.min(Math.max(x, rect.left + 2), rect.right - 2),
      Math.min(Math.max(y, rect.top + 2), rect.bottom - 2),
    );
    const cell = cellOf(hit);
    return cell ? position(cell) : null;
  };

  const selectCell = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const cell = cellOf(event.target);
    const at = cell && cell.textContent ? position(cell) : null;
    if (!at) return;
    // Drop the browser's word highlight so only the shared cell fill remains.
    clearSelection();
    handlers.select(at);
    event.preventDefault();
    event.stopPropagation();
  };

  let press: Press | null = null;
  const userSelect = frame.style.userSelect;
  const activate = (current: Press) => {
    if (current.timer !== null) clearTimeout(current.timer);
    current.timer = null;
    if (press !== current || current.active) return;
    current.active = true;
    clearSelection();
    frame.style.userSelect = "none";
    frame.style.setProperty("-webkit-user-select", "none");
    try {
      frame.setPointerCapture(current.pointer);
    } catch {
      // The pointer is already gone; its up event ends the range.
    }
    handlers.begin(current.cell);
  };
  const finish = () => {
    const current = press;
    press = null;
    if (!current) return;
    if (current.timer !== null) clearTimeout(current.timer);
    if (!current.active) return;
    frame.style.userSelect = userSelect;
    frame.style.removeProperty("-webkit-user-select");
    handlers.end();
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || event.defaultPrevented || press) return;
    const cell = cellOf(event.target);
    const at = cell ? position(cell) : null;
    if (!at) return;
    const current: Press = {
      pointer: event.pointerId, cell: at, x: event.clientX, y: event.clientY,
      touch: event.pointerType !== "mouse", active: false, timer: null,
    };
    current.timer = setTimeout(() => activate(current), HOLD_MS);
    press = current;
  };
  const move = (event: PointerEvent) => {
    const current = press;
    if (!current || event.pointerId !== current.pointer) return;
    if (!current.active) {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) <= MOVE_SLOP) return;
      if (current.touch) return finish();
      // A mouse that moves selects text, unless it leaves the cell it pressed.
      if (current.timer !== null) clearTimeout(current.timer);
      current.timer = null;
      const at = cellAt(event.clientX, event.clientY);
      if (!at || sameCell(at, current.cell)) return;
      activate(current);
    }
    event.preventDefault();
    clearSelection();
    const at = cellAt(event.clientX, event.clientY);
    if (at) handlers.extend(at);
  };
  const up = (event: PointerEvent) => {
    if (press?.pointer === event.pointerId) finish();
  };
  // A held touch keeps the page from scrolling and from raising its own menu.
  const holdStill = (event: Event) => {
    if (press?.active && event.cancelable) event.preventDefault();
  };

  suppressTouchCallout(frame);
  frame.addEventListener("dblclick", selectCell);
  frame.addEventListener("pointerdown", down);
  frame.addEventListener("pointermove", move);
  frame.addEventListener("pointerup", up);
  frame.addEventListener("pointercancel", up);
  frame.addEventListener("touchmove", holdStill, { passive: false });
  frame.addEventListener("contextmenu", holdStill);
  return () => {
    finish();
    frame.removeEventListener("dblclick", selectCell);
    frame.removeEventListener("pointerdown", down);
    frame.removeEventListener("pointermove", move);
    frame.removeEventListener("pointerup", up);
    frame.removeEventListener("pointercancel", up);
    frame.removeEventListener("touchmove", holdStill);
    frame.removeEventListener("contextmenu", holdStill);
  };
}
