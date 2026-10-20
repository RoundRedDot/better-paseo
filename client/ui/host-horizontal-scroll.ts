/**
 * The host's record of horizontally scrolled surfaces (Paseo's
 * `HorizontalScrollContext`): while any registered surface sits away from
 * its leading edge, the phone's swipe that opens the agent list fails on
 * its first move, on the UI thread. Paseo's own diff scroller registers its
 * offset there; the SDK does not expose it to plugins, so this finds the
 * provider's value by walking up from a view's fiber and checking its shape.
 * Anything else answers null and changes nothing.
 */
export interface HostHorizontalScroll {
  registerScrollOffset(id: string, offset: number): void;
  unregisterScrollOffset(id: string): void;
}

type Fiber = { return?: Fiber | null; memoizedProps?: { value?: unknown } | null };

/** Far enough for the app's root providers above a plugin screen. */
const MAX_DEPTH = 4000;

function asHorizontalScroll(value: unknown): HostHorizontalScroll | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<HostHorizontalScroll> & { isAnyScrolledRight?: unknown };
  if (typeof candidate.registerScrollOffset !== "function" || typeof candidate.unregisterScrollOffset !== "function") return null;
  if (!candidate.isAnyScrolledRight || typeof candidate.isAnyScrolledRight !== "object") return null;
  return candidate as HostHorizontalScroll;
}

/** The host's horizontal-scroll record above a mounted host view (a ref's current), or null. */
export function findHostHorizontalScroll(node: unknown): HostHorizontalScroll | null {
  try {
    let fiber = (node as { __internalInstanceHandle?: Fiber } | null)?.__internalInstanceHandle ?? null;
    for (let depth = 0; fiber && depth < MAX_DEPTH; depth++) {
      const found = asHorizontalScroll(fiber.memoizedProps?.value);
      if (found) return found;
      fiber = fiber.return ?? null;
    }
  } catch {
    // A host with another tree shape keeps its gestures as they are.
  }
  return null;
}
