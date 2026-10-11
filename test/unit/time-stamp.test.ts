import { describe, expect, it } from "vitest";
import { formatStamp } from "../../client/ui/time";

describe("formatStamp", () => {
  const now = new Date(2026, 9, 11, 21, 30);
  it("shows HH:mm today, zero-padded", () => {
    expect(formatStamp(new Date(2026, 9, 11, 6, 47), now)).toBe("06:47");
    expect(formatStamp(new Date(2026, 9, 11, 18, 5), now)).toBe("18:05");
  });
  it("adds the date on another day and the year in another year", () => {
    expect(formatStamp(new Date(2026, 8, 16, 6, 47), now)).toBe("Sep 16, 06:47");
    expect(formatStamp(new Date(2025, 11, 31, 23, 59), now)).toBe("Dec 31 2025, 23:59");
  });
});
