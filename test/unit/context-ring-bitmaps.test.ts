import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CONTEXT_RING_BITMAPS } from "../../client/tasks/cards/context-ring-bitmaps";

/** Decode our generated 8-bit RGBA PNGs without adding a test dependency. */
function pixels(uri: string) {
  const png = Buffer.from(uri.split(",")[1]!, "base64");
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect([png[24], png[25], png[28]]).toEqual([8, 6, 0]);
  const chunks: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    if (png.toString("ascii", at + 4, at + 8) === "IDAT") chunks.push(png.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    expect(filter).toBeLessThanOrEqual(4);
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const left = x >= 4 ? data[at - 4]! : 0;
      const above = y > 0 ? data[at - stride]! : 0;
      const corner = x >= 4 && y > 0 ? data[at - stride - 4]! : 0;
      const p = left + above - corner;
      const dl = Math.abs(p - left), da = Math.abs(p - above), dc = Math.abs(p - corner);
      const paeth = dl <= da && dl <= dc ? left : da <= dc ? above : corner;
      const predict = [0, left, above, Math.floor((left + above) / 2), paeth][filter]!;
      data[at] = (raw[y * (stride + 1) + 1 + x]! + predict) & 255;
    }
  }
  return { width, height, alpha: (x: number, y: number) => data[(y * width + x) * 4 + 3]! };
}

describe("antialiased context ring PNGs", () => {
  it.each(["card", "subtask"] as const)("%s has transparent gutters and clockwise round arcs at 4x resolution", (variant) => {
    const bitmap = CONTEXT_RING_BITMAPS[variant];
    const image = pixels(bitmap.uri);
    const cell = (bitmap.size + 2 * bitmap.padding) * bitmap.scale;
    expect(bitmap.scale).toBe(4);
    expect(image.width).toBe(cell * bitmap.columns);
    expect(image.height).toBe(cell * bitmap.rows);
    // An oversized strip can be downsampled by Android even with 4x source masks.
    expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(1024);
    expect(bitmap.columns * bitmap.rows).toBeGreaterThanOrEqual(bitmap.frames);
    const center = cell / 2;
    const stroke = variant === "card" ? 2 : 1.5;
    const radius = (bitmap.size - stroke) * bitmap.scale / 2;
    const alpha = (percent: number, x: number, y: number) => image.alpha(
      percent % bitmap.columns * cell + Math.floor(x),
      Math.floor(percent / bitmap.columns) * cell + Math.floor(y),
    );
    expect([0, 25, 50, 75, 100].map((percent) => alpha(percent, center, center))).toEqual([0, 0, 0, 0, 0]);
    expect([0, 25, 50, 75, 100].map((percent) => alpha(percent, center + radius, center))).toEqual([0, 255, 255, 255, 255]);
    expect([0, 25, 50, 75, 100].map((percent) => alpha(percent, center, center + radius))).toEqual([0, 0, 255, 255, 255]);
    expect([0, 25, 50, 75, 100].map((percent) => alpha(percent, center - radius, center))).toEqual([0, 0, 0, 255, 255]);
    let antialiased = false;
    for (let percent = 0; percent <= 100; percent++) {
      for (let y = 0; y < cell; y++) {
        expect(alpha(percent, 0, y)).toBe(0);
        expect(alpha(percent, cell - 1, y)).toBe(0);
        expect(alpha(percent, y, 0)).toBe(0);
        expect(alpha(percent, y, cell - 1)).toBe(0);
        for (let x = 0; x < cell; x++) {
          const value = alpha(percent, x, y);
          if (value > 0 && value < 255) antialiased = true;
        }
      }
    }
    expect(antialiased).toBe(true);
  });
});
