import { describe, expect, it } from "vitest";
import {
  FOLLOW_INTERFACE_LANGUAGE_CODE,
  TRANSLATION_LANGUAGES,
  filterTranslationLanguages,
  findTranslationLanguage,
  formatTranslationLanguageLabel,
  isTranslationLanguageCode,
  resolveTranslationTarget,
} from "../../shared/translation-languages";

describe("timeline translation language catalog", () => {
  it("contains follow-interface plus the 118 target language entries with unique codes", () => {
    expect(TRANSLATION_LANGUAGES).toHaveLength(119);
    expect(TRANSLATION_LANGUAGES[0]?.code).toBe(FOLLOW_INTERFACE_LANGUAGE_CODE);

    const codes = TRANSLATION_LANGUAGES.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(119);
    expect(codes).not.toContain("auto");
    expect(codes).not.toContain("auto-detect");
  });

  it("gives every entry complete, distinct names", () => {
    for (const entry of TRANSLATION_LANGUAGES) {
      expect(entry.zhName.trim()).not.toBe("");
      expect(entry.enName.trim()).not.toBe("");
      expect(entry.nativeName.trim()).not.toBe("");
    }
    expect(new Set(TRANSLATION_LANGUAGES.map((entry) => entry.zhName)).size).toBe(119);
    expect(new Set(TRANSLATION_LANGUAGES.map((entry) => entry.enName)).size).toBe(119);
    // Every real target resolves to itself, with a prompt name for the model.
    for (const entry of TRANSLATION_LANGUAGES.slice(1)) {
      const target = resolveTranslationTarget(entry.code, "en");
      expect(target.code).toBe(entry.code);
      expect(target.promptTarget.trim()).not.toBe("");
    }
  });

  it("preserves variant codes and script/region distinctions", () => {
    expect(findTranslationLanguage("zh-CN")).toBeDefined();
    expect(findTranslationLanguage("zh-TW")).toBeDefined();
    expect(findTranslationLanguage("wyw")).toBeDefined();
    expect(findTranslationLanguage("yue")).toBeDefined();
    expect(findTranslationLanguage("sr")).toBeDefined();
    expect(findTranslationLanguage("sr-Cyrl")).toBeDefined();
    expect(findTranslationLanguage("sr-Latn")).toBeDefined();
    expect(findTranslationLanguage("tlh")).toBeDefined();
    expect(findTranslationLanguage("tlh-Qaak")).toBeDefined();
    expect(findTranslationLanguage("fr")).toBeDefined();
    expect(findTranslationLanguage("pt")).toBeDefined();
    expect(findTranslationLanguage("mww")).toBeDefined();
    expect(findTranslationLanguage("hmn")).toBeDefined();
    expect(findTranslationLanguage("tn")).toBeDefined();
    expect(findTranslationLanguage("otq")).toBeDefined();
    expect(findTranslationLanguage("yua")).toBeDefined();
    expect(findTranslationLanguage("jw")).toBeDefined();
    expect(isTranslationLanguageCode("ug")).toBe(true);
    expect(isTranslationLanguageCode("unknown-xx")).toBe(false);
  });

  it("searches by code, English name, Chinese name, and native name", () => {
    expect(filterTranslationLanguages("").length).toBe(119);
    expect(filterTranslationLanguages("sr-latn").map((e) => e.code)).toEqual(["sr-Latn"]);
    expect(filterTranslationLanguages("tlh-Qaak").map((e) => e.code)).toEqual(["tlh-Qaak"]);
    expect(filterTranslationLanguages("Klingon").map((e) => e.code)).toEqual(["tlh", "tlh-Qaak"]);
    expect(filterTranslationLanguages("广东话").map((e) => e.code)).toEqual(["yue"]);
    expect(filterTranslationLanguages("日本語").map((e) => e.code)).toEqual(["ja"]);
    expect(filterTranslationLanguages("no-such-language-xyz")).toEqual([]);
  });

  it("resolves follow-interface dynamically and formats labels", () => {
    expect(resolveTranslationTarget("interface", "zh").code).toBe("zh-CN");
    expect(resolveTranslationTarget("interface", "en").code).toBe("en");
    expect(resolveTranslationTarget("ja", "zh").code).toBe("ja");
    expect(resolveTranslationTarget("ja", "en").code).toBe("ja");

    const interfaceEntry = findTranslationLanguage("interface")!;
    expect(formatTranslationLanguageLabel(interfaceEntry, "zh")).toBe("跟随界面语言");
    expect(formatTranslationLanguageLabel(interfaceEntry, "en")).toBe("Follow interface language");

    const jaEntry = findTranslationLanguage("ja")!;
    expect(formatTranslationLanguageLabel(jaEntry, "zh")).toContain("日本語");
    expect(formatTranslationLanguageLabel(jaEntry, "en")).toContain("Japanese");
  });
});
