import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import { openPreviewLayer } from "../../client/web";

beforeEach(() => { (globalThis as { __rnMockOS?: string }).__rnMockOS = "web"; });
afterEach(() => { delete (globalThis as { __rnMockOS?: string }).__rnMockOS; });

function layer(contentLeft: number, contentWidth: number, viewportWidth = 1600, anchorWidth = 24) {
  const view = { innerWidth: viewportWidth, innerHeight: 900, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const content = { getBoundingClientRect: () => ({ left: contentLeft, right: contentLeft + contentWidth }) };
  const anchor = {
    closest: vi.fn(() => content),
    getBoundingClientRect: () => ({ left: contentLeft - 8, right: contentLeft - 8 + anchorWidth, top: 100, bottom: 126 }),
  };
  const panel = {
    style: {} as Record<string, string>, scrollHeight: 1200,
    ownerDocument: { defaultView: view, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    setAttribute: vi.fn(), showPopover: vi.fn(), hidePopover: vi.fn(), contains: () => true,
    getBoundingClientRect: () => ({ height: 360 }),
  };
  const close = vi.fn();
  const release = openPreviewLayer(panel, anchor, close);
  return { panel, anchor, view, close, release };
}

describe("hover preview content bounds", () => {
  it.each([24, 716])("uses the whole content column for a %s px anchor", (anchorWidth) => {
    const { panel, anchor, release } = layer(200, 700, 1600, anchorWidth);
    expect(anchor.closest).toHaveBeenCalledWith("[data-bcroot]");
    expect(panel.style.width).toBe("700px");
    expect(panel.style.left).toBe("200px");
    expect(panel.style.padding).toBe("0");
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
});
