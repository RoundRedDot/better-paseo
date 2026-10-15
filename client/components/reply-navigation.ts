import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from "react";
import { Platform, type View } from "react-native";
import { viewBox } from "../timeline-order";
import { useTimelineList } from "../ui/scroll-anchor";
import { replyScrollViewport, scrollReplyViewport } from "../web";

export interface ReplyTarget {
  agentId: string;
  scope(): unknown;
  top(): number | null;
  available(): boolean;
  jump(): boolean;
  open(): void;
}

const targets = new Set<ReplyTarget>();
const listeners = new Set<() => void>();
let version = 0;
function publish() {
  version += 1;
  for (const listener of listeners) listener();
}

export function registerReplyTarget(target: ReplyTarget): () => void {
  targets.add(target);
  publish();
  return () => { targets.delete(target); publish(); };
}

/** Screen order handles replayed histories whose timestamps all coincide. */
export function adjacentReply(target: ReplyTarget, direction: -1 | 1): ReplyTarget | null {
  const scope = target.scope();
  if (!scope) return null;
  const candidates = [...targets].filter((other) => other.agentId === target.agentId && other.scope() === scope)
    .map((entry) => ({ entry, top: entry.top() }));
  if (candidates.some((item) => item.top === null)) return null;
  const ordered = candidates.filter((item): item is { entry: ReplyTarget; top: number } => item.top !== null)
    .sort((a, b) => a.top - b.top);
  const index = ordered.findIndex(({ entry }) => entry === target);
  if (index < 0) return null;
  const adjacent = ordered[index + direction];
  // Equal positions are ambiguous; never skip a missing or unlocatable neighbour.
  if (!adjacent || adjacent.top === ordered[index]!.top || !adjacent.entry.available()) return null;
  return adjacent.entry;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Registers completed replies only, and transfers the open panel to the destination row. */
export function useReplyTarget(agentId: string | undefined, anchor: RefObject<View | null>, open: () => void) {
  const list = useTimelineList();
  const latest = useRef({ list, open });
  latest.current = { list, open };
  const target = useMemo<ReplyTarget>(() => {
    const scroller = () => latest.current.list?.getOutermostParentListRef?.();
    const nativeViewport = () => scroller()?.getScrollRef?.();
    return {
      agentId: agentId ?? "",
      scope: () => Platform.OS === "web" ? replyScrollViewport(anchor.current) : scroller(),
      top: () => viewBox(anchor.current)?.top ?? null,
      available: () => {
        if (!viewBox(anchor.current)) return false;
        if (Platform.OS === "web") return replyScrollViewport(anchor.current) !== null;
        return Boolean(scroller()?.scrollToOffset && latest.current.list?.getScrollMetrics && viewBox(nativeViewport()));
      },
      jump: () => {
        const box = viewBox(anchor.current);
        if (!box) return false;
        if (Platform.OS === "web") {
          const viewport = replyScrollViewport(anchor.current);
          if (!viewport) return false;
          scrollReplyViewport(viewport, box.top);
          return true;
        }
        const viewport = viewBox(nativeViewport());
        const offset = latest.current.list?.getScrollMetrics?.().offset;
        const scroll = scroller();
        if (!viewport || !scroll?.scrollToOffset || typeof offset !== "number") return false;
        const delta = box.top - viewport.top - 16;
        scroll.scrollToOffset({ offset: Math.max(0, offset + (scroll.props?.inverted ? -delta : delta)), animated: false });
        return true;
      },
      open: () => latest.current.open(),
    };
  }, [agentId, anchor]);
  useLayoutEffect(() => agentId ? registerReplyTarget(target) : undefined, [agentId, target]);
  return agentId ? target : undefined;
}

/** Only an open panel measures neighbours or subscribes to mount/unmount changes. */
export function useReplyNavigation(target: ReplyTarget | undefined, close: () => void) {
  useSyncExternalStore(subscribe, () => version, () => version);
  const go = useCallback((direction: -1 | 1) => {
    if (!target) return;
    const next = adjacentReply(target, direction);
    if (!next || !next.jump()) return;
    close();
    next.open();
  }, [target, close]);
  return {
    previous: target && adjacentReply(target, -1) ? () => go(-1) : undefined,
    next: target && adjacentReply(target, 1) ? () => go(1) : undefined,
  };
}
