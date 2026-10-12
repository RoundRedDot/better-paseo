import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, copyText: vi.fn(), useToast: () => ({ show: vi.fn(), error: vi.fn() }) };
});
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => () => Promise.resolve(null) }));
import { thumbnailFrame } from "../../client/components/image-preview";

// Yoga derives an aspect-ratio box's height from its 100% width before
// `maxWidth` narrows it, so the frame caps the height as well: both caps
// describe the same box.
describe("thumbnailFrame", () => {
  it("caps a tall screenshot's height, not only its width", () => {
    const frame = thumbnailFrame(637, 1400, 480);
    expect(frame.maxWidth).toBeCloseTo(218.4, 1);
    expect(frame.maxHeight).toBeCloseTo(480, 6);
    expect(frame.aspectRatio).toBeCloseTo(637 / 1400, 6);
    expect(frame.width).toBe("100%");
  });

  it("lets a wide image fill the column and caps it at its height limit", () => {
    const frame = thumbnailFrame(1920, 1080, 480);
    expect(frame.maxWidth).toBeCloseTo(853.3, 1);
    expect(frame.maxHeight).toBeCloseTo(480, 6);
  });

  it("never grows a small icon past its own pixels", () => {
    expect(thumbnailFrame(32, 32, 480)).toMatchObject({ maxWidth: 32, maxHeight: 32 });
  });

  it("fits the smaller preview limit", () => {
    const frame = thumbnailFrame(637, 1400, 220);
    expect(frame.maxHeight).toBeCloseTo(220, 6);
    expect(frame.maxWidth).toBeCloseTo(100.1, 1);
  });
});
