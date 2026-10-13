import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import { bindPreviewMaximize } from "../../client/web";

afterEach(() => { delete (globalThis as { __rnMockOS?: string }).__rnMockOS; });

function binding(os = "web") {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
  const toolbar = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const maximize = vi.fn();
  const release = bindPreviewMaximize(toolbar, maximize);
  const doubleClick = (overrides = {}) => {
    const event = { button: 0, defaultPrevented: false, target: { closest: vi.fn(() => null) },
      preventDefault: vi.fn(), stopPropagation: vi.fn(), ...overrides };
    toolbar.addEventListener.mock.calls[0]![1](event);
    return event;
  };
  return { toolbar, maximize, release, doubleClick };
}

describe("preview toolbar double-click", () => {
  it("maximizes from free space or a title and removes the listener on cleanup", () => {
    const { toolbar, maximize, release, doubleClick } = binding();
    const event = doubleClick();
    expect(toolbar.addEventListener).toHaveBeenCalledWith("dblclick", expect.any(Function));
    expect(maximize).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    release();
    expect(toolbar.removeEventListener).toHaveBeenCalledWith("dblclick", toolbar.addEventListener.mock.calls[0]![1]);
  });

  it.each([{ button: 1 }, { button: 2 }, { defaultPrevented: true },
    { target: { closest: vi.fn(() => ({})) } },
  ])("ignores controls and non-primary or handled clicks: %j", (overrides) => {
    const { maximize, doubleClick } = binding();
    const event = doubleClick(overrides);
    expect(maximize).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it.each(["ios", "android"])("does not bind DOM events on %s", (os) => {
    const { toolbar, release } = binding(os);
    expect(toolbar.addEventListener).not.toHaveBeenCalled();
    release();
  });
});
