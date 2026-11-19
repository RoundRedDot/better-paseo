import type { TranslationThinkingMode } from "../../shared/timeline-translation";
import { findTranslationLanguage } from "../../shared/translation-languages";
import { toolbarLabel } from "../i18n/toolbar-strings";
import { selectionViewTargetCode, type SelectionTranslationView } from "./selection";

/**
 * Text for a translation result, shared by the native popup and the web
 * selection bar. No UI imports: the bar is loaded by `client/web.ts`, and a
 * component graph here would import that module back.
 */
export function describeResultThinkingNotice(
  thinkingMode: TranslationThinkingMode,
  model: string,
  thinkingOptionId: string | null,
  disableThinkingRequested: boolean,
  lang: "en" | "zh",
): { tone: "warning" | "neutral"; text: string } | null {
  if (thinkingMode === "unsupported_off") {
    const applied = thinkingOptionId ? thinkingOptionId : (lang === "zh" ? "模型默认" : "model default");
    return {
      tone: "warning",
      text: lang === "zh"
        ? `当前模型 ${model} 不支持 off / none / disabled 思考选项，本次翻译未能关闭思考（实际使用：${applied}）。`
        : `Thinking was NOT disabled for ${model}: no off, none, or disabled option is available (used ${applied}).`,
    };
  }
  if (disableThinkingRequested && thinkingMode === "none") {
    return {
      tone: "neutral",
      text: lang === "zh"
        ? `${model} 未暴露可选思考开关，无法强制关闭或确认思考状态。`
        : `${model} exposes no thinking control; unable to force thinking off or confirm thinking state.`,
    };
  }
  return null;
}

/** The thinking notice a finished view carries, if any. */
export function selectionViewNotice(view: SelectionTranslationView, lang: "en" | "zh") {
  if (view.status !== "done") return null;
  const { result } = view;
  return describeResultThinkingNotice(result.thinkingMode, result.model, result.thinkingOptionId, view.disableThinking, lang);
}

/** "Translation · 简体中文": the header line of a translation popup. */
export function selectionViewTitle(view: SelectionTranslationView, lang: "en" | "zh"): string {
  const prefix = toolbarLabel("Translation", lang);
  const code = selectionViewTargetCode(view);
  const target = code ? findTranslationLanguage(code) : undefined;
  if (!target) return prefix;
  return `${prefix} · ${lang === "zh" ? target.zhName : target.enName}`;
}

