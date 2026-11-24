/**
 * A turn's folded work, read from the entries the turn footer store already
 * holds (`turn-footers.ts`): the successful reads, edits, writes and commands
 * the standard level draws as one card instead of rows (`standard-fold.ts`).
 *
 * Pure. The store caches each turn's result by the entries it came from, and
 * the running turn's by the live calls the subscription delivered since.
 */
import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import { isAssistantPlaceholder } from "../assistant-text";
import { parseSystemEnvelope } from "../system-envelope";
import { foldedFilePath, foldedWorkVerb, type WorkVerb } from "../tools/standard-fold";
import { startsTurn, type Entry, type TurnMarks } from "./turn-duration";

export interface WorkStep {
  callId: string;
  verb: WorkVerb;
  filePath?: string;
  /** The call as last seen; only an opened step list reads more than the fields above. */
  item: ToolCallTimelineItem;
}

export interface WorkFile {
  path: string;
  /** The folded edits and writes of this path, in turn order. */
  callIds: readonly string[];
}

export interface TurnWork {
  key: string;
  running: boolean;
  /** The read reached the turn's start, so its steps and files are all here. */
  complete: boolean;
  /** Prompt to the turn's last item, when both are known and the turn ended. */
  durationMs: number | null;
  steps: readonly WorkStep[];
  /** Every tool call of the turn, folded into a step or still drawn as its own row. */
  toolCalls: number;
  /** Those calls as last seen, in turn order; the opened card counts them by kind. */
  calls: readonly ToolCallTimelineItem[];
  files: readonly WorkFile[];
  /**
   * The newest call still running that will fold once it succeeds (a
   * command, or a read, edit or write of a path): the running card's
   * status line shows it. `target` is the command or the path.
   */
  current: { callId: string; verb: WorkVerb; target: string } | null;
  /** The newest folded step, which the status line shows once nothing runs. */
  latest: WorkStep | null;
  /** The running turn's newest item is a thought (`thinking` of `collectTurnWork`). */
  thinking: boolean;
  /** The turn's first reasoning text, the source of the opened card's intent line. */
  intent: string | null;
  /** When the turn's first loaded item arrived: rows before it belong to earlier turns. */
  since: number;
}

export interface TurnSpan {
  start: number;
  end: number;
  /** The prompt that opened the turn, when one did. */
  prompt: { at: number; messageId?: string } | null;
  /** The last reply the footer store would pick (`completedTurnFooters`). */
  reply: { at: number; text: string } | null;
  active: boolean;
  /** Its first item is the turn's start, not just the first one loaded. */
  whole: boolean;
}

export interface TurnSplitOptions {
  running: boolean;
  activeTurnId: string | null;
  marks?: TurnMarks;
  fromStart: boolean;
}

/** The loaded entries as turns, split as `completedTurnFooters` splits them. */
export function splitTurns(entries: readonly Entry[], options: TurnSplitOptions): TurnSpan[] {
  const spans: TurnSpan[] = [];
  let start = 0;
  const close = (end: number) => {
    const first = entries[start]!;
    const active = options.running && (options.activeTurnId && first.turnId
      ? options.activeTurnId === first.turnId : end === entries.length - 1);
    let reply: TurnSpan["reply"] = null;
    for (let index = start; index <= end; index++) {
      const item = entries[index]!.item;
      if (item.type === "assistant_message" && item.text.trim() && !isAssistantPlaceholder(item.text) &&
        !parseSystemEnvelope(item.text)) reply = { at: Date.parse(entries[index]!.timestamp), text: item.text };
    }
    const prompt = first.item.type === "user_message"
      ? { at: Date.parse(first.timestamp), ...(first.item.messageId ? { messageId: first.item.messageId } : {}) } : null;
    spans.push({ start, end, prompt, reply: active ? null : reply, active,
      whole: first.item.type === "user_message" || start > 0 || options.fromStart });
  };
  for (let index = 1; index < entries.length; index++) {
    if (startsTurn(entries[index - 1]!, entries[index]!, options.marks)) {
      close(index - 1);
      start = index;
    }
  }
  if (entries.length) close(entries.length - 1);
  return spans;
}

