/**
 * Plan D10 level 2: the read-only shim over Paseo's persisted Appearance
 * settings (`client/ui/tokens/host-appearance-shim.ts`), and how
 * `resolveTypography` ranks it between host typography (H1) and Paseo's
 * default stack.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

vi.mock("react-native", () => import("./helpers/rn-mock"));

import {
  APP_SETTINGS_KEY,
  LEGACY_SETTINGS_KEY,
  RECHECK_MS,
  appearanceMonoStack,
  checkHostAppearance,
  clampCodeSize,
  clampContentSize,
  hostAppearanceParseCount,
  parseAppSettings,
  resetHostAppearanceForTests,
  resolveAppearance,
  sanitizeFamily,
  setNativeSettingsReaderForTests,
  useHostAppearance,
  type HostAppearance,
} from "../../client/ui/tokens/host-appearance-shim";
import {
  DEFAULT_WEB_MONO_STACK,
  describeMonoSource,
  resolveTypography,
  type TypographyPreferences,
} from "../../client/ui/tokens/typography";

await import("./helpers/quiet-renderer");
const TestRenderer = (await import("react-test-renderer")).default;
const { act } = await import("react-test-renderer");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const follow: TypographyPreferences = {
  uiFont: "host",
  monoFont: "host",
  customMonoFont: "",
  codeFontSize: null,
};
const settings = (fields: Record<string, unknown>) => JSON.stringify({ theme: "dark", ...fields });

/** A `localStorage` stand-in that counts reads; the shim must never write. */
function fakeStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const storage = {
    reads: 0,
    getItem: vi.fn((key: string) => {
      storage.reads += 1;
      return data.get(key) ?? null;
    }),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    set(key: string, value: string | null) {
      if (value === null) data.delete(key);
      else data.set(key, value);
    },
  };
  return storage;
}

const globals = globalThis as { localStorage?: unknown };

beforeEach(() => {
  resetHostAppearanceForTests();
});
afterEach(() => {
  delete globals.localStorage;
  vi.useRealTimers();
});

describe("parsing Paseo's app settings", () => {
  it("reads a valid font and size", () => {
    expect(parseAppSettings(settings({ monoFontFamily: "JetBrains Mono", codeFontSize: 13 }))).toEqual({
      monoFontFamily: "JetBrains Mono",
      codeFontSize: 13,
    });
  });

  it('treats "" (and blanks) as the platform default, i.e. unset', () => {
    expect(parseAppSettings(settings({ monoFontFamily: "", codeFontSize: 12 }))).toEqual({ codeFontSize: 12 });
    expect(parseAppSettings(settings({ monoFontFamily: "   " }))).toEqual({});
  });

  it("falls back to the legacy key when the current one is missing or corrupt", () => {
    const legacy = settings({ monoFontFamily: "Menlo" });
    expect(resolveAppearance(null, legacy)).toEqual({ monoFontFamily: "Menlo" });
    expect(resolveAppearance("{not json", legacy)).toEqual({ monoFontFamily: "Menlo" });
    expect(resolveAppearance(settings({ monoFontFamily: "Iosevka Term" }), legacy)).toEqual({
      monoFontFamily: "Iosevka Term",
    });
    expect(resolveAppearance(null, null)).toBeNull();
  });

  it("returns null for malformed JSON and non-object values", () => {
    expect(parseAppSettings("{")).toBeNull();
    expect(parseAppSettings("null")).toBeNull();
    expect(parseAppSettings("[1,2]")).toBeNull();
    expect(parseAppSettings('"Menlo"')).toBeNull();
    expect(parseAppSettings(settings({ monoFontFamily: 42, codeFontSize: "big" }))).toEqual({});
  });

  it("rejects values that could break a CSS declaration, like the host does", () => {
    for (const hostile of [
      "Menlo; } body { display: none",
      "x</style><script>",
      "url(evil)",
      "Menlo\u0000",
      "a".repeat(201),
    ]) {
      expect(sanitizeFamily(hostile)).toBeUndefined();
    }
    // Quotes and commas are legitimate in a stack.
    expect(sanitizeFamily(` "Fira Code", monospace `)).toBe('"Fira Code", monospace');
  });

  it("reads the content size, and the UI base size when content size was never stored", () => {
    expect(parseAppSettings(settings({ contentFontSize: 13, uiBaseFontSize: 15 }))).toMatchObject({
      contentFontSize: 13,
    });
    expect(parseAppSettings(settings({ uiBaseFontSize: 14 }))).toEqual({ contentFontSize: 14 });
    expect(parseAppSettings(settings({ contentFontSize: "big" }))).toEqual({});
  });

  it("floors and clamps the content size to the host's 10–21", () => {
    expect(clampContentSize(4)).toBe(10);
    expect(clampContentSize(40)).toBe(21);
    expect(clampContentSize(13.7)).toBe(13);
    expect(clampContentSize("18")).toBe(18);
    expect(clampContentSize("")).toBeUndefined();
  });

  it("floors and clamps the code size to the host's 9–22", () => {
    expect(clampCodeSize(4)).toBe(9);
    expect(clampCodeSize(40)).toBe(22);
    expect(clampCodeSize(13.7)).toBe(13);
    expect(clampCodeSize("16")).toBe(16);
    expect(clampCodeSize("")).toBeUndefined();
    expect(clampCodeSize(Number.NaN)).toBeUndefined();
    expect(clampCodeSize(null)).toBeUndefined();
  });

  it("builds the stack: the user's entries quoted, then Paseo's default stack", () => {
    expect(appearanceMonoStack("Courier New", DEFAULT_WEB_MONO_STACK)).toBe(
      `"Courier New", ${DEFAULT_WEB_MONO_STACK}`,
    );
    expect(appearanceMonoStack(`JetBrains Mono, 'Fira Code', Monospace`, DEFAULT_WEB_MONO_STACK)).toBe(
      `"JetBrains Mono", "Fira Code", monospace, ${DEFAULT_WEB_MONO_STACK}`,
    );
  });
});

