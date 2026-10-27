/**
 * Keeps the open block's row in view beside the panel (design 4e): on open
 * and on every switch the host list scrolls for 240 ms so the row sits in the
 * visible band, at least 24 above the panel's top. A row already in the band
 * stays put, and a list with no room to move (the newest rows, at the end) is
 * left alone: the panel's title is the context then.
 *
 * The plugin has no scroll API. On iOS and Android every timeline item
 * renders inside the host list's own `VirtualizedList` context, which hands
 * out the list and its offset (`scroll-anchor.ts`); the list is inverted, so
 * its offset runs from the bottom. On web the row's scroller is its nearest
 * scrolling ancestor, in its own pane.
 *
 * ‹ at the oldest block the panel knows probes once: the list scrolls up by
 * about a viewport so older rows mount and register, and the step is tried
 * again (`stepDetails`).
 */
import { createContext, useContext, useEffect, useMemo, useRef, type Context } from "react";
import { Platform, VirtualizedList } from "react-native";
import { detailsApi } from "../details-store";
import { setOrderShift } from "../block-registry";
import { nearestScroller, timelineColumn } from "./web-layer";
import { DETAILS_EASE } from "./motion";

export const SYNC = {
  /** The row's least distance from the panel's top and from the list's top. */
  gap: 24,
  ms: 240,
  /** How far the probe for older rows scrolls, in viewports. */
  probe: 0.9,
  /** How long the probe waits for older rows to mount before stepping again. */
  probeSettleMs: 400,
} as const;

export interface Band {
  /** Window y of the list's visible top. */
  top: number;
  /** Window y the row must stay above: the panel's top, or the list's bottom beside a side panel. */
  bottom: number;
}

/**
 * How far the list's content must move up (negative: down) to bring the row
 * into the band, 0 when it is already there. A row taller than the band keeps
 * its top in view.
 */
export function syncDelta(row: { top: number; height: number }, band: Band): number {
  const top = band.top + SYNC.gap;
  const bottom = band.bottom - SYNC.gap;
  const rowBottom = row.top + row.height;
  if (row.top >= top && rowBottom <= bottom) return 0;
  if (rowBottom > bottom) return Math.max(0, Math.min(rowBottom - bottom, row.top - top));
  return row.top - top;
}

/** The host list as the panel drives it. */
export interface HostList {
  /** The list's visible box in window coordinates, null when it cannot be measured. */
  viewport(): Promise<{ top: number; bottom: number; left?: number; right?: number; contentRight?: number } | null>;
  /** Observes pane and content-column resizing independently of the window (web). */
  observeResize?(measure: () => void): () => void;
  /** Moves the content up by `delta` (down when negative) over `ms`; returns how far it can move. */
  scroll(delta: number, ms: number): number;
  /**
   * What turns a row's window top into its place in the list's content: the
   * scroll offset, negated for the inverted native list. Null when unknown.
   */
  shift?(): number | null;
}

const lists = new Map<string, HostList>();

export function registerHostList(agentId: string, list: HostList): () => void {
  lists.set(agentId, list);
  const shift = list.shift;
  if (shift) setOrderShift(agentId, () => shift.call(list));
  return () => {
    if (lists.get(agentId) !== list) return;
    lists.delete(agentId);
    if (shift) setOrderShift(agentId, null);
  };
}

/**
 * Scrolls the agent's list so `row` sits in the band above `panelTop` (or in
 * the list's own box when `panelTop` is null). Resolves to the distance moved.
 */
export async function syncTimeline(agentId: string, row: { top: number; height: number }, panelTop: number | null, reduced: boolean): Promise<number> {
  const list = lists.get(agentId);
  if (!list) return 0;
  const viewport = await list.viewport().catch(() => null);
  const band: Band = {
    top: viewport?.top ?? 0,
    bottom: Math.min(panelTop ?? Number.POSITIVE_INFINITY, viewport?.bottom ?? Number.POSITIVE_INFINITY),
  };
  if (!Number.isFinite(band.bottom)) return 0;
  const delta = syncDelta(row, band);
  if (delta === 0) return 0;
  return list.scroll(delta, reduced ? 0 : SYNC.ms);
}

// Navigation as the open panel last drew it, for `stepDetails`.
const navigation = new Map<string, { first: string | null; openId: string | null }>();
// Blocks the probe already ran for: it runs once per oldest block.
const probed = new Set<string>();

export function noteNavigation(agentId: string, first: string | null, openId: string | null): void {
  navigation.set(agentId, { first, openId });
}

/** ‹ at the oldest known block still has the one probe for older rows. */
export function canProbeOlder(agentId: string, id: string): boolean {
  return lists.has(agentId) && !probed.has(`${agentId}\n${id}`);
}

/** Scrolls the list up by about a viewport so older rows mount; false when it cannot move. */
export async function probeOlder(agentId: string): Promise<boolean> {
  const list = lists.get(agentId);
  if (!list) return false;
  const viewport = await list.viewport().catch(() => null);
  const height = viewport ? viewport.bottom - viewport.top : 600;
  return list.scroll(-height * SYNC.probe, 0) !== 0;
}

/**
 * The panel's ‹ and › (and its header swipe, and the web keys): the previous
 * or next block. ‹ at the oldest known block probes for older rows once,
 * then steps again; when nothing older mounted the step does nothing.
 */
