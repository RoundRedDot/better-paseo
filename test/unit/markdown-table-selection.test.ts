import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import { bindTableCellSelection, TABLE_CELL_TEST_ID } from "../../client/components/markdown/render/table-selection";

afterEach(() => { delete (globalThis as { __rnMockOS?: string }).__rnMockOS; });

function binding(os = "web") {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
  const cell = { getAttribute: vi.fn((name: string): string => name === "data-table-cell-key" ? "r0c0" : "bold and code") };
  const selection = { removeAllRanges: vi.fn() };
  const select = vi.fn();
  const frame = {
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    contains: vi.fn((node) => node === cell),
    ownerDocument: { defaultView: { getSelection: vi.fn(() => selection) } },
  };
  const release = bindTableCellSelection(frame, select);
  const doubleClick = (overrides = {}) => {
    const event = {
      button: 0, defaultPrevented: false,
      target: { closest: vi.fn(() => cell) },
      preventDefault: vi.fn(), stopPropagation: vi.fn(), ...overrides,
    };
    frame.addEventListener.mock.calls[0]![1](event);
    return event;
  };
  return { cell, select, selection, frame, release, doubleClick };
}

describe("Markdown table cell double-click", () => {
  it("replaces the browser word selection with shared cell state", () => {
    const { select, selection, frame, doubleClick, release } = binding();
    const event = doubleClick();
    expect(event.target.closest).toHaveBeenCalledWith(`[data-testid="${TABLE_CELL_TEST_ID}"]`);
    expect(select).toHaveBeenCalledExactlyOnceWith("r0c0", "bold and code");
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
    const { select, selection, doubleClick } = binding();
    const event = doubleClick(overrides);
    expect(select).not.toHaveBeenCalled();
    expect(selection.removeAllRanges).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("leaves empty cells unselected", () => {
    const { cell, select, doubleClick } = binding();
    cell.getAttribute.mockReturnValue("");
    const event = doubleClick();
    expect(select).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each(["ios", "android"])("keeps native text selection on %s", (os) => {
    const { frame, release } = binding(os);
    expect(frame.addEventListener).not.toHaveBeenCalled();
    release();
  });
});
