import { Platform } from "react-native";
import { PLUGIN_ROOT_ATTRIBUTE } from "./components/focus-ring";

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
export function openPreviewLayer(node: unknown, anchor: unknown, close: () => void): () => void {
  if (Platform.OS !== "web") return () => {};
  const panel = node as HTMLElement;
  const row = anchor as HTMLElement;
  const content = row.closest<HTMLElement>(`[${PLUGIN_ROOT_ATTRIBUTE}]`)!;
  const view = panel.ownerDocument.defaultView!;
  panel.setAttribute("popover", "manual");
  panel.style.position = "fixed";
  panel.style.inset = "auto";
  panel.style.margin = "0";
  panel.style.padding = "0";
  panel.style.overflowY = "auto";
  panel.style.overscrollBehavior = "contain";
  panel.style.maxWidth = `${Math.max(0, view.innerWidth - 16)}px`;

  const position = () => {
    const rect = row.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const left = Math.max(8, contentRect.left);
    const right = Math.min(view.innerWidth - 8, contentRect.right);
    panel.style.width = `${Math.max(0, right - left)}px`;
    panel.style.left = `${left}px`;
    const below = view.innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    const down = below >= Math.min(360, panel.scrollHeight) || below >= above;
    panel.style.maxHeight = `${Math.max(0, Math.min(360, down ? below : above))}px`;
    panel.style.top = `${down ? rect.bottom + 6 : Math.max(8, rect.top - panel.getBoundingClientRect().height - 6)}px`;
  };
  panel.showPopover();
  position();
  const onScroll = (event: Event) => {
    // Scrolling the preview must not dismiss it or scroll the timeline.
    if (panel.contains(event.target as Node)) return;
    close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  view.addEventListener("scroll", onScroll, true);
  view.addEventListener("resize", close);
  view.addEventListener("blur", close);
  panel.ownerDocument.addEventListener("keydown", onKey);
  return () => {
    view.removeEventListener("scroll", onScroll, true);
    view.removeEventListener("resize", close);
    view.removeEventListener("blur", close);
    panel.ownerDocument.removeEventListener("keydown", onKey);
    panel.hidePopover();
  };
}
