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
  /** A held press starts a range on its cell, beside the ones already selected when `add`... */
  begin(cell: CellPos, add?: boolean): void;
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
  /** Pressed with the add key: the range joins the selection, from the press on. */
  add: boolean;
  active: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const CELL = `[data-testid="${TABLE_CELL_TEST_ID}"]`;

/**
 * A mouse press that adds a range to the table's selection: Command on a Mac,
 * Ctrl elsewhere, where Ctrl on a Mac is a right click.
 */
export function addsCellRange(event: MouseEvent): boolean {
  if ((event as PointerEvent).pointerType !== undefined && (event as PointerEvent).pointerType !== "mouse") return false;
  const platform = (globalThis as { navigator?: { platform?: string } }).navigator?.platform ?? "";
  return Boolean(/Mac|iPhone|iPad|iPod/.test(platform) ? event.metaKey : event.ctrlKey);
}

/**
 * Web cell selection, drawn by the same state and menu as on native. A double
 * click picks one cell. A press that rests on a cell, or a mouse drag that
 * crosses into another cell, starts a range that follows the pointer until it
 * lets go; a drag inside one cell stays the browser's text selection. A touch
 * has to rest first, and moving before that is a scroll. With the add key
 * (`addsCellRange`) a press starts its range at once and keeps the ranges
 * already selected, so rows apart can be picked together.
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
    if (event.defaultPrevented || event.button !== 0 || addsCellRange(event)) return;
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
  // An add press ends in a click, which would otherwise follow a link in the cell.
  let swallowClick = false;
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
    handlers.begin(current.cell, current.add);
  };
  const finish = () => {
    const current = press;
    press = null;
    if (!current) return;
    if (current.timer !== null) clearTimeout(current.timer);
    if (!current.active) return;
    swallowClick = current.add;
    frame.style.userSelect = userSelect;
    frame.style.removeProperty("-webkit-user-select");
    handlers.end();
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || event.defaultPrevented || press) return;
    const cell = cellOf(event.target);
    const at = cell ? position(cell) : null;
    if (!at) return;
    swallowClick = false;
    const current: Press = {
      pointer: event.pointerId, cell: at, x: event.clientX, y: event.clientY,
      touch: event.pointerType !== "mouse", add: addsCellRange(event), active: false, timer: null,
    };
    press = current;
    if (current.add) {
      // No browser text selection starts under the add key.
      event.preventDefault();
      activate(current);
    } else current.timer = setTimeout(() => activate(current), HOLD_MS);
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
  const click = (event: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
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
  frame.addEventListener("click", click, true);
  frame.addEventListener("touchmove", holdStill, { passive: false });
  frame.addEventListener("contextmenu", holdStill);
  return () => {
    finish();
    frame.removeEventListener("dblclick", selectCell);
    frame.removeEventListener("pointerdown", down);
    frame.removeEventListener("pointermove", move);
    frame.removeEventListener("pointerup", up);
    frame.removeEventListener("pointercancel", up);
    frame.removeEventListener("click", click, true);
    frame.removeEventListener("touchmove", holdStill);
    frame.removeEventListener("contextmenu", holdStill);
  };
}
