import { findTranslationLanguage } from "../../shared/translation-languages";
import { toolbarLabel } from "../i18n/toolbar-strings";
import { selectionViewTargetCode, type SelectionTranslationView } from "./selection";

/** "Translation · 简体中文": the header line of a translation popup. */
export function selectionViewTitle(view: SelectionTranslationView, lang: "en" | "zh"): string {
  const prefix = toolbarLabel("Translation", lang);
  const code = selectionViewTargetCode(view);
  const target = code ? findTranslationLanguage(code) : undefined;
  if (!target) return prefix;
  return `${prefix} · ${lang === "zh" ? target.zhName : target.enName}`;
}

