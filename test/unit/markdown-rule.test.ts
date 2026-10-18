import { describe, expect, it, vi } from "vitest";

// A reply's `---` is one device pixel thick, and neither of the two obvious ways
// to ask for that works on the web: React Native Web answers
// `StyleSheet.hairlineWidth` with a whole CSS pixel, and Chromium snaps a
// sub-pixel height up to a whole one too, so both paint two device pixels on a
// dense display. The web rule is drawn a pixel tall and scaled on the way to the
// compositor, which does paint a single one.

vi.mock("react-native", async () => import("./helpers/rn-mock"));

const { PixelRatio, StyleSheet } = await import("react-native");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { buildStyles, variantMetrics } = await import("../../client/components/markdown/render/styles");
const { DEFAULT_PREFERENCES } = await import("../../client/preferences");

const COLORS = {
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ededef", border: "#e2e2e6",
  foreground: "#18181b", foregroundMuted: "#62626b", accent: "#20744A", accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d92d20",
};

function rule(platform: "ios" | "android" | "web") {
  const tokens = buildThemeTokens(COLORS, DEFAULT_PREFERENCES, { platform });
  const styles = buildStyles(tokens, "document", variantMetrics("document", 15));
  return styles.rule as Record<string, unknown>;
}

describe("the markdown rule", () => {
  it("is the host's hairline on a phone", () => {
    for (const platform of ["ios", "android"] as const) {
      const style = rule(platform);
      expect(style.height).toBe(StyleSheet.hairlineWidth);
      expect(style.transform).toBeUndefined();
    }
  });

  it("is scaled to one device pixel on the web, where the host's hairline is a full one", () => {
    // React Native Web reports a whole CSS pixel, whatever the display.
    expect(StyleSheet.hairlineWidth).toBe(1);
    const style = rule("web");
    expect(style.height).toBe(1);
    // Scaled about an edge: Chromium then lands the line on the pixel grid.
    expect(style.transformOrigin).toBe("top");
    const [transform] = style.transform as { scaleY: number }[];
    expect(transform?.scaleY).toBe(1 / PixelRatio.get());
    expect(transform?.scaleY).toBeLessThan(1);
  });

  it("keeps its fill", () => {
    expect(rule("web").backgroundColor).toBe(COLORS.border);
  });
});
