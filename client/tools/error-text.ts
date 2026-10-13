/**
 * The text of a tool call's error, as the transformer stores it.
 *
 * The protocol types `error` as `unknown`. Providers send a string, an
 * `Error`-like `{ message }`, a Claude `tool_result` block whose `content`
 * holds the output, or some other object; `String()` on the objects gives
 * `"[object Object]"`, which then reads as the failure itself.
 */
export function toolErrorText(error: unknown): string | null {
  if (error === null || error === undefined || error === false || error === "") return null;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
    const content = resultText((error as { content?: unknown }).content);
    if (content) return content;
    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") return json;
    } catch {
      // A cycle: fall through to the generic text.
    }
    return "Tool call failed";
  }
  return String(error);
}

/** A `tool_result`'s content: a string, or text blocks joined by newlines. */
function resultText(content: unknown): string | null {
  if (typeof content === "string") return content.trim() ? content : null;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((block) => (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
      ? (block as { text: string }).text
      : ""))
    .filter(Boolean)
    .join("\n");
  return text.trim() ? text : null;
}
