/**
 * The details panel's follow of a streaming body: it lets go past 48 from the
 * end and follows again within 8, and says when it does, so the panel can
 * offer "Back to latest" (docs/prototypes/block-details-sheet.md). The hover
 * panel's single slack is `HOVER_FOLLOW`, the default.
 */
import { describe, expect, it } from "vitest";
import { bindPreviewTail, DETAILS_FOLLOW, HOVER_FOLLOW, nativePreviewTail, previewFollowsTail } from "../../client/ui/preview-tail";

describe("follow band", () => {
  it("lets go past `leave` while following and comes back within `resume`", () => {
    expect(previewFollowsTail(752, 200, 1000, DETAILS_FOLLOW, true)).toBe(true);
    expect(previewFollowsTail(751, 200, 1000, DETAILS_FOLLOW, true)).toBe(false);
    expect(previewFollowsTail(780, 200, 1000, DETAILS_FOLLOW, false)).toBe(false);
    expect(previewFollowsTail(792, 200, 1000, DETAILS_FOLLOW, false)).toBe(true);
    // The hover panel's one slack either way.
    expect(previewFollowsTail(776, 200, 1000, HOVER_FOLLOW, false)).toBe(true);
    expect(previewFollowsTail(775, 200, 1000)).toBe(false);
  });
});

describe("web body with the details band", () => {
  it("reports letting go, the growth after it, and following again", () => {
    const changes: Array<[boolean, number]> = [];
    const harness = scroller(1000, 200);
    const pinned = { current: true };
    const release = bindPreviewTail(harness.node as unknown as HTMLElement, pinned, undefined, {
      band: DETAILS_FOLLOW, onChange: (following, extent) => changes.push([following, extent]),
    });
    expect(harness.node.scrollTop).toBe(800);
    harness.node.scrollTop = 770;
    harness.scroll();
    expect(pinned.current).toBe(true);
    harness.node.scrollTop = 740;
    harness.scroll();
    expect(pinned.current).toBe(false);
    harness.node.scrollHeight = 1180;
    harness.mutate();
    expect(harness.node.scrollTop).toBe(740);
    harness.node.scrollTop = 960;
    harness.scroll();
    expect(pinned.current).toBe(false);
    harness.node.scrollTop = 975;
    harness.scroll();
    expect(pinned.current).toBe(true);
    expect(changes).toEqual([[false, 1000], [false, 1180], [true, 1180]]);
    release();
  });
});

describe("phone body with the details band", () => {
  it("keeps following 30 from the end, lets go past 48, and resumes from the pill without its own scroll letting go", () => {
    const calls: Array<[number | "end", boolean]> = [];
    const tail = nativePreviewTail((offset, animated) => calls.push([offset, animated]), Date.now, DETAILS_FOLLOW);
    tail.grow(200, 1000, 0, false);
    tail.scrolled(800, 200, 1000);
    tail.drag();
    tail.scrolled(770, 200, 1000);
    expect(tail.pinned).toBe(true);
    tail.scrolled(740, 200, 1000);
    expect(tail.pinned).toBe(false);
    tail.scrolled(780, 200, 1000);
    expect(tail.pinned).toBe(false);
    tail.resume(200, 1300, false);
    expect(tail.pinned).toBe(true);
    expect(calls.at(-1)).toEqual([1100, true]);
    // The animated scroll's own events on the way down are not the reader.
    tail.scrolled(900, 200, 1300);
    expect(tail.pinned).toBe(true);
    tail.scrolled(1100, 200, 1300);
    tail.scrolled(1000, 200, 1300);
    expect(tail.pinned).toBe(false);
    tail.resume(200, 1300, true);
    expect(calls.at(-1)).toEqual([1100, false]);
  });
});

function scroller(extent: number, viewport: number) {
  const listeners = new Set<() => void>();
  let mutate: (() => void) | null = null;
  const node = {
    scrollTop: 0,
    scrollHeight: extent,
    clientHeight: viewport,
    children: [] as HTMLElement[],
    addEventListener(_type: string, listener: () => void) { listeners.add(listener); },
    removeEventListener(_type: string, listener: () => void) { listeners.delete(listener); },
    ownerDocument: { defaultView: {
      matchMedia: () => ({ matches: false }),
      MutationObserver: class {
        constructor(callback: () => void) { mutate = callback; }
        observe() {}
        disconnect() {}
      },
    } },
  };
  return {
    node,
    scroll: () => listeners.forEach((listener) => listener()),
    mutate: () => mutate?.(),
  };
}
