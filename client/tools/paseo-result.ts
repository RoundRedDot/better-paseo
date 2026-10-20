/** Normalize MCP's structured and JSON-text transports once, before presentation. */
export function readPaseoResult(output: unknown, outputText?: string): Record<string, unknown> | undefined {
  const envelope = record(output);
  const structured = record(envelope?.structuredContent);
  if (structured) return structured;
  if (envelope && !Array.isArray(envelope.content)) return envelope;
  const text = typeof output === "string" ? output : outputText;
  if (!text) return undefined;
  try { return record(JSON.parse(text)); } catch { return undefined; }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
