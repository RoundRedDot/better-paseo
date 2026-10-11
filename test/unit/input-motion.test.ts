import { describe, expect, it, vi } from "vitest";

// `use-input-capabilities.ts` reads `Platform.OS` at load; the real package is
// Flow source that Node cannot parse, so it is replaced by the one field used.
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

const { resolveCapabilities } = await import("../../client/ui/use-input-capabilities");
const { motionDuration, outCubic, runningDot, duration } = await import("../../client/ui/tokens/motion");

describe("resolveCapabilities", () => {
  const base = { compact: false, hoverMedia: false, coarseMedia: false, nativeHoverSeen: false };

  it("desktop browser / Electron: hover, no touch", () => {
    expect(resolveCapabilities({ ...base, native: false, hoverMedia: true })).toMatchObject({
      hover: true,
      touch: false,
      native: false,
    });
  });

  it("phone browser: touch, no hover, although the platform is web", () => {
    expect(resolveCapabilities({ ...base, native: false, coarseMedia: true, compact: true })).toEqual({
      hover: false,
      touch: true,
      compact: true,
      native: false,
    });
  });

  it("a web device with neither signal still gets the touch entries", () => {
    expect(resolveCapabilities({ ...base, native: false }).touch).toBe(true);
  });

  it("native: touch always; hover only after a real hover", () => {
    expect(resolveCapabilities({ ...base, native: true })).toMatchObject({ hover: false, touch: true });
    expect(resolveCapabilities({ ...base, native: true, nativeHoverSeen: true })).toMatchObject({
      hover: true,
      touch: true,
    });
  });
});

describe("motion tokens", () => {
  it("fast is 120 ms, and 0 under reduced motion", () => {
    expect(duration.fast).toBe(120);
    expect(motionDuration(duration.fast, false)).toBe(120);
    expect(motionDuration(duration.fast, true)).toBe(0);
  });

  it("out-cubic starts at 0, ends at 1 and decelerates", () => {
    expect(outCubic(0)).toBe(0);
    expect(outCubic(1)).toBe(1);
    expect(outCubic(0.5)).toBeCloseTo(0.875);
  });

  it("running dot pulses 1.0 <-> 0.3 over 1200 ms at 6px", () => {
    expect(runningDot).toEqual({ size: 6, periodMs: 1200, minOpacity: 0.3, maxOpacity: 1 });
  });
});
