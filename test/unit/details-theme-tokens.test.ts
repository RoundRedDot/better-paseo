import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", async () => import("./helpers/rn-mock"));

import { buildThemeTokens, mix } from "../../client/components/theme-tokens";
import { DEFAULT_PREFERENCES } from "../../client/preferences";

const LIGHT = {
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ededef", border: "#e2e2e6",
  foreground: "#18181b", foregroundMuted: "#62626b", accent: "#2563eb", accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d92d20",
};
const DARK = {
  ...LIGHT,
  surface0: "#0f0f11",
  foreground: "#f2f3f5",
  foregroundMuted: "#a3a6ad",
};

describe("details theme palette", () => {
  it("derives the light palette from the host theme", () => {
    const tokens = buildThemeTokens(LIGHT, DEFAULT_PREFERENCES, { platform: "web" });
    expect(tokens.details.accentSoft).toBe(mix(LIGHT.surface0, tokens.accent, 0.1));
    expect(tokens.details.grabber).toBe("rgba(98, 98, 107, 0.35)");
    expect(tokens.details.scrim).toBe("rgba(0, 0, 0, 0.2)");
    expect(tokens.details.shadow).toBe("0 8px 32px rgba(0, 0, 0, 0.12)");
  });

  it("uses the dark scrim, grabber, and shadow opacity", () => {
    const tokens = buildThemeTokens(DARK, DEFAULT_PREFERENCES, { platform: "web" });
    expect(tokens.details.accentSoft).toBe(mix(DARK.surface0, tokens.accent, 0.1));
    expect(tokens.details.grabber).toBe("rgba(163, 166, 173, 0.35)");
    expect(tokens.details.scrim).toBe("rgba(0, 0, 0, 0.5)");
    expect(tokens.details.shadow).toBe("0 8px 32px rgba(0, 0, 0, 0.5)");
  });
});
