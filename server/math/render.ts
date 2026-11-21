import { Buffer } from "node:buffer";
import { mathjax } from "@mathjax/src/js/mathjax.js";
import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { LocalSvg, RenderFailure, createTeX } from "./engine";
import { wasmBase64 } from "./generated/wasm";
import { renderInput, renderOutput, type RenderErrorCode, type RenderInput, type RenderOutput } from "../../shared/math-rpc";

let wasmReady: Promise<void> | undefined;
function initialize() {
  return wasmReady ??= initWasm(Buffer.from(wasmBase64, "base64")).catch(error => {
    wasmReady = undefined;
    throw error;
  });
}

const failure = (code: RenderErrorCode, reason: string): RenderOutput => ({ ok: false, code, reason });

function validateComplexity(tex: string) {
  if (/\\(?:require|autoload|input|include|href|url|style|class|cssId|html\w*|includegraphics|unicode|def|gdef|edef|xdef|newcommand|renewcommand|let)\b/.test(tex))
    throw new RenderFailure("blocked-command", "This LaTeX command is disabled");
  let depth = 0, maxDepth = 0;
  for (const char of tex) {
    if (char === "{") maxDepth = Math.max(maxDepth, ++depth);
    else if (char === "}") depth--;
  }
  if (maxDepth > 32 || (tex.match(/\\[a-zA-Z]+/g)?.length ?? 0) > 256 || tex.split("\\\\").length > 40)
    throw new RenderFailure("limit", "Formula exceeds the nesting, command or row limit");
}

export function createMathRenderer({ maxEntries = 128, maxBytes = 8_000_000 } = {}) {
  const cache = new Map<string, RenderOutput>();
  let bytes = 0, pending = 0, disposed = false;
  const adaptor = liteAdaptor();
  const handler = RegisterHTMLHandler(adaptor);
  const size = (result: RenderOutput) => result.ok ? result.uri.length : 0;
  const stopped = () => failure("renderer-unavailable", "Renderer stopped");

  function remember(key: string, result: RenderOutput) {
    if (disposed || cache.has(key)) return;
    cache.set(key, result);
    bytes += size(result);
    while (cache.size > maxEntries || bytes > maxBytes) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      bytes -= size(cache.get(oldest)!);
      cache.delete(oldest);
    }
  }

  async function typeset(input: RenderInput) {
    validateComplexity(input.tex);
    await initialize();
    if (disposed) return stopped();

    // A fresh document isolates formula-local state and macros between concurrent renders.
    const document = handler.create("", {
      InputJax: createTeX(),
      OutputJax: new LocalSvg({ fontCache: "none", linebreaks: { inline: false } }),
    });
    const node = await document.convertPromise(input.tex, {
      display: input.display, em: input.fontSize, ex: input.fontSize / 2, containerWidth: 1200,
    });
    if (disposed) return stopped();

    // Stretchy operators can contain nested SVG viewports. Count only the
    // top-level images to guard against losing part of a split formula.
    const [svg, extraSvg] = adaptor.tags(node, "svg").filter(candidate => adaptor.parent(candidate) === node);
    if (!svg || extraSvg || adaptor.tags(svg, "text").length || adaptor.tags(svg, "image").length || adaptor.tags(svg, "a").length)
      throw new RenderFailure("blocked-command", "Formula requires unsupported SVG content");

    const box = String(adaptor.getAttribute(svg, "viewBox") ?? adaptor.getAttribute(svg, "data-mjx-viewBox")).split(/\s+/).map(Number);
    if (box.length !== 4 || box.some(n => !Number.isFinite(n)))
      throw new RenderFailure("invalid-tex", "Formula has no measurable layout");
    const [boxX = 0, boxY = 0, boxWidth = 0, boxHeight = 0] = box;
    const pad = 2000 / input.fontSize;
    const depth = Math.max(0, boxY + boxHeight) * input.fontSize / 1000 + 2;
    const width = Math.ceil(boxWidth * input.fontSize / 1000 + 4);
    const height = Math.ceil(boxHeight * input.fontSize / 1000 + 4);
    if (width <= 4 || height <= 4 || width > 2400 || height > 800 || width * height * input.scale ** 2 > 4_000_000)
      throw new RenderFailure("limit", "Formula exceeds the image dimensions limit");
    adaptor.setAttribute(svg, "viewBox", [boxX - pad, boxY - pad, boxWidth + 2 * pad, boxHeight + 2 * pad].join(" "));
    adaptor.setAttribute(svg, "width", width);
    adaptor.setAttribute(svg, "height", height);
    // The HTML serializer leaves '<' and '&' in attribute values unescaped.
    // The PNG renderer does not need MathJax's copy/assistive TeX annotations.
    for (const element of adaptor.tags(svg, "g")) {
      adaptor.removeAttribute(element, "data-latex");
      adaptor.removeAttribute(element, "data-latex-item");
    }
    const xml = adaptor.outerHTML(svg).replaceAll("currentColor", input.color);
    if (xml.length > 1_000_000) throw new RenderFailure("limit", "Formula exceeds the vector size limit");

    const raster = new Resvg(xml, { fitTo: { mode: "zoom", value: input.scale }, font: { loadSystemFonts: false } });
    try {
      const image = raster.render();
      try {
        const png = image.asPng();
        if (png.byteLength > 1_000_000) throw new RenderFailure("limit", "Formula exceeds the image file size limit");
        return renderOutput.parse({ ok: true, uri: "data:image/png;base64," + Buffer.from(png).toString("base64"), width, height, depth });
      } finally { image.free(); }
    } finally { raster.free(); }
  }

  async function render(raw: RenderInput): Promise<RenderOutput> {
    if (disposed) return stopped();
    const parsed = renderInput.safeParse(raw);
    if (!parsed.success) return failure("limit", "Formula or render settings exceed limits");
    const input = parsed.data;
    const key = JSON.stringify(input);
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
    if (pending >= 16) return failure("renderer-unavailable", "Renderer busy");
    pending++;
    try {
      const result = await typeset(input);
      if (result.ok) remember(key, result);
      return result;
    } catch (error) {
      if (error instanceof RenderFailure) {
        const result = failure(error.code, error.message);
        remember(key, result);
        return result;
      }
      return failure("renderer-unavailable", "Local formula rendering failed");
    } finally { pending--; }
  }

  return {
    render,
    stats: () => ({ entries: cache.size, bytes, pending, disposed }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cache.clear();
      bytes = 0;
      mathjax.handlers.unregister(handler);
    },
  };
}
