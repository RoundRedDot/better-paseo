/**
 * Semantic `React.memo` comparators for the Live renderers (plan §3.2).
 *
 * Paseo 0.11.2 hands every row a fresh `theme` and a freshly parsed
 * `item.data` on every render, and re-renders the whole live head on every
 * streamed chunk. Reference equality therefore never holds, and every card in
 * the turn rebuilt its tokens, data and subtree per chunk. These comparators
 * decide by meaning instead:
 *
 * | renderer | skips the render when |
 * |---|---|
 * | tool call | same `callId`, same settled `status` (not running), same phase, error and plan verdict |
 * | reasoning | same text (length first) and phase |
 * | assistant | same text (length first), phase and timestamp |
 * | user message | same message ids, text, images and timestamp |
 * | todo / notice | same content |
 *
 * and, for all of them, the same agent, layout and theme colours. State a
 * renderer reads through hooks (preferences, agent snapshots, the disclosure
 * store) still updates it: memo only filters what arrives as props.
 */
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { themeKey } from "../ui/tokens/theme-key";

type Props<T> = Readonly<PluginTimelineItemProps<T>>;

/** Agent, layout and theme colours: what every renderer reads besides its item. */
export function sameFrame<T>(prev: Props<T>, next: Props<T>): boolean {
  return (
    prev.agentId === next.agentId &&
    prev.host?.id === next.host?.id &&
    prev.layout.compact === next.layout.compact &&
    prev.layout.platform === next.layout.platform &&
    (prev.theme === next.theme || themeKey(prev.theme) === themeKey(next.theme))
  );
}

function sameTime(prev: Date, next: Date): boolean {
  return prev === next || prev.getTime() === next.getTime();
}

/** Length first: a streamed text grows, so a changed length settles it cheaply. */
function sameText(prev: string | undefined, next: string | undefined): boolean {
  return (prev ?? "").length === (next ?? "").length && prev === next;
}

interface ToolData {
  status: string;
  callId?: string;
  phase?: string;
  error?: string | null;
  approved?: boolean;
  questionData?: Record<string, unknown>;
}

export function toolPropsEqual<T extends ToolData>(prev: Props<T>, next: Props<T>): boolean {
  if (!sameFrame(prev, next) || !sameTime(prev.timestamp, next.timestamp)) return false;
  const a = prev.item.data;
  const b = next.item.data;
  if (a === b) return true;
  // Without a call id there is no identity to trust; let it render.
  if (!a.callId || a.callId !== b.callId) return false;
  // A running call is the live one: its output is what is changing.
  if (a.status === "running" || a.status !== b.status) return false;
  // Async questions stay `completed` while their answer arrives later.
  if (JSON.stringify(a.questionData) !== JSON.stringify(b.questionData)) return false;
  return a.phase === b.phase && (a.error ?? null) === (b.error ?? null) && a.approved === b.approved;
}

interface TextData {
  text: string;
  phase?: string;
  blockIndex?: number;
  messageText?: string;
  listContinuation?: boolean;
}

export function reasoningPropsEqual<T extends TextData>(prev: Props<T>, next: Props<T>): boolean {
  // The host rewrites a thought's timestamp on every chunk, and the card does
  // not draw it, so the timestamp is deliberately not compared.
  const a = prev.item.data;
  const b = next.item.data;
  return sameFrame(prev, next) && a.phase === b.phase && sameText(a.text, b.text);
}

export function assistantPropsEqual<T extends TextData>(prev: Props<T>, next: Props<T>): boolean {
  const a = prev.item.data;
  const b = next.item.data;
  return (
    sameFrame(prev, next) &&
    sameTime(prev.timestamp, next.timestamp) &&
    a.phase === b.phase &&
    a.blockIndex === b.blockIndex && a.listContinuation === b.listContinuation && sameText(a.messageText, b.messageText) &&
    sameText(a.text, b.text)
  );
}

interface UserData {
  text: string;
  images?: string[];
  messageId?: string;
  clientMessageId?: string;
}

export function userMessagePropsEqual<T extends UserData>(prev: Props<T>, next: Props<T>): boolean {
  const a = prev.item.data;
  const b = next.item.data;
  return (
    sameFrame(prev, next) &&
    sameTime(prev.timestamp, next.timestamp) &&
    a.messageId === b.messageId &&
    a.clientMessageId === b.clientMessageId &&
    sameText(a.text, b.text) &&
    (a.images ?? []).join("\n") === (b.images ?? []).join("\n")
  );
}

interface TodoData {
  items: unknown;
  phase?: string;
}

export function todoPropsEqual<T extends TodoData>(prev: Props<T>, next: Props<T>): boolean {
  const a = prev.item.data;
  const b = next.item.data;
  if (!sameFrame(prev, next) || !sameTime(prev.timestamp, next.timestamp)) return false;
  if (a === b) return true;
  // A checklist is a handful of short rows; comparing it serialised is cheaper
  // than rebuilding the card.
  return a.phase === b.phase && JSON.stringify(a.items) === JSON.stringify(b.items);
}

interface NoticeData {
  level: string;
  message: string;
  fatal?: boolean;
}

export function noticePropsEqual<T extends NoticeData>(prev: Props<T>, next: Props<T>): boolean {
  const a = prev.item.data;
  const b = next.item.data;
  return (
    sameFrame(prev, next) &&
    sameTime(prev.timestamp, next.timestamp) &&
    a.level === b.level &&
    a.message === b.message &&
    (a.fatal ?? false) === (b.fatal ?? false)
  );
}
