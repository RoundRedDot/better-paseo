import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import { bindTableCellSelection, TABLE_CELL_TEST_ID } from "../../client/components/markdown/render/table-selection";

afterEach(() => { delete (globalThis as { __rnMockOS?: string }).__rnMockOS; });

function binding(os = "web") {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
  const cell = {};
  const range = { selectNodeContents: vi.fn() };
  const selection = { removeAllRanges: vi.fn(), addRange: vi.fn() };
  const frame = {
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    contains: vi.fn((node) => node === cell),
    ownerDocument: { createRange: vi.fn(() => range), defaultView: { getSelection: vi.fn(() => selection) } },
  };
  const release = bindTableCellSelection(frame);
  const doubleClick = (overrides = {}) => {
    const event = {
      button: 0, defaultPrevented: false,
      target: { closest: vi.fn(() => cell) },
      preventDefault: vi.fn(), stopPropagation: vi.fn(), ...overrides,
    };
    frame.addEventListener.mock.calls[0]![1](event);
    return event;
  };
  return { cell, range, selection, frame, release, doubleClick };
}

describe("Markdown table cell double-click", () => {
  it("replaces the word selection with the whole cell, including nested inline text", () => {
    const { cell, range, selection, frame, doubleClick, release } = binding();
    const event = doubleClick();
    expect(event.target.closest).toHaveBeenCalledWith(`[data-testid="${TABLE_CELL_TEST_ID}"]`);
    expect(range.selectNodeContents).toHaveBeenCalledExactlyOnceWith(cell);
    expect(selection.removeAllRanges).toHaveBeenCalledOnce();
    expect(selection.addRange).toHaveBeenCalledExactlyOnceWith(range);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    release();
    expect(frame.removeEventListener).toHaveBeenCalledWith("dblclick", frame.addEventListener.mock.calls[0]![1]);
  });

  it.each([{ button: 1 }, { button: 2 }, { defaultPrevented: true },
    { target: { closest: vi.fn(() => null) } },
    { target: { closest: vi.fn(() => ({})) } },
  ])("leaves unrelated or handled clicks alone: %j", (overrides) => {
    const { selection, doubleClick } = binding();
    const event = doubleClick(overrides);
    expect(selection.removeAllRanges).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each(["ios", "android"])("keeps native text selection on %s", (os) => {
    const { frame, release } = binding(os);
    expect(frame.addEventListener).not.toHaveBeenCalled();
    release();
  });
});
