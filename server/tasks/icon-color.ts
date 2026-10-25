import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

/**
 * A project icon's theme colour, for the subtask mark on its cards: the most
 * common lively colour when the icon has enough colour to speak of, else its
 * most common colour that is not white (a black logo is black). PNG is decoded
 * here (8-bit, not interlaced: what the daemon hands over); an SVG gives the
 * colours it names. Anything else, or an icon that cannot be read, has none.
 */
export function iconThemeColor(data: string, mimeType: string): string | null {
  const key = `${mimeType}:${createHash("sha1").update(data).digest("hex")}`;
  if (remembered.has(key)) return remembered.get(key)!;
  const color = readThemeColor(data, mimeType);
  // Every board that opens asks again for the same icons; the oldest answer goes first.
  if (remembered.size >= REMEMBERED) remembered.delete(remembered.keys().next().value!);
  remembered.set(key, color);
  return color;
}

/** Icons whose colour is kept, by content. */
const REMEMBERED = 64;
const remembered = new Map<string, string | null>();

function readThemeColor(data: string, mimeType: string): string | null {
  try {
    const base64 = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
    const bytes = Buffer.from(base64, "base64");
    if (mimeType === "image/png") return dominantColor(pngPixels(bytes));
    if (mimeType.startsWith("image/svg")) return dominantColor(svgColors(bytes.toString("utf8")));
  } catch {
    // A broken icon only loses its colour; the card falls back to grey.
  }
  return null;
}

type Pixel = readonly [r: number, g: number, b: number, a: number];

/** A bucket is lively when its average channels spread at least this far (0-255). */
const LIVELY_CHROMA = 48;
/** The share of opaque pixels lively ones need before they win over the rest. */
const LIVELY_SHARE = 0.05;
/** A bucket whose darkest channel is this light counts as white (an icon's backdrop). */
const WHITE_FLOOR = 225;
/** About this many pixels are sampled from a large icon. */
const SAMPLES = 40_000;

export function dominantColor(pixels: Iterable<Pixel>): string | null {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const [r, g, b, a] of pixels) {
    if (a < 128) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const averaged = [...buckets.values()].map(({ n, r, g, b }) => {
    const rgb = [r / n, g / n, b / n] as const;
    return { n, rgb, chroma: Math.max(...rgb) - Math.min(...rgb), floor: Math.min(...rgb) };
  });
  const opaque = averaged.reduce((sum, bucket) => sum + bucket.n, 0);
  if (opaque === 0) return null;
  const lively = averaged.filter((bucket) => bucket.chroma >= LIVELY_CHROMA);
  const livelyCount = lively.reduce((sum, bucket) => sum + bucket.n, 0);
  const notWhite = averaged.filter((bucket) => bucket.floor < WHITE_FLOOR);
  const pool = livelyCount >= opaque * LIVELY_SHARE ? lively : notWhite.length > 0 ? notWhite : averaged;
  const best = pool.reduce((a, b) => (b.n > a.n ? b : a));
  return `#${best.rgb.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** A PNG's pixels, sampled on a grid; throws on what it does not read. */
export function pngPixels(bytes: Buffer): Pixel[] {
  if (bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let offset = 8; offset + 8 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    const name = bytes.toString("latin1", offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (name === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      type = body[9]!;
      interlace = body[12]!;
    } else if (name === "PLTE") palette = body;
    else if (name === "tRNS") transparency = body;
    else if (name === "IDAT") idat.push(body);
    else if (name === "IEND") break;
    offset += 12 + length;
  }
  const channels = CHANNELS[type];
  if (!channels || depth !== 8 || interlace !== 0 || width === 0 || height === 0) throw new Error("unsupported PNG");
  if (type === 3 && !palette) throw new Error("palette missing");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  let previous = new Uint8Array(stride);
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / SAMPLES)));
  const pixels: Pixel[] = [];
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start]!;
    const row = new Uint8Array(raw.subarray(start + 1, start + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? row[i - channels]! : 0;
      const up = previous[i]!;
      const corner = i >= channels ? previous[i - channels]! : 0;
      if (filter === 1) row[i] = (row[i]! + left) & 255;
      else if (filter === 2) row[i] = (row[i]! + up) & 255;
      else if (filter === 3) row[i] = (row[i]! + ((left + up) >> 1)) & 255;
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - corner);
        row[i] = (row[i]! + (pa <= pb && pa <= pc ? left : pb <= pc ? up : corner)) & 255;
      }
    }
    previous = row;
    if (y % step !== 0) continue;
    for (let x = 0; x < width; x += step) {
      const i = x * channels;
      if (type === 6) pixels.push([row[i]!, row[i + 1]!, row[i + 2]!, row[i + 3]!]);
      else if (type === 2) pixels.push([row[i]!, row[i + 1]!, row[i + 2]!, 255]);
      else if (type === 0) pixels.push([row[i]!, row[i]!, row[i]!, 255]);
      else if (type === 4) pixels.push([row[i]!, row[i]!, row[i]!, row[i + 1]!]);
      else {
        const index = row[i]!;
        const p = palette!;
        pixels.push([p[index * 3] ?? 0, p[index * 3 + 1] ?? 0, p[index * 3 + 2] ?? 0, transparency?.[index] ?? 255]);
      }
    }
  }
  return pixels;
}

const SVG_COLOR = /(?:fill|stroke|stop-color|color)\s*[=:]\s*["']?\s*(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|white|black)/g;

/** The colours an SVG names in its fills, strokes and gradient stops, once per mention. */
export function svgColors(source: string): Pixel[] {
  const colors: Pixel[] = [];
  for (const match of source.matchAll(SVG_COLOR)) {
    const pixel = parseCssColor(match[1]!);
    if (pixel) colors.push(pixel);
  }
  return colors;
}

function parseCssColor(value: string): Pixel | null {
  const text = value.trim().toLowerCase();
  if (text === "white") return [255, 255, 255, 255];
  if (text === "black") return [0, 0, 0, 255];
  if (text.startsWith("#")) {
    const hex = text.slice(1);
    const full = hex.length === 3 || hex.length === 4 ? [...hex].map((c) => c + c).join("") : hex;
    if (full.length !== 6 && full.length !== 8) return null;
    const channel = (at: number) => parseInt(full.slice(at, at + 2), 16);
    return [channel(0), channel(2), channel(4), full.length === 8 ? channel(6) : 255];
  }
  const parts = text.slice(text.indexOf("(") + 1, -1).split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null;
  const alpha = parts[3] === undefined ? 255 : parts[3] <= 1 ? Math.round(parts[3] * 255) : parts[3];
  return [parts[0]!, parts[1]!, parts[2]!, alpha];
}
