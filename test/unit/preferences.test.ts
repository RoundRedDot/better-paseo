import { afterEach, describe, expect, it, vi } from "vitest";
import { preferencesSchema } from "../../shared/preferences-settings";
import {
  DEFAULT_PREFERENCES,
  LEGACY_STORAGE_KEY,
  STORAGE_KEY,
  migrateV1Preferences,
  monoChoice,
  monoChoiceUpdate,
  parsePreferences,
  readStoredPreferences,
  storedPart,
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
  it("follows Paseo for fonts and starts tools collapsed", () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({
      uiFont: "host",
      monoFont: "host",
      customMonoFont: "",
      codeFontSize: null,
      toolDetail: "collapsed",
      pathDisplay: "relative",
    });
  });

  it("draws rows icon-only and tightens the host's gap between them", () => {
    expect(DEFAULT_PREFERENCES.rowLabels).toBe(false);
    expect(DEFAULT_PREFERENCES.compactRowSpacing).toBe(true);
  });

  it("gives a record stored before the row switches their defaults", () => {
    const { rowLabels: _rowLabels, compactRowSpacing: _compact, ...older } = storedPart(DEFAULT_PREFERENCES);
    const parsed = parsePreferences({ ...older, accent: "rose" });
    expect(parsed).toMatchObject({ accent: "rose", rowLabels: false, compactRowSpacing: true });
    expect(parsePreferences({ rowLabels: true, compactRowSpacing: false })).toMatchObject({
      rowLabels: true,
      compactRowSpacing: false,
    });
    expect(parsePreferences({ rowLabels: "yes" }).rowLabels).toBe(false);
  });
});

describe("v1 -> v2 migration", () => {
  it("keeps every choice v2 still has and drops the removed frost and glow switches", () => {
    const migrated = migrateV1Preferences(V1);
    expect(migrated).toEqual({
      ...DEFAULT_PREFERENCES,
      accent: "violet",
      codeFont: "plain",
      enhancedUserBubble: false,
      markdownVariant: "compact",
      uiFont: "host",
    });
    expect(migrated).not.toHaveProperty("frostedGlass");
    expect(migrated).not.toHaveProperty("pointerGlow");
  });

  it("keeps an explicit system UI font; v1's default Inter becomes follow-Paseo", () => {
    expect(migrateV1Preferences({ ...V1, uiFont: "system" }).uiFont).toBe("system");
    expect(migrateV1Preferences({ ...V1, uiFont: "inter" }).uiFont).toBe("host");
  });

  it("writes v2 on first load so the reset happens exactly once", () => {
    const store = memoryStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(V1) });
    const first = readStoredPreferences(store);
    expect(first.uiFont).toBe("host");
    expect(store.data.has(STORAGE_KEY)).toBe(true);
    // A choice made after the migration must stay across reloads.
    store.setItem(STORAGE_KEY, JSON.stringify({ ...first, uiFont: "system" }));
    expect(readStoredPreferences(store).uiFont).toBe("system");
    // v1 is left untouched for a downgrade.
    expect(JSON.parse(store.getItem(LEGACY_STORAGE_KEY) ?? "{}").uiFont).toBe("inter");
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
    });
    expect(parsed).toMatchObject({
      uiFont: "host",
      monoFont: "custom",
      customMonoFont: "Fira Code",
      codeFontSize: 22,
      toolDetail: "expand-failed",
      pathDisplay: "absolute",
    });
    expect(parsePreferences({ codeFontSize: 3 }).codeFontSize).toBe(10);
    expect(parsePreferences({ codeFontSize: null }).codeFontSize).toBeNull();
    expect(parsePreferences({ codeFontSize: Number.NaN }).codeFontSize).toBeNull();
  });
});

describe("records written before S7", () => {
  it("drops the removed frost and glow switches and keeps the rest", () => {
    const stored = { ...DEFAULT_PREFERENCES, accent: "jade", frostedGlass: true, pointerGlow: true };
    const parsed = parsePreferences(stored);
    expect(parsed.accent).toBe("jade");
    expect(parsed).not.toHaveProperty("frostedGlass");
    expect(parsed).not.toHaveProperty("pointerGlow");
    expect(preferencesSchema.safeParse(stored).success).toBe(true);
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

  it("resets the ligature setting to its default when returning to Follow Paseo", () => {
    expect(monoChoiceUpdate("host")).toEqual({ monoFont: "host", codeFont: "code" });
  });
});

describe("daemon-backed store (S5 fix round 1)", () => {
  async function freshModule(seed: Record<string, string> = {}) {
    vi.resetModules();
    const local = memoryStorage(seed);
    (globalThis as { localStorage?: unknown }).localStorage = local;
    const mod = await import("../../client/preferences");
    return { mod, local };
  }

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("degrades each stored field on its own instead of rejecting the record", () => {
    const parsed = preferencesSchema.parse({ accent: "neon", codeFontSize: "big", monoFont: "custom" });
    expect(parsed.accent).toBe("host");
    expect(parsed.codeFontSize).toBeNull();
    expect(parsed.monoFont).toBe("custom");
    expect(preferencesSchema.parse({})).toEqual(storedPart(DEFAULT_PREFERENCES));
  });

  it("offers the old local record once, then never again", async () => {
    const { mod } = await freshModule({ [STORAGE_KEY]: JSON.stringify({ accent: "jade" }) });
    expect(mod.legacyLocalPreferences()?.accent).toBe("jade");
    mod.markLegacyMigrated();
    expect(mod.legacyLocalPreferences()).toBeNull();
  });

  it("has nothing to offer from a client that never stored preferences", async () => {
    const { mod } = await freshModule();
    expect(mod.legacyLocalPreferences()).toBeNull();
  });

  it("starts from the web cache and applies daemon values without touching the local debug flag", async () => {
    const { mod, local } = await freshModule({
      [STORAGE_KEY]: JSON.stringify({ codeFontSize: 15, debugPerf: true }),
    });
    expect(mod.getEnhancerPreferences().codeFontSize).toBe(15);
    const listener = vi.fn();
    mod.subscribeEnhancerPreferences(listener);
    mod.applyStoredPreferences({ ...storedPart(DEFAULT_PREFERENCES), codeFontSize: 15 });
    expect(listener).not.toHaveBeenCalled();
    mod.applyStoredPreferences({ ...storedPart(DEFAULT_PREFERENCES), monoFont: "custom", customMonoFont: "Menlo" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(mod.getEnhancerPreferences()).toMatchObject({ monoFont: "custom", codeFontSize: null, debugPerf: true });
    expect(JSON.parse(local.getItem(STORAGE_KEY) ?? "{}").customMonoFont).toBe("Menlo");
  });

  it("hands only stored changes to the daemon persister", async () => {
    const { mod } = await freshModule();
    const persist = vi.fn();
    mod.setPreferencePersister(persist);
    mod.updateEnhancerPreferences({ debugPerf: true });
    expect(persist).not.toHaveBeenCalled();
    mod.updateEnhancerPreferences({ codeFontSize: 16 });
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ codeFontSize: 16 }));
    expect(persist.mock.calls[0]![0]).not.toHaveProperty("debugPerf");
  });
});

describe("prompt bubble default", () => {
  it("leaves prompts to Paseo's bubble, which keeps rewind and images", () => {
    expect(DEFAULT_PREFERENCES.enhancedUserBubble).toBe(false);
    expect(parsePreferences({}).enhancedUserBubble).toBe(false);
    expect(parsePreferences({ enhancedUserBubble: true }).enhancedUserBubble).toBe(true);
  });
});
