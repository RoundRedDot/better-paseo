import { describe, expect, it } from "vitest";
import {
  EMBEDDED_FAMILY,
  interfaceFamily,
  lineHeightFor,
  readHostTypography,
  resolveTypography,
  type TypographyPlatform,
  type TypographyPreferences,
} from "../../client/ui/tokens/typography";

const follow: TypographyPreferences = {
  uiFont: "host",
  codeFont: "code",
  monoFont: "host",
  customMonoFont: "",
  codeFontSize: null,
};
const iosevka: TypographyPreferences = { ...follow, monoFont: "iosevka" };
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
const SETTINGS = { follow, iosevka, custom } as const;
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
    follow: { noHost: { starts: `"${EMBEDDED_FAMILY.mono}"` }, withHost: { starts: '"JetBrains Mono"' } },
    iosevka: {
      noHost: { starts: `"${EMBEDDED_FAMILY.mono}"` },
      withHost: { starts: `"${EMBEDDED_FAMILY.mono}"` },
    },
    custom: { noHost: { starts: '"Menlo"' }, withHost: { starts: '"Menlo"' } },
  },
  ios: {
    follow: { noHost: { starts: "ui-monospace", single: true }, withHost: { starts: '"JetBrains Mono"' } },
    // Iosevka is not offered on native: the platform (or host) face instead.
    iosevka: { noHost: { starts: "ui-monospace", single: true }, withHost: { starts: '"JetBrains Mono"' } },
    custom: { noHost: { starts: "Menlo", single: true }, withHost: { starts: "Menlo", single: true } },
  },
  android: {
    follow: { noHost: { starts: "monospace", single: true }, withHost: { starts: '"JetBrains Mono"' } },
    iosevka: { noHost: { starts: "monospace", single: true }, withHost: { starts: '"JetBrains Mono"' } },
    // Menlo does not exist on Android: not in the platform list, so ignored.
    custom: { noHost: { starts: "monospace", single: true }, withHost: { starts: '"JetBrains Mono"' } },
  },
};

describe("resolveTypography: 3 platforms x 3 settings x host typography", () => {
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
            expect(result.mono.codeFamily).toBe(result.mono.family);
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
  it("uses the ligature cut for code blocks only with embedded Iosevka and ligatures on", () => {
    const on = resolveTypography(noHost, follow, "web");
    expect(on.mono.codeFamily.startsWith(`"${EMBEDDED_FAMILY.code}"`)).toBe(true);
    expect(on.mono.family.startsWith(`"${EMBEDDED_FAMILY.mono}"`)).toBe(true);
    const off = resolveTypography(noHost, { ...follow, codeFont: "plain" }, "web");
    expect(off.mono.codeFamily).toBe(off.mono.family);
    expect(off.mono.ligatures).toBe(false);
    const host = resolveTypography(withHost, follow, "web");
    expect(host.mono.codeFamily).toBe(host.mono.family);
  });

  it("builds a custom web stack on top of the follow value and strips stray quotes", () => {
    const result = resolveTypography(noHost, { ...follow, monoFont: "custom", customMonoFont: 'Fira "Code"' }, "web");
    expect(result.mono.family.startsWith('"Fira Code", "OMP Iosevka", ui-monospace')).toBe(true);
    const empty = resolveTypography(noHost, { ...follow, monoFont: "custom", customMonoFont: "  " }, "web");
    expect(empty.mono.family.startsWith(`"${EMBEDDED_FAMILY.mono}"`)).toBe(true);
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

  it("keeps the fixed UI scale", () => {
    expect(resolveTypography(noHost, follow, "web").ui.scale).toEqual({
      xs: 10,
      sm: 11,
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

  it("falls back to the system stack, Paseo's own default, without H1", () => {
    expect(ui(noHost, "host", "web")).toBe("System");
    expect(ui(noHost, "host", "ios")).toBe("System");
  });

  it("draws an explicit Inter as the bare embedded name on web only", () => {
    expect(ui(noHost, "inter", "web")).toBe(EMBEDDED_FAMILY.ui);
    expect(ui(withHost, "inter", "web")).toBe(EMBEDDED_FAMILY.ui);
    expect(ui(noHost, "inter", "android")).toBe("System");
  });

  it("never hands native the embedded name", () => {
    for (const uiFont of ["host", "inter", "system"] as const) {
      for (const platform of ["ios", "android"] as const) {
        expect(ui(noHost, uiFont, platform)).not.toContain(EMBEDDED_FAMILY.ui);
      }
    }
  });
});
