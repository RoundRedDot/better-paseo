import { afterEach, describe, expect, it, vi } from "vitest";
import { HOVER_DELAY_DEFAULT, clampHoverDelay, preferencesSchema } from "../../shared/preferences-settings";
import {
  DEFAULT_PREFERENCES,
  LEGACY_STORAGE_KEY,
  STORAGE_KEY,
  migrateV1Preferences,
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
  it("enables hover previews for old records and preserves an explicit opt-out", () => {
    expect(DEFAULT_PREFERENCES.hoverPreview).toBe(true);
    const { hoverPreview: _hover, ...older } = storedPart(DEFAULT_PREFERENCES);
    expect(parsePreferences(older).hoverPreview).toBe(true);
    expect(parsePreferences({ hoverPreview: false }).hoverPreview).toBe(false);
    expect(parsePreferences({ hoverPreview: "no" }).hoverPreview).toBe(true);
  });
  it("defaults the hover delay to one second and keeps a typed value to a tenth, within 0-10", () => {
    expect(HOVER_DELAY_DEFAULT).toBe(1);
    expect(DEFAULT_PREFERENCES.hoverDelaySeconds).toBe(1);
    expect(parsePreferences({}).hoverDelaySeconds).toBe(1);
    expect(parsePreferences({ hoverDelaySeconds: 0.3 }).hoverDelaySeconds).toBe(0.3);
    expect(parsePreferences({ hoverDelaySeconds: 0 }).hoverDelaySeconds).toBe(0);
    expect(parsePreferences({ hoverDelaySeconds: 2.75 }).hoverDelaySeconds).toBe(2.8);
    expect(parsePreferences({ hoverDelaySeconds: 42 }).hoverDelaySeconds).toBe(10);
    expect(parsePreferences({ hoverDelaySeconds: -1 }).hoverDelaySeconds).toBe(0);
    for (const hoverDelaySeconds of ["1", null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(parsePreferences({ hoverDelaySeconds }).hoverDelaySeconds).toBe(1);
    }
    expect(clampHoverDelay(0.1 + 0.2)).toBe(0.3);
  });
  it("carries a stored delay step over as seconds", () => {
    const steps = { "200ms": 0.2, "500ms": 0.5, "1s": 1, "1.5s": 1.5, "2s": 2 };
    for (const [hoverDelay, seconds] of Object.entries(steps)) {
      const parsed = parsePreferences({ hoverDelay });
      expect(parsed.hoverDelaySeconds).toBe(seconds);
      expect(parsed).not.toHaveProperty("hoverDelay");
    }
    expect(parsePreferences({ hoverDelay: "400ms" }).hoverDelaySeconds).toBe(1);
    // A record that already has the typed value ignores a leftover step.
    expect(parsePreferences({ hoverDelay: "2s", hoverDelaySeconds: 0.4 }).hoverDelaySeconds).toBe(0.4);
  });
  it("starts previews wrapped and shaded without line numbers and keeps an explicit choice", () => {
    expect(DEFAULT_PREFERENCES.previewWrap).toBe(true);
    expect(DEFAULT_PREFERENCES.previewLineNumbers).toBe(false);
    expect(DEFAULT_PREFERENCES.previewStripes).toBe(true);
    const { previewWrap: _wrap, previewLineNumbers: _numbers, previewStripes: _stripes, ...older } = storedPart(DEFAULT_PREFERENCES);
    expect(parsePreferences(older)).toMatchObject({ previewWrap: true, previewLineNumbers: false, previewStripes: true });
    expect(parsePreferences({ previewWrap: false }).previewWrap).toBe(false);
    expect(parsePreferences({ previewLineNumbers: true, previewStripes: false }))
      .toMatchObject({ previewLineNumbers: true, previewStripes: false });
    expect(parsePreferences({ previewLineNumbers: "yes", previewStripes: 0 }))
      .toMatchObject({ previewLineNumbers: false, previewStripes: true });
  });
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
    expect(DEFAULT_PREFERENCES.rowLabelStyle).toBe("icon");
    expect(DEFAULT_PREFERENCES.compactRowSpacing).toBe(true);
  });

  it("tightens the host's gap under a reply by default, and keeps a reader's choice", () => {
    expect(DEFAULT_PREFERENCES.compactReplySpacing).toBe(true);
    const { compactReplySpacing: _reply, ...older } = storedPart(DEFAULT_PREFERENCES);
    expect(parsePreferences(older).compactReplySpacing).toBe(true);
    expect(parsePreferences({ compactReplySpacing: false }).compactReplySpacing).toBe(false);
    expect(parsePreferences({ compactReplySpacing: "no" }).compactReplySpacing).toBe(true);
  });

  it("gives a record stored before the row switches their defaults", () => {
    const { rowLabelStyle: _style, compactRowSpacing: _compact, ...older } = storedPart(DEFAULT_PREFERENCES);
    const parsed = parsePreferences({ ...older, accent: "rose" });
    expect(parsed).toMatchObject({ accent: "rose", rowLabelStyle: "icon", compactRowSpacing: true });
    expect(parsePreferences({ rowLabelStyle: "label", compactRowSpacing: false })).toMatchObject({
      rowLabelStyle: "label",
      compactRowSpacing: false,
    });
    expect(parsePreferences({ rowLabelStyle: "yes" }).rowLabelStyle).toBe("icon");
  });

  it("turns the old row labels switch into a style", () => {
    expect(preferencesSchema.parse({ rowLabels: true })).toMatchObject({ rowLabelStyle: "both" });
    expect(preferencesSchema.parse({ rowLabels: false }).rowLabelStyle).toBe("icon");
    expect(preferencesSchema.parse({ rowLabels: true, rowLabelStyle: "label" }).rowLabelStyle).toBe("label");
    expect(preferencesSchema.parse({ rowLabels: true })).not.toHaveProperty("rowLabels");
  });
});

