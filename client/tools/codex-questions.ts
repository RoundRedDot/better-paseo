/**
 * Codex asks its async questions in a message and Paseo records them as a
 * `request_user_input_async` call whose only content is text
 * (`codex/async-questions.ts`): per question its title, then on the next line
 * the answer, or the options joined by ", " while none was given; questions
 * are separated by a blank line, and "Dismissed" ends a set the reader
 * dismissed. The structured questions are read back here, so the call draws
 * as the question card the other providers' questions get.
 */

const DISMISSED = /\n\nDismissed$/;

export function readCodexAsyncQuestions(text: unknown): Record<string, unknown> | undefined {
  if (typeof text !== "string" || !text.trim()) return undefined;
  const dismissed = DISMISSED.test(text);
  const blocks = text.replace(DISMISSED, "").split("\n\n").filter((block) => block.trim());
  if (!blocks.length) return undefined;
  const questions: Array<{ question: string; options: Array<{ label: string }> }> = [];
  const answers: Array<string | null> = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    // A question without options and without an answer is its title alone.
    const last = lines.length > 1 ? lines.pop()! : undefined;
    const question = lines.join("\n");
    questions.push({ question, options: dismissed && last ? last.split(", ").map((label) => ({ label })) : [] });
    answers.push(dismissed ? null : last ?? null);
  }
  return { questions, ...(dismissed ? { status: "dismissed" } : { answers }) };
}
