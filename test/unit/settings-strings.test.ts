import { describe, expect, it } from "vitest";
import { SETTINGS_STRINGS, resolveLanguage, systemLanguage } from "../../client/i18n/settings-strings";
import { parsePreferences, DEFAULT_PREFERENCES } from "../../client/preferences";

describe("settings language", () => {
  it("follows the system by default and keeps an explicit choice", () => {
    expect(DEFAULT_PREFERENCES.language).toBe("system");
    expect(parsePreferences({ language: "zh" }).language).toBe("zh");
    expect(parsePreferences({ language: "fr" }).language).toBe("system");
    expect(resolveLanguage("en", "zh-CN")).toBe("en");
    expect(resolveLanguage("zh", "en-US")).toBe("zh");
  });

  it("reads any Chinese system locale as Chinese and anything else as English", () => {
    expect(resolveLanguage("system", "zh-CN")).toBe("zh");
    expect(resolveLanguage("system", "zh-Hant-TW")).toBe("zh");
    expect(resolveLanguage("system", "zh")).toBe("zh");
    expect(resolveLanguage("system", "en-GB")).toBe("en");
    expect(resolveLanguage("system", "ja-JP")).toBe("en");
    expect(resolveLanguage("system", null)).toBe("en");
  });

  it("finds a system locale in the test runtime", () => {
    expect(typeof systemLanguage()).toBe("string");
  });

  it("has every English string in Chinese, with the same parameters", () => {
    const en = SETTINGS_STRINGS.en as Record<string, unknown>;
    const zh = SETTINGS_STRINGS.zh as Record<string, unknown>;
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      expect(typeof zh[key], key).toBe(typeof en[key]);
      if (typeof en[key] === "function") {
        expect((zh[key] as (...args: never[]) => unknown).length, key).toBe(
          (en[key] as (...args: never[]) => unknown).length,
        );
      } else {
        expect(zh[key], key).not.toBe("");
        // The two language names are written in their own language in both.
        if (key !== "languageEnglish" && key !== "languageChinese") expect(zh[key], key).not.toBe(en[key]);
      }
    }
  });
});
