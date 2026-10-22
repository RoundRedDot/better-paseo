import { Platform } from "react-native";
import { PLUGIN_ROOT_ATTRIBUTE } from "./components/focus-ring";
import { PREVIEW_LIMIT } from "./ui/press-preview-placement";
import {
  PREVIEW_DRAG_SLOP, PREVIEW_EDGE_HIT, PREVIEW_MIN, clampPreview, movePreview, previewCursor, previewEdgeAt, resizePreview,
  type PreviewBox, type PreviewEdge, type PreviewSize,
} from "./ui/preview-frame";
import { SELECTION_BAR_SELECTOR } from "./components/selection-actions";
import { FLOAT_EASE } from "./ui/tokens/float";
import { PREVIEW_REVEAL } from "./ui/tokens/motion";
import { radiusV2 } from "./components/theme-tokens";
import { hasActiveDetailsKeyboard } from "./details/keyboard";

export { PREVIEW_REVEAL } from "./ui/tokens/motion";

/**
 * ponytail: Paseo 0.12 owns a 16pt margin outside every plugin row. A zero
 * height child cannot cancel it with a negative margin (the wrapper clamps
 * at zero). On web/desktop hide only the wrapper of our empty rollup members,
 * including the host's display:contents bridge. Grouping itself is native.
 * Native spacing hosts retain these gaps; upgrade to a host API for hiding a
 * source slot (or source-preserving grouped projection) to remove them there.
 */
