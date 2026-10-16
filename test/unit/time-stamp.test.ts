import { describe, expect, it } from "vitest";
import { formatStamp, formatFooterStamp, formatFullStamp, formatDuration } from "../../client/ui/time";

it("always includes the full local date and seconds in timestamp hints", () => {
  expect(formatFullStamp(new Date(2026, 9, 15, 3, 4, 5))).toBe("2026-10-15 03:04:05");
  expect(formatFullStamp(new Date(2025, 0, 2, 0, 0, 0))).toBe("2025-01-02 00:00:00");
});

it("omits the current year and seconds with zero-padded local time", () => {
  const now = new Date(2026, 9, 15, 15, 30);
  expect(formatFooterStamp(new Date(2026, 0, 2, 3, 4, 5), now)).toBe("01-02 03:04");
  expect(formatFooterStamp(new Date(2025, 11, 31, 23, 59, 59), now)).toBe("2025-12-31 23:59");
  expect(formatFooterStamp(new Date(2027, 0, 2, 3, 4, 5), now)).toBe("2027-01-02 03:04");
});

it("omits today's date and seconds with zero-padded hours and minutes", () => {
  const now = new Date(2026, 9, 15, 15, 30);
  expect(formatFooterStamp(new Date(2026, 9, 15, 3, 4, 5), now)).toBe("03:04");
  expect(formatFooterStamp(new Date(2026, 9, 15, 0, 0, 0), now)).toBe("00:00");
});

it("compares the full local calendar date across midnight, month and year boundaries", () => {
  expect(formatFooterStamp(new Date(2026, 9, 15, 23, 59, 59), new Date(2026, 9, 16)))
    .toBe("10-15 23:59");
  expect(formatFooterStamp(new Date(2026, 8, 15, 3, 4, 5), new Date(2026, 9, 15)))
    .toBe("09-15 03:04");
  expect(formatFooterStamp(new Date(2025, 9, 15, 3, 4, 5), new Date(2026, 9, 15)))
    .toBe("2025-10-15 03:04");
});

it.each([[0, "0秒"], [999, "0秒"], [59000, "59秒"], [60000, "1分0秒"],
  [138000, "2分18秒"], [3600000, "1小时0分0秒"], [3661000, "1小时1分1秒"]] as const)(
  "formats %i milliseconds as %s", (ms, expected) => expect(formatDuration(ms)).toBe(expected),
);

it.each([
  [0, "0 秒", "0 s"],
  [999, "0 秒", "0 s"],
  [59000, "59 秒", "59 s"],
  [60000, "1 分 0 秒", "1 min 0 s"],
  [236999, "3 分 56 秒", "3 min 56 s"],
  [3600000, "1 小时 0 分 0 秒", "1 h 0 min 0 s"],
  [3661000, "1 小时 1 分 1 秒", "1 h 1 min 1 s"],
] as const)("formats %i milliseconds for localized hover hints", (ms, zh, en) => {
  expect(formatDuration(ms, "zh")).toBe(zh);
  expect(formatDuration(ms, "en")).toBe(en);
});

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