describe("resolveTypography with Paseo's appearance (plan D10)", () => {
  const appearance: HostAppearance = { monoFontFamily: "Courier New", codeFontSize: 16 };

  it("uses it on web without host typography, for code blocks and terminals alike", () => {
    const result = resolveTypography({ colors: {} }, follow, "web", appearance);
    expect(result.mono.family).toBe(`"Courier New", ${DEFAULT_WEB_MONO_STACK}`);
    expect(result.mono).toMatchObject({ size: 16, lineHeight: 24 });
    expect(result.mono.source).toEqual({ kind: "paseo-appearance", family: "Courier New", size: 16 });
    expect(describeMonoSource(result.mono.source, "web")).toBe("Following Paseo appearance: Courier New, 16 px");
  });

  it("is bypassed once the host shares typography (H1)", () => {
    const withHost = { colors: {}, typography: { fontFamily: { mono: "Geist Mono" }, fontSize: { code: 13 } } };
    const result = resolveTypography(withHost, follow, "web", appearance);
    expect(result.mono.family.startsWith("Geist Mono")).toBe(true);
    expect(result.mono.size).toBe(13);
    expect(result.mono.source.kind).toBe("host-typography");
  });

  it("follows the stored content size on iOS and Android, and still ignores the mono stack there", () => {
    const stored: HostAppearance = { monoFontFamily: "Courier New", codeFontSize: 16, contentFontSize: 13 };
    for (const platform of ["ios", "android"] as const) {
      const result = resolveTypography({ colors: {} }, follow, platform, stored);
      expect(result.mono.family).toBe(platform === "ios" ? "ui-monospace" : "monospace");
      expect(result.mono.size).toBe(12);
      expect(result.content).toEqual({ size: 13, lineHeight: 20 });
    }
    const host = resolveTypography(
      { colors: {}, typography: { fontSize: { content: 17 } } },
      follow,
      "android",
      stored,
    );
    expect(host.content.size).toBe(17);
  });

  it("is bypassed on iOS and Android", () => {
    for (const platform of ["ios", "android"] as const) {
      const result = resolveTypography({ colors: {} }, follow, platform, appearance);
      expect(result.mono.family).toBe(platform === "ios" ? "ui-monospace" : "monospace");
      expect(result.mono.size).toBe(12);
      expect(result.mono.source.kind).toBe("paseo-default");
    }
  });

  it("falls back to Paseo's default when unset; a stored default size alone is not a source", () => {
    const result = resolveTypography({ colors: {} }, follow, "web", { codeFontSize: 12 });
    expect(result.mono.family).toBe(DEFAULT_WEB_MONO_STACK);
    expect(result.mono.source.kind).toBe("paseo-default");
    expect(describeMonoSource(result.mono.source, "web")).toBe(
      "Paseo default: SF Mono, Menlo, Monaco or Consolas, 12 px",
    );
    const sizeOnly = resolveTypography({ colors: {} }, follow, "web", { codeFontSize: 14 });
    expect(sizeOnly.mono).toMatchObject({ family: DEFAULT_WEB_MONO_STACK, size: 14 });
    expect(describeMonoSource(sizeOnly.mono.source, "web")).toBe(
      "Following Paseo appearance: Paseo's default monospace, 14 px",
    );
  });

  it("ranks below the plugin's own choices: Custom and a custom size", () => {
    const custom = resolveTypography(
      { colors: {} },
      { ...follow, monoFont: "custom", customMonoFont: "Menlo", codeFontSize: 11 },
      "web",
      appearance,
    );
    expect(custom.mono.family).toBe(`"Menlo", "Courier New", ${DEFAULT_WEB_MONO_STACK}`);
    expect(custom.mono.size).toBe(11);
  });
});

