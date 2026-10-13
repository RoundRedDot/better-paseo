/**
 * A rendered element as a PNG on the clipboard, for "Copy as image" on web.
 *
 * The element is cloned with every computed style written inline, wrapped in
 * an SVG `foreignObject` and drawn onto a canvas, so the picture keeps the
 * browser's own layout: wrapped cells, code chips, bold headers. The SVG is
 * an image with no access to the page's style sheets, which is why the styles
 * travel inline; the embedded faces travel as their `@font-face` rules, and the
 * host's system font stacks resolve as they do on the page. Native has no DOM,
 * so the entry that calls this is shown on web only.
 */

/** Room around the element, so a pasted table does not touch the image's edge. */
export const IMAGE_PADDING = 12;
/** The canvas edge browsers still draw; a taller table is drawn at a lower scale. */
const MAX_CANVAS_SIDE = 16384;
/** The embedded faces' style element (`embed-fonts.ts`). */
const FONT_STYLE_ID = "better-paseo-fonts";

export interface ImageOptions {
  /** Fill behind the element; the clipboard would otherwise carry a transparent PNG. */
  background: string;
  padding?: number;
  /** Device pixels per CSS pixel; at least 2, so the text stays sharp when pasted. */
  scale?: number;
}

/** Whether this runtime can put an image on the clipboard. */
export function canCopyImage(): boolean {
  return typeof document !== "undefined"
    && typeof navigator !== "undefined"
    && typeof navigator.clipboard?.write === "function"
    && typeof ClipboardItem !== "undefined";
}

/**
 * The scale the canvas is drawn at: the requested one, lowered so neither
 * side passes what a browser canvas can hold.
 */
export function imageScale(width: number, height: number, requested: number): number {
  const longest = Math.max(width, height, 1);
  return Math.max(0.1, Math.min(requested, MAX_CANVAS_SIDE / longest));
}

/**
 * Copies the element's picture. The PNG is handed to `ClipboardItem` as a
 * promise, so the write starts inside the click's user activation and the
 * rendering finishes after it.
 */
export async function copyElementImage(element: HTMLElement, options: ImageOptions): Promise<void> {
  if (!canCopyImage()) throw new Error("Image copy is unavailable");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": renderElementPng(element, options) })]);
}

export async function renderElementPng(element: HTMLElement, options: ImageOptions): Promise<Blob> {
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  if (!view) throw new Error("The element is not in a window");
  const padding = options.padding ?? IMAGE_PADDING;
  const width = Math.ceil(element.offsetWidth);
  const height = Math.ceil(element.offsetHeight);
  const clone = cloneWithStyles(element, view) as HTMLElement;
  // The element's place on the page does not belong in the picture.
  clone.style.setProperty("margin", "0");
  clone.style.setProperty("position", "static");
  clone.style.setProperty("transform", "none");
  const fonts = doc.getElementById(FONT_STYLE_ID)?.textContent ?? "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<foreignObject x="0" y="0" width="${width}" height="${height}">`
    + (fonts ? `<style xmlns="http://www.w3.org/1999/xhtml">${escapeXml(fonts)}</style>` : "")
    + new view.XMLSerializer().serializeToString(clone)
    + "</foreignObject></svg>";
  const image = new view.Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();

  const fullWidth = width + padding * 2;
  const fullHeight = height + padding * 2;
  const scale = imageScale(fullWidth, fullHeight, options.scale ?? Math.max(2, view.devicePixelRatio || 1));
  const canvas = doc.createElement("canvas");
  canvas.width = Math.round(fullWidth * scale);
  canvas.height = Math.round(fullHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2D canvas");
  context.scale(scale, scale);
  context.fillStyle = options.background;
  context.fillRect(0, 0, fullWidth, fullHeight);
  context.drawImage(image, padding, padding, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The canvas gave no PNG"))), "image/png");
  });
}

/**
 * A deep copy with each element's computed style inline. Class names and ids
 * are dropped: no style sheet reaches the SVG, and an id would only collide.
 */
function cloneWithStyles(source: Node, view: Window): Node {
  if (source.nodeType !== 1) return source.cloneNode(false);
  const element = source as Element;
  const clone = element.cloneNode(false) as Element;
  clone.removeAttribute("class");
  clone.removeAttribute("id");
  const computed = view.getComputedStyle(element);
  let css = "";
  for (let index = 0; index < computed.length; index++) {
    const name = computed[index]!;
    css += `${name}:${computed.getPropertyValue(name)};`;
  }
  clone.setAttribute("style", css);
  for (let child = element.firstChild; child; child = child.nextSibling) {
    clone.appendChild(cloneWithStyles(child, view));
  }
  return clone;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
