import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { dominantColor, iconThemeColor, pngPixels, svgColors } from "../../server/tasks/icon-color";

type Rgba = [number, number, number, number];

/** A PNG of `rows` (RGBA, or RGB with `alpha: false`), each row written with `filter`. */
function png(rows: Rgba[][], { alpha = true, filter = 0 }: { alpha?: boolean; filter?: number } = {}): Buffer {
  const channels = alpha ? 4 : 3;
  const width = rows[0]!.length;
  const raw: number[] = [];
  let previous = new Array<number>(width * channels).fill(0);
  for (const row of rows) {
    const line = row.flatMap((pixel) => pixel.slice(0, channels));
    raw.push(filter);
    line.forEach((value, i) => {
      const left = i >= channels ? line[i - channels]! : 0;
      const up = previous[i]!;
      const corner = i >= channels ? previous[i - channels]! : 0;
      const p = left + up - corner;
      const paeth = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - corner) ? left : Math.abs(p - up) <= Math.abs(p - corner) ? up : corner;
      const predicted = [0, left, up, (left + up) >> 1, paeth][filter]!;
      raw.push((value - predicted) & 255);
    });
    previous = line;
  }
  const chunk = (name: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(name, 4, "latin1");
    return Buffer.concat([head, body, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(rows.length, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const ORANGE: Rgba = [255, 77, 35, 255];
const WHITE: Rgba = [255, 255, 255, 255];
const BLACK: Rgba = [0, 0, 0, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

/** An 8 x 8 icon: `ink` covers `share` of it, the rest is `ground`. */
function icon(ink: Rgba, ground: Rgba, share: number): Rgba[][] {
  return Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => (y * 8 + x < share * 64 ? ink : ground)));
}

describe("project icon theme colour", () => {
  it("decodes every PNG row filter back to the same pixels", () => {
    const rows: Rgba[][] = [
      [ORANGE, WHITE, [10, 200, 30, 255], CLEAR],
      [[1, 2, 3, 4], BLACK, ORANGE, [250, 5, 128, 200]],
      [WHITE, [99, 99, 99, 255], CLEAR, ORANGE],
    ];
    for (const filter of [0, 1, 2, 3, 4]) expect(pngPixels(png(rows, { filter }))).toEqual(rows.flat());
    expect(pngPixels(png(rows, { alpha: false, filter: 4 }))).toEqual(rows.flat().map(([r, g, b]) => [r, g, b, 255]));
  });

  it("takes a lively colour over a white or black ground once it covers enough of the icon", () => {
    // An orange mark on a white tile, and on a black one.
    expect(iconThemeColor(png(icon(ORANGE, WHITE, 0.25)).toString("base64"), "image/png")).toBe("#ff4d23");
    expect(iconThemeColor(png(icon(ORANGE, BLACK, 0.25)).toString("base64"), "image/png")).toBe("#ff4d23");
    // A few lively pixels in a black logo do not make it orange.
    expect(dominantColor(icon(ORANGE, BLACK, 1 / 64).flat())).toBe("#000000");
  });

  it("takes a plain logo's colour that is not white, and white only when there is nothing else", () => {
    // White glyph on a black tile (the Paseo logo): black.
    expect(dominantColor(icon(WHITE, BLACK, 0.7).flat())).toBe("#000000");
    // A grey mark on a white ground.
    expect(dominantColor(icon([90, 90, 96, 255], WHITE, 0.1).flat())).toBe("#5a5a60");
    expect(dominantColor(icon(WHITE, CLEAR, 0.5).flat())).toBe("#ffffff");
    // Nothing opaque: no colour.
    expect(dominantColor(icon(CLEAR, CLEAR, 1).flat())).toBeNull();
  });

  it("reads an SVG's named colours, once per mention", () => {
    const svg = `<svg><defs><linearGradient><stop stop-color="#2A8A5E"/><stop stop-color="#2a8a5e"/></linearGradient></defs>
      <rect fill="#fff"/><rect fill="#fff"/><path style="fill: rgb(0, 0, 0)"/><path fill="none" stroke="white"/><circle fill="#2A8A5E80"/></svg>`;
    expect(svgColors(svg)).toEqual([
      [42, 138, 94, 255],
      [42, 138, 94, 255],
      [255, 255, 255, 255],
      [255, 255, 255, 255],
      [0, 0, 0, 255],
      [255, 255, 255, 255],
      [42, 138, 94, 128],
    ]);
    expect(iconThemeColor(Buffer.from(svg).toString("base64"), "image/svg+xml")).toBe("#2a8a5e");
  });

  it("has no colour for what it cannot read", () => {
    expect(iconThemeColor(Buffer.from("img").toString("base64"), "image/png")).toBeNull();
    expect(iconThemeColor(png(icon(ORANGE, WHITE, 0.5)).toString("base64"), "image/jpeg")).toBeNull();
    // A data URI reads as its base64 body.
    expect(iconThemeColor(`data:image/png;base64,${png(icon(ORANGE, WHITE, 0.5)).toString("base64")}`, "image/png")).toBe("#ff4d23");
  });
});
