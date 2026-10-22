import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import { detailsApi } from "../../client/details/details-store";
import {
  bindDetailsKeys,
  hasActiveDetailsKeyboard,
  registerDetailsKeyboardActions,
  registerDetailsPager,
} from "../../client/details/keyboard";

type FakeEvent = {
  key: string;
  target: object;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  defaultPrevented: boolean;
  immediateStopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
};

function setup(os = "web") {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
  const listeners: Array<(event: FakeEvent) => void> = [];
  const doc = {
    addEventListener: vi.fn((type: string, listener: (event: FakeEvent) => void, capture?: boolean) => {
      if (type === "keydown") listeners.push(listener);
      return capture;
    }),
    removeEventListener: vi.fn(),
    getSelection: vi.fn(() => ({ isCollapsed: true })),
    defaultView: { getComputedStyle: (node: { computedStyle?: { overflowX?: string } }) => node.computedStyle ?? { overflowX: "visible" } },
  };
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true, writable: true });
  const target = {
    closest: vi.fn(() => null),
    isContentEditable: false,
    parentElement: null,
    ownerDocument: doc,
    style: { overflowX: "visible" },
    scrollWidth: 100,
    clientWidth: 100,
  };
  const key = (name: string, overrides: Record<string, unknown> = {}) => {
    const event: FakeEvent = {
      key: name,
      target,
      defaultPrevented: false,
      immediateStopped: false,
      preventDefault() { event.defaultPrevented = true; },
      stopPropagation() {},
      stopImmediatePropagation() { event.immediateStopped = true; },
      ...overrides,
    } as FakeEvent;
    for (const listener of listeners) {
      if (event.immediateStopped) break;
      listener(event);
    }
    return event;
  };
  return { doc, target, key, listeners };
}

afterEach(() => {
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
  delete (globalThis as { document?: Document }).document;
  vi.restoreAllMocks();
});

describe("details keyboard routing", () => {
  it("routes block, pager, chrome, fullscreen and primary-copy shortcuts in capture phase", () => {
    const { doc, key } = setup();
    const step = vi.spyOn(detailsApi, "step");
    const close = vi.spyOn(detailsApi, "close");
    const previous = vi.fn();
    const next = vi.fn();
    const toggleWrap = vi.fn();
    const toggleRender = vi.fn();
    const toggleFullscreen = vi.fn();
    const copyPrimary = vi.fn();
    const dropPager = registerDetailsPager("agent-1", { prev: previous, next });
    const dropActions = registerDetailsKeyboardActions("agent-1", { toggleWrap, toggleRender, toggleFullscreen, copyPrimary });
    const release = bindDetailsKeys("agent-1", () => true);

    expect(doc.addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    for (const [name, expected] of [["ArrowLeft", -1], ["ArrowRight", 1]] as const) {
      expect(key(name).defaultPrevented).toBe(true);
      expect(step).toHaveBeenLastCalledWith("agent-1", expected);
    }
    key("[");
    key("]");
    key("W");
    key("r");
    key("f");
    key("c", { metaKey: true });
    expect(previous).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
    expect(toggleWrap).toHaveBeenCalledOnce();
    expect(toggleRender).toHaveBeenCalledOnce();
    expect(toggleFullscreen).toHaveBeenCalledOnce();
    expect(copyPrimary).toHaveBeenCalledOnce();
    const escape = key("Escape");
    expect(close).toHaveBeenCalledWith("agent-1");
    expect(escape.immediateStopped).toBe(true);

    release();
    dropActions();
    dropPager();
    expect(doc.removeEventListener).toHaveBeenCalledWith("keydown", expect.any(Function), true);
  });

  it("steps ← → through the shell's own step while one is registered", () => {
    const { key } = setup();
    const storeStep = vi.spyOn(detailsApi, "step");
    const step = vi.fn();
    const dropActions = registerDetailsKeyboardActions("agent-1", { step });
    const release = bindDetailsKeys("agent-1", () => true);
    key("ArrowLeft");
    key("ArrowRight");
    expect(step.mock.calls).toEqual([[-1], [1]]);
    expect(storeStep).not.toHaveBeenCalled();
    release();
    dropActions();
  });

  it("yields arrows to inputs and horizontally scrollable code", () => {
    const { target, key } = setup();
    const step = vi.spyOn(detailsApi, "step");
    const release = bindDetailsKeys("agent-1", () => true);

    target.closest.mockReturnValue({} as never);
    key("ArrowLeft");
    target.closest.mockReturnValue(null as never);

    const code = {
      ownerDocument: target.ownerDocument,
      parentElement: null,
      computedStyle: { overflowX: "auto" },
      scrollWidth: 600,
      clientWidth: 200,
    };
    target.parentElement = code as never;
    key("ArrowRight");
    expect(step).not.toHaveBeenCalled();
    release();
  });

  it("copies only without a selection and leaves editable inputs alone", () => {
    const { doc, target, key } = setup();
    const copyPrimary = vi.fn();
    const dropActions = registerDetailsKeyboardActions("agent-1", { copyPrimary });
    const release = bindDetailsKeys("agent-1", () => true);

    doc.getSelection.mockReturnValue({ isCollapsed: false } as never);
    key("c", { ctrlKey: true });
    expect(copyPrimary).not.toHaveBeenCalled();

    doc.getSelection.mockReturnValue({ isCollapsed: true } as never);
    target.closest.mockReturnValue({} as never);
    key("c", { ctrlKey: true });
    key("w");
    expect(copyPrimary).not.toHaveBeenCalled();
    release();
    dropActions();
  });

  it("skips a hidden retained duplicate pane and closes Escape once", () => {
    const { key } = setup();
    const step = vi.spyOn(detailsApi, "step");
    const close = vi.spyOn(detailsApi, "close");
    const hiddenPane = { getClientRects: () => [] };
    const visiblePane = { getClientRects: () => [{}] };
    const hiddenLease = bindDetailsKeys("agent-1", () => hiddenPane.getClientRects().length > 0);
    const visibleLease = bindDetailsKeys("agent-1", () => visiblePane.getClientRects().length > 0);

    const stepped = key("ArrowRight");
    expect(step).toHaveBeenCalledTimes(1);
    expect(hasActiveDetailsKeyboard(stepped as never)).toBe(true);
    const escaped = key("Escape");
    expect(close).toHaveBeenCalledTimes(1);
    expect(escaped.immediateStopped).toBe(true);

    visibleLease();
    expect(hasActiveDetailsKeyboard()).toBe(false);
    hiddenLease();
  });

  it("does not attach browser listeners on native platforms", () => {
    const { doc } = setup("ios");
    const release = bindDetailsKeys("agent-1", () => true);
    expect(doc.addEventListener).not.toHaveBeenCalled();
    release();
  });
});
