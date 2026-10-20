import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import { bindTableCellSelection, HOLD_MS, TABLE_CELL_TEST_ID } from "../../client/components/markdown/render/table-selection";
import { cellRange, indexAt, rangeHas, rangeText, rowSpan } from "../../client/components/markdown/render/table-range";
import { marked, type Tokens } from "../../client/vendor/marked";

afterEach(() => {
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
  vi.useRealTimers();
});

type Listener = (event: Record<string, unknown>) => void;

/** A 2×3 table of cells, each `{ row, column }`, laid out 100 wide and 20 tall from (0, 0). */
function binding(os = "web") {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
  const cells = [0, 1].flatMap((row) => [0, 1, 2].map((column) => ({
    row, column, textContent: row === 1 && column === 2 ? "" : `r${row}c${column}`,
    getAttribute: (name: string) => name === "data-table-cell-row" ? String(row)
      : name === "data-table-cell-column" ? String(column) : null,
  })));
  const cellAt = (x: number, y: number) => cells.find((cell) => cell.row === Math.floor(y / 20)
    && cell.column === Math.floor(x / 100)) ?? null;
  const target = (cell: unknown) => ({ closest: vi.fn(() => cell) });
  const selection = { removeAllRanges: vi.fn() };
  const handlers = { select: vi.fn(), begin: vi.fn(), extend: vi.fn(), end: vi.fn() };
  const listeners = new Map<string, Listener>();
  const style: Record<string, unknown> = {};
  const frame = {
    style: Object.assign(style, {
      setProperty: vi.fn((name: string, value: string) => { style[name] = value; }),
      removeProperty: vi.fn((name: string) => { delete style[name]; }),
    }),
    addEventListener: vi.fn((type: string, listener: Listener) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    contains: vi.fn((node) => cells.includes(node)),
    setPointerCapture: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 300, bottom: 40 }),
    ownerDocument: {
      defaultView: { getSelection: vi.fn(() => selection) },
      elementFromPoint: (x: number, y: number) => target(cellAt(x, y)),
    },
  };
  const release = bindTableCellSelection(frame, handlers);
  const fire = (type: string, overrides: Record<string, unknown> = {}) => {
    const event = {
      button: 0, defaultPrevented: false, pointerId: 1, pointerType: "mouse", cancelable: true,
      target: target(cells[0]), preventDefault: vi.fn(), stopPropagation: vi.fn(), ...overrides,
    };
    listeners.get(type)!(event);
    return event;
  };
  const pointer = (type: string, x: number, y: number, overrides: Record<string, unknown> = {}) =>
    fire(type, { clientX: x, clientY: y, target: target(cellAt(x, y)), ...overrides });
  return { cells, target, handlers, selection, frame, listeners, release, fire, pointer };
}

