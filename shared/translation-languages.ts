/**
 * Target language catalog for timeline translation.
 *
 * Includes the 118 target language entries from Immersive Translate's language
 * list (excluding auto-detect) plus the leading "interface" option that follows
 * the active Better Paseo interface language.
 *
 * Keep comments and regexes strictly ASCII for Hermes bundle compilation.
 */

export interface TranslationLanguageEntry {
  readonly code: string;
  readonly zhName: string;
  readonly enName: string;
  readonly nativeName: string;
}

export const FOLLOW_INTERFACE_LANGUAGE_CODE = "interface";

export const TRANSLATION_LANGUAGES: readonly TranslationLanguageEntry[] = [
  { code: "interface", zhName: "跟随界面语言", enName: "Follow interface language", nativeName: "Follow interface language" },
  { code: "af", zhName: "阿非利卡语", enName: "Afrikaans", nativeName: "Afrikaans" },
  { code: "am", zhName: "阿姆哈拉语", enName: "Amharic", nativeName: "Amharic" },
  { code: "ar", zhName: "阿拉伯语", enName: "Arabic", nativeName: "Arabic" },
  { code: "az", zhName: "阿塞拜疆语", enName: "Azerbaijani", nativeName: "Azerbaijani" },
  { code: "be", zhName: "白俄罗斯语", enName: "Belarusian", nativeName: "Belarusian" },
  { code: "bg", zhName: "保加利亚语", enName: "Bulgarian", nativeName: "Bulgarian" },
  { code: "tn", zhName: "泽纳语", enName: "Zana", nativeName: "Zana" },
  { code: "bn", zhName: "孟加拉语", enName: "Bengali", nativeName: "Bengali" },
  { code: "bs", zhName: "波斯尼亚语", enName: "Bosnian", nativeName: "Bosnian" },
  { code: "ca", zhName: "加泰罗尼亚语", enName: "Catalan", nativeName: "Catalan" },
  { code: "ceb", zhName: "宿务语", enName: "Cebuano", nativeName: "Cebuano" },
  { code: "co", zhName: "科西嘉语", enName: "Corsican", nativeName: "Corsican" },
  { code: "cs", zhName: "捷克语", enName: "Czech", nativeName: "Czech" },
  { code: "cy", zhName: "威尔士语", enName: "Welsh", nativeName: "Welsh" },
  { code: "da", zhName: "丹麦语", enName: "Danish", nativeName: "Danish" },
  { code: "de", zhName: "德语", enName: "German", nativeName: "German" },
  { code: "el", zhName: "希腊语", enName: "Greek", nativeName: "Greek" },
  { code: "en", zhName: "英语", enName: "English", nativeName: "English" },
  { code: "eo", zhName: "世界语", enName: "Esperanto", nativeName: "Esperanto" },
  { code: "es", zhName: "西班牙语", enName: "Spanish", nativeName: "Spanish" },
  { code: "et", zhName: "爱沙尼亚语", enName: "Estonian", nativeName: "Estonian" },
  { code: "eu", zhName: "巴斯克语", enName: "Basque", nativeName: "Basque" },
  { code: "fa", zhName: "波斯语", enName: "Farsi", nativeName: "Farsi" },
  { code: "fi", zhName: "芬兰语", enName: "Finnish", nativeName: "Finnish" },
  { code: "fil", zhName: "菲律宾语", enName: "Filipino", nativeName: "Filipino" },
  { code: "fj", zhName: "斐济语", enName: "Fijian", nativeName: "Fijian" },
  { code: "fr", zhName: "法语", enName: "French", nativeName: "French" },
  { code: "fy", zhName: "弗里斯兰语", enName: "Frisian", nativeName: "Frisian" },
  { code: "ga", zhName: "爱尔兰语", enName: "Irish", nativeName: "Irish" },
  { code: "gd", zhName: "苏格兰盖尔语", enName: "Scottish Gaelic", nativeName: "Scottish Gaelic" },
  { code: "gl", zhName: "加利西亚语", enName: "Galician", nativeName: "Galician" },
  { code: "gu", zhName: "古吉拉特语", enName: "Gujarati", nativeName: "Gujarati" },
  { code: "ha", zhName: "豪萨语", enName: "Hausa", nativeName: "Hausa" },
  { code: "haw", zhName: "夏威夷语", enName: "Hawaiian", nativeName: "Hawaiian" },
  { code: "he", zhName: "希伯来语", enName: "Hebrew", nativeName: "Hebrew" },
  { code: "hi", zhName: "印地语", enName: "Hindi", nativeName: "Hindi" },
  { code: "hmn", zhName: "蒙语", enName: "Hmong", nativeName: "Hmong" },
  { code: "hr", zhName: "克罗地亚语", enName: "Croatian", nativeName: "Croatian" },
  { code: "ht", zhName: "海地克里奥尔语", enName: "Haitian Creole", nativeName: "Haitian Creole" },
  { code: "hu", zhName: "匈牙利语", enName: "Hungarian", nativeName: "Hungarian" },
  { code: "hy", zhName: "亚美尼亚语", enName: "Armenian", nativeName: "Armenian" },
  { code: "id", zhName: "印度尼西亚语", enName: "Indonesian", nativeName: "Indonesian" },
  { code: "ig", zhName: "伊博语", enName: "Igbo", nativeName: "Igbo" },
  { code: "is", zhName: "冰岛语", enName: "Icelandic", nativeName: "Icelandic" },
  { code: "it", zhName: "意大利语", enName: "Italian", nativeName: "Italian" },
  { code: "ja", zhName: "日本语", enName: "Japanese", nativeName: "日本語" },
  { code: "jw", zhName: "爪哇语", enName: "Javanese", nativeName: "Javanese" },
  { code: "ka", zhName: "格鲁吉亚语", enName: "Georgian", nativeName: "Georgian" },
  { code: "kk", zhName: "哈萨克语", enName: "Kazakh", nativeName: "Kazakh" },
  { code: "km", zhName: "高棉语", enName: "Khmer", nativeName: "Khmer" },
  { code: "kn", zhName: "卡纳达语", enName: "Kannada", nativeName: "Kannada" },
  { code: "ko", zhName: "韩语", enName: "Korean", nativeName: "Korean" },
  { code: "ku", zhName: "库尔德语", enName: "Kurdish", nativeName: "Kurdish" },
  { code: "ky", zhName: "吉尔吉斯语", enName: "Kyrgyz", nativeName: "Kyrgyz" },
  { code: "la", zhName: "拉丁语", enName: "Latin", nativeName: "Latin" },
  { code: "lb", zhName: "卢森堡语", enName: "Luxembourgish", nativeName: "Luxembourgish" },
  { code: "lo", zhName: "老挝语", enName: "Lao", nativeName: "Lao" },
  { code: "lt", zhName: "立陶宛语", enName: "Lithuanian", nativeName: "Lithuanian" },
  { code: "lv", zhName: "拉脱维亚语", enName: "Latvian", nativeName: "Latvian" },
  { code: "mg", zhName: "马尔加什语", enName: "Malagash", nativeName: "Malagash" },
  { code: "mi", zhName: "毛利语", enName: "Maori", nativeName: "Maori" },
  { code: "mk", zhName: "马其顿语", enName: "Macedonian", nativeName: "Macedonian" },
  { code: "ml", zhName: "马拉雅拉姆语", enName: "Malayalam", nativeName: "Malayalam" },
  { code: "mn", zhName: "蒙古语", enName: "Mongolian", nativeName: "Mongolian" },
  { code: "mr", zhName: "马拉地语", enName: "Marathi", nativeName: "Marathi" },
  { code: "ms", zhName: "马来语", enName: "Malay", nativeName: "Malay" },
  { code: "mt", zhName: "马耳他语", enName: "Maltese", nativeName: "Maltese" },
  { code: "mww", zhName: "白苗语", enName: "Bai Miao", nativeName: "Bai Miao" },
  { code: "my", zhName: "缅甸语", enName: "Burmese", nativeName: "Burmese" },
  { code: "ne", zhName: "尼泊尔语", enName: "Nepali", nativeName: "Nepali" },
  { code: "nl", zhName: "荷兰语", enName: "Dutch", nativeName: "Dutch" },
  { code: "no", zhName: "挪威语", enName: "Norwegian", nativeName: "Norwegian" },
  { code: "ny", zhName: "奇切瓦语", enName: "Nyanza (Chichewa)", nativeName: "Nyanza (Chichewa)" },
  { code: "otq", zhName: "奥托米语", enName: "Querétaro Otomi", nativeName: "Querétaro Otomi" },
  { code: "pa", zhName: "旁遮普语", enName: "Punjabi", nativeName: "Punjabi" },
  { code: "pl", zhName: "波兰语", enName: "Polish", nativeName: "Polish" },
  { code: "ps", zhName: "阿富汗/普什图语", enName: "Afghan/Pashto", nativeName: "Afghan/Pashto" },
  { code: "pt", zhName: "葡萄牙语", enName: "Portuguese (Portugal, Brazil)", nativeName: "Portuguese (Portugal, Brazil)" },
  { code: "ro", zhName: "罗马尼亚语", enName: "Romanian", nativeName: "Romanian" },
  { code: "ru", zhName: "俄罗斯语", enName: "Russian", nativeName: "Russian" },
  { code: "sd", zhName: "信德语", enName: "Sindhi", nativeName: "Sindhi" },
  { code: "si", zhName: "僧伽罗语", enName: "Sinhala", nativeName: "Sinhala" },
  { code: "sk", zhName: "斯洛伐克语", enName: "Slovak", nativeName: "Slovak" },
  { code: "sl", zhName: "斯洛文尼亚语", enName: "Slovenian", nativeName: "Slovenian" },
  { code: "sm", zhName: "萨摩亚语", enName: "Samoan", nativeName: "Samoan" },
  { code: "sn", zhName: "修纳语", enName: "Shona", nativeName: "Shona" },
  { code: "so", zhName: "索马里语", enName: "Somali", nativeName: "Somali" },
  { code: "sq", zhName: "阿尔巴尼亚语", enName: "Albanian", nativeName: "Albanian" },
  { code: "sr", zhName: "塞尔维亚语", enName: "Serbian", nativeName: "Serbian" },
  { code: "sr-Cyrl", zhName: "塞尔维亚语（西里尔文）", enName: "Serbian (Cyrillic)", nativeName: "Serbian (Cyrillic)" },
  { code: "sr-Latn", zhName: "塞尔维亚语（拉丁文）", enName: "Serbian (Latin)", nativeName: "Serbian (Latin)" },
  { code: "st", zhName: "塞索托语", enName: "Sesotho", nativeName: "Sesotho" },
  { code: "su", zhName: "巽他语", enName: "Sundanese", nativeName: "Sundanese" },
  { code: "sv", zhName: "瑞典语", enName: "Swedish", nativeName: "Swedish" },
  { code: "sw", zhName: "斯瓦希里语", enName: "Swahili", nativeName: "Swahili" },
  { code: "ta", zhName: "泰米尔语", enName: "Tamil", nativeName: "Tamil" },
  { code: "te", zhName: "泰卢固语", enName: "Telugu", nativeName: "Telugu" },
  { code: "tg", zhName: "塔吉克语", enName: "Tajik", nativeName: "Tajik" },
  { code: "th", zhName: "泰语", enName: "Thai", nativeName: "Thai" },
  { code: "tlh", zhName: "克林贡语", enName: "Klingon", nativeName: "Klingon" },
  { code: "tlh-Qaak", zhName: "克林贡语（piqaD）", enName: "Klingon (piqaD)", nativeName: "Klingon (piqaD)" },
  { code: "to", zhName: "汤加语", enName: "Tongan", nativeName: "Tongan" },
  { code: "tr", zhName: "土耳其语", enName: "Turkish", nativeName: "Turkish" },
  { code: "ty", zhName: "塔希提语", enName: "Tahiti", nativeName: "Tahiti" },
  { code: "ug", zhName: "维吾尔语", enName: "Uyghur", nativeName: "Uyghur" },
  { code: "uk", zhName: "乌克兰语", enName: "Ukrainian", nativeName: "Ukrainian" },
  { code: "ur", zhName: "乌尔都语", enName: "Urdu", nativeName: "Urdu" },
  { code: "uz", zhName: "乌兹别克语", enName: "Uzbek", nativeName: "Uzbek" },
  { code: "vi", zhName: "越南语", enName: "Vietnamese", nativeName: "Vietnamese" },
  { code: "wyw", zhName: "文言文", enName: "Classical Chinese", nativeName: "文言文" },
  { code: "xh", zhName: "班图语", enName: "Bantu", nativeName: "Bantu" },
  { code: "yi", zhName: "意第绪语", enName: "Yiddish", nativeName: "Yiddish" },
  { code: "yo", zhName: "约鲁巴语", enName: "Yoruba", nativeName: "Yoruba" },
  { code: "yua", zhName: "尤卡坦玛雅语", enName: "Yucatan Mayan", nativeName: "Yucatan Mayan" },
  { code: "yue", zhName: "广东话（传统）", enName: "Cantonese (Traditional)", nativeName: "Cantonese (Traditional)" },
  { code: "zh-CN", zhName: "简体中文", enName: "Simplified Chinese", nativeName: "简体中文" },
  { code: "zh-TW", zhName: "繁体中文", enName: "Traditional Chinese", nativeName: "繁體中文" },
  { code: "zu", zhName: "祖鲁语", enName: "Zulu", nativeName: "Zulu" },
];

