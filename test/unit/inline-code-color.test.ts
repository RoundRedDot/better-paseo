import { afterEach, describe, expect, it, vi } from "vitest";

// Off the web an inline code span has no fill (it would cover the whole line
// box), so its colour is what sets it apart: the accent the reader picked in
// the plugin settings, dark grey while the accent follows Paseo.

vi.mock("react-native", async () => import("./helpers/rn-mock"));

const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { buildStyles, variantMetrics } = await import("../../client/components/markdown/render/styles");
const { ACCENT_PRESETS, DEFAULT_PREFERENCES } = await import("../../client/preferences");

const LIGHT = {
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ededef", border: "#e2e2e6",
  foreground: "#18181b", foregroundMuted: "#62626b", accent: "#20744A", accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d92d20",
};

function codeSpan(accent: keyof typeof ACCENT_PRESETS, quiet = false) {
  const tokens = buildThemeTokens(LIGHT, { ...DEFAULT_PREFERENCES, accent }, { platform: "ios" });
  return buildStyles(tokens, "document", variantMetrics("document", 15), quiet).codeSpan;
}

function setOS(os: string) {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
}

afterEach(() => {
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

describe("inline code colour on native", () => {
  it("is dark grey, not Paseo's accent, while the accent follows Paseo", () => {
    setOS("ios");
    const style = codeSpan("host");
    expect(style.color).toBe("rgba(24, 24, 27, 0.75)");
    expect(style.backgroundColor).toBeUndefined();
  });

  it("takes the accent picked in the plugin settings", () => {
    setOS("android");
    expect(codeSpan("violet").color).toBe(ACCENT_PRESETS.violet);
    expect(codeSpan("jade").color).toBe(ACCENT_PRESETS.jade);
  });

  it("is semibold off the web", () => {
    setOS("ios");
    expect(codeSpan("host").fontWeight).toBe("600");
    setOS("android");
    expect(codeSpan("host").fontWeight).toBe("600");
    setOS("web");
    expect(codeSpan("host").fontWeight).toBeUndefined();
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
