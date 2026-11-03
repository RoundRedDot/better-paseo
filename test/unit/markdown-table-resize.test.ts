import { describe, expect, it, vi } from "vitest";
vi.mock("react-native", () => import("./helpers/rn-mock"));
import { bindTableResize } from "../../client/components/markdown/render/table-resize";

type Listener = (event: PointerEvent) => void;

function binding() {
  const nodeListeners = new Map<string, Listener>();
  const documentListeners = new Map<string, Listener>();
  const target = (listeners: Map<string, Listener>) => ({
    addEventListener: (name: string, listener: Listener) => listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const doc = target(documentListeners);
  const node = { ...target(nodeListeners), ownerDocument: doc };
  const onResize = vi.fn();
  const current = { current: { width: 100, minWidth: 60, onResize } };
  const cleanup = bindTableResize(node as unknown as HTMLElement, current);
  const fire = (listeners: Map<string, Listener>, name: string, values: Record<string, unknown> = {}) => {
    const event = { pointerType: "mouse", pointerId: 1, button: 0, clientX: 100,
      preventDefault: vi.fn(), stopPropagation: vi.fn(), ...values };
    listeners.get(name)?.(event as unknown as PointerEvent);
    return event;
  };
  return { nodeListeners, documentListeners, current, onResize, cleanup, fire };
}

describe("Markdown table column resize", () => {
  it("tracks the mouse outside the handle, clamps width, and stops on release", () => {
    const b = binding();
    const down = b.fire(b.nodeListeners, "pointerdown");
    expect(down.preventDefault).toHaveBeenCalledOnce();
    expect(down.stopPropagation).toHaveBeenCalledOnce();
    b.fire(b.documentListeners, "pointermove", { clientX: 145 });
    expect(b.onResize).toHaveBeenLastCalledWith(145);
    b.fire(b.documentListeners, "pointermove", { clientX: 0 });
    expect(b.onResize).toHaveBeenLastCalledWith(60);
    b.fire(b.documentListeners, "pointerup");
    b.fire(b.documentListeners, "pointermove", { clientX: 150 });
    expect(b.onResize).toHaveBeenCalledTimes(2);
    b.cleanup();
    expect(b.nodeListeners.size + b.documentListeners.size).toBe(0);
  });

  it("ignores touch and other pointers, and ends a cancelled drag", () => {
    const b = binding();
    b.fire(b.nodeListeners, "pointerdown", { pointerType: "touch" });
    b.fire(b.documentListeners, "pointermove", { clientX: 140 });
    expect(b.onResize).not.toHaveBeenCalled();
    b.fire(b.nodeListeners, "pointerdown");
    b.fire(b.documentListeners, "pointermove", { pointerId: 2, clientX: 140 });
    b.fire(b.documentListeners, "pointercancel");
    b.fire(b.documentListeners, "pointermove", { clientX: 140 });
    expect(b.onResize).not.toHaveBeenCalled();
    b.cleanup();
  });
});
