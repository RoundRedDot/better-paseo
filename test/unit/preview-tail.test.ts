/**
 * A streaming preview opens on the newest output and stays there while it
 * grows, until the reader scrolls up. Hover and the maximized window share
 * the body this binds to.
 */
import { describe, expect, it } from "vitest";
import { bindPreviewTail, previewFollowsTail, previewTailOffset } from "../../client/ui/preview-tail";

describe("preview tail", () => {
  it("measures the end, and treats a fitting or unmeasured body as already there", () => {
    expect(previewTailOffset(200, 1000)).toBe(800);
    expect(previewTailOffset(200, 50)).toBe(0);
    expect(previewTailOffset(0, 1000)).toBe(0);
    expect(previewFollowsTail(800, 200, 1000)).toBe(true);
    expect(previewFollowsTail(776, 200, 1000)).toBe(true);
    expect(previewFollowsTail(770, 200, 1000)).toBe(false);
    expect(previewFollowsTail(0, 200, 100)).toBe(true);
    expect(previewFollowsTail(0, 0, 1000)).toBe(true);
  });

  it("follows growth, lets a scroll up stay put, and follows again from the tail", () => {
    const harness = fakeScroller(1000, 200);
    const pinned = { current: true };
    const follow = { current: null as (() => void) | null };
    const release = bindPreviewTail(harness.node as unknown as HTMLElement, pinned, follow);
    expect(harness.node.scrollTop).toBe(800);
    expect(pinned.current).toBe(true);

    harness.node.scrollHeight = 1400;
    harness.mutate();
    expect(harness.node.scrollTop).toBe(1200);

    harness.node.scrollTop = 100;
    harness.scroll();
    expect(pinned.current).toBe(false);
    harness.node.scrollHeight = 1800;
    harness.mutate();
    expect(harness.node.scrollTop).toBe(100);
    follow.current?.();
    expect(harness.node.scrollTop).toBe(100);

    harness.node.scrollTop = 1600;
    harness.scroll();
    expect(pinned.current).toBe(true);
    harness.node.scrollHeight = 2000;
    harness.resize();
    expect(harness.node.scrollTop).toBe(1800);

    pinned.current = true;
    harness.node.scrollTop = 0;
    release();
    harness.scroll();
    expect(pinned.current).toBe(true);
    expect(follow.current).toBeNull();
  });

  it("ignores the scroll event a programmatic jump fires synchronously", () => {
    const listeners = new Set<() => void>();
    const seen = { resize: null as (() => void) | null, mutate: null as (() => void) | null };
    const node = {
      scrollHeight: 1000,
      clientHeight: 200,
      children: [] as HTMLElement[],
      top: 0,
      get scrollTop() { return this.top; },
      set scrollTop(value: number) {
        // Reports the old offset, as a scroll event can, before storing the new one.
        for (const listener of listeners) listener();
        this.top = value;
      },
      addEventListener(_type: string, listener: () => void) { listeners.add(listener); },
      removeEventListener(_type: string, listener: () => void) { listeners.delete(listener); },
      ownerDocument: viewOf(seen),
    };
    const pinned = { current: true };
    bindPreviewTail(node as unknown as HTMLElement, pinned);
    expect(node.scrollTop).toBe(800);
    expect(pinned.current).toBe(true);
  });
});

function viewOf(seen: { resize: (() => void) | null; mutate: (() => void) | null }) {
  return {
    defaultView: {
      ResizeObserver: class {
        constructor(callback: () => void) { seen.resize = callback; }
        observe() {}
        disconnect() {}
      },
      MutationObserver: class {
        constructor(callback: () => void) { seen.mutate = callback; }
        observe() {}
        disconnect() {}
      },
    },
  };
}

function fakeScroller(extent: number, viewport: number) {
  const listeners = new Set<() => void>();
  const seen = { resize: null as (() => void) | null, mutate: null as (() => void) | null };
  const node = {
    scrollTop: 0,
    scrollHeight: extent,
    clientHeight: viewport,
    children: [] as HTMLElement[],
    addEventListener(_type: string, listener: () => void) { listeners.add(listener); },
    removeEventListener(_type: string, listener: () => void) { listeners.delete(listener); },
    ownerDocument: viewOf(seen),
  };
  return {
    node,
    scroll: () => { for (const listener of listeners) listener(); },
    mutate: () => seen.mutate?.(),
    resize: () => seen.resize?.(),
  };
}