export async function stepDetails(agentId: string, direction: -1 | 1): Promise<void> {
  const nav = navigation.get(agentId);
  if (direction === -1 && nav?.openId && nav.openId === nav.first) {
    const key = `${agentId}\n${nav.openId}`;
    if (probed.has(key)) return;
    probed.add(key);
    if (!(await probeOlder(agentId))) return;
    await wait(SYNC.probeSettleMs);
    detailsApi.step(agentId, -1);
    return;
  }
  detailsApi.step(agentId, direction);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Steps `apply` from `from` to `to` over `ms` on animation frames; at once when `ms` is 0 or frames are missing. */
function glide(from: number, to: number, ms: number, apply: (value: number) => void): void {
  const frame = (globalThis as { requestAnimationFrame?: (callback: (time: number) => void) => number }).requestAnimationFrame;
  if (ms <= 0 || typeof frame !== "function") {
    apply(to);
    return;
  }
  let start: number | null = null;
  const tick = (time: number) => {
    start ??= time;
    const t = Math.min(1, (time - start) / ms);
    apply(from + (to - from) * DETAILS_EASE(t));
    if (t < 1) frame(tick);
  };
  frame(tick);
}

// --- Native: the host's VirtualizedList, through its context ---

interface ScrollMetrics {
  offset: number;
  visibleLength?: number;
  contentLength?: number;
}

interface MeasurableView {
  measureInWindow?(callback: (x: number, y: number, width: number, height: number) => void): void;
}

interface ListRef {
  props?: { inverted?: boolean | null };
  scrollToOffset?(params: { offset: number; animated?: boolean }): void;
  getScrollRef?(): MeasurableView | null;
}

interface ListContextValue {
  getScrollMetrics?(): ScrollMetrics;
  getOutermostParentListRef?(): ListRef;
}

const NO_LIST = createContext<ListContextValue | null>(null);
let listContext: Context<ListContextValue | null> | null = null;

function resolveListContext(): Context<ListContextValue | null> {
  if (listContext) return listContext;
  let found: Context<ListContextValue | null> | undefined;
  try {
    found = (VirtualizedList as unknown as { contextType?: Context<ListContextValue | null> } | undefined)?.contextType;
  } catch {
    found = undefined;
  }
  listContext = found ?? NO_LIST;
  return listContext;
}

/** The native list, from inside one of its items. */
export function nativeHostList(read: () => ListContextValue | null): HostList {
  return {
    viewport() {
      return new Promise((resolve) => {
        const scroller = read()?.getOutermostParentListRef?.()?.getScrollRef?.();
        if (!scroller?.measureInWindow) {
          resolve(null);
          return;
        }
        scroller.measureInWindow((x, y, width, height) => {
          resolve(Number.isFinite(x) && Number.isFinite(y) && width > 0 && height > 0
            ? { top: y, bottom: y + height, left: x, right: x + width } : null);
        });
      });
    },
    scroll(delta, ms) {
      const list = read();
      const ref = list?.getOutermostParentListRef?.();
      const metrics = list?.getScrollMetrics?.();
      if (!ref?.scrollToOffset || !metrics) return 0;
      // Inverted: the offset runs from the bottom, so moving the content up lowers it.
      const signed = ref.props?.inverted ? -delta : delta;
      const max = metrics.contentLength !== undefined && metrics.visibleLength !== undefined
        ? Math.max(0, metrics.contentLength - metrics.visibleLength)
        : Number.POSITIVE_INFINITY;
      const to = Math.max(0, Math.min(max, metrics.offset + signed));
      const moved = to - metrics.offset;
      if (Math.abs(moved) < 1) return 0;
      glide(metrics.offset, to, ms, (offset) => ref.scrollToOffset?.({ offset, animated: false }));
      return ref.props?.inverted ? -moved : moved;
    },
    shift() {
      const list = read();
      const offset = list?.getScrollMetrics?.().offset;
      if (typeof offset !== "number") return null;
      // Inverted: scrolling to older rows raises the offset and moves every row down the screen.
      return list?.getOutermostParentListRef?.()?.props?.inverted ? -offset : offset;
    },
  };
}

/** The web list: the nearest scroller above `anchor`, looked up when used (the host can swap it). */
export function webHostList(anchor: () => unknown): HostList {
  return {
    observeResize(measure) {
      const scroller = nearestScroller(anchor());
      if (!scroller || typeof ResizeObserver === "undefined") return () => {};
      const observer = new ResizeObserver(measure);
      observer.observe(scroller);
      const column = timelineColumn(anchor(), scroller);
      if (column) observer.observe(column);
      return () => observer.disconnect();
    },
    viewport() {
      const scroller = nearestScroller(anchor());
      if (!scroller) return Promise.resolve(null);
      const rect = scroller.getBoundingClientRect();
      const column = timelineColumn(anchor(), scroller);
      return Promise.resolve(rect.height > 0 ? {
        top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
        contentRight: column?.getBoundingClientRect().right ?? rect.right,
      } : null);
    },
    scroll(delta, ms) {
      const scroller = nearestScroller(anchor());
      if (!scroller) return 0;
      const from = scroller.scrollTop;
      const to = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, from + delta));
      if (Math.abs(to - from) < 1) return 0;
      glide(from, to, ms, (top) => { scroller.scrollTop = top; });
      return to - from;
    },
    shift() {
      return nearestScroller(anchor())?.scrollTop ?? null;
    },
  };
}

/**
 * Registers the agent's host list for the lease holder: the native list from
 * the item's context, or the web scroller above `anchor`.
 */
export function useHostList(agentId: string, anchor: () => unknown): HostList | null {
  const list = useContext(resolveListContext());
  const latest = useRef(list);
  latest.current = list;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const host = useMemo(() => Platform.OS === "web"
      ? webHostList(() => anchorRef.current())
      : list?.getOutermostParentListRef ? nativeHostList(() => latest.current) : null, [list]);
  useEffect(() => {
    return host ? registerHostList(agentId, host) : undefined;
  }, [agentId, host]);
  return host;
}

/** Tests only. */
export function resetTimelineSync(): void {
  lists.clear();
  navigation.clear();
  probed.clear();
}
