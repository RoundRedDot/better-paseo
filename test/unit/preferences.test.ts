import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  LEGACY_STORAGE_KEY,
  STORAGE_KEY,
  migrateV1Preferences,
  monoChoice,
  monoChoiceUpdate,
  parsePreferences,
  readStoredPreferences,
} from "../../client/preferences";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const V1 = {
  accent: "violet",
  uiFont: "inter",
  codeFont: "plain",
  frostedGlass: true,
  pointerGlow: true,
  enhancedUserBubble: false,
  selectionActions: true,
  assistantMarkdown: true,
  markdownVariant: "compact",
  debugPerf: false,
};

describe("preferences v2 defaults", () => {
  it("defaults frost and glow off and follows Paseo for fonts", () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({
      frostedGlass: false,
      pointerGlow: false,
      uiFont: "host",
      monoFont: "host",
      customMonoFont: "",
      codeFontSize: null,
      toolDetail: "collapsed",
      pathDisplay: "relative",
    });
  });
});

describe("v1 -> v2 migration", () => {
  it("resets frost and glow once and keeps every other choice", () => {
    const migrated = migrateV1Preferences(V1);
    expect(migrated).toEqual({
      ...DEFAULT_PREFERENCES,
      accent: "violet",
      codeFont: "plain",
      enhancedUserBubble: false,
      markdownVariant: "compact",
      uiFont: "host",
      frostedGlass: false,
      pointerGlow: false,
    });
  });

  it("keeps an explicit system UI font; v1's default Inter becomes follow-Paseo", () => {
    expect(migrateV1Preferences({ ...V1, uiFont: "system" }).uiFont).toBe("system");
    expect(migrateV1Preferences({ ...V1, uiFont: "inter" }).uiFont).toBe("host");
  });

  it("writes v2 on first load so the reset happens exactly once", () => {
    const store = memoryStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(V1) });
    const first = readStoredPreferences(store);
    expect(first.frostedGlass).toBe(false);
    expect(store.data.has(STORAGE_KEY)).toBe(true);
    // The reader turns frost back on; it must stay on across reloads.
    store.setItem(STORAGE_KEY, JSON.stringify({ ...first, frostedGlass: true }));
    expect(readStoredPreferences(store).frostedGlass).toBe(true);
    // v1 is left untouched for a downgrade.
    expect(JSON.parse(store.getItem(LEGACY_STORAGE_KEY) ?? "{}").frostedGlass).toBe(true);
  });

  it("returns defaults with no storage, empty storage or garbage", () => {
    expect(readStoredPreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
    expect(readStoredPreferences(memoryStorage())).toEqual(DEFAULT_PREFERENCES);
    expect(readStoredPreferences(memoryStorage({ [STORAGE_KEY]: "{not json" }))).toEqual(DEFAULT_PREFERENCES);
    expect(readStoredPreferences(memoryStorage({ [LEGACY_STORAGE_KEY]: "[]" }))).toEqual(DEFAULT_PREFERENCES);
  });
});

describe("parsePreferences", () => {
  it("validates each field and clamps the code size", () => {
    const parsed = parsePreferences({
      uiFont: "comic",
      monoFont: "custom",
      customMonoFont: "  Fira Code  ",
      codeFontSize: 40.4,
      toolDetail: "expand-failed",
      pathDisplay: "absolute",
      frostedGlass: "yes",
    });
    expect(parsed).toMatchObject({
      uiFont: "host",
      monoFont: "custom",
      customMonoFont: "Fira Code",
      codeFontSize: 22,
      toolDetail: "expand-failed",
      pathDisplay: "absolute",
      frostedGlass: false,
    });
    expect(parsePreferences({ codeFontSize: 3 }).codeFontSize).toBe(10);
    expect(parsePreferences({ codeFontSize: null }).codeFontSize).toBeNull();
    expect(parsePreferences({ codeFontSize: Number.NaN }).codeFontSize).toBeNull();
  });
});

describe("monospace choice (settings page)", () => {
  it("tells Iosevka and Iosevka Code apart by the ligature setting", () => {
    expect(monoChoice({ monoFont: "iosevka", codeFont: "plain" })).toBe("iosevka");
    expect(monoChoice({ monoFont: "iosevka", codeFont: "code" })).toBe("iosevka-code");
    expect(monoChoice({ monoFont: "host", codeFont: "plain" })).toBe("host");
    expect(monoChoice({ monoFont: "custom", codeFont: "code" })).toBe("custom");
  });

  it("round-trips every choice through the stored preferences", () => {
    for (const choice of ["host", "iosevka", "iosevka-code", "custom"] as const) {
      const stored = parsePreferences({ ...DEFAULT_PREFERENCES, ...monoChoiceUpdate(choice) });
      expect(monoChoice(stored)).toBe(choice);
    }
  });

  it("brings ligatures back when returning to Follow Paseo (plan D2)", () => {
    expect(monoChoiceUpdate("host")).toEqual({ monoFont: "host", codeFont: "code" });
  });
});
