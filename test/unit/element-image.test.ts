import { describe, expect, it } from "vitest";
import { imageScale } from "../../client/ui/element-image";

describe("table image scale", () => {
  it("keeps the requested scale while the canvas fits", () => {
    expect(imageScale(800, 400, 2)).toBe(2);
  });

  it("lowers it so a long table stays under the browser's canvas edge", () => {
    expect(imageScale(800, 12000, 2) * 12000).toBeLessThanOrEqual(16384);
    expect(imageScale(20000, 400, 3) * 20000).toBeLessThanOrEqual(16384);
  });
});