function commandOf(item: ToolCallTimelineItem): string | null {
  return item.detail.type === "shell" && item.detail.command ? item.detail.command : null;
}

/** What a running call will fold as, and the command or path it names. */
function pendingStep(item: ToolCallTimelineItem): { verb: WorkVerb; target: string } | null {
  if (item.status !== "running") return null;
  const verb = foldedWorkVerb({ ...item, status: "completed" });
  if (!verb) return null;
  const target = verb === "command" ? commandOf(item) : foldedFilePath(item) ?? null;
  return target ? { verb, target } : null;
}

/**
 * The turn's folded steps and files. `live` holds calls the subscription
 * delivered after the read, by call ID; a running turn takes them in, newer
 * than the entries, in arrival order. `thinking`: the subscription's newest
 * item is a thought, which the standard level does not draw.
 */
export function collectTurnWork(entries: readonly Entry[], span: TurnSpan, key: string,
  live?: ReadonlyMap<string, ToolCallTimelineItem>, thinking = false): TurnWork {
  const calls = new Map<string, ToolCallTimelineItem>();
  let intent: string | null = null;
  for (let index = span.start; index <= span.end; index++) {
    const item = entries[index]!.item;
    if (item.type === "tool_call") calls.set(item.callId, item);
    else if (item.type === "reasoning" && intent === null && item.text.trim()) intent = item.text;
  }
  if (span.active && live) for (const [callId, item] of live) calls.set(callId, item);
  const steps: WorkStep[] = [];
  const files = new Map<string, string[]>();
  let current: TurnWork["current"] = null;
  for (const [callId, item] of calls) {
    const verb = foldedWorkVerb(item);
    if (!verb) {
      const pending = span.active ? pendingStep(item) : null;
      if (pending) current = { callId, ...pending };
      continue;
    }
    const filePath = verb === "edit" || verb === "write" || verb === "read" ? foldedFilePath(item) : undefined;
    steps.push({ callId, verb, ...(filePath ? { filePath } : {}), item });
    if ((verb === "edit" || verb === "write") && filePath) {
      const list = files.get(filePath);
      if (list) list.push(callId); else files.set(filePath, [callId]);
    }
  }
  const lastAt = Date.parse(entries[span.end]!.timestamp);
  const duration = span.prompt && !span.active ? lastAt - span.prompt.at : NaN;
  return {
    key,
    running: span.active,
    complete: span.whole,
    durationMs: Number.isFinite(duration) && duration >= 0 ? duration : null,
    steps,
    toolCalls: calls.size,
    calls: [...calls.values()],
    files: [...files].map(([path, callIds]) => ({ path, callIds })),
    current,
    latest: steps.at(-1) ?? null,
    thinking: span.active && thinking,
    intent,
    since: Date.parse(entries[span.start]!.timestamp),
  };
}

/** What a card's subscribers compare: members' status and kind, and the running command. */
export function workSignature(work: TurnWork | null): string {
  if (!work) return "";
  return [work.running, work.complete, work.durationMs, work.since, work.current?.callId ?? "", work.current?.verb ?? "",
    work.thinking, work.intent?.length ?? -1, work.toolCalls,
    ...work.steps.map((step) => `${step.callId}:${step.verb}:${step.filePath ?? ""}`)].join("|");
}

/** The part of a live call that can change a card: its status, kind and path. */
export function liveCallSignature(item: ToolCallTimelineItem): string {
  return `${item.status}|${foldedWorkVerb(item) ?? ""}|${foldedFilePath(item) ?? ""}|${commandOf(item) ?? ""}|${pendingStep(item)?.verb ?? ""}`;
}
