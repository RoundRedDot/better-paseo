import { findTranslationLanguage } from "../../shared/translation-languages";
import { selectionViewTargetCode, type SelectionTranslationView } from "./selection";

/** The target language shown in a translation popup. */
export function selectionViewTitle(view: SelectionTranslationView, lang: "en" | "zh"): string {
  const code = selectionViewTargetCode(view);
  const target = code ? findTranslationLanguage(code) : undefined;
  if (!target) return "";
  return lang === "zh" ? target.zhName : target.enName;
}

