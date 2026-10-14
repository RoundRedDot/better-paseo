import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import {
  blockMetrics,
  blockProseBase,
  DEFAULT_WEB_MONO_STACK,
  EMBEDDED_FAMILY,
  HOST_DEFAULT_WEB_MONO,
  interfaceFamily,
  lineHeightFor,
  proseScale,
  readHostTypography,
  resolveTypography,
  type TypographyPlatform,
  type TypographyPreferences,
} from "../../client/ui/tokens/typography";

const follow: TypographyPreferences = {
  uiFont: "host",
  monoFont: "host",
  customMonoFont: "",
  codeFontSize: null,
};
const custom: TypographyPreferences = { ...follow, monoFont: "custom", customMonoFont: "Menlo" };

const noHost = { colors: {} };
const withHost = {
  colors: {},
  typography: {
    fontFamily: { ui: "Geist", mono: '"JetBrains Mono", monospace' },
    fontSize: { ui: 14, content: 17, code: 13 },
    lineHeight: { code: 20 },
  },
};

const PLATFORMS: TypographyPlatform[] = ["web", "ios", "android"];
const SETTINGS = { follow, custom } as const;
const THEMES = { noHost, withHost } as const;

/**
 * Expected mono family for every platform x setting x host combination
 * (plan §3.10 item 2). `starts` is the first family of the value.
 */
const EXPECTED: Record<
  TypographyPlatform,
  Record<keyof typeof SETTINGS, Record<keyof typeof THEMES, { starts: string; single?: boolean }>>
> = {
  web: {
    // Without H1, Paseo's own default stack, never the embedded face.
    follow: { noHost: { starts: HOST_DEFAULT_WEB_MONO }, withHost: { starts: '"JetBrains Mono"' } },
    custom: { noHost: { starts: '"Menlo"' }, withHost: { starts: '"Menlo"' } },
  },
  ios: {
    follow: { noHost: { starts: "ui-monospace", single: true }, withHost: { starts: '"JetBrains Mono"' } },
    custom: { noHost: { starts: "Menlo", single: true }, withHost: { starts: "Menlo", single: true } },
  },
  android: {
    follow: { noHost: { starts: "monospace", single: true }, withHost: { starts: '"JetBrains Mono"' } },
    // Menlo does not exist on Android: not in the platform list, so ignored.
    custom: { noHost: { starts: "monospace", single: true }, withHost: { starts: '"JetBrains Mono"' } },
  },
};

describe("resolveTypography: 3 platforms x 2 settings x host typography", () => {
  for (const platform of PLATFORMS) {
    for (const [settingName, prefs] of Object.entries(SETTINGS)) {
      for (const [themeName, theme] of Object.entries(THEMES)) {
        it(`${platform} / ${settingName} / ${themeName}`, () => {
          const result = resolveTypography(theme, prefs, platform);
          const expected =
            EXPECTED[platform][settingName as keyof typeof SETTINGS][themeName as keyof typeof THEMES];
          expect(result.mono.family.startsWith(expected.starts)).toBe(true);
          if (expected.single) expect(result.mono.family).toBe(expected.starts);
          expect(result.fromHost).toBe(themeName === "withHost");
          if (platform !== "web") {
            // Native never sees an embedded face or a CSS stack.
            expect(result.mono.family).not.toContain("OMP");
            expect(result.ui.family ?? "").not.toContain("OMP");
          } else {
            expect(result.mono.family).toContain('"PingFang SC"');
          }
        });
      }
    }
  }
});

