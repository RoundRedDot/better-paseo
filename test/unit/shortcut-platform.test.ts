import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));

const { isShortcutMac } = await import("../../client/tasks/open-shortcut");

describe("isShortcutMac", () => {
  it("prefers userAgentData.platform", () => {
    expect(isShortcutMac({ userAgentData: { platform: "macOS" }, userAgent: "Windows" })).toBe(true);
    expect(isShortcutMac({ userAgentData: { platform: "Windows" }, userAgent: "Macintosh" })).toBe(false);
    expect(isShortcutMac({ userAgentData: { platform: "Linux" } })).toBe(false);
  });

  it("falls back to the user agent, iPadOS's Mac one included", () => {
    expect(isShortcutMac({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15" })).toBe(true);
    expect(isShortcutMac({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" })).toBe(true);
    expect(isShortcutMac({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })).toBe(false);
  });

  it("is false without a user agent (React Native) or navigator", () => {
    expect(isShortcutMac({})).toBe(false);
    expect(isShortcutMac(null)).toBe(false);
  });
});
