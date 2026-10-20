import { afterEach, describe, expect, it } from "vitest";
import {
  deviceLocales,
  hostLanguage,
  hostLanguageSetting,
  pickHostLanguage,
  resetHostLanguageForTests,
  subscribeHostLanguage,
} from "../../client/i18n/host-language";
import { resolveLanguage } from "../../client/i18n/settings-strings";

// Paseo's own language as the plugin reads it: the stored setting (web
// localStorage, native AsyncStorage) and the device locales the host walks.

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  resetHostLanguageForTests();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("pickHostLanguage", () => {
  it("lets an explicit host language decide", () => {
    expect(pickHostLanguage("zh-CN", ["en-US"])).toBe("zh");
    expect(pickHostLanguage("en", ["zh-Hans-SG"])).toBe("en");
    expect(pickHostLanguage("ja", ["zh-Hans-SG"])).toBe("en");
  });

  it("walks the device locales like the host under system", () => {
    // A Chinese iPhone whose app bundle declares no localisations: Intl says
    // en-SG, the preferred languages say zh-Hans-SG first.
    expect(pickHostLanguage("system", ["zh-Hans-SG", "en-SG"])).toBe("zh");
    expect(pickHostLanguage(undefined, ["en-SG", "zh-Hans-SG"])).toBe("en");
    // A language the host does not translate is skipped, as the host does.
    expect(pickHostLanguage("system", ["de-DE", "zh-Hans"])).toBe("zh");
    expect(pickHostLanguage("system", ["de-DE", "fr-FR", "zh-Hans"])).toBe("en");
    expect(pickHostLanguage("system", ["pt-BR", "zh-Hans"])).toBe("en");
    expect(pickHostLanguage("system", ["zh_CN"])).toBe("zh");
    expect(pickHostLanguage("system", [])).toBe("en");
    expect(pickHostLanguage(null, "zh")).toBe("zh");
  });
});

describe("the device locales", () => {
  it("prefer expo-localization's list on native over Intl", () => {
    const nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { value: { product: "ReactNative" }, configurable: true });
    (globalThis as { expo?: unknown }).expo = {
      modules: { ExpoLocalization: { getLocales: () => [{ languageTag: "zh-Hans-SG" }, { languageTag: "en-SG" }] } },
    };
    try {
      expect(deviceLocales()).toEqual(["zh-Hans-SG", "en-SG"]);
      expect(resolveLanguage("system", undefined)).toBe("zh");
    } finally {
      delete (globalThis as { expo?: unknown }).expo;
      if (nav) Object.defineProperty(globalThis, "navigator", nav);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });

  it("are read at most once a second", () => {
    let reads = 0;
    resetHostLanguageForTests({ deviceLocales: () => (reads++, ["en-US"]), nativeRead: null });
    deviceLocales(1000);
    deviceLocales(1500);
    expect(reads).toBe(1);
    deviceLocales(2100);
    expect(reads).toBe(2);
  });
});

describe("the host's language setting", () => {
  it("is read from localStorage on web, current key first, then the legacy key", () => {
    const store: Record<string, string> = { "@paseo:settings": JSON.stringify({ language: "zh-CN" }) };
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (key: string) => store[key] ?? null };
    resetHostLanguageForTests({ deviceLocales: () => ["en-US"] });
    expect(hostLanguage()).toBe("zh");
    store["@paseo:app-settings"] = JSON.stringify({ language: "en" });
    expect(hostLanguageSetting(Date.now() + 5000)).toBe("en");
  });

  it("arrives from AsyncStorage on native, and the change is announced", async () => {
    let stored = JSON.stringify({ theme: "dark", language: "zh-CN" });
    resetHostLanguageForTests({
      deviceLocales: () => ["en-SG"],
      nativeRead: () => Promise.resolve({ current: stored, legacy: null }),
    });
    let calls = 0;
    subscribeHostLanguage(() => calls++);
    // The first look has only the device locale.
    expect(hostLanguage()).toBe("en");
    await flush();
    expect(calls).toBe(1);
    expect(hostLanguage()).toBe("zh");
    expect(resolveLanguage("system")).toBe("zh");
    // The same blob again announces nothing; a new language does.
    hostLanguageSetting(Date.now() + 5000);
    await flush();
    expect(calls).toBe(1);
    stored = JSON.stringify({ language: "system" });
    hostLanguageSetting(Date.now() + 10_000);
    await flush();
    expect(calls).toBe(2);
    expect(hostLanguage()).toBe("en");
  });

  it("keeps the device locale when the native read fails or there is no storage module", async () => {
    resetHostLanguageForTests({ deviceLocales: () => ["zh-Hans"], nativeRead: () => Promise.reject(new Error("gone")) });
    expect(hostLanguage()).toBe("zh");
    await flush();
    expect(hostLanguage()).toBe("zh");
    resetHostLanguageForTests({ deviceLocales: () => ["en-US"], nativeRead: null });
    expect(hostLanguage()).toBe("en");
  });
});
