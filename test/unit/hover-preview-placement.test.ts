import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import { bindPreviewPointer, dropSelectionIn, linesFit, openPreviewLayer, PREVIEW_GROW, PREVIEW_REVEAL, scrollsWithin } from "../../client/web";

/** The system's reduce-motion setting and the anchor row's top, for the next `layer`. */
let reduceMotion = false;
let anchorTop = 100;
beforeEach(() => { (globalThis as { __rnMockOS?: string }).__rnMockOS = "web"; });
afterEach(() => {
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
  reduceMotion = false;
  anchorTop = 100;
});

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
    matchMedia: vi.fn(() => ({ matches: reduceMotion })),
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
  const body = { children: [], natural: 600, style: { width: "", maxWidth: "" }, scrollTop: 0, scrollLeft: 0, querySelectorAll: () => [],
    getBoundingClientRect() { return { width: this.style.width === "max-content" ? this.natural : 600 }; } };
  const closeButton = { focus: vi.fn() };
  const content = { getBoundingClientRect: () => ({ left: contentLeft, right: contentLeft + contentWidth }) };
  const viewport = { top: 64, bottom: 800 };
  const anchor = {
    closest: vi.fn((selector: string) => selector === "[data-window-content]"
      ? { getBoundingClientRect: () => viewport } : content),
    getBoundingClientRect: () => ({ left: contentLeft - 8, right: contentLeft - 8 + anchorWidth, top: anchorTop, bottom: anchorTop + 26 }),
  };
  const panel = {
    style: {} as Record<string, string>, scrollHeight: 1200,
    ownerDocument: { defaultView: view, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    setAttribute: vi.fn(), showPopover: vi.fn(), hidePopover: vi.fn(), contains: (node: unknown) => node !== OUTSIDE,
    querySelector: vi.fn((selector: string) => selector.includes("hover-preview-body") ? body : closeButton),
    getBoundingClientRect: (): Record<string, number> => ({ left: contentLeft, top: anchorTop + 32, width: contentWidth, height: 360 }),
    animate: vi.fn(),
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
    // Caught on the way down, before the focused reply box can stop it.
    expect(key[2]).toBe(true);
    // An Escape that ends an IME composition belongs to the field.
    (key[1] as (event: unknown) => void)({ key: "Escape", isComposing: true, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(close).not.toHaveBeenCalled();
    const escape = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
    (key[1] as (event: unknown) => void)(escape);
    expect(close).toHaveBeenCalledOnce();
    expect(escape.stopPropagation).toHaveBeenCalledOnce();
    release();
  });
});

describe("hover preview and timeline scrolls", () => {
  it("stays open and in place when the timeline scrolls on its own, as when a streamed call finishes", () => {
    const { panel, view, close, resize, release } = layer(200, 700);
    const top = panel.style.top;
    listener(view, "scroll")({ target: OUTSIDE });
    expect(close).not.toHaveBeenCalled();
    // The row has moved up the timeline; growing content no longer follows it.
    anchorTop = 400;
    resize();
    expect(panel.style.top).toBe(top);
    expect(top).toBe("132px");
    expect(panel.style.maxHeight).toBe("360px");
    // Arrow keys in a field move its caret, not the page.
    const key = listener(panel.ownerDocument, "keydown");
    key({ key: "ArrowDown", target: { closest: () => ({}) } });
    listener(view, "scroll")({ target: OUTSIDE });
    expect(close).not.toHaveBeenCalled();
    release();
  });

  it("closes on a scroll the reader started from the keyboard", () => {
    const { panel, view, close, release } = layer(200, 700);
    listener(panel.ownerDocument, "keydown")({ key: "PageDown", target: OUTSIDE });
    listener(view, "scroll")({ target: OUTSIDE });
    expect(close).toHaveBeenCalledOnce();
    release();
  });
});

