import { afterEach, describe, expect, it } from "vitest";
import { createMathRenderer } from "../../server/math/render";

const renderOptions = { color: "#202124", fontSize: 16, scale: 2, display: true } as const;
let renderer: ReturnType<typeof createMathRenderer> | undefined;
afterEach(() => { renderer?.dispose(); renderer = undefined; });

describe("daemon display math renderer", () => {
  it("rasterizes a closed surface integral and a Chinese label using the bundled fonts", async () => {
    renderer = createMathRenderer();
    const tex = String.raw`\oiint_{\partial V} \mathbf D\cdot\mathrm d\mathbf S = Q \quad \text{总电荷}`;
    const result = await renderer.render({ ...renderOptions, tex });
    expect(result).toMatchObject({ ok: true, width: expect.any(Number), height: expect.any(Number) });
    if (!result.ok) return;
    const png = Buffer.from(result.uri.split(",")[1]!, "base64");
    expect(png.readUInt32BE(0)).toBe(0x89504e47);
    expect(png.readUInt32BE(16)).toBe(result.width * 2);
    expect(png.readUInt32BE(20)).toBe(result.height * 2);
    expect(await renderer.render({ ...renderOptions, tex })).toBe(result);
  });

  it("reports an unknown command so the reply can retain its source", async () => {
    renderer = createMathRenderer();
    expect(await renderer.render({ ...renderOptions, tex: String.raw`\unknownFormula{x}` }))
      .toMatchObject({ ok: false, code: "unknown-command" });
  });

  it("rejects oversize input before rendering", async () => {
    renderer = createMathRenderer();
    expect(await renderer.render({ ...renderOptions, tex: "x".repeat(4097) }))
      .toMatchObject({ ok: false, code: "limit" });
  });
});
