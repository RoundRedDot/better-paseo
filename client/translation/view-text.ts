import { findTranslationLanguage } from "../../shared/translation-languages";
import { describeTranslationLimitation } from "../../shared/timeline-translation";
import { selectionViewTargetCode, type SelectionTranslationView } from "./selection";

/** The target language shown in a translation popup. */
export function selectionViewTitle(view: SelectionTranslationView, lang: "en" | "zh"): string {
  const code = selectionViewTargetCode(view);
  const target = code ? findTranslationLanguage(code) : undefined;
  if (!target) return "";
  return lang === "zh" ? target.zhName : target.enName;
}


/**
 * The host's limitations for a finished translation, in words. Every surface that shows a
 * translation shows these with it; a result from before the host reported limitations has none.
 */
export function selectionViewLimitations(view: SelectionTranslationView | null, lang: "en" | "zh"): string[] {
  if (view?.status !== "done") return [];
  return (view.result.limitations ?? []).map((id) => describeTranslationLimitation(id, lang));
}
