import { Buffer } from "node:buffer";
import { gunzipSync } from "node:zlib";
import { mathjax } from "@mathjax/src/js/mathjax.js";
import type TexError from "@mathjax/src/js/input/tex/TexError.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import { SVG } from "@mathjax/src/js/output/svg.js";
import type { LiteDocument } from "@mathjax/src/js/adaptors/lite/Document.js";
import type { LiteElement } from "@mathjax/src/js/adaptors/lite/Element.js";
import type { LiteText } from "@mathjax/src/js/adaptors/lite/Text.js";
import "@mathjax/src/js/input/tex/base/BaseConfiguration.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/js/input/tex/amscd/AmsCdConfiguration.js";
import "@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js";
import "@mathjax/src/js/input/tex/cases/CasesConfiguration.js";
import "@mathjax/src/js/input/tex/cancel/CancelConfiguration.js";
import "@mathjax/src/js/input/tex/centernot/CenternotConfiguration.js";
import "@mathjax/src/js/input/tex/braket/BraketConfiguration.js";
import "@mathjax/src/js/input/tex/upgreek/UpgreekConfiguration.js";
import "@mathjax/src/js/input/tex/extpfeil/ExtpfeilConfiguration.js";
import "@mathjax/src/js/input/tex/gensymb/GensymbConfiguration.js";
import "@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js";
import "@mathjax/src/js/input/tex/physics/PhysicsConfiguration.js";
import { create as openFont } from "fontkit";
import type { RenderErrorCode } from "../../shared/math-rpc";
import { cjkBase64 } from "./generated/cjk";
import { fontRanges } from "./generated/font-ranges";

const extensions = [
  "base", "ams", "amscd", "boldsymbol", "mathtools", "cases", "cancel", "centernot",
  "braket", "upgreek", "extpfeil", "gensymb", "textmacros", "physics",
];

mathjax.asyncLoad = async specifier => {
  const load = fontRanges.get(specifier);
  if (!load) throw new Error("Unbundled MathJax font range");
  return load();
};

export class RenderFailure extends Error {
  constructor(readonly code: RenderErrorCode, message: string) {
    super(message);
  }
}

export function createTeX() {
  return new TeX<LiteElement, LiteText, LiteDocument>({
    packages: extensions,
    maxBuffer: 4096,
    maxMacros: 256,
    formatError: (_jax: unknown, error: TexError) => {
      if (error.id === "UndefinedControlSequence" || error.id === "UndefinedControlSequenceInText") {
        const command = error.message.match(/\\[a-z]{1,80}/i)?.[0];
        throw new RenderFailure("unknown-command", command ? "Unknown LaTeX command " + command : "Unknown LaTeX command");
      }
      if (/MaxMacro|BufferSize/.test(error.id))
        throw new RenderFailure("limit", "Formula exceeds the TeX expansion limit");
      throw new RenderFailure("invalid-tex", "Invalid LaTeX syntax");
    },
  });
}

function loadFallbackFont() {
  const font = openFont(gunzipSync(Buffer.from(cjkBase64, "base64")));
  if (!("layout" in font)) throw new Error("The bundled fallback font could not be loaded");
  return font;
}

let fallbackFont: ReturnType<typeof loadFallbackFont> | undefined;

export class LocalSvg extends SVG<LiteElement, LiteText, LiteDocument> {
  private readonly metrics = new WeakMap<LiteElement, { w: number; h: number; d: number }>();

  // The Node adaptor has no text measurement. Lay out the fallback font directly and
  // emit outlines in MathJax's coordinate system so resvg still needs no font lookup.
  unknownText(text: string, variant: string) {
    const font = fallbackFont ??= loadFallbackFont();
    for (const char of text) {
      const codepoint = char.codePointAt(0)!;
      if (!font.hasGlyphForCodePoint(codepoint))
        throw new RenderFailure("missing-glyph", "No bundled glyph for U+" + codepoint.toString(16).toUpperCase());
    }

    const run = font.layout(text);
    const scale = 1000 / font.unitsPerEm;
    const group = this.svg("g", { transform: "scale(" + scale + ")" });
    const italic = this.font.getCssFont(variant)[1];
    if (italic) this.adaptor.setAttribute(group, "transform", "scale(" + scale + ") skewX(12)");

    let x = 0, y = 0, top = 0, bottom = 0;
    for (const [index, glyph] of run.glyphs.entries()) {
      const position = run.positions[index];
      if (!position) throw new RenderFailure("invalid-tex", "Formula glyph has no position");
      const { xOffset, yOffset, xAdvance, yAdvance } = position;
      const path = glyph.path.toSVG();
      if (path) {
        const gx = x + xOffset;
        const gy = y + yOffset;
        this.adaptor.append(group, this.svg("path", { d: path, transform: "translate(" + gx + " " + gy + ")" }));
        top = Math.max(top, gy + glyph.bbox.maxY);
        bottom = Math.min(bottom, gy + glyph.bbox.minY);
      }
      x += xAdvance;
      y += yAdvance;
    }

    this.metrics.set(group, { w: x / font.unitsPerEm, h: top / font.unitsPerEm, d: -bottom / font.unitsPerEm });
    return group;
  }

  measureTextNode(node: LiteElement) {
    return this.metrics.get(node) ?? super.measureTextNode(node);
  }
}
