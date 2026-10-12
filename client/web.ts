import { Platform } from "react-native";
import { PLUGIN_ROOT_ATTRIBUTE } from "./components/focus-ring";
import { PREVIEW_LIMIT } from "./ui/press-preview-placement";

const MAXIMIZED_PREVIEW_GAP = 16;

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

/** A non-modal top-layer surface escapes transformed and clipped timeline rows. */
export function openPreviewLayer(node: unknown, anchor: unknown, close: () => void, options: {
  maximized?: boolean;
  onOverflow?(overflowing: boolean): void;
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
      const top = Math.max(8, viewportRect.top) + MAXIMIZED_PREVIEW_GAP;
      const bottom = Math.min(view.innerHeight - 8, viewportRect.bottom) - MAXIMIZED_PREVIEW_GAP;
      const height = Math.max(0, bottom - top);
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
    if (!options.maximized && body) options.onOverflow?.(body.scrollHeight > body.clientHeight);
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
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  const onResize = options.maximized ? measure : close;
  const onBlur = () => { if (!options.maximized) close(); };
  view.addEventListener("scroll", onScroll, true);
  view.addEventListener("resize", onResize);
  view.addEventListener("blur", onBlur);
  panel.ownerDocument.addEventListener("keydown", onKey);
  return () => {
    view.removeEventListener("scroll", onScroll, true);
    view.removeEventListener("resize", onResize);
    view.removeEventListener("blur", onBlur);
    panel.ownerDocument.removeEventListener("keydown", onKey);
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    panel.hidePopover();
  };
}
