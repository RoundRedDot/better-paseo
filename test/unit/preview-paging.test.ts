import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import { bindPreviewPaging } from "../../client/web";

afterEach(() => { delete (globalThis as { __rnMockOS?: string }).__rnMockOS; });

function binding(os = "web", keys: "arrows" | "brackets" = "arrows") {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
  const doc = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const target = { closest: vi.fn(() => null) };
  const panel = { contains: vi.fn((node) => node === target) };
  const pager = { ownerDocument: doc, closest: vi.fn(() => panel) };
  const step = vi.fn();
  const release = bindPreviewPaging(pager, step, keys);
  const key = (key: string, overrides = {}) => {
    const event = { key, target, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...overrides };
    doc.addEventListener.mock.calls[0]![1](event);
    return event;
  };
  return { doc, target, step, release, key };
}

describe("preview paging", () => {
  it("preserves arrow paging with a bubbling listener by default", () => {
    const { doc, step, release, key } = binding();
    for (const [name, direction] of [["ArrowLeft", -1], ["ArrowRight", 1]] as const) {
      const event = key(name);
      expect(step).toHaveBeenLastCalledWith(direction);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.stopPropagation).toHaveBeenCalledOnce();
    }
    expect(step).toHaveBeenCalledTimes(2);
    expect(doc.addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
    release();
    expect(doc.removeEventListener).toHaveBeenCalledWith("keydown", doc.addEventListener.mock.calls[0]![1]);
  });

  it("maps brackets with a capture listener when details are enabled", () => {
    const { doc, step, release, key } = binding("web", "brackets");
    for (const [name, direction] of [["[", -1], ["]", 1]] as const) {
      const event = key(name);
      expect(step).toHaveBeenLastCalledWith(direction);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.stopPropagation).toHaveBeenCalledOnce();
    }
    key("ArrowRight");
    expect(step).toHaveBeenCalledTimes(2);
    expect(doc.addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    release();
    expect(doc.removeEventListener).toHaveBeenCalledWith("keydown", doc.addEventListener.mock.calls[0]![1], true);
  });

  it.each([
    { key: "[" }, { key: "]" }, { key: "ArrowUp" }, { key: "Escape" }, { altKey: true }, { ctrlKey: true },
    { metaKey: true }, { shiftKey: true }, { isComposing: true }, { defaultPrevented: true },
    { target: { closest: vi.fn(() => null) } },
  ])("leaves other keys and focus outside the panel alone: %j", (overrides) => {
    const { step, key, release } = binding();
    const event = key("ArrowRight", overrides);
    expect(step).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    release();
  });

  it("leaves editable controls alone", () => {
    const { target, step, key, release } = binding();
    target.closest.mockReturnValue({} as never);
    const event = key("ArrowLeft");
    expect(step).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    release();
  });

  it.each(["ios", "android"])("does not bind DOM events on %s", (os) => {
    const { doc, release } = binding(os);
    expect(doc.addEventListener).not.toHaveBeenCalled();
    release();
  });
});
