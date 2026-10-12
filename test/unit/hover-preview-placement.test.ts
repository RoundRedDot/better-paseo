import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import { openPreviewLayer } from "../../client/web";

beforeEach(() => { (globalThis as { __rnMockOS?: string }).__rnMockOS = "web"; });
afterEach(() => { delete (globalThis as { __rnMockOS?: string }).__rnMockOS; });

function layer(contentLeft: number, contentWidth: number, viewportWidth = 1600, anchorWidth = 24,
  options: Parameters<typeof openPreviewLayer>[3] = {}, scrollHeight = 1200) {
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
  const body = { scrollHeight, clientHeight: 300, children: [] };
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
    setAttribute: vi.fn(), showPopover: vi.fn(), hidePopover: vi.fn(), contains: () => true,
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
  it.each([299, 300, 301])("only reports overflow when %s px exceeds the visible body", (height) => {
    const onOverflow = vi.fn();
    const { release } = layer(200, 700, 1600, 24, { onOverflow }, height);
    expect(onOverflow).toHaveBeenLastCalledWith(height > 300);
    release();
  });
  it("remeasures changing content and disconnects observers on release", () => {
    const onOverflow = vi.fn();
    const { body, resize, mutate, release, disconnectResize, disconnectMutation } = layer(200, 700, 1600, 24, { onOverflow }, 200);
    body.scrollHeight = 500;
    mutate();
    expect(onOverflow).toHaveBeenLastCalledWith(true);
    body.clientHeight = 500;
    resize();
    expect(onOverflow).toHaveBeenLastCalledWith(false);
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