const BY_CODE = new Map<string, TranslationLanguageEntry>(
  TRANSLATION_LANGUAGES.map((entry) => [entry.code, entry]),
);

export function isTranslationLanguageCode(code: string): boolean {
  return BY_CODE.has(code);
}

export function findTranslationLanguage(code: string): TranslationLanguageEntry | undefined {
  return BY_CODE.get(code);
}

export function formatTranslationLanguageLabel(entry: TranslationLanguageEntry, uiLanguage: "en" | "zh"): string {
  if (entry.code === FOLLOW_INTERFACE_LANGUAGE_CODE) {
    return uiLanguage === "zh" ? entry.zhName : entry.enName;
  }
  if (uiLanguage === "zh") {
    return entry.zhName === entry.nativeName ? entry.zhName : `${entry.zhName} \u00B7 ${entry.nativeName}`;
  }
  return entry.enName === entry.nativeName ? entry.enName : `${entry.enName} \u00B7 ${entry.nativeName}`;
}

export function filterTranslationLanguages(query: string): readonly TranslationLanguageEntry[] {
  const term = query.trim().toLowerCase();
  if (!term) return TRANSLATION_LANGUAGES;
  return TRANSLATION_LANGUAGES.filter((entry) =>
    entry.code.toLowerCase().includes(term) ||
    entry.zhName.toLowerCase().includes(term) ||
    entry.enName.toLowerCase().includes(term) ||
    entry.nativeName.toLowerCase().includes(term),
  );
}

export interface ResolvedTranslationTarget {
  code: string;
  entry: TranslationLanguageEntry;
  /** Human-readable target description included in the translation prompt. */
  promptTarget: string;
}

export function resolveTranslationTarget(
  configuredCode: string,
  interfaceLanguage: "en" | "zh",
): ResolvedTranslationTarget {
  const effectiveCode = configuredCode === FOLLOW_INTERFACE_LANGUAGE_CODE
    ? (interfaceLanguage === "zh" ? "zh-CN" : "en")
    : configuredCode;
  const entry = BY_CODE.get(effectiveCode) ?? BY_CODE.get(interfaceLanguage === "zh" ? "zh-CN" : "en")!;
  const promptTarget = entry.enName === entry.nativeName
    ? `${entry.enName} (${entry.code})`
    : `${entry.enName} / ${entry.nativeName} (${entry.code})`;
  return { code: entry.code, entry, promptTarget };
}
