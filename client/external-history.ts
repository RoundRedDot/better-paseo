import type { PluginTimelineItem } from "@getpaseo/plugin";

/** Codex imports external tool events as tagged assistant text. */
export function externalHistoryRows(text: string, phase: string, messageId?: string) {
  if (phase !== "complete" || !text.includes("[external_agent_tool_")) return undefined;

  const opening = /\[external_agent_tool_(call: ([^\]\n]+)|result(?:: (error))?)\]\n/g;
  const parts: Array<{ kind: "text" | "tool"; text: string; name?: string; failed?: boolean; offset: number }> = [];
  let position = 0;
  let scanPosition = 0;
  let fence: string | undefined;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(text))) {
    const before = text.slice(scanPosition, match.index);
    for (const line of before.split("\n")) {
      const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (!delimiter) continue;
      if (!fence) fence = delimiter[1];
      else if (delimiter[1]![0] === fence[0] && delimiter[1]!.length >= fence.length && !delimiter[2]!.trim()) fence = undefined;
    }
    scanPosition = match.index;
    if (fence) continue;
    const close = match[2] ? "[/external_agent_tool_call]" : "[/external_agent_tool_result]";
    const end = text.startsWith(close, opening.lastIndex)
      ? opening.lastIndex : text.indexOf(`\n${close}`, opening.lastIndex);
    if (end < 0) return undefined;
    if (match.index > position) parts.push({ kind: "text", text: text.slice(position, match.index), offset: position });
    parts.push({ kind: "tool", name: match[2] ?? "Tool result", failed: Boolean(match[3]), text: text.slice(opening.lastIndex, end), offset: match.index });
    position = end + close.length + (end === opening.lastIndex ? 0 : 1);
    scanPosition = position;
    opening.lastIndex = position;
  }
  if (!parts.length) return undefined;
  if (position < text.length) parts.push({ kind: "text", text: text.slice(position), offset: position });

  const lastText = parts.findLastIndex((part) => part.kind === "text" && part.text.trim());
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  const rows: PluginTimelineItem[] = [];
  parts.forEach((part, index) => {
    if (part.kind === "tool") {
      rows.push({
      type: "plugin" as const, kind: "omp-tool-call", version: 1,
      data: { name: part.name!, status: part.failed ? "failed" : "completed", phase,
        callId: `external-history:${messageId ?? (hash >>> 0)}:${part.offset}`,
        detail: { type: "plain_text", label: part.name!, text: part.text } },
      });
      return;
    }
    if (!part.text.trim()) return;
    rows.push({
      type: "plugin" as const, kind: "omp-assistant", version: 1,
      data: { text: part.text, phase, blockIndex: index,
        ...(index === lastText ? { messageText: text } : {}) },
    });
  });
  return rows;
}
