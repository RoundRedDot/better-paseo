/**
 * The viewer's pan and zoom arithmetic, held to the cases Paseo's own
 * zoomable viewport is tested against, plus the plugin's no-upscale fit.
 */
import { describe, expect, it } from "vitest";
import {
  FIT_TRANSFORM,
  clampTransform,
  fitContentSize,
  isPointInsideTransformedContent,
  panContent,
  zoomContentAtPoint,
} from "../../client/components/zoom-geometry";

const viewport = { width: 800, height: 600 };
const fittedContent = { width: 800, height: 400 };
const limits = { minScale: 1, maxScale: 8 };

describe("fitContentSize", () => {
  it("fits content inside the viewport without changing its aspect ratio", () => {
    expect(fitContentSize({ width: 1600, height: 800 }, viewport)).toEqual(fittedContent);
    expect(fitContentSize({ width: 400, height: 800 }, viewport)).toEqual({ width: 300, height: 600 });
  });

  it("leaves room for the padding", () => {
    expect(fitContentSize({ width: 1600, height: 800 }, viewport, { padding: 100 })).toEqual({
      width: 600,
      height: 300,
    });
  });

  it("keeps a small image at its own pixels when upscaling is off", () => {
    expect(fitContentSize({ width: 32, height: 16 }, viewport, { upscale: false })).toEqual({
      width: 32,
      height: 16,
    });
    expect(fitContentSize({ width: 1600, height: 800 }, viewport, { upscale: false })).toEqual(fittedContent);
  });
});

describe("isPointInsideTransformedContent", () => {
  it("tells backdrop presses from presses on the transformed picture", () => {
    const at = (x: number, y: number, transform = FIT_TRANSFORM) =>
      isPointInsideTransformedContent({ point: { x, y }, transform, fittedContent, viewport });
    expect(at(400, 300)).toBe(true);
    expect(at(400, 50)).toBe(false);
    expect(at(10, 10, { scale: 2, x: 0, y: 0 })).toBe(true);
  });
});

describe("transforms", () => {
  it("returns to the centred fit at the minimum scale", () => {
    expect(clampTransform({ scale: 0.5, x: 200, y: -200 }, fittedContent, viewport, limits)).toEqual(
      FIT_TRANSFORM,
    );
  });

  it("zooms below fit without inventing an offset", () => {
    expect(
      clampTransform({ scale: 0.25, x: 100, y: 100 }, fittedContent, viewport, { minScale: 0.25, maxScale: 8 }),
    ).toEqual({ scale: 0.25, x: 0, y: 0 });
  });

  it("keeps the content under the cursor while zooming", () => {
    expect(
      zoomContentAtPoint({
        transform: FIT_TRANSFORM,
        scale: 2,
        focalPoint: { x: 600, y: 300 },
        fittedContent,
        viewport,
        limits,
      }),
    ).toEqual({ scale: 2, x: -200, y: 0 });
  });

  it("clamps panning to the scaled content's edges", () => {
    expect(
      panContent({ transform: { scale: 2, x: 0, y: 0 }, delta: { x: 900, y: -900 }, fittedContent, viewport, limits }),
    ).toEqual({ scale: 2, x: 400, y: -100 });
  });
});
