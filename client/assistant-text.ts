/**
 * oh-my-pi gives an assistant message that carries tool calls only a single
 * "." text block, because some providers reject empty content. The transport
 * filler is not the model's reply, so the timeline and reply summaries skip it.
 */
export function isAssistantPlaceholder(text: string): boolean {
  return text.trim() === ".";
}
