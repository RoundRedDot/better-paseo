import { Platform } from "react-native";
import { PLUGIN_ROOT_ATTRIBUTE } from "./components/focus-ring";
import { PREVIEW_LIMIT } from "./ui/press-preview-placement";

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


/** Web-only pointer binding; native renderers never inspect a DOM node. */
export function bindPreviewPointer(node: unknown, enter: () => void, leave: () => void): () => void {
  if (Platform.OS !== "web") return () => {};
  const element = node as HTMLElement | null;
  if (!element) return () => {};
  element.addEventListener("mouseenter", enter);
  element.addEventListener("mouseleave", leave);
  return () => {
    element.removeEventListener("mouseenter", enter);
    element.removeEventListener("mouseleave", leave);
  };
}

/** Arrow keys page a maximized preview while focus stays in its panel. */
export function bindPreviewPaging(node: unknown, step: (direction: -1 | 1) => void): () => void {
  if (Platform.OS !== "web") return () => {};
  const pager = node as HTMLElement | null;
  if (!pager) return () => {};
  const panel = pager.closest<HTMLElement>('[data-testid="hover-preview"]')!;
  const doc = pager.ownerDocument;
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const target = event.target as HTMLElement;
    if (!panel.contains(target) || target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
    event.preventDefault();
    event.stopPropagation();
    step(event.key === "ArrowLeft" ? -1 : 1);
  };
  doc.addEventListener("keydown", onKey);
  return () => doc.removeEventListener("keydown", onKey);
}

/** A non-modal top-layer surface escapes transformed and clipped timeline rows. */
export function openPreviewLayer(node: unknown, anchor: unknown, close: () => void, options: {
  maximized?: boolean;
  /** Whether every line fits the body's width unwrapped, so wrapping changes nothing. */
  onLinesFit?(fits: boolean): void;
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

  const position = () => {
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
    const rect = row.getBoundingClientRect();
    const below = view.innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    const down = below >= Math.min(PREVIEW_LIMIT.maxHeight, panel.scrollHeight) || below >= above;
    panel.style.maxHeight = `${Math.max(0, Math.min(PREVIEW_LIMIT.maxHeight, down ? below : above))}px`;
    panel.style.top = `${down ? rect.bottom + 6 : Math.max(8, rect.top - panel.getBoundingClientRect().height - 6)}px`;
  };
  panel.showPopover();
  position();
  const body = panel.querySelector<HTMLElement>('[data-testid="hover-preview-body"]');
  const measure = () => {
    position();
    if (body && options.onLinesFit) options.onLinesFit(linesFit(body));
  };
  measure();
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
  const onScroll = (event: Event) => {
    // Scrolling the preview must not dismiss it or scroll the timeline.
    if (options.maximized || panel.contains(event.target as Node)) return;
    close();
  };
  // While the panel is up the wheel never moves what lies under it. Inside the
  // panel it scrolls the panel's own scrollers and stops at their ends instead
  // of chaining out to the timeline; outside, a resting panel closes.
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) return; // pinch zoom
    const target = event.target as Node;
    if (panel.contains(target)) {
      if (!scrollsWithin(target, panel, event.deltaX, event.deltaY)) event.preventDefault();
      return;
    }
    event.preventDefault();
    if (!options.maximized) close();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!panel.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  const onResize = options.maximized ? measure : close;
  const onBlur = () => { if (!options.maximized) close(); };
  view.addEventListener("scroll", onScroll, true);
  view.addEventListener("wheel", onWheel, { capture: true, passive: false });
  view.addEventListener("resize", onResize);
  view.addEventListener("blur", onBlur);
  panel.ownerDocument.addEventListener("pointerdown", onPointerDown, true);
  panel.ownerDocument.addEventListener("keydown", onKey);
  return () => {
    view.removeEventListener("scroll", onScroll, true);
    view.removeEventListener("wheel", onWheel, true);
    view.removeEventListener("resize", onResize);
    view.removeEventListener("blur", onBlur);
    panel.ownerDocument.removeEventListener("pointerdown", onPointerDown, true);
    panel.ownerDocument.removeEventListener("keydown", onKey);
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    panel.hidePopover();
  };
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
  body.style.width = "max-content";
  body.style.maxWidth = "none";
  const natural = body.getBoundingClientRect().width;
  body.style.width = width;
  body.style.maxWidth = maxWidth;
  return natural <= fitted + 0.5;
}
