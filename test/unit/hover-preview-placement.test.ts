import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import { bindPreviewPointer, linesFit, openPreviewLayer, scrollsWithin } from "../../client/web";

beforeEach(() => { (globalThis as { __rnMockOS?: string }).__rnMockOS = "web"; });
afterEach(() => { delete (globalThis as { __rnMockOS?: string }).__rnMockOS; });

/** A node under the panel, in the timeline. */
const OUTSIDE = { nodeType: 1 };

function listener(target: { addEventListener: { mock: { calls: unknown[][] } } }, name: string) {
  return target.addEventListener.mock.calls.find(([event]) => event === name)![1] as (event: unknown) => void;
}

function wheel(target: unknown, deltaY = 40, ctrlKey = false) {
  return { target, deltaX: 0, deltaY, ctrlKey, preventDefault: vi.fn() };
}

function layer(contentLeft: number, contentWidth: number, viewportWidth = 1600, anchorWidth = 24,
  options: Parameters<typeof openPreviewLayer>[3] = {}) {
  let resized!: () => void;
  let mutated!: () => void;
  const disconnectResize = vi.fn();
  const disconnectMutation = vi.fn();
  const view = { innerWidth: viewportWidth, innerHeight: 900, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    ResizeObserver: class {
      constructor(callback: () => void) { resized = callback; }
      observe = vi.fn();
      disconnect = disconnectResize;
    },
    MutationObserver: class {
      constructor(callback: () => void) { mutated = callback; }
      observe = vi.fn();
      disconnect = disconnectMutation;
    },
  };
  // 600 wide; `natural` is how wide its lines are unwrapped.
  const body = { children: [], natural: 600, style: { width: "", maxWidth: "" },
    getBoundingClientRect() { return { width: this.style.width === "max-content" ? this.natural : 600 }; } };
  const closeButton = { focus: vi.fn() };
  const content = { getBoundingClientRect: () => ({ left: contentLeft, right: contentLeft + contentWidth }) };
  const viewport = { top: 64, bottom: 800 };
  const anchor = {
    closest: vi.fn((selector: string) => selector === "[data-window-content]"
      ? { getBoundingClientRect: () => viewport } : content),
    getBoundingClientRect: () => ({ left: contentLeft - 8, right: contentLeft - 8 + anchorWidth, top: 100, bottom: 126 }),
  };
  const panel = {
    style: {} as Record<string, string>, scrollHeight: 1200,
    ownerDocument: { defaultView: view, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    setAttribute: vi.fn(), showPopover: vi.fn(), hidePopover: vi.fn(), contains: (node: unknown) => node !== OUTSIDE,
    querySelector: vi.fn((selector: string) => selector.includes("hover-preview-body") ? body : closeButton),
    getBoundingClientRect: () => ({ height: 360 }),
  };
  const close = vi.fn();
  const release = openPreviewLayer(panel, anchor, close, options);
  return { panel, anchor, view, viewport, body, closeButton, close, release,
    resize: () => resized(), mutate: () => mutated(), disconnectResize, disconnectMutation };
}

describe("hover preview content bounds", () => {
  it.each([24, 716])("uses the whole content column for a %s px anchor", (anchorWidth) => {
    const { panel, anchor, release } = layer(200, 700, 1600, anchorWidth);
    expect(anchor.closest).toHaveBeenCalledWith("[data-bcroot]");
    expect(panel.style.width).toBe("700px");
    expect(panel.style.left).toBe("200px");
    expect(panel.style.padding).toBe("0");
    expect(panel.style.overflow).toBe("hidden");
    expect(panel.showPopover).toHaveBeenCalledOnce();
    release();
    expect(panel.hidePopover).toHaveBeenCalledOnce();
  });
  it("keeps a narrower content column narrow on a wide screen", () => {
    const { panel, release } = layer(300, 420, 1800);
    expect(panel.style.width).toBe("420px");
    expect(panel.style.left).toBe("300px");
    release();
  });
  it("clips the content bounds to a narrow viewport without widening them", () => {
    const { panel, release } = layer(20, 700, 600);
    expect(panel.style.width).toBe("572px");
    expect(panel.style.left).toBe("20px");
    release();
  });
  it("clips an offscreen left edge and dismisses on resize", () => {
    const { panel, view, close, release } = layer(-20, 700, 600);
    expect(panel.style.width).toBe("584px");
    expect(panel.style.left).toBe("8px");
    const resize = view.addEventListener.mock.calls.find(([name]) => name === "resize")!;
    (resize[1] as () => void)();
    expect(close).toHaveBeenCalledOnce();
    release();
  });
  it("remeasures changing content and disconnects observers on release", () => {
    const onLinesFit = vi.fn();
    const { body, resize, mutate, release, disconnectResize, disconnectMutation } = layer(200, 700, 1600, 24, { onLinesFit });
    expect(onLinesFit).toHaveBeenLastCalledWith(true);
    body.natural = 900;
    mutate();
    expect(onLinesFit).toHaveBeenLastCalledWith(false);
    body.natural = 500;
    resize();
    expect(onLinesFit).toHaveBeenLastCalledWith(true);
    release();
    expect(disconnectResize).toHaveBeenCalledOnce();
    expect(disconnectMutation).toHaveBeenCalledOnce();
  });
  it.each([600, 1600])("preserves preview width within a %s px viewport and expands to the main content height", (width) => {
    const normal = layer(200, 700, width);
    const { panel, view, viewport, closeButton, close, release } = layer(200, 700, width, 24, { maximized: true });
    const expectedWidth = Math.min(width - 8, 900) - 200;
    expect(panel.style.width).toBe(`${expectedWidth}px`);
    expect(panel.style.width).toBe(normal.panel.style.width);
    expect(panel.style.left).toBe(normal.panel.style.left);
    normal.release();
    expect(panel.style.height).toBe("704px");
    expect(panel.style.top).toBe("80px");
    expect(Number.parseFloat(panel.style.top!) - viewport.top).toBe(16);
    expect(viewport.bottom - (Number.parseFloat(panel.style.top!) + Number.parseFloat(panel.style.height!))).toBe(16);
    expect(closeButton.focus).toHaveBeenCalledOnce();
    for (const event of ["scroll", "blur", "resize"]) {
      const listener = view.addEventListener.mock.calls.find(([name]) => name === event)!;
      (listener[1] as (event: unknown) => void)({ target: {} });
    }
    expect(close).not.toHaveBeenCalled();
    viewport.top = 80;
    viewport.bottom = 700;
    const resize = view.addEventListener.mock.calls.find(([name]) => name === "resize")!;
    (resize[1] as () => void)();
    expect(panel.style.top).toBe("96px");
    expect(panel.style.height).toBe("588px");
    const key = panel.ownerDocument.addEventListener.mock.calls.find(([name]) => name === "keydown")!;
    (key[1] as (event: unknown) => void)({ key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    release();
  });
});

describe("hover preview dismissal and wheel", () => {
  it.each([false, true])("closes on a press outside the panel (maximized: %s), not inside it", (maximized) => {
    const { panel, close, release } = layer(200, 700, 1600, 24, { maximized });
    const press = listener(panel.ownerDocument, "pointerdown");
    press({ target: {} });
    expect(close).not.toHaveBeenCalled();
    press({ target: OUTSIDE });
    expect(close).toHaveBeenCalledOnce();
    release();
    expect(panel.ownerDocument.removeEventListener).toHaveBeenCalledWith("pointerdown", press, true);
  });
  it("treats a press or wheel on the selection bar as inside the panel", () => {
    const { panel, view, close, release } = layer(200, 700, 1600, 24);
    // Outside the panel's DOM, on document.body, yet acting on its text.
    const bar = { ...OUTSIDE, closest: (selector: string) => selector === "[data-bcselectionbar]" ? bar : null };
    listener(panel.ownerDocument, "pointerdown")({ target: bar });
    const event = wheel(bar);
    listener(view, "wheel")(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    release();
  });
  it("keeps the wheel off the timeline under a maximized panel", () => {
    const { view, close, release } = layer(200, 700, 1600, 24, { maximized: true });
    const event = wheel(OUTSIDE);
    listener(view, "wheel")(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    release();
  });
  it("closes a resting panel on a wheel outside it without scrolling the timeline", () => {
    const { view, close, release } = layer(200, 700, 1600, 24);
    const event = wheel(OUTSIDE);
    listener(view, "wheel")(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    release();
  });
  it("leaves pinch zoom alone", () => {
    const { view, close, release } = layer(200, 700, 1600, 24, { maximized: true });
    const event = wheel(OUTSIDE, 40, true);
    listener(view, "wheel")(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    release();
  });
});

describe("scrollsWithin", () => {
  function tree(scroller: Partial<Record<"scrollTop" | "scrollHeight" | "clientHeight" | "scrollLeft" | "scrollWidth" | "clientWidth", number>>,
    overflow = "auto") {
    const styles = new Map<unknown, { overflowX: string; overflowY: string }>();
    const root = { nodeType: 1, parentNode: null, ownerDocument: { defaultView: { getComputedStyle: (node: unknown) => styles.get(node) } } };
    const body = { nodeType: 1, parentNode: root, scrollTop: 0, scrollHeight: 300, clientHeight: 300,
      scrollLeft: 0, scrollWidth: 600, clientWidth: 600, ...scroller };
    const text = { nodeType: 3, parentNode: body };
    styles.set(body, { overflowX: overflow, overflowY: overflow });
    return { root: root as unknown as HTMLElement, text: text as unknown as Node };
  }
  it("is false when nothing in the panel can scroll, so the wheel would chain out", () => {
    const { root, text } = tree({});
    expect(scrollsWithin(text, root, 0, 40)).toBe(false);
    expect(scrollsWithin(text, root, 0, -40)).toBe(false);
  });
  it("follows the scroller's room in the wheel's direction", () => {
    const { root, text } = tree({ scrollTop: 0, scrollHeight: 900 });
    expect(scrollsWithin(text, root, 0, 40)).toBe(true);
    expect(scrollsWithin(text, root, 0, -40)).toBe(false);
    const end = tree({ scrollTop: 600, scrollHeight: 900 });
    expect(scrollsWithin(end.text, end.root, 0, 40)).toBe(false);
    expect(scrollsWithin(end.text, end.root, 0, -40)).toBe(true);
  });
  it("takes a sideways wheel for an unwrapped body", () => {
    const { root, text } = tree({ scrollWidth: 1200 });
    expect(scrollsWithin(text, root, 40, 0)).toBe(true);
    expect(scrollsWithin(text, root, -40, 0)).toBe(false);
  });
  it("ignores clipped content that does not scroll", () => {
    const { root, text } = tree({ scrollHeight: 900 }, "hidden");
    expect(scrollsWithin(text, root, 0, 40)).toBe(false);
  });
});

describe("linesFit", () => {
  /** A body `width` wide whose content is `natural` wide unwrapped. */
  function body(width: number, natural: number) {
    const style = { width: "", maxWidth: "" };
    return { style, getBoundingClientRect: () => ({ width: style.width === "max-content" ? natural : width }) } as unknown as HTMLElement;
  }

  it("is true only when the unwrapped content is no wider than the body, and leaves the body's style as it was", () => {
    const fits = body(600, 420);
    expect(linesFit(fits)).toBe(true);
    expect(fits.style.width).toBe("");
    expect(fits.style.maxWidth).toBe("");
    expect(linesFit(body(600, 600))).toBe(true);
    expect(linesFit(body(600, 1800))).toBe(false);
  });
});

describe("preview pointer and the selection bar", () => {
  function mouse(target: EventTarget, type: string, relatedTarget: unknown) {
    const event = new Event(type);
    Object.defineProperty(event, "relatedTarget", { value: relatedTarget });
    target.dispatchEvent(event);
  }
  it("does not leave the panel for the selection bar, only for what lies past it", () => {
    const panel = Object.assign(new EventTarget(), { contains: (node: unknown) => node === panel });
    const bar = Object.assign(new EventTarget(), { closest: (selector: string) => selector === "[data-bcselectionbar]" ? bar : null });
    const leave = vi.fn();
    const release = bindPreviewPointer(panel, () => {}, leave);
    mouse(panel, "mouseleave", bar);
    expect(leave).not.toHaveBeenCalled();
    mouse(bar, "mouseleave", panel);
    expect(leave).not.toHaveBeenCalled();
    mouse(panel, "mouseleave", bar);
    mouse(bar, "mouseleave", OUTSIDE);
    expect(leave).toHaveBeenCalledOnce();
    mouse(panel, "mouseleave", OUTSIDE);
    expect(leave).toHaveBeenCalledTimes(2);
    release();
  });
});
