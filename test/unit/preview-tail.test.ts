/**
 * A streaming preview opens on the newest output and stays there while it
 * grows, until the reader scrolls up. Hover and the maximized window share
 * the body this binds to.
 */
import { describe, expect, it } from "vitest";
import { bindPreviewTail, previewFollowsTail, previewGlideStep, previewTailOffset } from "../../client/ui/preview-tail";

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

  it("eases toward the tail, skipping all but the last screen of a long way", () => {
    expect(previewGlideStep(800, 800, 16, 200)).toBe(800);
    expect(previewGlideStep(900, 800, 16, 200)).toBe(800);
    const first = previewGlideStep(800, 900, 16, 200);
    expect(first).toBeGreaterThan(800);
    expect(first).toBeLessThan(850);
    expect(previewGlideStep(800, 900, 1000, 200)).toBe(900);
    // A rounding browser still gets a pixel a frame, and the last one snaps.
    expect(previewGlideStep(800, 803, 1, 200)).toBe(801);
    expect(previewGlideStep(800, 801.5, 1, 200)).toBe(801.5);
    const far = previewGlideStep(0, 5000, 16, 200);
    expect(far).toBeGreaterThan(4800);
    expect(far).toBeLessThan(5000);
  });

  it("glides to new output a frame at a time and ignores its own scroll events", () => {
    const harness = fakeScroller(1000, 200, { frames: true });
    const pinned = { current: true };
    const release = bindPreviewTail(harness.node as unknown as HTMLElement, pinned);
    // Opening jumps.
    expect(harness.node.scrollTop).toBe(800);

    harness.node.scrollHeight = 1100;
    harness.mutate();
    expect(harness.node.scrollTop).toBe(800);
    harness.frame(16);
    const mid = harness.node.scrollTop;
    expect(mid).toBeGreaterThan(800);
    expect(mid).toBeLessThan(900);
    // The glide's own offset, reported late, is not the reader leaving.
    harness.scroll();
    expect(pinned.current).toBe(true);
    for (let index = 0; index < 60 && harness.pending(); index++) harness.frame(16);
    expect(harness.node.scrollTop).toBe(900);
    expect(harness.pending()).toBe(false);
    release();
  });

  it("stops gliding when the reader scrolls up, and jumps when the panel is resized", () => {
    const harness = fakeScroller(1000, 200, { frames: true });
    const pinned = { current: true };
    const follow = { current: null as (() => void) | null };
    const release = bindPreviewTail(harness.node as unknown as HTMLElement, pinned, follow);
    harness.node.scrollHeight = 1400;
    harness.mutate();
    harness.frame(16);
    harness.node.scrollTop = 300;
    harness.scroll();
    expect(pinned.current).toBe(false);
    expect(harness.pending()).toBe(false);
    harness.node.scrollHeight = 1600;
    harness.mutate();
    expect(harness.pending()).toBe(false);
    expect(harness.node.scrollTop).toBe(300);

    harness.node.scrollTop = 1400;
    harness.scroll();
    expect(pinned.current).toBe(true);
    harness.node.clientHeight = 400;
    harness.resize();
    expect(harness.node.scrollTop).toBe(1200);
    expect(harness.pending()).toBe(false);

    // A glide under way when the stream ends finishes at once.
    harness.node.scrollHeight = 1700;
    follow.current?.();
    expect(harness.pending()).toBe(true);
    release();
    expect(harness.node.scrollTop).toBe(1300);
    expect(harness.pending()).toBe(false);
  });

  it("jumps under reduced motion", () => {
    const harness = fakeScroller(1000, 200, { frames: true, still: true });
    const pinned = { current: true };
    bindPreviewTail(harness.node as unknown as HTMLElement, pinned);
    harness.node.scrollHeight = 1100;
    harness.mutate();
    expect(harness.node.scrollTop).toBe(900);
    expect(harness.pending()).toBe(false);
  });
});

function viewOf(
  seen: { resize: (() => void) | null; mutate: (() => void) | null },
  extra: Record<string, unknown> = {},
) {
  return {
    defaultView: {
      ...extra,
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

function fakeScroller(extent: number, viewport: number, options: { frames?: boolean; still?: boolean } = {}) {
  const listeners = new Set<() => void>();
  const seen = { resize: null as (() => void) | null, mutate: null as (() => void) | null };
  const queued = new Map<number, (time: number) => void>();
  let next = 0;
  let clock = 0;
  const extra = {
    ...(options.frames ? {
      requestAnimationFrame(callback: (time: number) => void) { queued.set(++next, callback); return next; },
      cancelAnimationFrame(id: number) { queued.delete(id); },
    } : {}),
    matchMedia: () => ({ matches: options.still ?? false }),
  };
  const node = {
    scrollTop: 0,
    scrollHeight: extent,
    clientHeight: viewport,
    children: [] as HTMLElement[],
    addEventListener(_type: string, listener: () => void) { listeners.add(listener); },
    removeEventListener(_type: string, listener: () => void) { listeners.delete(listener); },
    ownerDocument: viewOf(seen, extra),
  };
  return {
    node,
    frame: (elapsed: number) => {
      clock += elapsed;
      const callbacks = [...queued.values()];
      queued.clear();
      for (const callback of callbacks) callback(clock);
    },
    pending: () => queued.size > 0,
    scroll: () => { for (const listener of listeners) listener(); },
    mutate: () => seen.mutate?.(),
    resize: () => seen.resize?.(),
  };
}
