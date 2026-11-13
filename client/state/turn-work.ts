import { startsTurn, type CompletedTurnFooter, type Entry, type TurnMarks } from "./turn-duration";
import { transformToolCall } from "../tools/transform";

export interface TurnWorkGroup {
  epoch: string;
  key: string;
  anchor: string;
  members: readonly string[];
  failed: number;
}

/** Content key for renderers; folding also requires the canonical cursor. */
export function turnWorkItemKey(item: Entry["item"], at: number): string | null {
  if (item.type === "reasoning") return `thought:${item.text}`;
  if (item.type === "tool_call" && item.callId) return `tool:${item.callId}`;
  return null;
}

/** Match the canonical record's last contributing sequence, never a range. */
export function turnWorkCursorKey(sourceKey: string, seq: number): string {
  return `${seq}:${sourceKey}`;
}

function recordKey(entry: Entry): string | null {
  const key = turnWorkItemKey(entry.item, 0);
  return key && Number.isSafeInteger(entry.seqEnd) && entry.seqEnd >= 0 ? turnWorkCursorKey(key, entry.seqEnd) : null;
}

function foldable(entry: Entry): boolean {
  const item = entry.item;
  if (item.type === "reasoning") return !!item.text.trim();
  if (item.type !== "tool_call" || item.status === "running" ||
    item.metadata?.approved === false || item.metadata?.questions ||
    /^(agent_message|task_notification|request_user_input_async|request_user_input|askuserquestion|question|exitplanmode)$/i.test(item.name)) return false;
  return transformToolCall({ item, phase: "complete" })?.items.length === 1;
}

/** Only whole, completed turns can fold. Ambiguous identities remain visible. */
export function completedTurnWork(
  entries: readonly Entry[], completed: readonly CompletedTurnFooter[], epoch: string,
  { marks, fromStart = false }: { marks?: TurnMarks; fromStart?: boolean } = {},
): Map<string, TurnWorkGroup> {
  const result = new Map<string, TurnWorkGroup>();
  const replies = new Map<number, Set<string>>();
  for (const footer of completed) {
    let texts = replies.get(footer.at);
    if (!texts) replies.set(footer.at, texts = new Set());
    texts.add(footer.text);
  }
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = recordKey(entry);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let start = 0;
  const close = (end: number) => {
    if (start === 0 && !fromStart && entries[start]?.item.type !== "user_message") return;
    let finished = false;
    let failed = 0;
    const members: string[] = [];
    for (let index = start; index <= end; index++) {
      const entry = entries[index]!;
      if (entry.item.type === "error" || (entry.item.type === "notification" && entry.item.level === "error")) return;
      if (entry.item.type === "assistant_message" && replies.get(Date.parse(entry.timestamp))?.has(entry.item.text)) finished = true;
      const key = recordKey(entry);
      if (key && counts.get(key) === 1 && foldable(entry)) {
        members.push(key);
        if (entry.item.type === "tool_call" && (entry.item.status === "failed" || entry.item.error)) failed++;
      }
    }
    if (!finished || members.length < 2) return;
    const group: TurnWorkGroup = { epoch, key: `${epoch}:${entries[start]!.seqStart}`, anchor: members[0]!, members, failed };
    for (const key of members) result.set(key, group);
  };
  for (let index = 1; index < entries.length; index++) {
    if (!startsTurn(entries[index - 1]!, entries[index]!, marks)) continue;
    close(index - 1);
    start = index;
  }
  if (entries.length) close(entries.length - 1);
  return result;
}
