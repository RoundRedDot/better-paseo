import type { ToolCallView } from "./classify";

export interface UserQuestion {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: { label: string; description?: string }[];
  answer?: string;
}

export interface UserQuestionData {
  questions: UserQuestion[];
  running: boolean;
  /** Preserve a response that does not contain the provider's answer summary. */
  response?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Read only Claude's named tool; an unrelated tool may also accept `questions`. */
export function readUserQuestions(call: ToolCallView): UserQuestionData | undefined {
  if (call.tool !== "unknown" || call.name?.toLowerCase() !== "askuserquestion") return undefined;
  const input = record(jsonValue(call.input));
  if (!Array.isArray(input?.questions) || input.questions.length === 0) return undefined;
  const questions: UserQuestion[] = [];
  for (const value of input.questions) {
    const row = record(value);
    const question = text(row?.question);
    if (!row || !question || !Array.isArray(row.options)) return undefined;
    const options: UserQuestion["options"] = [];
    for (const value of row.options) {
      const option = record(value);
      const label = text(option?.label);
      if (!label) return undefined;
      options.push({ label, description: text(option?.description) });
    }
    questions.push({ question, header: text(row.header), multiSelect: row.multiSelect === true, options });
  }

  // The timeline can carry updated input answers or the tool's JSON output.
  const output = record(jsonValue(call.output));
  const answers = record(input.answers) ?? record(output?.answers);
  const response = text(output?.output) ?? (output?.answers ? undefined : call.output);
  const summary = response?.match(/^Your questions have been answered: ([\s\S]*)\. You can now continue with the (?:user's )?answers in mind\.$/)?.[1];
  for (const question of questions) {
    question.answer = text(answers?.[question.question]) ?? (question.header ? text(answers?.[question.header]) : undefined);
    if (question.answer !== undefined || summary === undefined) continue;
    // Match the exact question text. Quotes and commas inside a question or
    // answer are content, not generic delimiters to split on.
    const marker = `"${question.question}"="`;
    const start = summary.indexOf(marker);
    if (start < 0) continue;
    const valueStart = start + marker.length;
    let end = summary.length - 1;
    for (const next of questions) {
      const boundary = summary.indexOf(`", "${next.question}"="`, valueStart);
      if (boundary >= 0) end = Math.min(end, boundary);
    }
    if (summary[end] === '"') {
      question.answer = summary.slice(valueStart, end);
    }
  }
  return {
    questions,
    running: call.status === "running",
    response: summary !== undefined && questions.every((q) => q.answer !== undefined) ? undefined : response,
  };
}
