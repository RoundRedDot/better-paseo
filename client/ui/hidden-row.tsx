import React, { useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { Platform, View } from "react-native";

/** Collapsed disclosure row (`DISCLOSURE_HEADER.height`). The placeholder reserves this so the latest row stays at the bottom. */
const ROW_HEIGHT = { desktop: 26, compact: 28 };

/**
 * Opening a task card switches onto the workspace, and that screen mounts
 * every retained tab's timeline before the first paint. A hidden tab is only
 * `display: none` — its rows still render — and a visible tab mounts the
 * whole last turn, past the host's virtualizer. Either one is a second or
 * two of script and layout on the click.
 *
 * A row under `display: none` stays a placeholder until that ancestor is
 * shown. A row in a visible chat stays a placeholder until it is near the
 * viewport, so the opened tab paints the screenful the reader actually sees.
 * The placeholder is the collapsed row's height, and the scroller is moved
 * to the latest row before that choice, which is where opening a task lands.
 */

interface HeldRowOptions {
  compact?: boolean;
  /** Keep only the rows near the viewport. Off for replies, whose height the placeholder cannot reserve. */
  window?: boolean;
}

interface Box {
  top: number;
  bottom: number;
  width: number;
  height: number;
}

const pinnedBottoms = new WeakMap<HTMLElement, number>();
const panelListeners = new WeakMap<HTMLElement, Set<() => void>>();
const panelObservers = new WeakMap<HTMLElement, MutationObserver>();
const viewListeners = new WeakMap<Element, () => void>();
const viewObservers = new WeakMap<HTMLElement, IntersectionObserver>();

export function hiddenAncestor(node: HTMLElement): HTMLElement | null {
  let parent = node.parentElement;
  while (parent) {
    if (parent.style.display === "none") return parent;
    parent = parent.parentElement;
  }
  return null;
}

export function isHiddenNode(node: HTMLElement): boolean {
  return node.style.display === "none" || hiddenAncestor(node) !== null;
}

export function intersectsWindow(rect: Box, frame: Pick<Box, "top" | "bottom">, margin: number): boolean {
  if (rect.width === 0 && rect.height === 0) return false;
  return rect.bottom >= frame.top - margin && rect.top <= frame.bottom + margin;
}

/**
 * Put a freshly opened chat on its latest row, then follow that edge when
 * placeholders are replaced by real rows. A scroller the reader has moved
 * away from the bottom is left where it is.
 */
export function followScrollerBottom(
  scroller: HTMLElement,
  pinned: { get(key: HTMLElement): number | undefined; set(key: HTMLElement, value: number): void },
): void {
  if (scroller.clientHeight === 0) return;
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const distance = max - scroller.scrollTop;
  const last = pinned.get(scroller);
  if (last === undefined && scroller.scrollTop > 1) return;
  if (last !== undefined && Math.abs(scroller.scrollTop - last) > 2 && distance > 48) return;
  if (distance <= 1) {
    pinned.set(scroller, scroller.scrollTop);
    return;
  }
  scroller.scrollTop = max;
  pinned.set(scroller, scroller.scrollTop);
}

function scrollerOf(node: HTMLElement): HTMLElement | null {
  const found = node.closest?.('[id^="agent-chat-scroll"]');
  if (!found || typeof (found as HTMLElement).getBoundingClientRect !== "function") return null;
  return found as HTMLElement;
}

function rememberBottom(node: HTMLElement): void {
  const scroller = scrollerOf(node);
  if (!scroller || isHiddenNode(scroller)) return;
  followScrollerBottom(scroller, pinnedBottoms);
}

function rowInView(node: HTMLElement): boolean {
  const rect = node.getBoundingClientRect();
  const scroller = scrollerOf(node);
  if (!scroller) return rect.width !== 0 || rect.height !== 0;
  return intersectsWindow(rect, scroller.getBoundingClientRect(), scroller.clientHeight);
}

function stopWatchingPanel(panel: HTMLElement, onShow: () => void): void {
  const listeners = panelListeners.get(panel);
  if (!listeners) return;
  listeners.delete(onShow);
  if (listeners.size > 0) return;
  panelObservers.get(panel)?.disconnect();
  panelObservers.delete(panel);
  panelListeners.delete(panel);
}

function watchPanel(panel: HTMLElement, onShow: () => void): () => void {
  let listeners = panelListeners.get(panel);
  if (!listeners) {
    listeners = new Set();
    panelListeners.set(panel, listeners);
    const observer = new MutationObserver(() => {
      if (panel.style.display === "none") return;
      observer.disconnect();
      panelObservers.delete(panel);
      const pending = panelListeners.get(panel);
      panelListeners.delete(panel);
      pending?.forEach((listener) => listener());
    });
    observer.observe(panel, { attributes: true, attributeFilter: ["style"] });
    panelObservers.set(panel, observer);
  }
  listeners.add(onShow);
  return () => stopWatchingPanel(panel, onShow);
}

function watchView(node: HTMLElement, onShow: () => void): () => void {
  const root = scrollerOf(node) ?? undefined;
  const key = root ?? node.ownerDocument?.documentElement ?? null;
  if (!key) {
    onShow();
    return () => {};
  }
  let observer = viewObservers.get(key);
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const show = viewListeners.get(entry.target);
        if (!show) continue;
        viewListeners.delete(entry.target);
        observer?.unobserve(entry.target);
        show();
      }
    }, { root: root ?? null, rootMargin: "100% 0px" });
    viewObservers.set(key, observer);
  }
  viewListeners.set(node, onShow);
  observer.observe(node);
  return () => {
    viewListeners.delete(node);
    observer?.unobserve(node);
  };
}

function domNode(value: unknown): HTMLElement | null {
  if (!value || typeof value !== "object") return null;
  const node = value as HTMLElement;
  return node.nodeType === 1 ? node : null;
}

/**
 * The placeholder while this row should not mount, or null when it should.
 * Native has no retained workspace deck, so it always mounts.
 */
export function useHeldRow(options?: HeldRowOptions): ReactElement | null {
  const windowed = options?.window === true;
  const ref = useRef<View | null>(null);
  // The placeholder unmounts once the row draws; the host wrapper around it does not.
  const anchor = useRef<HTMLElement | null>(null);
  const [drawn, setDrawn] = useState(Platform.OS !== "web");

  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const current = domNode(ref.current);
    if (current?.parentElement) anchor.current = current.parentElement;
    if (drawn) {
      if (anchor.current) rememberBottom(anchor.current);
      return;
    }
    if (!current) {
      setDrawn(true);
      return;
    }
    let stop = (): void => {};
    const reveal = () => {
      stop();
      rememberBottom(current);
      if (isHiddenNode(current)) {
        const panel = hiddenAncestor(current);
        // No observer means a hidden tab could never appear. Draw it instead of leaving a blank chat.
        if (!panel || typeof MutationObserver === "undefined") {
          setDrawn(true);
          return;
        }
        stop = watchPanel(panel, reveal);
        return;
      }
      if (windowed && !rowInView(current)) {
        if (typeof IntersectionObserver === "undefined") {
          setDrawn(true);
          return;
        }
        stop = watchView(current, () => setDrawn(true));
        return;
      }
      setDrawn(true);
    };
    reveal();
    return () => stop();
  }, [drawn, ref, windowed]);

  if (drawn) return null;
  const height = windowed ? (options?.compact ? ROW_HEIGHT.compact : ROW_HEIGHT.desktop) : 0;
  return <View ref={ref} collapsable={false} style={height > 0 ? { height } : undefined} />;
}
