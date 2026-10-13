import { describe, expect, it, vi } from "vitest";

// Off the web an inline code span has no fill (it would cover the whole line
// box), so its colour is what sets it apart: the colour picked in the plugin
// settings, dark grey by default, whatever the accent. The span follows the
// tokens' platform, not the running one, so the settings page can preview a
// phone on the web.

vi.mock("react-native", async () => import("./helpers/rn-mock"));

const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { buildStyles, variantMetrics } = await import("../../client/components/markdown/render/styles");
const { DEFAULT_PREFERENCES, INLINE_CODE_PALETTE } = await import("../../client/preferences");
type InlineCodeColor = import("../../client/preferences").InlineCodeColorPreference;
type Platform = "ios" | "android" | "web";

const LIGHT = {
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ededef", border: "#e2e2e6",
  foreground: "#18181b", foregroundMuted: "#62626b", accent: "#20744A", accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d92d20",
};
const DARK = { ...LIGHT, surface0: "#0b0b0c", foreground: "#fafafa" };

function codeSpan(inlineCodeColor: InlineCodeColor, { quiet = false, colors = LIGHT, platform = "ios" as Platform } = {}) {
  const tokens = buildThemeTokens(colors, { ...DEFAULT_PREFERENCES, inlineCodeColor }, { platform });
  return buildStyles(tokens, "document", variantMetrics("document", 15), quiet).codeSpan;
}

describe("inline code colour on native", () => {
  it("is dark grey by default", () => {
    const style = codeSpan(DEFAULT_PREFERENCES.inlineCodeColor);
    // #18181b moved 15% towards the white surface: opaque, not rgba.
    expect(style.color).toBe("#3b3b3d");
    expect(style.backgroundColor).toBeUndefined();
  });

  it("does not follow a picked accent", () => {
    const tokens = buildThemeTokens(LIGHT, { ...DEFAULT_PREFERENCES, accent: "violet" }, { platform: "ios" });
    expect(tokens.codeInline).toBe("#3b3b3d");
  });

  it("takes the colour picked in the plugin settings, in the theme's shade", () => {
    expect(codeSpan("blue", { platform: "android" }).color).toBe(INLINE_CODE_PALETTE.blue.light);
    expect(codeSpan("coral", { platform: "android" }).color).toBe(INLINE_CODE_PALETTE.coral.light);
    expect(codeSpan("blue", { colors: DARK }).color).toBe(INLINE_CODE_PALETTE.blue.dark);
  });

  it("is a light grey on a dark theme", () => {
    // #fafafa moved 15% towards #0b0b0c.
    expect(codeSpan("grey", { colors: DARK }).color).toBe("#d6d6d6");
  });

  it("is semibold off the web", () => {
    expect(codeSpan("grey", { platform: "ios" }).fontWeight).toBe("600");
    expect(codeSpan("grey", { platform: "android" }).fontWeight).toBe("600");
    expect(codeSpan("grey", { platform: "web" }).fontWeight).toBeUndefined();
  });

  it("keeps the weight of a heading or strong run it sits in", () => {
    const tokens = buildThemeTokens(LIGHT, DEFAULT_PREFERENCES, { platform: "ios" });
    const styles = buildStyles(tokens, "document", variantMetrics("document", 15));
    expect(styles.codeSpanBold.fontWeight).toBeUndefined();
    expect(styles.codeSpanBold.color).toBe(styles.codeSpan.color);
  });

  it("stays the muted prose colour in a quiet reply", () => {
    expect(codeSpan("violet", { quiet: true }).color).toBe(LIGHT.foregroundMuted);
  });

  it("keeps the filled chip on the web", () => {
    const style = codeSpan("violet", { platform: "web" });
    expect(style.backgroundColor).toBeDefined();
    expect(style.color).toBe(LIGHT.foreground);
  });
});
