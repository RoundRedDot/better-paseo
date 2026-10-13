import { useEffect, type RefObject } from "react";
import { Platform, type View } from "react-native";

/**
 * How wide the settings page may grow on desktop. Paseo centres its settings
 * pages in a 720 column (`PageLayout`), which leaves no room for the live
 * preview beside the options; the plugin SDK has no way to ask for more.
 */
export const WIDE_SETTINGS_MAX = 1440;
/** Host wrappers between the plugin's root and `PageLayout`'s column: a handful. */
const SEARCH_DEPTH = 12;

export interface WidthCapNode {
  parentElement: WidthCapNode | null;
  style: { maxWidth: string };
}

/**
 * The nearest ancestor of `node` that caps its width in pixels, narrower than
 * `limit`: Paseo's page column. A percentage or `none` is no cap, and a host
 * that already grants `limit` or more is left alone.
 */
export function findWidthCap<T extends WidthCapNode>(
  node: T | null,
  readMaxWidth: (element: T) => string,
  limit = WIDE_SETTINGS_MAX,
): T | null {
  let element = node?.parentElement as T | null | undefined;
  for (let depth = 0; element && depth < SEARCH_DEPTH; depth += 1) {
    const match = /^(\d+(?:\.\d+)?)px$/.exec(readMaxWidth(element).trim());
    if (match) return Number(match[1]) < limit ? element : null;
    element = element.parentElement as T | null;
  }
  return null;
}

/**
 * While mounted on web, lifts the host column's width cap above the settings
 * page to `WIDE_SETTINGS_MAX`, and restores the host's own value on unmount.
 * The search starts at this page's own node, so it never reaches another
 * page. Phones get no change: their column is the screen.
 */
export function useWideHostColumn(ref: RefObject<View | null>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || Platform.OS !== "web" || typeof getComputedStyle !== "function") return;
    const node = ref.current as unknown as HTMLElement | null;
    const cap = findWidthCap(node, (element) => getComputedStyle(element).maxWidth);
    if (!cap) return;
    const previous = cap.style.maxWidth;
    cap.style.maxWidth = `${WIDE_SETTINGS_MAX}px`;
    return () => {
      cap.style.maxWidth = previous;
    };
  }, [ref, enabled]);
}
