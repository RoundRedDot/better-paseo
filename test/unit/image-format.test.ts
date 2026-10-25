import { describe, expect, it } from "vitest";
import { formatImageBytes } from "../../client/components/image-format";

describe("formatImageBytes", () => {
  it.each([
    [0, "0 B"],
    [1, "1 B"],
    [512, "512 B"],
    [1023, "1023 B"],
    [1024, "1 KB"],
    [1535, "1 KB"],
    [1536, "2 KB"],
    [1537, "2 KB"],
    [12_288, "12 KB"],
    [1_048_575, "1024 KB"],
    [1_048_576, "1.0 MB"],
    [1_572_864, "1.5 MB"],
    [2_097_152, "2.0 MB"],
    [1_073_741_824, "1024.0 MB"],
  ])("formats %i bytes as %s", (bytes, expected) => {
    expect(formatImageBytes(bytes)).toBe(expected);
  });
});