describe("hover preview entrance", () => {
  it("fades in on the compositor, sliding down from a row above it", () => {
    const { panel, view, release } = layer(200, 700);
    expect(view.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    expect(panel.animate).toHaveBeenCalledOnce();
    const [frames, timing] = panel.animate.mock.calls[0]!;
    expect(frames).toEqual([
      { opacity: 0, transform: `translateY(-${PREVIEW_REVEAL.shift}px)` },
      { opacity: 1, transform: "none" },
    ]);
    // No fill, so nothing outlives the entrance.
    expect(timing).toEqual({ duration: PREVIEW_REVEAL.ms, easing: expect.any(String) });
    release();
  });
  it("slides up when it opens above its row", () => {
    anchorTop = 800;
    const { panel, release } = layer(200, 700);
    expect(Number.parseFloat(panel.style.top!)).toBeLessThan(anchorTop);
    expect(panel.animate.mock.calls[0]![0][0]).toEqual({ opacity: 0, transform: `translateY(${PREVIEW_REVEAL.shift}px)` });
    release();
  });
  it("appears at once when maximized or when the system reduces motion", () => {
    const maximized = layer(200, 700, 1600, 24, { maximized: true });
    expect(maximized.panel.animate).not.toHaveBeenCalled();
    maximized.release();
    reduceMotion = true;
    const reduced = layer(200, 700);
    expect(reduced.panel.animate).not.toHaveBeenCalled();
    reduced.release();
  });
});

describe("maximizing a hover preview", () => {
  /** Hovers, then maximizes the same panel, as the preview's re-render does. */
  function maximize() {
    const hover = layer(200, 700);
    const { panel, anchor, close } = hover;
    // The panel's box while hovering, then once maximized.
    panel.getBoundingClientRect = vi.fn(() => ({ height: 360, top: 132, bottom: 492, left: 200, right: 900 }));
    hover.release();
    panel.getBoundingClientRect = vi.fn(() => ({ height: 704, top: 80, bottom: 784, left: 200, right: 900 }));
    panel.animate.mockClear();
    const release = openPreviewLayer(panel, anchor, close, { maximized: true });
    return { panel, anchor, close, release };
  }

  it("opens a clip from the hover box to the maximized panel and its shadow", () => {
    const { panel, release } = maximize();
    expect(panel.animate).toHaveBeenCalledOnce();
    const [frames, timing] = panel.animate.mock.calls[0]!;
    expect(frames).toEqual([
      { clipPath: "inset(52px 0px 292px 0px round 12px)" },
      { clipPath: `inset(-${PREVIEW_GROW.shadow}px round 12px)` },
    ]);
    expect(timing).toEqual({ duration: PREVIEW_GROW.ms, easing: expect.any(String) });
    release();
  });
  it("grows only from a hover box this panel just had", () => {
    const { panel, anchor, close, release } = maximize();
    release();
    panel.animate.mockClear();
    // Closing a maximized panel leaves no box behind for the next one.
    openPreviewLayer(panel, anchor, close, { maximized: true })();
    expect(panel.animate).not.toHaveBeenCalled();
  });
  it("jumps straight to its size when the system reduces motion", () => {
    reduceMotion = true;
    const { panel, release } = maximize();
    expect(panel.animate).not.toHaveBeenCalled();
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
  it("keeps a popped-out window up and in place while the reader goes on with the timeline", () => {
    const { panel, view, close, resize, release } = layer(200, 700, 1600, 24, { floating: true });
    listener(view, "scroll")({ target: OUTSIDE });
    // The wheel outside scrolls the timeline as usual; inside, the panel's own body.
    const outside = wheel(OUTSIDE);
    listener(view, "wheel")(outside);
    expect(outside.preventDefault).not.toHaveBeenCalled();
    listener(panel.ownerDocument, "pointerdown")({ target: OUTSIDE });
    listener(view, "resize")({});
    listener(view, "blur")({});
    expect(close).not.toHaveBeenCalled();
    // Its first box is kept as a placed one: the same spot, at the height it opened with.
    resize();
    expect(panel.style).toMatchObject({ left: "200px", top: "132px", width: "700px", height: "360px" });
    listener(panel.ownerDocument, "keydown")({ key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(close).toHaveBeenCalledOnce();
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

describe("moving and resizing a hover preview", () => {
  function emitter() {
    const map = new Map<string, Set<(event: unknown) => void>>();
    return {
      addEventListener(name: string, fn: (event: unknown) => void) {
        let set = map.get(name);
        if (!set) map.set(name, (set = new Set()));
        set.add(fn);
      },
      removeEventListener(name: string, fn: (event: unknown) => void) {
        map.get(name)?.delete(fn);
      },
      emit(name: string, event?: unknown) {
        for (const fn of [...(map.get(name) ?? [])]) fn(event);
      },
      has(name: string) {
        return (map.get(name)?.size ?? 0) > 0;
      },
    };
  }

  function movable(options: { maximized?: boolean; frame?: { x: number; y: number; width: number; height: number } } = {}) {
    const panelEvents = emitter();
    const docEvents = emitter();
    const viewEvents = emitter();
    const onPlace = vi.fn();
    const onHold = vi.fn();
    const onLeave = vi.fn();
    const close = vi.fn();
    const documentElement = { style: {} as Record<string, string> };
    const view = {
      innerWidth: 1600, innerHeight: 900,
      addEventListener: viewEvents.addEventListener, removeEventListener: viewEvents.removeEventListener,
      emit: viewEvents.emit,
      matchMedia: vi.fn(() => ({ matches: false })),
      ResizeObserver: class { observe() {} disconnect() {} },
      MutationObserver: class { observe() {} disconnect() {} },
    };
    const ownerDocument = Object.assign(docEvents, { defaultView: view, documentElement });
    const body = {
      children: [] as unknown[], natural: 600, style: { width: "", maxWidth: "", flexGrow: "" }, scrollTop: 0, scrollLeft: 0, querySelectorAll: () => [],
      getBoundingClientRect() { return { width: this.style.width === "max-content" ? this.natural : 600 }; },
    };
    // A DOM `closest` throws "Illegal invocation" when it is called without its element.
    const element = (matches: (selector: string) => boolean) => {
      const node = {
        closest(this: unknown, selector: string) {
          if (this !== node) throw new TypeError("Illegal invocation");
          return matches(selector) ? node : null;
        },
      };
      return node;
    };
    const title = element(() => false);
    const button = element((selector) => selector.includes("button"));
    const toolbar = { contains: (node: unknown) => node === title || node === toolbar };
    const content = { getBoundingClientRect: () => ({ left: 200, right: 900 }) };
    const viewport = { getBoundingClientRect: () => ({ top: 64, bottom: 800, left: 0, right: 1600 }) };
    const anchor = {
      closest: vi.fn((selector: string) => selector === "[data-window-content]" ? viewport : content),
      getBoundingClientRect: () => ({ left: 192, right: 216, top: 100, bottom: 126 }),
    };
    const panel = Object.assign(panelEvents, {
      style: {} as Record<string, string>,
      scrollHeight: 200,
      ownerDocument,
      setAttribute: vi.fn(), showPopover: vi.fn(), hidePopover: vi.fn(), setPointerCapture: vi.fn(),
      contains: (node: unknown) => node !== OUTSIDE && node !== button,
      querySelector: (selector: string) => {
        if (selector.includes("hover-preview-body")) return body;
        if (selector.includes("hover-preview-toolbar")) return toolbar;
        return { focus: vi.fn() };
      },
      getBoundingClientRect() {
        const n = (value: string | undefined, fallback: number) => {
          const parsed = Number.parseFloat(value ?? "");
          return Number.isFinite(parsed) ? parsed : fallback;
        };
        const x = n(panel.style.left, 200);
        const y = n(panel.style.top, 132);
        const width = n(panel.style.width, 700);
        const height = n(panel.style.height, 360);
        return { left: x, top: y, x, y, width, height, right: x + width, bottom: y + height };
      },
      animate: vi.fn(),
    });
    const release = openPreviewLayer(panel, anchor, close, { onPlace, onHold, onLeave, ...options });
    const pointer = (target: unknown, point: { x: number; y: number }, extra: Record<string, unknown> = {}) => ({
      button: 0, pointerId: 1, pointerType: "mouse", clientX: point.x, clientY: point.y, target,
      defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra,
    });
    return { panel, view, docEvents, onPlace, onHold, onLeave, close, title, button, release, pointer };
  }

  it("moves from the toolbar and then stays put when the window resizes", () => {
    const { panel, view, docEvents, onPlace, onHold, close, title, release, pointer } = movable();
    expect(panel.style.left).toBe("200px");
    const down = pointer(title, { x: 400, y: 160 });
    panel.emit("pointerdown", down);
    expect(down.preventDefault).not.toHaveBeenCalled();
    expect(onHold).toHaveBeenLastCalledWith(true);
    docEvents.emit("pointermove", pointer(title, { x: 402, y: 161 }));
    expect(onPlace).not.toHaveBeenCalled();
    expect(panel.style.left).toBe("200px");
    docEvents.emit("pointermove", pointer(title, { x: 480, y: 200 }));
    docEvents.emit("pointerup", pointer(title, { x: 480, y: 200 }));
    expect(onPlace).toHaveBeenCalledOnce();
    expect(onHold).toHaveBeenLastCalledWith(false);
    expect(panel.style.left).toBe("280px");
    expect(panel.style.top).toBe("172px");
    expect(panel.style.width).toBe("700px");
    expect(panel.style.height).toBe("360px");
    view.innerWidth = 400;
    view.emit("resize");
    expect(close).not.toHaveBeenCalled();
    expect(panel.style.left).toBe("8px");
    expect(panel.style.width).toBe("384px");
    release();
  });

  it("captures the pointer only once a press travels, so a click or double-click keeps its target", () => {
    const { panel, docEvents, title, release, pointer } = movable();
    panel.emit("pointerdown", pointer(title, { x: 400, y: 160 }));
    docEvents.emit("pointermove", pointer(title, { x: 402, y: 161 }));
    docEvents.emit("pointerup", pointer(title, { x: 402, y: 161 }));
    // A captured pointer sends the click and dblclick to the panel, past the toolbar's listener.
    expect(panel.setPointerCapture).not.toHaveBeenCalled();

    panel.emit("pointerdown", pointer(title, { x: 400, y: 160 }));
    docEvents.emit("pointermove", pointer(title, { x: 480, y: 200 }));
    docEvents.emit("pointermove", pointer(title, { x: 500, y: 210 }));
    expect(panel.setPointerCapture).toHaveBeenCalledOnce();
    expect(panel.setPointerCapture).toHaveBeenCalledWith(1);
    docEvents.emit("pointerup", pointer(title, { x: 500, y: 210 }));
    release();
  });

  it("keeps the box dragged out of a maximized window, without playing the entrance again", () => {
    const { panel, docEvents, onPlace, title, release, pointer } = movable({ maximized: true });
    expect(panel.style.top).toBe("80px");
    expect(panel.style.height).toBe("704px");
    panel.emit("pointerdown", pointer(title, { x: 400, y: 120 }));
    docEvents.emit("pointermove", pointer(title, { x: 480, y: 180 }));
    docEvents.emit("pointerup", pointer(title, { x: 480, y: 180 }));
    const box = onPlace.mock.calls[0]![0] as { x: number; y: number; width: number; height: number };
    expect(box).toEqual({ x: 280, y: 140, width: 700, height: 704 });
    expect(panel.style.left).toBe("280px");
    release();

    const restored = movable({ frame: box });
    expect(restored.panel.animate).not.toHaveBeenCalled();
    expect(restored.panel.style.left).toBe("280px");
    expect(restored.panel.style.top).toBe("140px");
    expect(restored.panel.style.width).toBe("700px");
    expect(restored.panel.style.height).toBe("704px");
    restored.release();
  });

  it("resizes from an edge and ignores a drag that starts on a button", () => {
    const { panel, docEvents, onPlace, button, title, release, pointer } = movable();
    const down = pointer(button, { x: 500, y: 160 });
    panel.emit("pointerdown", down);
    docEvents.emit("pointermove", pointer(button, { x: 560, y: 160 }));
    docEvents.emit("pointerup", pointer(button, { x: 560, y: 160 }));
    expect(onPlace).not.toHaveBeenCalled();
    expect(panel.style.left).toBe("200px");

    const edge = pointer(title, { x: 896, y: 300 });
    panel.emit("pointerdown", edge);
    expect(edge.preventDefault).toHaveBeenCalledOnce();
    docEvents.emit("pointermove", pointer(title, { x: 946, y: 300 }));
    docEvents.emit("pointerup", pointer(title, { x: 946, y: 300 }));
    expect(panel.style.left).toBe("200px");
    expect(panel.style.width).toBe("750px");
    release();
  });

  it("treats a wider strip as an edge for touch than for a mouse", () => {
    const touch = movable();
    const down = touch.pointer(touch.title, { x: 212, y: 300 }, { pointerType: "touch" });
    touch.panel.emit("pointerdown", down);
    touch.docEvents.emit("pointermove", touch.pointer(touch.title, { x: 252, y: 300 }, { pointerType: "touch" }));
    touch.docEvents.emit("pointerup", touch.pointer(touch.title, { x: 252, y: 300 }, { pointerType: "touch" }));
    // 12px in from the left: a finger resizes, and the right edge stays at 900.
    expect(touch.panel.style.left).toBe("240px");
    expect(touch.panel.style.width).toBe("660px");
    touch.release();

    const mouse = movable();
    mouse.panel.emit("pointerdown", mouse.pointer(mouse.title, { x: 212, y: 300 }));
    mouse.docEvents.emit("pointermove", mouse.pointer(mouse.title, { x: 252, y: 300 }));
    mouse.docEvents.emit("pointerup", mouse.pointer(mouse.title, { x: 252, y: 300 }));
    // The same point with a mouse is the toolbar, so the window moves and keeps its width.
    expect(mouse.panel.style.left).toBe("240px");
    expect(mouse.panel.style.width).toBe("700px");
    mouse.release();
  });

  it("drops the drag listeners when the layer closes", () => {
    const { panel, docEvents, release } = movable();
    expect(panel.has("pointerdown")).toBe(true);
    release();
    expect(panel.has("pointerdown")).toBe(false);
    expect(docEvents.has("pointermove")).toBe(false);
  });
});

describe("linesFit", () => {
  /** A body `width` wide whose content is `natural` wide unwrapped. */
  function body(width: number, natural: number) {
    const style = { width: "", maxWidth: "" };
    return {
      style, scrollTop: 0, scrollLeft: 0, querySelectorAll: () => [],
      getBoundingClientRect: () => ({ width: style.width === "max-content" ? natural : width }),
    } as unknown as HTMLElement;
  }

  it("is true only when the unwrapped content is no wider than the body, and leaves the body's style as it was", () => {
    const fits = body(600, 420);
    expect(linesFit(fits)).toBe(true);
    expect(fits.style.width).toBe("");
    expect(fits.style.maxWidth).toBe("");
    expect(linesFit(body(600, 600))).toBe(true);
    expect(linesFit(body(600, 1800))).toBe(false);
  });

  it("puts back the scroll offsets the wider layout clamped, in the body and in scrollers inside it", () => {
    // Unwrapped, the body is shorter and the code block as wide as its lines:
    // laying that out pulls both offsets to 0, as a browser does.
    const style = { width: "", maxWidth: "" };
    const code = { scrollTop: 0, scrollLeft: 90 };
    const fake = {
      style,
      scrollTop: 400,
      scrollLeft: 0,
      querySelectorAll: () => [code, { scrollTop: 0, scrollLeft: 0 }],
      getBoundingClientRect() {
        if (style.width === "max-content") {
          fake.scrollTop = 0;
          code.scrollLeft = 0;
          return { width: 1800 };
        }
        return { width: 600 };
      },
    };
    expect(linesFit(fake as unknown as HTMLElement)).toBe(false);
    expect(fake.scrollTop).toBe(400);
    expect(code.scrollLeft).toBe(90);
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

describe("a closing preview's selection", () => {
  it("is removed with the panel, while a selection elsewhere stays", () => {
    const inside = {};
    const selection = { anchorNode: inside as unknown, removeAllRanges: vi.fn() };
    const panel = { contains: (node: unknown) => node === inside, ownerDocument: { defaultView: { getSelection: () => selection } } };
    selection.anchorNode = OUTSIDE;
    dropSelectionIn(panel);
    expect(selection.removeAllRanges).not.toHaveBeenCalled();
    selection.anchorNode = inside;
    dropSelectionIn(panel);
    expect(selection.removeAllRanges).toHaveBeenCalledOnce();
    dropSelectionIn(null);
  });
});