describe("v1 -> v2 migration", () => {
  it("keeps every choice v2 still has and drops the removed frost and glow switches", () => {
    const migrated = migrateV1Preferences(V1);
    expect(migrated).toEqual({
      ...DEFAULT_PREFERENCES,
      accent: "violet",
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
    expect(parsePreferences({}).blockFontSize).toBe(13);
    expect(parsePreferences({ blockFontSize: 9 }).blockFontSize).toBe(9);
    expect(parsePreferences({ blockFontSize: 8 }).blockFontSize).toBe(9);
    expect(parsePreferences({ blockFontSize: 40 }).blockFontSize).toBe(20);
    expect(parsePreferences({ blockFontSize: 15.6 }).blockFontSize).toBe(16);
    expect(parsePreferences({ blockFontSize: "big" }).blockFontSize).toBe(13);
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

describe("removed Iosevka choice", () => {
  it("falls back to Follow Paseo and drops the ligature setting", () => {
    const parsed = preferencesSchema.parse({ monoFont: "iosevka", codeFont: "plain" });
    expect(parsed.monoFont).toBe("host");
    expect(parsed).not.toHaveProperty("codeFont");
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
  it("persists the hover choice to the daemon and reloads it from the cache", async () => {
    const { mod, local } = await freshModule();
    const persist = vi.fn();
    mod.setPreferencePersister(persist);
    mod.updateEnhancerPreferences({ hoverDelaySeconds: 1.5 });
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ hoverDelaySeconds: 1.5 }));
    expect(readStoredPreferences(local).hoverDelaySeconds).toBe(1.5);
    mod.applyStoredPreferences({ ...storedPart(DEFAULT_PREFERENCES), hoverDelaySeconds: 2 });
    expect(mod.getEnhancerPreferences().hoverDelaySeconds).toBe(2);
  });
  it("persists disabled hover previews and restores them when resetting defaults", async () => {
    const { mod, local } = await freshModule();
    const persist = vi.fn();
    mod.setPreferencePersister(persist);
    mod.updateEnhancerPreferences({ hoverPreview: false });
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ hoverPreview: false }));
    expect(readStoredPreferences(local).hoverPreview).toBe(false);
    mod.resetEnhancerPreferences();
    expect(mod.getEnhancerPreferences().hoverPreview).toBe(true);
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ hoverPreview: true }));
  });
});

describe("prompt bubble default", () => {
  it("leaves prompts to Paseo's bubble, which keeps rewind and images", () => {
    expect(DEFAULT_PREFERENCES.enhancedUserBubble).toBe(false);
    expect(parsePreferences({}).enhancedUserBubble).toBe(false);
    expect(parsePreferences({ enhancedUserBubble: true }).enhancedUserBubble).toBe(true);
  });
});
