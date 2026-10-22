import { Platform } from "react-native";
import { detailsApi } from "./details-store";

export interface DetailsPagerKeys {
  prev(): void;
  next(): void;
}

/** Actions supplied by the currently rendered details chrome. */
export interface DetailsKeyboardActions {
  toggleWrap?(): void;
  toggleRender?(): void;
  toggleFullscreen?(): void;
  copyPrimary?(): void;
}

type ActivePane = (event?: KeyboardEvent) => boolean;

const pagers = new Map<string, DetailsPagerKeys>();
const actions = new Map<string, DetailsKeyboardActions>();
const activePanes = new Map<ActivePane, number>();

/** The details toolbar registers its merged-row or question pager while mounted. */
export function registerDetailsPager(agentId: string, pager: DetailsPagerKeys): () => void {
  pagers.set(agentId, pager);
  return () => {
    if (pagers.get(agentId) === pager) pagers.delete(agentId);
  };
}

/** The details chrome registers the controls whose state it owns. */
export function registerDetailsKeyboardActions(agentId: string, value: DetailsKeyboardActions): () => void {
  actions.set(agentId, value);
  return () => {
    if (actions.get(agentId) === value) actions.delete(agentId);
  };
}

/** Lets a legacy hover layer yield Escape to the active details shell. */
export function hasActiveDetailsKeyboard(event?: KeyboardEvent): boolean {
  return Array.from(activePanes.keys()).some((isActive) => isActive(event));
}

/**
 * Bind the web-only shortcuts while the details panel is open. The caller
 * keeps this binding scoped to its shell; `isActivePane` must include both
 * lease ownership and visibility so retained duplicate panes cannot react.
 */
export function bindDetailsKeys(agentId: string, isActivePane: ActivePane): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => {};
  const doc = document;
  const onKey = (event: KeyboardEvent) => {
    if (!isActivePane(event) || event.defaultPrevented || event.isComposing) return;

    if (event.key === "Escape") {
      consume(event);
      detailsApi.close(agentId);
      return;
    }

    const target = eventElement(event.target);
    const editable = isEditable(target);
    const modified = event.altKey || event.ctrlKey || event.metaKey;

    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !modified && !event.shiftKey) {
      if (editable || hasHorizontalScroller(target)) return;
      consume(event);
      detailsApi.step(agentId, event.key === "ArrowLeft" ? -1 : 1);
      return;
    }

    if (modified || editable) {
      if (!editable && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "c") {
        if (doc.getSelection?.()?.isCollapsed === false) return;
        const copy = actions.get(agentId)?.copyPrimary;
        if (copy) {
          consume(event);
          copy();
        }
      }
      return;
    }

    const key = event.key.toLowerCase();
    if (event.key === "[") {
      const previous = pagers.get(agentId)?.prev;
      if (previous) {
        consume(event);
        previous();
      }
    } else if (event.key === "]") {
      const next = pagers.get(agentId)?.next;
      if (next) {
        consume(event);
        next();
      }
    } else if (key === "w") {
      const toggle = actions.get(agentId)?.toggleWrap;
      if (toggle) {
        consume(event);
        toggle();
      }
    } else if (key === "r") {
      const toggle = actions.get(agentId)?.toggleRender;
      if (toggle) {
        consume(event);
        toggle();
      }
    } else if (key === "f") {
      const toggle = actions.get(agentId)?.toggleFullscreen;
      if (toggle) {
        consume(event);
        toggle();
      }
    }
  };

  activePanes.set(isActivePane, (activePanes.get(isActivePane) ?? 0) + 1);
  doc.addEventListener("keydown", onKey, true);
  return () => {
    const activeCount = activePanes.get(isActivePane) ?? 0;
    if (activeCount <= 1) activePanes.delete(isActivePane);
    else activePanes.set(isActivePane, activeCount - 1);
    doc.removeEventListener("keydown", onKey, true);
  };
}

function consume(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

function eventElement(target: EventTarget | null): HTMLElement | null {
  if (!target) return null;
  if ((target as Node).nodeType === 3) return (target as Node).parentElement as HTMLElement | null;
  return target as HTMLElement;
}

function isEditable(target: HTMLElement | null): boolean {
  if (!target) return false;
  return Boolean(
    target.isContentEditable ||
      target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'),
  );
}

function hasHorizontalScroller(target: HTMLElement | null): boolean {
  for (let node = target; node; node = node.parentElement) {
    const view = node.ownerDocument?.defaultView;
    const overflow = view?.getComputedStyle?.(node).overflowX ?? node.style?.overflowX ?? "";
    if (/auto|scroll|overlay/.test(overflow) && node.scrollWidth > node.clientWidth + 1) return true;
  }
  return false;
}
