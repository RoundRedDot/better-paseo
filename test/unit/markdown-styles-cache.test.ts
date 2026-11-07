import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));

import { PixelRatio, StyleSheet } from "react-native";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { buildStyles, MARKDOWN_VARIANTS, variantMetrics } from "../../client/components/markdown/render/styles";

const colors = {
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ededef", border: "#e2e2e6",
  foreground: "#18181b", foregroundMuted: "#62626b", accent: "#20744A", accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d92d20",
};

afterEach(() => vi.restoreAllMocks());

describe("shared Markdown styles", () => {
  it.each(MARKDOWN_VARIANTS)("registers %s styles once across independently mounted rows", (variant) => {
    const first = buildThemeTokens(colors, undefined, { platform: "web" });
    const second = buildThemeTokens(colors, undefined, { platform: "web" });
    const create = vi.spyOn(StyleSheet, "create");
    const styles = buildStyles(first, variant, variantMetrics(variant, 17));
    const calls = create.mock.calls.length;
    expect(second).not.toBe(first);
    expect(buildStyles(second, variant, { ...variantMetrics(variant, 17) })).toBe(styles);
    expect(create.mock.calls.length).toBe(calls);
  });

  it("isolates theme, fonts, metrics, variant and quiet without changing previous styles", () => {
    const tokens = buildThemeTokens(colors, undefined, { platform: "ios" });
    const metrics = variantMetrics("document", 15);
    const first = buildStyles(tokens, "document", metrics);
    const original = structuredClone(first);
    const changes = [
      buildStyles({ ...tokens, foreground: "#112233" }, "document", metrics),
      buildStyles({ ...tokens, fontUi: "Other UI", fontMono: "Other Mono" }, "document", metrics),
      buildStyles(tokens, "document", variantMetrics("document", 20)),
      buildStyles(tokens, "terminal", metrics),
      buildStyles(tokens, "document", metrics, true),
      buildStyles({ ...tokens, codeInline: "#334455" }, "document", metrics),
      buildStyles({ ...tokens, v2: { ...tokens.v2, surface1: "#aabbcc" } }, "document", metrics),
    ];
    for (const changed of changes) expect(changed).not.toBe(first);
    expect(changes[0]!.paragraph.color).toBe("#112233");
    expect(changes[1]!.paragraph.fontFamily).toBe("Other UI");
    expect(changes[1]!.codeSpan.fontFamily).toBe("Other Mono");
    expect(changes[2]!.paragraph.fontSize).toBe(20);
    expect(changes[3]!.h1.color).toBe(tokens.accent);
    expect(changes[4]!.paragraph.color).toBe(tokens.foregroundMuted);
    expect(changes[5]!.codeSpan.color).toBe("#334455");
    expect(changes[6]!.insight.backgroundColor).toBe("#aabbcc");
    expect(first).toEqual(original);
    expect(buildStyles(tokens, "document", metrics)).toBe(first);
  });

  it("keeps mobile previews and display densities separate", () => {
    const tokens = buildThemeTokens(colors, undefined, { platform: "web" });
    const metrics = variantMetrics("document", 15);
    vi.spyOn(PixelRatio, "get").mockReturnValue(2);
    const web = buildStyles(tokens, "document", metrics);
    const ios = buildStyles({ ...tokens, platform: "ios" }, "document", metrics);
    expect(ios).not.toBe(web);
    expect(ios.codeSpan.backgroundColor).toBeUndefined();
    expect(web.codeSpan.backgroundColor).toBeDefined();
    vi.mocked(PixelRatio.get).mockReturnValue(3);
    const dense = buildStyles(tokens, "document", metrics);
    expect(dense).not.toBe(web);
    expect(dense.rule.transform).toEqual([{ scaleY: 1 / 3 }]);
    expect(web.rule.transform).toEqual([{ scaleY: 1 / 2 }]);
  });

  it("bounds retained configurations while keeping recently used styles", () => {
    const tokens = buildThemeTokens(colors, undefined, { platform: "web" });
    const metrics = variantMetrics("document", 19);
    const first = buildStyles(tokens, "document", metrics);
    for (let index = 0; index < 80; index++) {
      buildStyles({ ...tokens, fontMono: `font-${index}` }, "document", metrics);
    }
    const recent = buildStyles({ ...tokens, fontMono: "font-79" }, "document", metrics);
    expect(buildStyles({ ...tokens, fontMono: "font-79" }, "document", metrics)).toBe(recent);
    expect(buildStyles(tokens, "document", metrics)).not.toBe(first);
  });
});
