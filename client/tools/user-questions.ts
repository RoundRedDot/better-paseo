import type { ToolCallView } from "./classify";

export interface UserQuestion {
  id?: string;
  question: string;
  header?: string;
  multiSelect: boolean;
  options: { label: string; description?: string }[];
  answer?: string;
  selected?: string[];
}

export interface UserQuestionData {
  questions: UserQuestion[];
  running: boolean;
  dismissed?: boolean;
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

const QUESTION_TOOLS = new Set(["askuserquestion", "request_user_input", "request_user_input_async", "ask", "ask_user", "ask_user_question", "question"]);

function answerValues(value: unknown): string[] | undefined {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  const nested = record(value)?.answers;
  if (Array.isArray(nested) && nested.every((item) => typeof item === "string")) return nested;
  return undefined;
}

function resultAnswer(result: Record<string, unknown> | undefined, question: UserQuestion, singleQuestion: boolean): string[] | undefined {
  const rows = Array.isArray(result?.answers) ? result.answers : result?.results;
  const answer = Array.isArray(rows) ? rows.map(record).find((row) => row?.question === question.question) :
    result?.question === question.question || (singleQuestion && result?.question === undefined) ? result : undefined;
  if (!answer) return undefined;
  const selected = answerValues(answer.selectedOptions ?? answer.selected);
  const custom = text(answer.customInput) ?? text(answer.answer);
  return selected ? [...selected, ...(custom ? [custom] : [])] : custom !== undefined ? [custom] : undefined;
}

/** Structured timeline metadata is provider-independent; raw inputs require a known question tool. */
export function readUserQuestions(call: ToolCallView): UserQuestionData | undefined {
  if (!call.questionData && !QUESTION_TOOLS.has(call.name?.toLowerCase() ?? "")) return undefined;
  const input = call.questionData ?? record(jsonValue(call.input));
  if (!Array.isArray(input?.questions) || input.questions.length === 0) return undefined;
  const questions: UserQuestion[] = [];
  for (const value of input.questions) {
    const row = record(value);
    const question = text(row?.question) ?? text(row?.title);
    if (!row || !question || (row.options !== undefined && !Array.isArray(row.options))) return undefined;
    if (call.name?.toLowerCase() === "askuserquestion" && !Array.isArray(row.options)) return undefined;
    const options: UserQuestion["options"] = [];
    const rawOptions = Array.isArray(row.options) ? row.options : [];
    for (const value of rawOptions) {
      const option = record(value);
      const label = text(value) ?? text(option?.label);
      if (!label) return undefined;
      options.push({ label, description: text(option?.description) });
    }
    questions.push({ id: text(row.id), question, header: text(row.header),
      multiSelect: row.multiSelect === true || row.multi === true || row.multiple === true || row.allowMultiple === true, options });
  }

  // The timeline can carry updated input answers or the tool's JSON output.
  const output = record(jsonValue(call.output));
  const result = record(input.result) ?? record(output?.details) ?? output;
  const answers = record(input.answers) ?? record(output?.answers);
  const positionalAnswers = Array.isArray(input.answers) ? input.answers : Array.isArray(output?.answers) ? output.answers : undefined;
  const transcriptResponse = call.questionData && call.status !== "running" && input.status !== "pending" && input.status !== "dismissed" ? text(call.text) : undefined;
  const response = text(output?.output) ?? (output?.answers ? undefined : text(call.output)) ?? transcriptResponse;
  const summary = response?.match(/^(?:Your questions have been answered|User has answered your questions): ([\s\S]*)\. You can now continue with (?:the (?:user's )?|these )answers in mind\.$/)?.[1];
  for (const [index, question] of questions.entries()) {
    const value = (question.id ? answers?.[question.id] : undefined) ?? answers?.[question.question] ??
      (question.header ? answers?.[question.header] : undefined);
    const rawAnswer = value ?? positionalAnswers?.[index];
    const values = answerValues(rawAnswer) ?? resultAnswer(result, question, questions.length === 1);
    if (values !== undefined) {
      question.answer = values.join(", ");
      if (typeof rawAnswer !== "string") {
        question.selected = values.filter((answer) => question.options.some((option) => option.label === answer));
      }
    }
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
    running: input.status === "pending" || call.status === "running",
    dismissed: input.status === "dismissed" || result?.cancelled === true,
    response: questions.every((q) => q.answer !== undefined) ? undefined : response,
  };
}