describe("the cached store", () => {
  it("reads at most once per 500 ms and parses only a changed string", () => {
    const storage = fakeStorage({ [APP_SETTINGS_KEY]: settings({ monoFontFamily: "Menlo", codeFontSize: 13 }) });
    globals.localStorage = storage;
    expect(checkHostAppearance(1000)).toBe(true);
    expect(hostAppearanceParseCount()).toBe(1);
    const reads = storage.reads;
    // Inside the window: no read at all.
    expect(checkHostAppearance(1000 + RECHECK_MS - 1)).toBe(false);
    expect(storage.reads).toBe(reads);
    // After it: a read, but the same string is not parsed again.
    expect(checkHostAppearance(1000 + RECHECK_MS)).toBe(false);
    expect(storage.reads).toBeGreaterThan(reads);
    expect(hostAppearanceParseCount()).toBe(1);
    // A changed string is parsed once.
    storage.set(APP_SETTINGS_KEY, settings({ monoFontFamily: "Courier New", codeFontSize: 16 }));
    expect(checkHostAppearance(1000 + 2 * RECHECK_MS)).toBe(true);
    expect(hostAppearanceParseCount()).toBe(2);
    // A change to a field the plugin does not use is parsed but changes nothing.
    storage.set(APP_SETTINGS_KEY, settings({ monoFontFamily: "Courier New", codeFontSize: 16, language: "fr" }));
    expect(checkHostAppearance(1000 + 3 * RECHECK_MS)).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("reads the legacy key when the current one is absent", () => {
    globals.localStorage = fakeStorage({ [LEGACY_SETTINGS_KEY]: settings({ monoFontFamily: "Menlo" }) });
    checkHostAppearance(5000);
    const seen: Array<HostAppearance | null> = [];
    function Probe() {
      seen.push(useHostAppearance(true, {}));
      return null;
    }
    act(() => {
      TestRenderer.create(React.createElement(Probe));
    });
    expect(seen.at(-1)).toEqual({ monoFontFamily: "Menlo" });
  });

  it("survives a storage that throws", () => {
    globals.localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => checkHostAppearance(9000)).not.toThrow();
  });
});

describe("useHostAppearance", () => {
  function setup(enabled: boolean) {
    const storage = fakeStorage({ [APP_SETTINGS_KEY]: settings({ monoFontFamily: "", codeFontSize: 12 }) });
    globals.localStorage = storage;
    const seen: Array<HostAppearance | null> = [];
    function Probe({ theme }: { theme: object }) {
      seen.push(useHostAppearance(enabled, theme));
      return null;
    }
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(React.createElement(Probe, { theme: {} }));
    });
    return { storage, seen, renderer, Probe };
  }

  it("follows a change in Paseo's Appearance within about a second, without a reload", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { storage, seen, renderer, Probe } = setup(true);
    expect(seen.at(-1)).toEqual({ codeFontSize: 12 });
    // Paseo applies the new appearance (a new theme prop) and writes its
    // settings a moment later.
    vi.setSystemTime(101_000);
    act(() => renderer.update(React.createElement(Probe, { theme: {} })));
    storage.set(APP_SETTINGS_KEY, settings({ monoFontFamily: "Courier New", codeFontSize: 16 }));
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(seen.at(-1)).toEqual({ monoFontFamily: "Courier New", codeFontSize: 16 });
    act(() => renderer.unmount());
  });

  it("reads Paseo's content size from AsyncStorage when there is no localStorage", async () => {
    setNativeSettingsReaderForTests(() =>
      Promise.resolve({ current: settings({ contentFontSize: 13, codeFontSize: 12 }), legacy: null }),
    );
    const seen: Array<HostAppearance | null> = [];
    function Probe() {
      seen.push(useHostAppearance(true, {}));
      return null;
    }
    await act(async () => {
      TestRenderer.create(React.createElement(Probe));
      await Promise.resolve();
    });
    expect(seen.at(-1)).toEqual({ contentFontSize: 13, codeFontSize: 12 });
  });

  it("does not read storage at all when disabled (host typography is present)", () => {
    const { storage, seen } = setup(false);
    expect(seen.at(-1)).toBeNull();
    expect(storage.reads).toBe(0);
  });
});
