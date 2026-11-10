import type { UserQuestion } from "../tools/user-questions";

export interface TaskQuestion extends UserQuestion {
  allowOther?: boolean;
  allowEmpty?: boolean;
  isSecret?: boolean;
  placeholder?: string;
}

/** Pending permissions already identify the question domain, including OMP tools. */
export function parseTaskQuestions(input: unknown): TaskQuestion[] | undefined {
  if (!input || typeof input !== "object" || !("questions" in input) || !Array.isArray(input.questions) || !input.questions.length) return;
  const questions: TaskQuestion[] = [];
  for (const raw of input.questions) {
    if (!raw || typeof raw !== "object") return;
    const q = raw as Record<string, unknown>;
    if (typeof q.question !== "string" || typeof q.header !== "string" || !Array.isArray(q.options)) return;
    const options: TaskQuestion["options"] = [];
    for (const rawOption of q.options) {
      if (!rawOption || typeof rawOption !== "object") return;
      const option = rawOption as Record<string, unknown>;
      if (typeof option.label !== "string") return;
      options.push({ label: option.label,
        ...(typeof option.description === "string" ? { description: option.description } : {}),
        ...(typeof option.preview === "string" ? { preview: option.preview } : {}) });
    }
    questions.push({ question: q.question, header: q.header, options, multiSelect: q.multiSelect === true,
      ...(typeof q.id === "string" ? { id: q.id } : {}),
      allowOther: q.allowOther === true || q.isOther === true, allowEmpty: q.allowEmpty === true,
      isSecret: q.isSecret === true, ...(typeof q.placeholder === "string" ? { placeholder: q.placeholder } : {}) });
  }
  return questions;
}

export interface QuestionDraft {
  selections: Record<number, number[]>;
  texts: Record<number, string>;
}

export const EMPTY_QUESTION_DRAFT: QuestionDraft = { selections: {}, texts: {} };

export function questionTextInput(q: TaskQuestion): boolean {
  return q.options.length === 0 || q.allowOther === true;
}

/** Match the host form's validation and string answer encoding. */
export function questionAnswers(questions: TaskQuestion[], draft: QuestionDraft): Record<string, string> | undefined {
  const entries: Array<[string, string]> = [];
  for (const [index, q] of questions.entries()) {
    const labels = (draft.selections[index] ?? []).map((option) => q.options[option]!.label);
    const text = questionTextInput(q) ? draft.texts[index]?.trim() : undefined;
    if (text) entries.push([q.header!, q.multiSelect ? [...labels, text].join(", ") : text]);
    else if (q.allowEmpty && q.options.length === 0) entries.push([q.header!, ""]);
    else if (labels.length) entries.push([q.header!, labels.join(", ")]);
    else return;
  }
  return Object.fromEntries(entries);
}

export function questionFormSupported(questions: TaskQuestion[] | undefined, provider: string, name?: string): boolean {
  if (!questions?.length || new Set(questions.map((q) => q.header)).size !== questions.length) return false;
  return questions.every((q) => !!q.header && new Set(q.options.map((o) => o.label)).size === q.options.length &&
    // Codex's synchronous bridge splits every comma, including commas inside labels.
    !(provider === "codex" && name === "request_user_input" && q.multiSelect &&
      q.options.some((o) => o.label.includes(","))));
}

export function questionDraftSupported(questions: TaskQuestion[], draft: QuestionDraft, provider: string, name?: string): boolean {
  return provider !== "codex" || name !== "request_user_input" || questions.every((q, index) =>
    !q.multiSelect || !questionTextInput(q) || !draft.texts[index]?.includes(","));
}