describe("resolveTypography details", () => {
  it("follows Paseo's default web stack exactly, code blocks included, when the host shares no typography", () => {
    expect(HOST_DEFAULT_WEB_MONO).toBe(
      "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    );
    const result = resolveTypography(noHost, follow, "web");
    expect(result.mono.family).toBe(DEFAULT_WEB_MONO_STACK);
    expect(result.mono.family.startsWith(`${HOST_DEFAULT_WEB_MONO}, "PingFang SC"`)).toBe(true);
    expect(result.mono.family).not.toContain("OMP");
  });

  it("builds a custom web stack on top of the follow value and strips stray quotes", () => {
    const result = resolveTypography(noHost, { ...follow, monoFont: "custom", customMonoFont: 'Fira "Code"' }, "web");
    expect(result.mono.family).toBe(`"Fira Code", ${DEFAULT_WEB_MONO_STACK}`);
    const empty = resolveTypography(noHost, { ...follow, monoFont: "custom", customMonoFont: "  " }, "web");
    expect(empty.mono.family).toBe(DEFAULT_WEB_MONO_STACK);
  });

  it("only honours native custom fonts from the platform list", () => {
    expect(resolveTypography(noHost, { ...custom, customMonoFont: "Courier New" }, "ios").mono.family).toBe(
      "Courier New",
    );
    expect(resolveTypography(noHost, { ...custom, customMonoFont: "Iosevka" }, "ios").mono.family).toBe(
      "ui-monospace",
    );
    expect(resolveTypography(noHost, { ...custom, customMonoFont: "monospace" }, "android").mono.family).toBe(
      "monospace",
    );
  });

  it("sizes code at 12 by default, the host size when given, the preference over both", () => {
    expect(resolveTypography(noHost, follow, "web").mono).toMatchObject({ size: 12, lineHeight: 18 });
    expect(resolveTypography(withHost, follow, "web").mono).toMatchObject({ size: 13, lineHeight: 20 });
    expect(resolveTypography(withHost, { ...follow, codeFontSize: 16 }, "web").mono).toMatchObject({
      size: 16,
      lineHeight: 24,
    });
    expect(resolveTypography(noHost, { ...follow, codeFontSize: 40 }, "ios").mono.size).toBe(22);
    expect(resolveTypography(noHost, { ...follow, codeFontSize: 4 }, "ios").mono.size).toBe(10);
    expect(resolveTypography(noHost, { ...follow, codeFontSize: 13 }, "ios").mono.lineHeight).toBe(20);
  });

  it("resolves the interface family per setting", () => {
    expect(resolveTypography(noHost, follow, "web").ui.family).toBeUndefined();
    expect(resolveTypography(withHost, follow, "web").ui.family?.startsWith("Geist")).toBe(true);
    expect(resolveTypography(withHost, follow, "ios").ui.family).toBe("Geist");
    expect(resolveTypography(noHost, { ...follow, uiFont: "inter" }, "web").ui.family?.startsWith('"OMP Inter"')).toBe(
      true,
    );
    expect(resolveTypography(noHost, { ...follow, uiFont: "inter" }, "android").ui.family).toBeUndefined();
    expect(resolveTypography(noHost, { ...follow, uiFont: "system" }, "web").ui.family).toBe("System");
    expect(resolveTypography(noHost, { ...follow, uiFont: "system" }, "ios").ui.family).toBeUndefined();
  });

  it("takes content size from the host, else the host's platform default", () => {
    expect(resolveTypography(noHost, follow, "web").content).toEqual({ size: 15, lineHeight: 23 });
    expect(resolveTypography(noHost, follow, "ios").content.size).toBe(16);
    expect(resolveTypography(withHost, follow, "android").content.size).toBe(17);
  });

  it("uses a stored content size on every platform, and drops Android's placeholder UI family", () => {
    const stored = { contentFontSize: 13 };
    expect(resolveTypography(noHost, follow, "android", stored).content).toEqual({ size: 13, lineHeight: 20 });
    expect(resolveTypography(noHost, follow, "web", stored).content.size).toBe(13);
    const normal = {
      typography: { fontFamily: { ui: "normal", mono: "monospace" }, fontSize: { content: 14 } },
    };
    expect(resolveTypography(normal, follow, "android").ui.family).toBeUndefined();
    expect(interfaceFamily(resolveTypography(normal, follow, "android"), "host", "android")).toBeUndefined();
    expect(resolveTypography(normal, follow, "android").content.size).toBe(14);
    expect(resolveTypography(normal, follow, "ios").ui.family).toBe("normal");
    expect(
      resolveTypography({ typography: { fontFamily: { ui: "Roboto, sans-serif" } } }, follow, "android").ui.family,
    ).toBeUndefined();
    expect(resolveTypography({ typography: { fontFamily: { ui: "Roboto" } } }, follow, "android").ui.family).toBe(
      "Roboto",
    );
  });

  it("keeps the fixed UI scale", () => {
    expect(resolveTypography(noHost, follow, "web").ui.scale).toEqual({
      base: 12,
      md: 13,
      lg: 14,
      xl: 16,
    });
  });

  it("rounds line height to 1.5x", () => {
    expect(lineHeightFor(11)).toBe(17);
    expect(lineHeightFor(22)).toBe(33);
  });

  it("keeps block text at the built-in row sizes until the reader changes it", () => {
    const block = resolveTypography(noHost, follow, "web").block;
    expect(block).toMatchObject({
      size: 13,
      delta: 0,
      label: { size: 13, lineHeight: 18 },
      target: { size: 12, lineHeight: 18 },
      meta: { size: 12, lineHeight: 16 },
      rowHeight: { desktop: 26, compact: 28 },
    });
    expect(block.caption).toEqual(block.meta);
    expect(block.button).toEqual(block.label);
    expect(blockMetrics(16)).toMatchObject({
      size: 16,
      delta: 3,
      label: { size: 16, lineHeight: 22 },
      target: { size: 15, lineHeight: 22 },
      meta: { size: 15, lineHeight: 20 },
      rowHeight: { desktop: 30, compact: 32 },
    });
    expect(blockMetrics(4).size).toBe(9);
    expect(blockMetrics(9)).toMatchObject({ size: 9, target: { size: 9 }, meta: { size: 9 } });
    expect(blockMetrics(12).target.size).toBe(11);
    const grown = resolveTypography(noHost, { ...follow, blockFontSize: 16 }, "web");
    expect(blockProseBase(grown)).toBe(grown.content.size + 3);
    expect(blockProseBase(resolveTypography(noHost, follow, "web"))).toBe(15);
  });
});

describe("proseScale", () => {
  it("derives integer reading sizes from the host body size", () => {
    expect(proseScale(15)).toEqual({
      h1: { size: 22, lineHeight: 28 },
      h2: { size: 18, lineHeight: 24 },
      h3: { size: 16, lineHeight: 22 },
      body: { size: 15, lineHeight: 22 },
      secondary: { size: 14, lineHeight: 20 },
      small: { size: 13, lineHeight: 18 },
      code: { size: 13, lineHeight: 20 },
    });
    expect(proseScale(16)).toMatchObject({
      h1: { size: 24, lineHeight: 30 },
      h2: { size: 20, lineHeight: 26 },
      h3: { size: 17, lineHeight: 24 },
      body: { size: 16, lineHeight: 24 },
    });
  });

  it("never yields a fractional size or line height", () => {
    for (let b = 11; b <= 22; b += 0.5) {
      for (const step of Object.values(proseScale(b))) {
        expect(Number.isInteger(step.size)).toBe(true);
        expect(Number.isInteger(step.lineHeight)).toBe(true);
      }
      // Running text sits on the 2px grid; headings are size + 6.
      expect(proseScale(b).body.lineHeight % 2).toBe(0);
    }
  });
});

describe("readHostTypography", () => {
  it("detects the optional H1 field and ignores unusable values", () => {
    expect(readHostTypography({ colors: {} })).toBeNull();
    expect(readHostTypography(undefined)).toBeNull();
    expect(readHostTypography({ typography: { fontFamily: { ui: "" }, fontSize: { code: -1 } } })).toBeNull();
    expect(readHostTypography({ typography: { fontSize: { code: 14 } } })?.fontSize?.code).toBe(14);
  });
});

describe("interfaceFamily (plan §3.10 item 4)", () => {
  const ui = (theme: unknown, uiFont: TypographyPreferences["uiFont"], platform: TypographyPlatform) =>
    interfaceFamily(resolveTypography(theme, { ...follow, uiFont }, platform), uiFont, platform);

  it("follows the host family when H1 provides one", () => {
    expect(ui(withHost, "host", "web")).toContain("Geist");
    expect(ui(withHost, "host", "ios")).toBe("Geist");
  });

  it("sets no family without H1, so the host's UI font rule (web) or the system face (native) applies", () => {
    expect(ui(noHost, "host", "web")).toBeUndefined();
    expect(ui(noHost, "host", "ios")).toBeUndefined();
    expect(ui(noHost, "system", "web")).toBe("System");
  });

  it("draws an explicit Inter as the bare embedded name on web only", () => {
    expect(ui(noHost, "inter", "web")).toBe(EMBEDDED_FAMILY.ui);
    expect(ui(withHost, "inter", "web")).toBe(EMBEDDED_FAMILY.ui);
    expect(ui(noHost, "inter", "android")).toBeUndefined();
  });

  it("never hands native the embedded name", () => {
    for (const uiFont of ["host", "inter", "system"] as const) {
      for (const platform of ["ios", "android"] as const) {
        expect(ui(noHost, uiFont, platform) ?? "").not.toContain(EMBEDDED_FAMILY.ui);
      }
    }
  });
});