export function installToolRollupSpacing(): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => {};
  const style = document.createElement("style");
  style.textContent = `
    div:has(> [data-bcrollupempty="true"]),
    div:has(> [style*="display: contents"] > [data-bcrollupempty="true"]) {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
  return () => style.remove();
}

/** The selection bar floats outside a preview but acts on its text, so it counts as part of it. */
function onSelectionBar(target: EventTarget | null): boolean {
  return Boolean((target as Element | null)?.closest?.(SELECTION_BAR_SELECTOR));
}

/** Row hover includes child actions and ends even when a leave event is lost. */
export function bindRowHover(node: unknown, enter: () => void, leave: () => void): () => void {
  if (Platform.OS !== "web") return () => {};
  const element = node as HTMLElement | null;
  if (!element) return () => {};
  const doc = element.ownerDocument;
  const view = doc.defaultView!;
  let active = false;
  let point: { x: number; y: number } | null = null;
  const end = () => {
    if (!active) return;
    active = false;
    doc.removeEventListener("pointermove", checkPointer, true);
    view.removeEventListener("scroll", checkScroll, true);
    view.removeEventListener("blur", end);
    leave();
  };
  const checkPointer = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    point = { x: event.clientX, y: event.clientY };
    if (!element.contains(event.target as Node)) end();
  };
  const checkScroll = () => {
    if (point && !element.contains(doc.elementFromPoint(point.x, point.y))) end();
  };
  const start = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    point = { x: event.clientX, y: event.clientY };
    if (active) return;
    active = true;
    doc.addEventListener("pointermove", checkPointer, true);
    view.addEventListener("scroll", checkScroll, true);
    view.addEventListener("blur", end);
    enter();
  };
  // Native DOM events do not depend on React's synthetic relatedTarget path.
  element.addEventListener("pointerenter", start);
  element.addEventListener("pointermove", start);
  element.addEventListener("pointerleave", end);
  return () => {
    element.removeEventListener("pointerenter", start);
    element.removeEventListener("pointermove", start);
    element.removeEventListener("pointerleave", end);
    end();
  };
}


/** Keep interactive toolbar details above timeline stacking contexts without moving their React tree. */
export function openToolbarDetailsLayer(node: unknown, anchor: unknown, side: "above" | "below"): () => void {
  if (Platform.OS !== "web") return () => {};
  const panel = node as HTMLElement | null;
  const trigger = anchor as HTMLElement | null;
  if (!panel || !trigger) return () => {};
  const view = panel.ownerDocument.defaultView!;
  const originalStyle = panel.style.cssText;
  const originalPopover = panel.getAttribute("popover");
  const initial = panel.getBoundingClientRect();
  const offset = initial.left - trigger.getBoundingClientRect().left;
  panel.setAttribute("popover", "manual");
  Object.assign(panel.style, {
    position: "fixed", inset: "auto", margin: "0", border: "0", background: "transparent",
    overflow: "visible", width: `${initial.width}px`, maxWidth: "calc(100vw - 16px)",
  });
  panel.showPopover();
  const position = () => {
    const rect = trigger.getBoundingClientRect();
    const { width, height } = panel.getBoundingClientRect();
    const above = rect.top - height;
    const below = rect.bottom;
    const fitsAbove = above >= 8;
    const fitsBelow = below + height <= view.innerHeight - 8;
    const top = side === "above"
      ? (fitsAbove || !fitsBelow ? above : below)
      : (fitsBelow || !fitsAbove ? below : above);
    panel.style.left = `${Math.max(8, Math.min(rect.left + offset, view.innerWidth - width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(top, view.innerHeight - height - 8))}px`;
  };
  position();
  const observer = new view.ResizeObserver(position);
  observer.observe(panel);
  observer.observe(trigger);
  view.addEventListener("resize", position);
  return () => {
    observer.disconnect();
    view.removeEventListener("resize", position);
    if (panel.matches(":popover-open")) panel.hidePopover();
    if (originalPopover === null) panel.removeAttribute("popover");
    else panel.setAttribute("popover", originalPopover);
    panel.style.cssText = originalStyle;
  };
}

/** Web-only pointer binding; native renderers never inspect a DOM node. */
export function bindPreviewPointer(node: unknown, enter: () => void, leave: () => void): () => void {
  if (Platform.OS !== "web") return () => {};
  const element = node as HTMLElement | null;
  if (!element) return () => {};
  // Into the selection bar is not a leave; out of it to anywhere else is.
  const exit = (event: MouseEvent) => {
    const bar = event.relatedTarget as HTMLElement | null;
    if (!onSelectionBar(bar)) return leave();
    bar!.addEventListener("mouseleave", (next) => {
      if (!element.contains(next.relatedTarget as Node)) leave();
    }, { once: true });
  };
  element.addEventListener("mouseenter", enter);
  element.addEventListener("mouseleave", exit);
  return () => {
    element.removeEventListener("mouseenter", enter);
    element.removeEventListener("mouseleave", exit);
  };
}

/**
 * Calls `moved` on the pointer's first real move after now, then stops.
 * Scrolling content under a resting pointer sends it no movement.
 */
export function watchNextPointerMove(anchor: unknown, moved: () => void): () => void {
  if (Platform.OS !== "web") return () => {};
  const doc = (anchor as HTMLElement | null)?.ownerDocument;
  if (!doc) return () => {};
  const onMove = (event: PointerEvent) => {
    if (event.movementX === 0 && event.movementY === 0) return;
    doc.removeEventListener("pointermove", onMove, true);
    moved();
  };
  doc.addEventListener("pointermove", onMove, true);
  return () => doc.removeEventListener("pointermove", onMove, true);
}

/**
 * Calls `leave` on the pointer's first move outside `anchor` and every hover
 * preview panel, then stops; a first move inside either hands over to the
 * usual enter and leave events and stops too.
 */
export function watchPointerOutside(anchor: unknown, leave: () => void): () => void {
  if (Platform.OS !== "web") return () => {};
  const row = anchor as HTMLElement | null;
  const doc = row?.ownerDocument;
  if (!row || !doc) return () => {};
  const onMove = (event: PointerEvent) => {
    const target = event.target as Element | null;
    const inside = Boolean(target && (row.contains(target) || target.closest?.('[data-testid="hover-preview"]')));
    doc.removeEventListener("pointermove", onMove, true);
    if (!inside) leave();
  };
  doc.addEventListener("pointermove", onMove, true);
  return () => doc.removeEventListener("pointermove", onMove, true);
}

/**
 * A selection inside a closing preview goes with it. The selection bar follows
 * the page's selection, and a panel taken off screen leaves its selection in
 * place without a `selectionchange`, so the bar would stay up over nothing.
 */
export function dropSelectionIn(node: unknown): void {
  if (Platform.OS !== "web") return;
  const element = node as HTMLElement | null;
  const selection = element?.ownerDocument?.defaultView?.getSelection();
  if (selection?.anchorNode && element!.contains(selection.anchorNode)) selection.removeAllRanges();
}

/** Double-clicking the toolbar's title or free space maximizes its preview. */
export function bindPreviewMaximize(node: unknown, maximize: () => void): () => void {
  if (Platform.OS !== "web") return () => {};
  const toolbar = node as HTMLElement | null;
  if (!toolbar) return () => {};
  const onDoubleClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, [role="button"], a, input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    event.preventDefault();
    event.stopPropagation();
    maximize();
  };
  toolbar.addEventListener("dblclick", onDoubleClick);
  return () => toolbar.removeEventListener("dblclick", onDoubleClick);
}

/** Page a maximized preview while focus stays in its panel. */
export function bindPreviewPaging(
  node: unknown,
  step: (direction: -1 | 1) => void,
  keys: "arrows" | "brackets" = "arrows",
): () => void {
  if (Platform.OS !== "web") return () => {};
  const pager = node as HTMLElement | null;
  if (!pager) return () => {};
  const panel = pager.closest<HTMLElement>('[data-testid="hover-preview"]');
  if (!panel) return () => {};
  const doc = pager.ownerDocument;
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const previousKey = keys === "arrows" ? "ArrowLeft" : "[";
    const nextKey = keys === "arrows" ? "ArrowRight" : "]";
    if (event.key !== previousKey && event.key !== nextKey) return;
    const target = event.target as HTMLElement;
    if (!panel.contains(target) || target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
    event.preventDefault();
    event.stopPropagation();
    step(event.key === previousKey ? -1 : 1);
  };
  if (keys === "brackets") {
    doc.addEventListener("keydown", onKey, true);
    return () => doc.removeEventListener("keydown", onKey, true);
  }
  // Preserve the legacy hover window's bubbling listener when details are off.
  doc.addEventListener("keydown", onKey);
  return () => doc.removeEventListener("keydown", onKey);
}

const FRAME_CONTROL = 'button, [role="button"], a, input, textarea, select, [contenteditable]:not([contenteditable="false"])';

function isFrameControl(target: EventTarget | null): boolean {
  // Called on the element: a DOM `closest` taken off it throws "Illegal invocation".
  return Boolean((target as Element | null)?.closest?.(FRAME_CONTROL));
}

function boxFrom(panel: HTMLElement): PreviewBox {
  const rect = panel.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

/**
 * Drag the toolbar to move a preview, or an edge to resize it. A press that
 * does not travel stays a click: double-click on the toolbar can still
 * maximize, and a button still receives its tap. The window is only pinned
 * (`place`) once the pointer has actually moved.
 */
export function bindPreviewFrame(node: unknown, hooks: {
  toolbar(): unknown;
  readBox(): PreviewBox;
  writeBox(box: PreviewBox): void;
  hold(on: boolean): void;
  place(): void;
  leave(): void;
  bounds(): PreviewSize;
}): () => void {
  if (Platform.OS !== "web") return () => {};
  const panel = node as HTMLElement | null;
  if (!panel || typeof panel.addEventListener !== "function") return () => {};
  const doc = panel.ownerDocument;
  const view = doc?.defaultView;
  if (!doc || !view) return () => {};

  type Drag = {
    kind: "move" | PreviewEdge;
    pointerId: number;
    start: PreviewBox;
    x: number;
    y: number;
    moved: boolean;
  };
  let drag: Drag | null = null;
  const paint = (cursor: string) => {
    panel.style.cursor = cursor;
    const root = doc.documentElement;
    if (root?.style) root.style.cursor = cursor;
  };
  const edgeAt = (event: PointerEvent) => {
    const rect = panel.getBoundingClientRect();
    const hit = event.pointerType === "touch" ? PREVIEW_EDGE_HIT.touch : PREVIEW_EDGE_HIT.pointer;
    return previewEdgeAt(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      { width: rect.width, height: rect.height },
      hit,
    );
  };
  const onToolbar = (target: EventTarget | null) => {
    const toolbar = hooks.toolbar() as { contains?(node: Node): boolean } | null;
    return Boolean(toolbar?.contains?.(target as Node));
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const delta = { x: event.clientX - drag.x, y: event.clientY - drag.y };
    if (!drag.moved) {
      if (Math.hypot(delta.x, delta.y) < PREVIEW_DRAG_SLOP) return;
      // Only a drag captures: a captured press sends its click and dblclick to the panel,
      // and the toolbar's double-click maximize would never see them.
      panel.setPointerCapture?.(drag.pointerId);
    }
    drag.moved = true;
    event.preventDefault();
    const next = drag.kind === "move"
      ? movePreview(drag.start, delta, hooks.bounds(), PREVIEW_LIMIT.margin)
      : resizePreview(drag.start, drag.kind, delta, hooks.bounds(), PREVIEW_MIN, PREVIEW_LIMIT.margin);
    hooks.writeBox(next);
    paint(drag.kind === "move" ? previewCursor("moving") : previewCursor(drag.kind));
  };
  const endDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    drag = null;
    doc.removeEventListener("pointermove", onPointerMove);
    doc.removeEventListener("pointerup", endDrag);
    doc.removeEventListener("pointercancel", endDrag);
    paint("");
    hooks.hold(false);
    if (moved) hooks.place();
    else if (typeof panel.matches === "function" && !panel.matches(":hover")) hooks.leave();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || drag) return;
    const edge = edgeAt(event);
    const draggingToolbar = onToolbar(event.target) && !isFrameControl(event.target);
    if (!edge && !draggingToolbar) return;
    if (edge) event.preventDefault();
    drag = {
      kind: edge ?? "move",
      pointerId: event.pointerId,
      start: hooks.readBox(),
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    hooks.hold(true);
    doc.addEventListener("pointermove", onPointerMove);
    doc.addEventListener("pointerup", endDrag);
    doc.addEventListener("pointercancel", endDrag);
  };
  const onHover = (event: PointerEvent) => {
    if (drag) return;
    const edge = edgeAt(event);
    if (edge) paint(previewCursor(edge));
    else if (onToolbar(event.target) && !isFrameControl(event.target)) paint(previewCursor("move"));
    else paint("");
  };
  const onLeave = () => {
    if (!drag) paint("");
  };
  panel.addEventListener("pointerdown", onPointerDown);
  panel.addEventListener("pointermove", onHover);
  panel.addEventListener("pointerleave", onLeave);
  return () => {
    drag = null;
    paint("");
    panel.removeEventListener("pointerdown", onPointerDown);
    panel.removeEventListener("pointermove", onHover);
    panel.removeEventListener("pointerleave", onLeave);
    doc.removeEventListener("pointermove", onPointerMove);
    doc.removeEventListener("pointerup", endDrag);
    doc.removeEventListener("pointercancel", endDrag);
  };
}

/** A non-modal top-layer surface escapes transformed and clipped timeline rows. */
export function openPreviewLayer(node: unknown, anchor: unknown, close: () => void, options: {
  maximized?: boolean;
  /** Whether every line fits the body's width unwrapped, so wrapping changes nothing. */
  onLinesFit?(fits: boolean): void;
  /** The pointer is down on the frame, so leaving must not start the close timer. */
  onHold?(holding: boolean): void;
  /** The reader moved or resized the frame: pin it and stop following the row. */
  onPlace?(box: PreviewBox): void;
  /**
   * A box the reader already placed. The layer opens there, without the
   * entrance, instead of following the row or filling the viewport.
   */
  frame?: PreviewBox | null;
  /** A press ended without a drag and the pointer is no longer over the frame. */
  onLeave?(): void;
  /** Reapplies a placed frame after React commits, which rewrites the panel's style. */
  onFrame?(sync: () => void): void;
  /**
   * Opened as a window (a pop-out button): it keeps the box it opens in, as a
   * placed one does, and stays up while the reader goes on with the timeline
   * under it, which scrolls and takes presses as usual. Its close button or
   * Escape closes it.
   */
  floating?: boolean;
  /** Reopened for a row the host remounted: it was already on screen, so no entrance. */
  quiet?: boolean;
} = {}): () => void {
  if (Platform.OS !== "web") return () => {};
  const panel = node as HTMLElement;
  const row = anchor as HTMLElement;
  const content = row.closest<HTMLElement>(`[${PLUGIN_ROOT_ATTRIBUTE}]`)!;
  const viewport = options.maximized ? row.closest<HTMLElement>("[data-window-content]")! : null;
  const view = panel.ownerDocument.defaultView!;
  panel.setAttribute("popover", "manual");
  panel.style.position = "fixed";
  panel.style.inset = "auto";
  panel.style.margin = "0";
  panel.style.padding = "0";
  panel.style.overflow = "hidden";
  panel.style.maxWidth = `${Math.max(0, view.innerWidth - 16)}px`;

  let below = true;
  // Set once the reader drags or resizes. Until then the panel follows its row.
  let frame: PreviewBox | null = options.frame ?? null;
  let holding = false;
  // Where a resting panel stays once the timeline scrolls under it on its
  // own: the host moves a finished call into its history and follows the
  // newest reply. The reader is still reading, so the panel neither closes
  // nor follows its row away from the pointer.
  let settled: number | null = null;
  // When a key that scrolls the page last went down outside the panel. A
  // scroll right after it is the reader's; a wheel or a press outside closes
  // the panel on its own.
  let scrollKeyAt = Number.NEGATIVE_INFINITY;
  const screen = (): PreviewSize => ({ width: view.innerWidth, height: view.innerHeight });
  const floating = () => frame !== null || Boolean(options.maximized);
  const applyFrame = (box: PreviewBox) => {
    const next = clampPreview(box, screen(), PREVIEW_MIN, PREVIEW_LIMIT.margin);
    frame = next;
    // A column with a fixed height, so the body scrolls inside the box the reader set.
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.left = `${next.x}px`;
    panel.style.top = `${next.y}px`;
    panel.style.width = `${next.width}px`;
    panel.style.height = `${next.height}px`;
    panel.style.maxWidth = "none";
    panel.style.maxHeight = `${next.height}px`;
    const fitted = panel.querySelector<HTMLElement>('[data-testid="hover-preview-body"]');
    if (fitted) fitted.style.flexGrow = "1";
  };
  const position = () => {
    if (holding) return;
    if (frame) {
      applyFrame(frame);
      return;
    }
    const contentRect = content.getBoundingClientRect();
    const left = Math.max(8, contentRect.left);
    const right = Math.min(view.innerWidth - 8, contentRect.right);
    panel.style.width = `${Math.max(0, right - left)}px`;
    panel.style.left = `${left}px`;
    if (options.maximized) {
      const viewportRect = viewport!.getBoundingClientRect();
      const { margin, maximizedGap } = PREVIEW_LIMIT;
      const top = Math.max(margin, viewportRect.top) + maximizedGap;
      const bottom = Math.min(view.innerHeight - margin, viewportRect.bottom) - maximizedGap;
      const height = Math.max(0, bottom - top);
      // A column, so the body and a picture in it can take this height.
      // The popover UA style would otherwise leave the picture at its content size.
      panel.style.display = "flex";
      panel.style.flexDirection = "column";
      panel.style.height = `${height}px`;
      panel.style.maxHeight = `${height}px`;
      panel.style.top = `${top}px`;
      return;
    }
    panel.style.height = "";
    if (settled !== null) {
      panel.style.maxHeight = `${Math.max(0, Math.min(PREVIEW_LIMIT.maxHeight, view.innerHeight - settled - PREVIEW_LIMIT.margin))}px`;
      panel.style.top = `${settled}px`;
      return;
    }
    const rect = row.getBoundingClientRect();
    const room = view.innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    below = room >= Math.min(PREVIEW_LIMIT.maxHeight, panel.scrollHeight) || room >= above;
    panel.style.maxHeight = `${Math.max(0, Math.min(PREVIEW_LIMIT.maxHeight, below ? room : above))}px`;
    panel.style.top = `${below ? rect.bottom + 6 : Math.max(8, rect.top - panel.getBoundingClientRect().height - 6)}px`;
  };
  panel.showPopover();
  position();
  const body = panel.querySelector<HTMLElement>('[data-testid="hover-preview-body"]');
  const measure = () => {
    position();
    if (body && options.onLinesFit) options.onLinesFit(linesFit(body));
  };
  measure();
  if (options.floating && !frame && !options.maximized) frame = boxFrom(panel);
  // A box carried over from a drag is already in place, so it does not fade or grow again.
  if (!options.frame && !options.quiet) {
    if (options.maximized) grow(panel, hoverRects.get(panel));
    else reveal(panel, below);
  }
  hoverRects.delete(panel);
  // Content can grow while streaming or after syntax highlighting/fonts settle.
  const resizeObserver = new view.ResizeObserver(measure);
  resizeObserver.observe(panel);
  if (viewport) resizeObserver.observe(viewport);
  if (body) {
    resizeObserver.observe(body);
    for (const child of body.children) resizeObserver.observe(child);
  }
  const mutationObserver = new view.MutationObserver(() => {
    if (body) for (const child of body.children) resizeObserver.observe(child);
    measure();
  });
  if (body) mutationObserver.observe(body, { childList: true, subtree: true, characterData: true });
  if (options.maximized) panel.querySelector<HTMLElement>('[aria-label="Close preview"]')?.focus();
  options.onFrame?.(() => {
    if (!holding && frame) applyFrame(frame);
  });
  const unbindFrame = bindPreviewFrame(panel, {
    toolbar: () => panel.querySelector('[data-testid="hover-preview-toolbar"]'),
    readBox: () => frame ?? boxFrom(panel),
    writeBox: applyFrame,
    hold(on) {
      holding = on;
      options.onHold?.(on);
    },
    place() {
      if (frame) applyFrame(frame);
      if (body && options.onLinesFit) options.onLinesFit(linesFit(body));
      if (frame) options.onPlace?.(frame);
    },
    leave() { options.onLeave?.(); },
    bounds: screen,
  });
  const onScroll = (event: Event) => {
    // Scrolling the preview must not dismiss it or scroll the timeline.
    // A frame the reader has placed stays, the way a maximized one does.
    if (floating() || panel.contains(event.target as Node)) return;
    if (Date.now() - scrollKeyAt < SCROLL_KEY_MS) {
      close();
      return;
    }
    settled ??= Number.parseFloat(panel.style.top) || 0;
  };
  // While the panel is up the wheel never moves what lies under it. Inside the
  // panel it scrolls the panel's own scrollers and stops at their ends instead
  // of chaining out to the timeline; outside, a resting panel closes.
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) return; // pinch zoom
    const target = event.target as Node;
    if (onSelectionBar(target)) return;
    if (panel.contains(target)) {
      if (!scrollsWithin(target, panel, event.deltaX, event.deltaY)) event.preventDefault();
      return;
    }
    if (options.floating) return;
    event.preventDefault();
    if (!floating()) close();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (options.floating) return;
    if (!panel.contains(event.target as Node) && !onSelectionBar(event.target)) close();
  };
  // Caught on the way down: the reply box, which holds focus while the reader
  // watches a stream, stops Escape before it bubbles to the document. One
  // Escape closes the panel and goes no further.
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !event.isComposing) {
      // The details shell owns Escape while open; its capture handler closes
      // that pane and stops the legacy hover popover from closing as well.
      if (hasActiveDetailsKeyboard(event)) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (SCROLL_KEYS.has(event.key) && !panel.contains(event.target as Node) && !editable(event.target)) scrollKeyAt = Date.now();
  };
  const onResize = () => { if (floating()) measure(); else close(); };
  const onBlur = () => { if (!floating()) close(); };
  view.addEventListener("scroll", onScroll, true);
  view.addEventListener("wheel", onWheel, { capture: true, passive: false });
  view.addEventListener("resize", onResize);
  view.addEventListener("blur", onBlur);
  panel.ownerDocument.addEventListener("pointerdown", onPointerDown, true);
  panel.ownerDocument.addEventListener("keydown", onKey, true);
  return () => {
    view.removeEventListener("scroll", onScroll, true);
    view.removeEventListener("wheel", onWheel, true);
    view.removeEventListener("resize", onResize);
    view.removeEventListener("blur", onBlur);
    panel.ownerDocument.removeEventListener("pointerdown", onPointerDown, true);
    panel.ownerDocument.removeEventListener("keydown", onKey, true);
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    unbindFrame();
    // Maximize re-lays out this same panel: the grow starts from where it was.
    if (!options.maximized) hoverRects.set(panel, panel.getBoundingClientRect());
    panel.hidePopover();
  };
}

/** Keys that scroll the page when focus is not in a field. */
const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "]);
/** How long after such a key a scroll still counts as the reader's: key repeat and a smooth scroll both land inside it. */
const SCROLL_KEY_MS = 1000;

function editable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== "function") return false;
  return element.isContentEditable || element.closest("input, textarea, select, [contenteditable='true']") !== null;
}

/**
 * Fades the panel in while it slides `PREVIEW_REVEAL.shift` px away from its
 * row. A translate leaves the panel's measured height alone, which placing it
 * above the row reads. No fill: once played, the panel's own style stands.
 */
function reveal(panel: HTMLElement, below: boolean): void {
  const view = panel.ownerDocument.defaultView!;
  if (typeof panel.animate !== "function" || view.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const from = below ? -PREVIEW_REVEAL.shift : PREVIEW_REVEAL.shift;
  panel.animate(
    [{ opacity: 0, transform: `translateY(${from}px)` }, { opacity: 1, transform: "none" }],
    { duration: PREVIEW_REVEAL.ms, easing: FLOAT_EASE.out },
  );
}

/** Where each hover panel last stood, until the layer that replaces it reads it. */
const hoverRects = new WeakMap<HTMLElement, DOMRect>();

/** Maximize: the panel's clip opens from its hover box to the whole panel. */
export const PREVIEW_GROW = { ms: 200, shadow: 48 } as const;

/**
 * Lays the panel out at its maximized size at once, then opens a clip from the
 * box it had while hovering. Nothing is scaled, so text never stretches, and
 * layout runs once. The end of the clip reaches past the panel so its shadow
 * comes in with it; with no fill, the clip is gone once played.
 */
function grow(panel: HTMLElement, from: DOMRect | undefined): void {
  const view = panel.ownerDocument.defaultView!;
  if (!from || typeof panel.animate !== "function" || view.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const to = panel.getBoundingClientRect();
  const inset = [from.top - to.top, to.right - from.right, to.bottom - from.bottom, from.left - to.left]
    .map((side) => `${Math.max(0, side)}px`).join(" ");
  const round = `round ${radiusV2.overlay}px`;
  panel.animate(
    [{ clipPath: `inset(${inset} ${round})` }, { clipPath: `inset(-${PREVIEW_GROW.shadow}px ${round})` }],
    { duration: PREVIEW_GROW.ms, easing: FLOAT_EASE.out },
  );
}

/**
 * True when a scroller between `target` and `root` (exclusive) can still move
 * by this wheel delta, so the browser should take the event.
 */
export function scrollsWithin(target: Node, root: HTMLElement, deltaX: number, deltaY: number): boolean {
  const view = root.ownerDocument.defaultView!;
  for (let node: Node | null = target; node && node !== root; node = node.parentNode) {
    if (node.nodeType !== 1) continue;
    const element = node as HTMLElement;
    const style = view.getComputedStyle(element);
    if (deltaY !== 0 && /auto|scroll|overlay/.test(style.overflowY)) {
      const room = deltaY < 0 ? element.scrollTop : element.scrollHeight - element.clientHeight - element.scrollTop;
      if (room > 1) return true;
    }
    if (deltaX !== 0 && /auto|scroll|overlay/.test(style.overflowX)) {
      const room = deltaX < 0 ? element.scrollLeft : element.scrollWidth - element.clientWidth - element.scrollLeft;
      if (room > 1) return true;
    }
  }
  return false;
}

/**
 * True when the body's content, laid out without wrapping, is no wider than
 * the body: its width is set to `max-content` for one synchronous layout and
 * put back before anything paints. A sideways-scrolling body measures the
 * same way, since a scroller's max-content width is its content's.
 */
export function linesFit(body: HTMLElement): boolean {
  const { width, maxWidth } = body.style;
  const fitted = body.getBoundingClientRect().width;
  // The wider layout is shorter, and a code block in it as wide as its lines,
  // so the browser clamps their offsets; nothing gives them back. This runs on
  // every change to the content: a streaming body went back to its top each
  // time, under the reader's scroll and the tail that follows the newest output.
  const scrolled = [body, ...Array.from(body.querySelectorAll<HTMLElement>("*"))]
    .filter((element) => element.scrollTop !== 0 || element.scrollLeft !== 0)
    .map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft }));
  body.style.width = "max-content";
  body.style.maxWidth = "none";
  const natural = body.getBoundingClientRect().width;
  body.style.width = width;
  body.style.maxWidth = maxWidth;
  for (const { element, top, left } of scrolled) {
    if (element.scrollTop !== top) element.scrollTop = top;
    if (element.scrollLeft !== left) element.scrollLeft = left;
  }
  return natural <= fitted + 0.5;
}

/**
 * Closes a control a long press opened once the reader scrolls anything (the
 * chat list, the table's own scroller) or touches outside it. Interactive
 * details can opt to keep their own scrolling region open. Bound only while
 * it is open. Web only.
 */
export function bindTouchDismiss(node: unknown, close: () => void, options: { allowInsideScroll?: boolean } = {}): () => void {
  if (Platform.OS !== "web") return () => {};
  const element = node as HTMLElement | null;
  if (!element) return () => {};
  const doc = element.ownerDocument;
  const view = doc.defaultView!;
  const outside = (event: Event) => {
    if (!element.contains(event.target as Node)) close();
  };
  const scroll = (event: Event) => {
    if (options.allowInsideScroll && element.contains(event.target as Node)) return;
    close();
  };
  view.addEventListener("scroll", scroll, true);
  doc.addEventListener("pointerdown", outside, true);
  return () => {
    view.removeEventListener("scroll", scroll, true);
    doc.removeEventListener("pointerdown", outside, true);
  };
}

/** Keeps a long press on the element from raising iOS Safari's callout. Web only. */
export function suppressTouchCallout(node: unknown): void {
  if (Platform.OS !== "web") return;
  (node as HTMLElement | null)?.style.setProperty("-webkit-touch-callout", "none");
}

/** Handle Escape before the host composer consumes it. */
export function bindDetailsEscape(node: unknown, close: () => void): () => void {
  if (Platform.OS !== "web") return () => {};
  const doc = (node as HTMLElement | null)?.ownerDocument;
  if (!doc) return () => {};
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  doc.addEventListener("keydown", keydown, true);
  return () => doc.removeEventListener("keydown", keydown, true);
}
