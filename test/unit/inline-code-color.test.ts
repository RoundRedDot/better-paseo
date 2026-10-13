import { afterEach, describe, expect, it, vi } from "vitest";

// Off the web an inline code span has no fill (it would cover the whole line
// box), so its colour is what sets it apart: the accent the reader picked in
// the plugin settings, dark grey by default, whatever the accent.

vi.mock("react-native", async () => import("./helpers/rn-mock"));

const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { buildStyles, variantMetrics } = await import("../../client/components/markdown/render/styles");
const { DEFAULT_PREFERENCES, INLINE_CODE_PALETTE } = await import("../../client/preferences");
type InlineCodeColor = import("../../client/preferences").InlineCodeColorPreference;

const LIGHT = {
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ededef", border: "#e2e2e6",
  foreground: "#18181b", foregroundMuted: "#62626b", accent: "#20744A", accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d92d20",
};

const DARK = { ...LIGHT, surface0: "#0b0b0c", foreground: "#fafafa" };

function codeSpan(inlineCodeColor: InlineCodeColor, quiet = false, colors = LIGHT) {
  const tokens = buildThemeTokens(colors, { ...DEFAULT_PREFERENCES, inlineCodeColor }, { platform: "ios" });
  return buildStyles(tokens, "document", variantMetrics("document", 15), quiet).codeSpan;
}

function setOS(os: string) {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
}

afterEach(() => {
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

describe("inline code colour on native", () => {
  it("is dark grey by default", () => {
    setOS("ios");
    const style = codeSpan(DEFAULT_PREFERENCES.inlineCodeColor);
    // #18181b moved 15% towards the white surface: opaque, not rgba.
    expect(style.color).toBe("#3b3b3d");
    expect(style.backgroundColor).toBeUndefined();
  });

  it("does not follow a picked accent", () => {
    setOS("ios");
    const tokens = buildThemeTokens(LIGHT, { ...DEFAULT_PREFERENCES, accent: "violet" }, { platform: "ios" });
    expect(tokens.codeInline).toBe("#3b3b3d");
  });

  it("takes the colour picked in the plugin settings, in the theme's shade", () => {
    setOS("android");
    expect(codeSpan("blue").color).toBe(INLINE_CODE_PALETTE.blue.light);
    expect(codeSpan("coral").color).toBe(INLINE_CODE_PALETTE.coral.light);
    expect(codeSpan("blue", false, DARK).color).toBe(INLINE_CODE_PALETTE.blue.dark);
  });

  it("is a light grey on a dark theme", () => {
    setOS("ios");
    // #fafafa moved 15% towards #0b0b0c.
    expect(codeSpan("grey", false, DARK).color).toBe("#d6d6d6");
  });

  it("is semibold off the web", () => {
    setOS("ios");
    expect(codeSpan("grey").fontWeight).toBe("600");
    setOS("android");
    expect(codeSpan("grey").fontWeight).toBe("600");
    setOS("web");
    expect(codeSpan("grey").fontWeight).toBeUndefined();
  });

  it("keeps the weight of a heading or strong run it sits in", () => {
    setOS("ios");
    const tokens = buildThemeTokens(LIGHT, DEFAULT_PREFERENCES, { platform: "ios" });
    const styles = buildStyles(tokens, "document", variantMetrics("document", 15));
    expect(styles.codeSpanBold.fontWeight).toBeUndefined();
    expect(styles.codeSpanBold.color).toBe(styles.codeSpan.color);
  });

  it("stays the muted prose colour in a quiet reply", () => {
    setOS("ios");
    expect(codeSpan("violet", true).color).toBe(LIGHT.foregroundMuted);
  });

  it("keeps the filled chip on the web", () => {
    setOS("web");
    const style = codeSpan("violet");
    expect(style.backgroundColor).toBeDefined();
    expect(style.color).toBe(LIGHT.foreground);
  });
});