describe("Markdown table cell double-click", () => {
  it("replaces the browser word selection with shared cell state", () => {
    const { cells, target, handlers, selection, frame, fire, release } = binding();
    const event = fire("dblclick", { target: target(cells[4]) });
    expect(event.target.closest).toHaveBeenCalledWith(`[data-testid="${TABLE_CELL_TEST_ID}"]`);
    expect(handlers.select).toHaveBeenCalledExactlyOnceWith({ row: 1, column: 1 });
    expect(selection.removeAllRanges).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    release();
    expect(frame.removeEventListener).toHaveBeenCalledWith("dblclick", frame.addEventListener.mock.calls[0]![1]);
  });

  it.each([{ button: 1 }, { button: 2 }, { defaultPrevented: true },
    { target: { closest: vi.fn(() => null) } },
    { target: { closest: vi.fn(() => ({})) } },
  ])("leaves unrelated or handled clicks alone: %j", (overrides) => {
    const { handlers, selection, fire } = binding();
    const event = fire("dblclick", overrides);
    expect(handlers.select).not.toHaveBeenCalled();
    expect(selection.removeAllRanges).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("leaves empty cells unselected", () => {
    const { cells, target, handlers, fire } = binding();
    const event = fire("dblclick", { target: target(cells[5]) });
    expect(handlers.select).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each(["ios", "android"])("binds nothing on %s, where the cells take the gesture", (os) => {
    const { frame, release } = binding(os);
    expect(frame.addEventListener).not.toHaveBeenCalled();
    release();
  });
});

describe("Markdown table cell range on web", () => {
  it("starts a range when a mouse rests on a cell, follows it and ends on release", () => {
    vi.useFakeTimers();
    const { frame, handlers, selection, pointer } = binding();
    pointer("pointerdown", 10, 5);
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(handlers.begin).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(handlers.begin).toHaveBeenCalledExactlyOnceWith({ row: 0, column: 0 });
    expect(selection.removeAllRanges).toHaveBeenCalled();
    expect(frame.setPointerCapture).toHaveBeenCalledWith(1);
    expect(frame.style.userSelect).toBe("none");
    const move = pointer("pointermove", 250, 30);
    expect(move.preventDefault).toHaveBeenCalled();
    expect(handlers.extend).toHaveBeenLastCalledWith({ row: 1, column: 2 });
    // Past the table's edge, the nearest cell in.
    pointer("pointermove", 900, 400);
    expect(handlers.extend).toHaveBeenLastCalledWith({ row: 1, column: 2 });
    pointer("pointerup", 900, 400);
    expect(handlers.end).toHaveBeenCalledOnce();
    expect(frame.style.userSelect).toBeUndefined();
  });

  it("keeps a mouse drag inside one cell as text selection, and turns it into a range on leaving the cell", () => {
    vi.useFakeTimers();
    const { handlers, pointer } = binding();
    pointer("pointerdown", 10, 5);
    const inside = pointer("pointermove", 60, 5);
    expect(inside.preventDefault).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(handlers.begin).not.toHaveBeenCalled();
    const across = pointer("pointermove", 150, 25);
    expect(across.preventDefault).toHaveBeenCalled();
    expect(handlers.begin).toHaveBeenCalledExactlyOnceWith({ row: 0, column: 0 });
    expect(handlers.extend).toHaveBeenLastCalledWith({ row: 1, column: 1 });
    pointer("pointerup", 150, 25);
    expect(handlers.end).toHaveBeenCalledOnce();
  });

  it("lets a touch that moves before the hold scroll the page", () => {
    vi.useFakeTimers();
    const { handlers, pointer, fire } = binding();
    pointer("pointerdown", 10, 5, { pointerType: "touch" });
    pointer("pointermove", 10, 30, { pointerType: "touch" });
    vi.advanceTimersByTime(HOLD_MS);
    expect(handlers.begin).not.toHaveBeenCalled();
    const scroll = fire("touchmove");
    expect(scroll.preventDefault).not.toHaveBeenCalled();
  });

  it("holds the page still and keeps its menu away while a held touch draws the range", () => {
    vi.useFakeTimers();
    const { handlers, pointer, fire } = binding();
    pointer("pointerdown", 10, 5, { pointerType: "touch" });
    vi.advanceTimersByTime(HOLD_MS);
    expect(handlers.begin).toHaveBeenCalledOnce();
    expect(fire("touchmove").preventDefault).toHaveBeenCalled();
    expect(fire("contextmenu").preventDefault).toHaveBeenCalled();
    pointer("pointermove", 120, 5, { pointerType: "touch" });
    expect(handlers.extend).toHaveBeenLastCalledWith({ row: 0, column: 1 });
    pointer("pointercancel", 120, 5, { pointerType: "touch" });
    expect(handlers.end).toHaveBeenCalledOnce();
    expect(fire("touchmove").preventDefault).not.toHaveBeenCalled();
  });

  it("ignores a quick click and another pointer", () => {
    vi.useFakeTimers();
    const { handlers, pointer } = binding();
    pointer("pointerdown", 10, 5);
    pointer("pointerdown", 150, 5, { pointerId: 2 });
    pointer("pointermove", 150, 25, { pointerId: 2 });
    pointer("pointerup", 10, 5);
    vi.advanceTimersByTime(HOLD_MS);
    expect(handlers.begin).not.toHaveBeenCalled();
    expect(handlers.end).not.toHaveBeenCalled();
  });
});

describe("Markdown table cell ranges", () => {
  const table = marked.lexer("| a | b \\| c | d |\n|:--|:-:|--:|\n| 1 | **2** | 3 |\n| 4 | `5 \\| 6` | 7 |\n")[0] as Tokens.Table;

  it("normalises the rectangle from either corner", () => {
    const range = cellRange({ row: 2, column: 0 }, { row: 1, column: 2 });
    expect(range).toEqual({ top: 1, left: 0, bottom: 2, right: 2 });
    expect(rangeHas(range, 1, 1)).toBe(true);
    expect(rangeHas(range, 0, 1)).toBe(false);
    expect(rowSpan(range, 2)).toBe("0-2");
    expect(rowSpan(range, 0)).toBe("");
    expect(rowSpan(null, 1)).toBe("");
  });

  it("copies one cell as its text", () => {
    expect(rangeText(table, cellRange({ row: 1, column: 1 }, { row: 1, column: 1 }))).toBe("2");
    expect(rangeText(table, cellRange({ row: 0, column: 1 }, { row: 0, column: 1 }))).toBe("b | c");
  });

  it("copies several cells as a Markdown table led by their header", () => {
    expect(rangeText(table, cellRange({ row: 1, column: 1 }, { row: 2, column: 2 }))).toBe(
      "| b \\| c | d |\n| :---: | ---: |\n| **2** | 3 |\n| `5 \\| 6` | 7 |");
    expect(rangeText(table, cellRange({ row: 0, column: 0 }, { row: 1, column: 0 }))).toBe(
      "| a |\n| :--- |\n| 1 |");
    expect(rangeText(table, cellRange({ row: 0, column: 0 }, { row: 0, column: 1 }))).toBe(
      "| a | b \\| c |\n| :--- | :---: |");
  });

  it("finds the row or column a point falls in", () => {
    expect(indexAt([1, 101, 201], -5)).toBe(0);
    expect(indexAt([1, 101, 201], 100)).toBe(0);
    expect(indexAt([1, 101, 201], 101)).toBe(1);
    expect(indexAt([1, 101, 201], 900)).toBe(2);
  });
});
