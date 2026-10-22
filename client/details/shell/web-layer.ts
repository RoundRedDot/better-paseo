/**
 * The details panel's layer on web: a top-layer popover over the whole
 * window, as the hover preview's (`openPreviewLayer`). Never `position: fixed`
 * inside the row on its own: a virtualized row's transform would make the row
 * its containing block (host facts §6); the top layer has the viewport.
 *
 * The layer is non-modal. Its stage lets the pointer through outside the
 * panel (`pointerEvents="box-none"`), so the timeline behind stays live and a
 * click on another row switches the panel to it; only the phone-width drawer
 * catches the pointer, on its scrim.
 */
import { Platform } from "react-native";

/** A hover preview open besides the panel. */
function previewOpenBesides(layer: HTMLElement): boolean {
  const previews = layer.ownerDocument.querySelectorAll<HTMLElement>('[data-testid="hover-preview"]');
  return Array.from(previews).some((preview) => {
    if (layer.contains(preview)) return false;
    try {
      return preview.matches(":popover-open");
    } catch {
      return preview.getClientRects().length > 0;
    }
  });
}

/**
 * Raises `node` to the top layer over the window; returns what lowers it.
 * The panel's keys, Escape among them, are `client/details/keyboard.ts`'s.
 */
export function bindDetailsLayer(node: unknown): () => void {
  if (Platform.OS !== "web") return () => {};
  const layer = node as HTMLElement | null;
  if (!layer || typeof layer.setAttribute !== "function") return () => {};
  layer.setAttribute("popover", "manual");
  const style = layer.style;
  style.position = "fixed";
  style.inset = "0";
  style.width = "100%";
  style.height = "100%";
  style.maxWidth = "none";
  style.maxHeight = "none";
  style.margin = "0";
  style.padding = "0";
  style.border = "0";
  style.background = "transparent";
  style.overflow = "hidden";
  try {
    layer.showPopover?.();
  } catch {
    // Already shown, or a browser without popovers: the fixed layer still draws in place.
  }
  return () => {
    try {
      layer.hidePopover?.();
    } catch {
      // Gone with its pane.
    }
  };
}

/**
 * Whether the panel's keys are this layer's: it is shown (Paseo keeps hidden
 * panes mounted, and a layer in one must not react), and for Escape no hover
 * preview is open over it. That preview takes the key first, so one Escape
 * closes one layer (`openPreviewLayer` asks `hasActiveDetailsKeyboard`).
 */
export function layerTakesKey(node: unknown, event?: KeyboardEvent): boolean {
  const layer = node as HTMLElement | null;
  if (!layer || typeof layer.getClientRects !== "function" || layer.getClientRects().length === 0) return false;
  return !(event?.key === "Escape" && previewOpenBesides(layer));
}

/** The scroller a row sits in: its nearest ancestor that scrolls vertically, within its own pane. */
export function nearestScroller(node: unknown): HTMLElement | null {
  if (Platform.OS !== "web") return null;
  let element = (node as HTMLElement | null)?.parentElement ?? null;
  const view = element?.ownerDocument.defaultView;
  while (element && view) {
    const overflow = view.getComputedStyle(element).overflowY;
    if (/auto|scroll|overlay/.test(overflow) && element.scrollHeight > element.clientHeight) return element;
    element = element.parentElement;
  }
  return null;
}

/** The body the panel's content draws (`HoverPreviewBody`) is scrolled to its top. */
export function webBodyAtTop(panel: unknown): boolean {
  const node = panel as HTMLElement | null;
  const body = node?.querySelector?.<HTMLElement>('[data-testid="hover-preview-body"]');
  return !body || body.scrollTop <= 0;
}
